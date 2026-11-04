/**
 * Connection preflight.
 *
 *   npm run check
 *
 * Reports exactly which part of the Google Sheets setup is wrong, in plain
 * language, without writing anything to the workbook.
 */
import { env } from '../env.js';
import { AppError } from '../errors.js';
import { AppsScriptGateway } from '../sheets/drivers/appsScript.js';
import { getStore } from '../sheets/index.js';
import { inspectWorkbook } from '../sheets/init.js';
import { SHEET_DEFINITIONS } from '../sheets/schema.js';

const tick = '\u2713';
const cross = '\u2717';
const warn = '\u25B3';

function line(symbol: string, message: string): void {
  console.log('  ' + symbol + ' ' + message);
}

const REMEDIES: Record<string, string[]> = {
  NOT_CONFIGURED: [
    'apps-script: confirm the deployment is "Execute as: Me" and "Who has access: Anyone",',
    '             and that APPS_SCRIPT_TOKEN matches the API_TOKEN script property.',
    'google-api:  share the spreadsheet with the service-account email as an Editor.',
  ],
  DATA_SOURCE_UNAVAILABLE: [
    'The endpoint could not be reached. Check the URL and your internet connection.',
  ],
  DATA_SOURCE_TIMEOUT: [
    'The data source did not answer in time. Retry; if it persists raise APPS_SCRIPT_TIMEOUT_MS.',
  ],
  NOT_FOUND: [
    'The spreadsheet or a sheet was not found. Check GOOGLE_SPREADSHEET_ID.',
  ],
};

async function main(): Promise<void> {
  console.log('\nN & F LAUNDRY POS \u2014 connection check\n');

  const store = getStore();
  console.log('  provider : ' + store.gateway.name);
  console.log('  target   : ' + (store.gateway.name === 'local' ? store.gateway.target : (env.GOOGLE_SPREADSHEET_ID ?? 'configured')));
  console.log('');

  if (store.gateway.name === 'local') {
    line(warn, 'Using the LOCAL file driver \u2014 this is development storage, not Google Sheets.');
    line(' ', 'Set SHEETS_PROVIDER=apps-script (or google-api) in .env to use the real workbook.');
    console.log('');
  }

  let latency: number;
  try {
    latency = await store.ping();
    line(tick, 'Reachable (' + latency + ' ms round trip)');
  } catch (error) {
    line(cross, 'Cannot reach the data source.');
    if (error instanceof AppError) {
      console.log('\n    ' + error.message);
      for (const remedy of REMEDIES[error.code] ?? []) console.log('    ' + remedy);
    } else {
      console.log('\n    ' + (error as Error).message);
    }
    console.log('');
    process.exit(1);
  }

  // Report which build of the Apps Script is actually deployed. A Web App
  // serves a version snapshot, so a saved editor and a live deployment can
  // easily disagree — this makes that visible instead of mysterious.
  if (store.gateway instanceof AppsScriptGateway) {
    try {
      const info = await store.gateway.scriptInfo();
      if (info.version === null) {
        line(warn, 'Deployed script predates the version marker. Re-deploy to update it.');
      } else {
        line(tick, 'Deployed script version ' + info.version + ' (' + info.ops.length + ' operations).');
      }
      const expected = ['bumpCounters', 'appendMany', 'readTables', 'clearSheetData'];
      const missing = expected.filter((op) => !info.ops.includes(op));
      if (info.version !== null && missing.length > 0) {
        line(warn, 'Deployed script is missing: ' + missing.join(', '));
      }
    } catch {
      line(warn, 'Could not read the deployed script version.');
    }
  }

  const workbook = await inspectWorkbook(store);
  if (workbook.ready) {
    line(tick, 'All ' + SHEET_DEFINITIONS.length + ' required sheets exist.');
  } else {
    line(warn, 'Missing sheets: ' + workbook.missing.join(', '));
    line(' ', 'Run "npm run setup" to create them (existing data is never overwritten).');
  }

  // Header check: a sheet can exist but have the wrong columns after a manual edit.
  let headerProblems = 0;
  for (const definition of SHEET_DEFINITIONS) {
    if (!workbook.present.includes(definition.name)) continue;
    const table = await store.table(definition.name, { fresh: true });
    const missing = definition.headers.filter((header) => !table.hasColumn(header));
    if (missing.length > 0) {
      headerProblems += 1;
      line(warn, definition.name + ' is missing columns: ' + missing.join(', '));
    }
  }
  if (workbook.ready && headerProblems === 0) {
    line(tick, 'Every sheet has the expected columns.');
  }

  if (workbook.present.includes('Users')) {
    const users = await store.table('Users', { fresh: true });
    const admins = users.rows.filter(
      (row) => row.get('Role') === 'Admin' && row.get('Status') !== 'Inactive',
    );
    if (users.size === 0) {
      line(warn, 'No user accounts yet. Run "npm run setup" to create the first administrator.');
    } else if (admins.length === 0) {
      line(cross, users.size + ' user(s) exist but none is an active administrator.');
    } else {
      line(tick, users.size + ' user account(s), ' + admins.length + ' active administrator(s).');
    }
  }

  if (workbook.present.includes('Services')) {
    const services = await store.table('Services', { fresh: true });
    const active = services.rows.filter((row) => row.get('Status') !== 'Inactive');
    if (active.length === 0) {
      line(warn, 'No active services. The POS will have nothing to sell.');
    } else {
      line(
        tick,
        active.length + ' active service(s): ' +
          active.map((row) => row.get('Name') + ' @ ' + row.get('Price')).join(', '),
      );
    }
  }

  if (workbook.present.includes('Transactions')) {
    const transactions = await store.table('Transactions', { fresh: true });
    line(tick, transactions.size + ' transaction row(s) currently in the workbook.');
  }

  const ready = workbook.ready && headerProblems === 0;
  console.log('\n' + (ready ? 'Ready to trade.' : 'Setup incomplete \u2014 see the notes above.') + '\n');
  process.exit(ready ? 0 : 1);
}

main().catch((error) => {
  console.error('\nConnection check failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
  process.exit(1);
});
