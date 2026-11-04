/**
 * Counts what each request costs in calls to the Sheets service.
 *
 * On Apps Script the JavaScript is almost free; the time goes on each call
 * across into Google's services — every getValues, every setValues, every
 * flush, every lock, and every HMAC. Counting them locally shows where a slow
 * request is spending itself, without deploying and timing it blind.
 *
 * Usage:  node scripts/profile-appsscript.mjs
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, opCounts } from './appsscript-sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = 'profile-token';
const PASSWORD = 'Laundry123';

const code = await readFile(path.join(root, 'apps-script', 'Bundle.gs'), 'utf8');
const sandbox = createSandbox(code, { properties: { API_TOKEN: MASTER } });

sandbox.post({ op: 'setup', token: MASTER });
sandbox.post({
  op: 'createAdmin', token: MASTER,
  username: 'admin', password: PASSWORD, fullName: 'System Administrator',
});

// Some data, so reads are not measured against an empty workbook.
let token = null;
function app(method, apiPath, body, query) {
  const result = sandbox.post({ method, path: apiPath, body, query: query ?? {}, token });
  if (result.token !== undefined) token = result.token;
  return result;
}

app('POST', '/auth/login', { username: 'admin', password: PASSWORD, remember: false });
const services = app('GET', '/services');
const service = services.body.items[0];
const customer = app('POST', '/customers', {
  fullName: 'Profile Customer', contactNumber: '09170000000', address: 'Candon City',
});
for (let i = 1; i <= 3; i += 1) {
  app('POST', '/transactions', {
    orNumber: 'PROFILE-' + i,
    customerId: customer.body.customer.customerId,
    serviceId: service.serviceId,
    quantity: 1,
    payments: [{ amount: service.price, modeOfPayment: 'Cash' }],
    idempotencyKey: 'profile-' + i,
  });
}

const measurements = [];

/** Run one request with a fresh count, as a cold Apps Script execution would. */
function measure(label, run) {
  token = null;
  // Sign in first where the request needs a session, but do not count that.
  const needsSession = label !== 'sign in';
  if (needsSession) {
    app('POST', '/auth/login', { username: 'admin', password: PASSWORD, remember: false });
  }
  opCounts.reset();
  const started = Date.now();
  const result = run();
  const ms = Date.now() - started;
  measurements.push({
    label,
    status: result.status,
    ms,
    read: opCounts.read,
    cells: opCounts.readCells,
    write: opCounts.write,
    flush: opCounts.flush,
    lock: opCounts.lock,
    hmac: opCounts.hmac,
  });
}

measure('sign in', () =>
  app('POST', '/auth/login', { username: 'admin', password: PASSWORD, remember: false }),
);
measure('session check (/auth/me)', () => app('GET', '/auth/me'));
measure('service list', () => app('GET', '/services'));
measure('transaction list', () => app('GET', '/transactions', undefined, { page: '1', pageSize: '25' }));
measure('pickup queue', () => app('GET', '/transactions/pickup-queue'));
measure('daily report', () => app('GET', '/reports/daily'));
measure('dashboard metrics', () => app('GET', '/dashboard/metrics', undefined, { preset: 'today' }));
measure('O.R. duplicate check', () => app('GET', '/transactions/or-number', undefined, { value: 'X-9' }));
measure('record a sale', () =>
  app('POST', '/transactions', {
    orNumber: 'PROFILE-SALE-' + Date.now(),
    customerId: customer.body.customer.customerId,
    serviceId: service.serviceId,
    quantity: 1,
    payments: [{ amount: service.price, modeOfPayment: 'Cash' }],
    idempotencyKey: 'profile-sale-' + Date.now(),
  }),
);

console.log('\nCalls into the Sheets service, per request\n');
console.log(
  '  ' + 'request'.padEnd(26) + 'reads'.padStart(7) + 'cells'.padStart(8) +
  'writes'.padStart(8) + 'flush'.padStart(7) + 'locks'.padStart(7) + 'HMAC'.padStart(8),
);
console.log('  ' + '-'.repeat(71));
for (const m of measurements) {
  console.log(
    '  ' + m.label.padEnd(26) +
    String(m.read).padStart(7) + String(m.cells).padStart(8) +
    String(m.write).padStart(8) + String(m.flush).padStart(7) +
    String(m.lock).padStart(7) + String(m.hmac).padStart(8) +
    (m.status >= 400 ? '   <- ' + m.status : ''),
  );
}
console.log('');
