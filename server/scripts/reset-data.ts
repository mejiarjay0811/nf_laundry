/**
 * Clear trading data and restart the numbering, keeping the setup intact.
 *
 *   npm run reset:data              -- preview only, changes nothing
 *   npm run reset:data -- --confirm -- actually do it
 *
 * Removes:  Transactions, Payments, Customers, AuditLogs
 * Keeps:    Users, Services, Settings
 * Resets:   the O.R., transaction, customer and payment counters, so the next
 *           sale is issued OR-000001 again. The user counter is left alone,
 *           because the accounts it numbered still exist.
 *
 * CLI only. No HTTP route reaches this, by design.
 */
import { COUNTER_KEYS, SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { env } from '../env.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { recordAudit } from '../services/audit.service.js';

/** Sheets whose rows are trading data, safe to clear. */
const CLEARABLE = [SHEETS.transactions, SHEETS.payments, SHEETS.customers, SHEETS.auditLogs];

/** Sheets that hold configuration and accounts — never touched here. */
const PRESERVED = [SHEETS.users, SHEETS.services, SHEETS.settings];

/** Counters to zero. USER_ID is excluded: those accounts still exist. */
const COUNTERS_TO_RESET = [
  COUNTER_KEYS.orNumber,
  COUNTER_KEYS.customerId,
  COUNTER_KEYS.paymentId,
];

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm');
  const store = getStore();

  console.log('');
  console.log('N & F LAUNDRY POS — reset trading data');
  console.log('  provider: ' + store.gateway.name);
  console.log('');

  await store.connect();

  // --- Show exactly what would go, before anything is touched --------------
  const counts: Record<string, number> = {};
  for (const sheet of CLEARABLE) {
    const table = await store.table(sheet, { fresh: true });
    counts[sheet] = table.size;
  }

  console.log('  Will be cleared:');
  for (const sheet of CLEARABLE) {
    console.log('    ' + sheet.padEnd(14) + String(counts[sheet] ?? 0).padStart(4) + ' row(s)');
  }
  console.log('');
  console.log('  Will be kept:');
  for (const sheet of PRESERVED) {
    const table = await store.table(sheet, { fresh: true });
    console.log('    ' + sheet.padEnd(14) + String(table.size).padStart(4) + ' row(s)');
  }
  console.log('');

  const counters = await store.table(SHEETS.counters, { fresh: true });
  const resettable = counters.rows.filter((row) => {
    const name = row.get('Name');
    return COUNTERS_TO_RESET.includes(name as never) || name.startsWith('TXN_');
  });
  console.log('  Counters to reset:');
  if (resettable.length === 0) {
    console.log('    (none)');
  } else {
    for (const row of resettable) {
      console.log('    ' + row.get('Name').padEnd(20) + row.get('Value'));
    }
  }
  console.log('');

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);

  if (!confirmed) {
    console.log('  Nothing was changed. This was a preview.');
    console.log('  Re-run with --confirm to remove ' + total + ' row(s):');
    console.log('');
    console.log('      npm run reset:data -- --confirm');
    console.log('');
    process.exit(0);
  }

  if (env.NODE_ENV === 'production') {
    console.log('  Refusing to run with NODE_ENV=production.');
    console.log('  Set NODE_ENV=development for this maintenance command.');
    console.log('');
    process.exit(1);
  }

  // --- Do it ---------------------------------------------------------------
  console.log('  Clearing…');
  let removed = 0;
  for (const sheet of CLEARABLE) {
    const result = await store.gateway.clearSheetData(sheet, 'DELETE_ALL_ROWS');
    removed += result.removed;
    console.log('    ' + sheet.padEnd(14) + 'removed ' + result.removed + ' row(s)');
  }

  // Zero the counters in place rather than deleting them, so the next sale
  // reseeds from the (now empty) tables and starts at 1.
  if (resettable.length > 0) {
    const fresh = await store.table(SHEETS.counters, { fresh: true });
    const stamp = manilaIso();
    const updates = fresh.rows
      .filter((row) => {
        const name = row.get('Name');
        return COUNTERS_TO_RESET.includes(name as never) || name.startsWith('TXN_');
      })
      .map((row) => ({ row, patch: { Value: '0', 'Updated At': stamp } }));

    if (updates.length > 0) {
      await store.updateRecords(SHEETS.counters, updates);
      console.log('    Counters      reset ' + updates.length + ' sequence(s) to 0');
    }
  }

  store.invalidateAll();

  // The reset itself is the first entry in the fresh audit trail.
  await recordAudit({
    actor: null,
    action: 'SHEET_INIT',
    module: 'System',
    entityId: 'reset',
    newValue: { removedRows: removed, cleared: CLEARABLE, countersReset: resettable.length },
  });

  console.log('');
  console.log('  Done. Removed ' + removed + ' row(s). The next sale will be OR-000001.');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Reset failed', errorMeta(error));
    console.error('');
    console.error('Reset failed: ' + (error instanceof Error ? error.message : String(error)));
    console.error('');
    process.exit(1);
  });
