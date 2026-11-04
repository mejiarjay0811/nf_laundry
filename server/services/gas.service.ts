import {
  COUNTER_KEYS,
  LIMITS,
  SHEETS,
  type GasLogType,
  type GasTankStatus,
} from '../../shared/constants.js';
import { manilaDateKey, manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import type { GasLogDto, GasSummaryDto, GasTankDto, SessionUser } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { createExpense } from './expense.service.js';
import { countDryerCycles } from './machine.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * LPG, which for a laundry is the second-largest running cost after wages and
 * the one nobody can put a number on.
 *
 * The number that matters is cost per dryer cycle, and it is only honest once
 * a tank is spent: a tank half-used has served some unknown fraction of the
 * cycles it will serve, so dividing its price by the cycles so far would
 * flatter or damn it at random. So cost-per-cycle is written when a tank is
 * marked Empty, and the shop's average is taken across spent tanks only. While
 * a tank is running, the app shows cycles so far and an estimate of what is
 * left based on past tanks, clearly as an estimate.
 *
 * Buying a tank optionally books itself as an expense, the same way restocking
 * detergent does, so the gas shows up in the month's spending without being
 * entered twice.
 */

function toTankDto(row: RowView): GasTankDto {
  const status = (row.get('Status') || 'Full') as GasTankStatus;
  const cycles = row.num('Cycles Served');
  const stored = row.num('Cost Per Cycle');
  return {
    tankId: row.get('Tank ID'),
    label: row.get('Label'),
    supplier: row.get('Supplier'),
    sizeKg: row.num('Size Kg'),
    purchaseCost: row.num('Purchase Cost'),
    purchaseDate: row.get('Purchase Date'),
    installedAt: row.get('Installed At'),
    emptiedAt: row.get('Emptied At'),
    cyclesServed: cycles,
    // Null, not zero: "we do not know yet" and "it cost nothing" are different
    // claims, and a zero here would drag the shop average down silently.
    costPerCycle: status === 'Empty' || status === 'Returned' ? (stored || null) : null,
    expenseId: row.get('Expense ID'),
    status,
    notes: row.get('Notes'),
  };
}

function toLogDto(row: RowView): GasLogDto {
  return {
    logId: row.get('Log ID'),
    tankId: row.get('Tank ID'),
    tankLabel: row.get('Tank Label'),
    type: (row.get('Type') || 'Refill') as GasLogType,
    machineId: row.get('Machine ID'),
    cycles: row.num('Cycles'),
    estimatedKg: row.num('Estimated Kg'),
    cost: row.num('Cost'),
    recordedBy: row.get('Recorded By'),
    logDate: row.get('Log Date'),
    notes: row.get('Notes'),
  };
}

async function tankRows(fresh = false): Promise<readonly RowView[]> {
  return (await getStore().table(SHEETS.gasTanks, { fresh })).rows;
}

async function findTank(tankId: string, fresh = false): Promise<RowView> {
  const row = (await tankRows(fresh)).find((entry) => entry.get('Tank ID') === tankId);
  if (!row) throw notFound('Gas tank');
  return row;
}

/* ------------------------------------------------------------- reading */

export async function listTanks(includeReturned = false): Promise<GasTankDto[]> {
  return (await tankRows())
    .filter((row) => includeReturned || row.get('Status') !== 'Returned')
    .map(toTankDto)
    .sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
}

export async function listGasLogs(limit = 50): Promise<GasLogDto[]> {
  const table = await getStore().table(SHEETS.gasLogs);
  return table.rows
    .filter((row) => row.get('Status') !== 'Cancelled')
    .sort((a, b) => b.get('Log Date').localeCompare(a.get('Log Date')))
    .slice(0, limit)
    .map(toLogDto);
}

export async function gasSummary(): Promise<GasSummaryDto> {
  const tanks = (await tankRows()).map(toTankDto);
  const active = tanks.find((tank) => tank.status === 'In Use') ?? null;

  const spent = tanks.filter((tank) => tank.costPerCycle !== null && tank.cyclesServed > 0);
  const averageCostPerCycle = spent.length
    ? Math.round(
        (spent.reduce((sum, tank) => sum + toCentavos(tank.costPerCycle ?? 0), 0) / spent.length),
      ) / 100
    : null;
  const averageCyclesPerTank = spent.length
    ? Math.round(spent.reduce((sum, tank) => sum + tank.cyclesServed, 0) / spent.length)
    : null;

  const cyclesOnCurrentTank =
    active && active.installedAt ? await countDryerCycles(active.installedAt, manilaIso()) : 0;

  const month = manilaDateKey().slice(0, 7);
  const spendThisMonthC = tanks
    .filter((tank) => (tank.purchaseDate || '').startsWith(month))
    .reduce((sum, tank) => sum + toCentavos(tank.purchaseCost), 0);

  return {
    activeTank: active,
    averageCostPerCycle,
    averageCyclesPerTank,
    cyclesOnCurrentTank,
    // An estimate drawn from how past tanks behaved, floored at zero so a tank
    // running long does not report a negative number of cycles left.
    estimatedCyclesRemaining:
      averageCyclesPerTank === null ? null : Math.max(0, averageCyclesPerTank - cyclesOnCurrentTank),
    spendThisMonth: toPesos(spendThisMonthC),
    tanksInStock: tanks.filter((tank) => tank.status === 'Full').length,
  };
}

/* ------------------------------------------------------------- writing */

export async function recordTankPurchase(
  input: {
    label: string;
    supplier?: string;
    sizeKg: number;
    purchaseCost: number;
    purchaseDate?: string;
    recordAsExpense?: boolean;
    notes?: string;
  },
  actor: SessionUser,
): Promise<GasTankDto> {
  const label = normaliseText(input.label, 40);
  if (label.length < 1) throw badRequest('Give the tank a label, such as "Tank A".');

  const sizeKg = Number(input.sizeKg);
  if (!Number.isFinite(sizeKg) || sizeKg <= 0 || sizeKg > LIMITS.maxGasKg) {
    throw badRequest('Enter the tank size in kilograms.');
  }

  const cost = Number(input.purchaseCost);
  if (!Number.isFinite(cost) || cost < 0 || cost > LIMITS.maxExpenseAmount) {
    throw badRequest('Enter what the tank cost.');
  }

  return withNamedLock('gas:write', async () => {
    const tankId = await nextEntityId(
      COUNTER_KEYS.gasTankId,
      'GAS-',
      SHEETS.gasTanks,
      'Tank ID',
      5,
    );
    const purchaseDate = input.purchaseDate?.trim() || manilaDateKey();
    const timestamp = manilaIso();

    /*
     * Book the expense first. If it fails the tank is simply not recorded and
     * the user retries; the other order would leave a tank on the sheet that
     * the month's spending does not know about, which is the kind of silent
     * gap that makes the profit figure wrong without anyone noticing.
     */
    let expenseId = '';
    if (input.recordAsExpense && cost > 0) {
      const expense = await createExpense(
        {
          category: 'Utilities',
          description: 'LPG tank ' + label + ' (' + sizeKg + 'kg)',
          amount: cost,
          modeOfPayment: 'Cash',
          paidTo: normaliseText(input.supplier, 80),
          expenseDate: purchaseDate,
        } as never,
        actor,
      );
      expenseId = expense.expenseId;
    }

    await getStore().appendRecords(SHEETS.gasTanks, [
      {
        'Tank ID': tankId,
        Label: label,
        Supplier: normaliseText(input.supplier, 80),
        'Size Kg': String(sizeKg),
        'Purchase Cost': toPesos(toCentavos(cost)).toFixed(2),
        'Purchase Date': purchaseDate,
        'Installed At': '',
        'Emptied At': '',
        'Cycles Served': '0',
        'Cost Per Cycle': '',
        'Expense ID': expenseId,
        Status: 'Full',
        Notes: normaliseText(input.notes, LIMITS.maxNotesLength),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await writeLog(
      { tankId, tankLabel: label, type: 'Refill', cost, notes: 'Tank purchased' },
      actor,
    );

    await recordAudit({
      actor,
      action: 'GAS_TANK_CREATE',
      module: 'Gas',
      entityId: tankId,
      newValue: { label, sizeKg, cost, expenseId },
    });

    return toTankDto(await findTank(tankId, true));
  });
}

/** Put a tank on the line. Only one can be in use, which is how the shop works. */
export async function installTank(tankId: string, actor: SessionUser): Promise<GasTankDto> {
  return withNamedLock('gas:write', async () => {
    const rows = await tankRows(true);
    const inUse = rows.find((row) => row.get('Status') === 'In Use');
    if (inUse && inUse.get('Tank ID') !== tankId) {
      throw conflict(
        'Tank ' + inUse.get('Label') + ' is still connected. Mark it empty first.',
      );
    }

    const row = rows.find((entry) => entry.get('Tank ID') === tankId);
    if (!row) throw notFound('Gas tank');
    if (row.get('Status') !== 'Full') throw conflict('Only a full tank can be connected.');

    const timestamp = manilaIso();
    await getStore().updateRecord(SHEETS.gasTanks, row, {
      Status: 'In Use',
      'Installed At': timestamp,
      'Updated At': timestamp,
    });

    await writeLog(
      { tankId, tankLabel: row.get('Label'), type: 'Install', notes: 'Connected' },
      actor,
    );
    await recordAudit({
      actor,
      action: 'GAS_TANK_INSTALL',
      module: 'Gas',
      entityId: tankId,
    });

    return toTankDto(await findTank(tankId, true));
  });
}

/**
 * The tank ran out. This is the only moment its true cost per cycle is known,
 * so it is computed and frozen here rather than recalculated later from usage
 * rows that may since have been archived.
 */
export async function markTankEmpty(
  tankId: string,
  input: { cyclesOverride?: number; notes?: string },
  actor: SessionUser,
): Promise<GasTankDto> {
  return withNamedLock('gas:write', async () => {
    const row = await findTank(tankId, true);
    if (row.get('Status') !== 'In Use') throw conflict('That tank is not connected.');

    const installedAt = row.get('Installed At');
    const emptiedAt = manilaIso();

    const counted = installedAt ? await countDryerCycles(installedAt, emptiedAt) : 0;
    const override = Number(input.cyclesOverride);
    // The counter only sees loads that were actually logged against a dryer.
    // A shop still getting into the habit can correct it by hand rather than
    // being stuck with a cost-per-cycle it knows is wrong.
    const cycles =
      Number.isFinite(override) && override > 0 ? Math.min(override, LIMITS.maxCycles) : counted;

    const costC = toCentavos(row.num('Purchase Cost'));
    const costPerCycleC = cycles > 0 ? Math.round(costC / cycles) : 0;

    await getStore().updateRecord(SHEETS.gasTanks, row, {
      Status: 'Empty',
      'Emptied At': emptiedAt,
      'Cycles Served': String(cycles),
      'Cost Per Cycle': cycles > 0 ? toPesos(costPerCycleC).toFixed(2) : '',
      Notes: normaliseText(input.notes, LIMITS.maxNotesLength) || row.get('Notes'),
      'Updated At': emptiedAt,
    });

    await writeLog(
      {
        tankId,
        tankLabel: row.get('Label'),
        type: 'Consumption',
        cycles,
        estimatedKg: row.num('Size Kg'),
        cost: toPesos(costC),
        notes: cycles === counted ? 'Counted from dryer loads' : 'Cycle count entered by hand',
      },
      actor,
    );

    await recordAudit({
      actor,
      action: 'GAS_TANK_EMPTY',
      module: 'Gas',
      entityId: tankId,
      newValue: { cycles, costPerCycle: toPesos(costPerCycleC) },
    });

    return toTankDto(await findTank(tankId, true));
  });
}

async function writeLog(
  entry: {
    tankId: string;
    tankLabel: string;
    type: GasLogType;
    machineId?: string;
    cycles?: number;
    estimatedKg?: number;
    cost?: number;
    notes?: string;
  },
  actor: SessionUser,
): Promise<void> {
  const logId = await nextEntityId(COUNTER_KEYS.gasLogId, 'GLG-', SHEETS.gasLogs, 'Log ID', 6);
  const timestamp = manilaIso();

  await getStore().appendRecords(SHEETS.gasLogs, [
    {
      'Log ID': logId,
      'Tank ID': entry.tankId,
      'Tank Label': entry.tankLabel,
      Type: entry.type,
      'Machine ID': entry.machineId ?? '',
      Cycles: String(entry.cycles ?? 0),
      'Estimated Kg': String(entry.estimatedKg ?? 0),
      Cost: toPesos(toCentavos(entry.cost ?? 0)).toFixed(2),
      'Recorded By': actor.username,
      'Log Date': timestamp,
      Notes: normaliseText(entry.notes, LIMITS.maxNotesLength),
      Status: 'Active',
      'Created At': timestamp,
    },
  ]);
}
