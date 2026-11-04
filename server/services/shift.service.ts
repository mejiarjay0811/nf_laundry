import {
  COUNTER_KEYS,
  LIMITS,
  SHEETS,
  type CashMovementType,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { can } from '../../shared/permissions.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type {
  CashMovementDto,
  CashShiftDto,
  Paginated,
  SessionUser,
  ShiftReconciliationDto,
} from '../../shared/types.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * A cashier's drawer, from count to count.
 *
 * The expected figure is never stored as a fact — it is derived from the
 * Payments ledger every time it is asked for. Storing it would create a second
 * version of the truth, and the moment the two disagreed the ledger would
 * still be the one that was right. The sheet keeps the *result* of a close
 * (counted, expected at that moment, variance) so a past shift can be audited
 * without replaying it, but a live shift is always computed.
 *
 * Cash is attributed by who received it, not merely by when. Two cashiers can
 * have overlapping shifts on a busy Saturday, and a window-only rule would put
 * one person's takings in the other's drawer.
 */

const PESO = (centavos: number): number => toPesos(centavos);

function toShiftDto(row: RowView): CashShiftDto {
  const closed = row.get('Status') === 'Closed';
  return {
    shiftId: row.get('Shift ID'),
    userId: row.get('User ID'),
    username: row.get('Username'),
    fullName: row.get('Full Name'),
    openedAt: row.get('Opened At'),
    closedAt: row.get('Closed At') || null,
    openingFloat: row.num('Opening Float'),
    countedCash: closed ? row.num('Counted Cash') : null,
    expectedCash: closed ? row.num('Expected Cash') : null,
    variance: closed ? row.num('Variance') : null,
    status: closed ? 'Closed' : 'Open',
    openingNote: row.get('Opening Note'),
    closingNote: row.get('Closing Note'),
    closedBy: row.get('Closed By'),
  };
}

function toMovementDto(row: RowView): CashMovementDto {
  return {
    movementId: row.get('Movement ID'),
    shiftId: row.get('Shift ID'),
    type: (row.get('Type') || 'Cash In') as CashMovementType,
    amount: row.num('Amount'),
    reason: row.get('Reason'),
    reference: row.get('Reference'),
    recordedBy: row.get('Recorded By'),
    movementDate: row.get('Movement Date'),
  };
}

async function shiftRows(fresh = false): Promise<readonly RowView[]> {
  const table = await getStore().table(SHEETS.shifts, { fresh });
  return table.rows;
}

async function findShiftRow(shiftId: string, fresh = false): Promise<RowView> {
  const row = (await shiftRows(fresh)).find((entry) => entry.get('Shift ID') === shiftId);
  if (!row) throw notFound('Shift');
  return row;
}

/* ------------------------------------------------------------ reading */

/** The shift this account currently has open, if any. */
export async function openShiftFor(userId: string): Promise<CashShiftDto | null> {
  const row = (await shiftRows()).find(
    (entry) => entry.get('User ID') === userId && entry.get('Status') !== 'Closed',
  );
  return row ? toShiftDto(row) : null;
}

export async function listShifts(query: {
  page: number;
  pageSize: number;
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<Paginated<CashShiftDto>> {
  const rows = (await shiftRows())
    .filter((row) => {
      if (query.userId && row.get('User ID') !== query.userId) return false;
      if (query.status && row.get('Status') !== query.status) return false;
      const opened = row.get('Opened At').slice(0, 10);
      if (query.from && opened < query.from) return false;
      if (query.to && opened > query.to) return false;
      return true;
    })
    // Newest first: the shift someone wants is almost always the last one.
    .sort((a, b) => b.get('Opened At').localeCompare(a.get('Opened At')));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: rows.slice(start, start + query.pageSize).map(toShiftDto),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / query.pageSize)),
  };
}

/**
 * Rebuild what the drawer should hold.
 *
 * Cash only. GCash never passes through the till, so counting it here would
 * guarantee a variance on every single shift and train people to ignore the
 * number — which defeats the point of counting at all.
 */
export async function reconcileShift(shiftId: string): Promise<ShiftReconciliationDto> {
  const row = await findShiftRow(shiftId);
  const shift = toShiftDto(row);

  const openedAt = shift.openedAt;
  const closedAt = shift.closedAt ?? manilaIso();

  const paymentsTable = await getStore().table(SHEETS.payments);
  let cashSalesC = 0;
  let salesCount = 0;
  for (const payment of paymentsTable.rows) {
    if (payment.get('Status') !== 'Active') continue;
    if (payment.get('Mode of Payment') !== 'Cash') continue;
    if (payment.get('Received By') !== shift.username) continue;
    const at = payment.get('Payment Date');
    if (at < openedAt || at > closedAt) continue;
    cashSalesC += toCentavos(payment.num('Amount'));
    salesCount += 1;
  }

  const movementTable = await getStore().table(SHEETS.cashMovements);
  const movements = movementTable.rows.filter(
    (entry) => entry.get('Shift ID') === shiftId && entry.get('Status') !== 'Cancelled',
  );

  let cashInC = 0;
  let cashOutC = 0;
  for (const movement of movements) {
    const amountC = toCentavos(movement.num('Amount'));
    // A drop is cash leaving the drawer for the safe, so it reduces what should
    // be in the till exactly as a payout does.
    if (movement.get('Type') === 'Cash In' || movement.get('Type') === 'Float') cashInC += amountC;
    else cashOutC += amountC;
  }

  const openingC = toCentavos(shift.openingFloat);
  const expectedC = openingC + cashSalesC + cashInC - cashOutC;

  return {
    shift,
    openingFloat: PESO(openingC),
    cashSales: PESO(cashSalesC),
    cashIn: PESO(cashInC),
    cashOut: PESO(cashOutC),
    expectedCash: PESO(expectedC),
    salesCount,
    movements: movements
      .sort((a, b) => a.get('Movement Date').localeCompare(b.get('Movement Date')))
      .map(toMovementDto),
  };
}

/* ------------------------------------------------------------ writing */

export async function openShift(
  input: { openingFloat: number; note?: string },
  actor: SessionUser,
): Promise<CashShiftDto> {
  const openingFloat = Number(input.openingFloat);
  if (!Number.isFinite(openingFloat) || openingFloat < 0) {
    throw badRequest('Enter the cash the drawer starts with, or zero.');
  }
  if (openingFloat > LIMITS.maxCashAmount) throw badRequest('That float is out of range.');

  return withNamedLock('shifts:write', async () => {
    // Re-read inside the lock: two taps on a slow connection must not open two
    // shifts for the same person, which would split their takings in half.
    const existing = (await shiftRows(true)).find(
      (entry) => entry.get('User ID') === actor.userId && entry.get('Status') !== 'Closed',
    );
    if (existing) {
      throw conflict('You already have a shift open. Close it before starting another.');
    }

    const shiftId = await nextEntityId(COUNTER_KEYS.shiftId, 'SHF-', SHEETS.shifts, 'Shift ID', 5);
    const timestamp = manilaIso();

    await getStore().appendRecords(SHEETS.shifts, [
      {
        'Shift ID': shiftId,
        'User ID': actor.userId,
        Username: actor.username,
        'Full Name': actor.fullName,
        'Opened At': timestamp,
        'Closed At': '',
        'Opening Float': toPesos(toCentavos(openingFloat)).toFixed(2),
        'Counted Cash': '',
        'Expected Cash': '',
        Variance: '',
        Status: 'Open',
        'Opening Note': normaliseText(input.note, LIMITS.maxNotesLength),
        'Closing Note': '',
        'Closed By': '',
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'SHIFT_OPEN',
      module: 'Shifts',
      entityId: shiftId,
      newValue: { openingFloat },
    });

    return toShiftDto(await findShiftRow(shiftId, true));
  });
}

export async function closeShift(
  shiftId: string,
  input: { countedCash: number; note?: string },
  actor: SessionUser,
): Promise<ShiftReconciliationDto> {
  const countedCash = Number(input.countedCash);
  if (!Number.isFinite(countedCash) || countedCash < 0) {
    throw badRequest('Enter the cash actually counted in the drawer.');
  }
  if (countedCash > LIMITS.maxCashAmount) throw badRequest('That amount is out of range.');

  return withNamedLock('shifts:write', async () => {
    const row = await findShiftRow(shiftId, true);
    if (row.get('Status') === 'Closed') throw conflict('That shift is already closed.');

    /*
     * Your own drawer, or a supervisor's. A cashier closing someone else's
     * shift would attribute a variance to a person who was not standing there.
     */
    const ownShift = row.get('User ID') === actor.userId;
    if (!ownShift && !can(actor.role, 'shifts.reconcile')) {
      throw forbidden('Only a manager can close another cashier’s shift.');
    }

    const reconciliation = await reconcileShift(shiftId);
    const expectedC = toCentavos(reconciliation.expectedCash);
    const countedC = toCentavos(countedCash);
    const timestamp = manilaIso();

    await getStore().updateRecord(SHEETS.shifts, row, {
      'Closed At': timestamp,
      'Counted Cash': toPesos(countedC).toFixed(2),
      'Expected Cash': toPesos(expectedC).toFixed(2),
      Variance: toPesos(countedC - expectedC).toFixed(2),
      Status: 'Closed',
      'Closing Note': normaliseText(input.note, LIMITS.maxNotesLength),
      'Closed By': actor.username,
      'Updated At': timestamp,
    });

    await recordAudit({
      actor,
      action: 'SHIFT_CLOSE',
      module: 'Shifts',
      entityId: shiftId,
      newValue: {
        counted: countedCash,
        expected: reconciliation.expectedCash,
        variance: PESO(countedC - expectedC),
      },
    });

    return reconcileShift(shiftId);
  });
}

export async function recordCashMovement(
  input: {
    shiftId: string;
    type: CashMovementType;
    amount: number;
    reason: string;
    reference?: string;
  },
  actor: SessionUser,
): Promise<CashMovementDto> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('Enter an amount greater than zero.');
  }
  if (amount > LIMITS.maxCashAmount) throw badRequest('That amount is out of range.');

  const reason = normaliseText(input.reason, 160);
  if (reason.length < 2) throw badRequest('Say what the money was for.');

  return withNamedLock('shifts:write', async () => {
    const shift = await findShiftRow(input.shiftId, true);
    if (shift.get('Status') === 'Closed') {
      throw conflict('That shift is closed. Movements can only be added to an open shift.');
    }

    const movementId = await nextEntityId(
      COUNTER_KEYS.cashMovementId,
      'CMV-',
      SHEETS.cashMovements,
      'Movement ID',
      6,
    );
    const timestamp = manilaIso();

    await getStore().appendRecords(SHEETS.cashMovements, [
      {
        'Movement ID': movementId,
        'Shift ID': input.shiftId,
        Type: input.type,
        Amount: toPesos(toCentavos(amount)).toFixed(2),
        Reason: reason,
        Reference: normaliseText(input.reference, 80),
        'Recorded By': actor.username,
        'Movement Date': timestamp,
        Status: 'Active',
        'Created At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'CASH_MOVEMENT',
      module: 'Shifts',
      entityId: movementId,
      newValue: { shiftId: input.shiftId, type: input.type, amount, reason },
    });

    const table = await getStore().table(SHEETS.cashMovements, { fresh: true });
    const created = table.rows.find((row) => row.get('Movement ID') === movementId);
    if (!created) throw notFound('Cash movement');
    return toMovementDto(created);
  });
}

