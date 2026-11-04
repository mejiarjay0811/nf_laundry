/**
 * Smoke test for the Node server's single API endpoint.
 *
 * The Apps Script bundle has its own end-to-end run (npm run test:appsscript).
 * This covers the other host: that POST /api/rpc unwraps the request, applies
 * the same route table, and returns the same envelope the client expects.
 *
 * It runs against the file-backed driver in a throwaway directory, so it never
 * touches the real workbook.
 *
 * Usage:  node scripts/smoke-rpc.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = await mkdtemp(path.join(tmpdir(), 'nf-smoke-'));

// Must be set before the app's env module is imported.
process.env.NODE_ENV = 'development';
process.env.SHEETS_PROVIDER = 'local';
process.env.LOCAL_DATA_DIR = dataDir;
process.env.LOG_LEVEL = 'error';
process.env.SESSION_SECRET = 'smoke-test-session-secret-at-least-32-chars';
process.env.PASSWORD_PEPPER = 'smoke-test-pepper';
process.env.SERVE_CLIENT = 'false';

const { createApp } = await import('../server/app.js');
const { getStore } = await import('../server/sheets/index.js');
const { initialiseWorkbook } = await import('../server/sheets/init.js');
const { seedServices } = await import('../server/services/catalog.service.js');
const { seedSettings } = await import('../server/services/settings.service.js');
const { createUser } = await import('../server/services/user.service.js');

let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + label);
  } else {
    failed += 1;
    console.log('  FAIL  ' + label + (detail ? '\n          ' + detail : ''));
  }
}

const store = getStore();
await store.connect();
await initialiseWorkbook(store, { seedServices, seedSettings });
await createUser(
  // Owner, not Admin: this script exercises the business routes, and an Admin
  // may only reach accounts, settings and the audit log.
  { username: 'admin', password: 'Laundry123', fullName: 'Smoke Owner', role: 'Owner' },
  null,
);

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

/** Send a request the way the client does. */
async function rpc(method, apiPath, { body, query, token } = {}) {
  const response = await fetch(base + '/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ method, path: apiPath, body, query: query ?? {}, token: token ?? null }),
  });
  return response.json();
}

console.log('\nNode server: POST /api/rpc\n');

const health = await fetch(base + '/api/system/health').then((r) => r.json());
check('the plain health probe still answers', health.provider === 'local', JSON.stringify(health));

const anonymous = await rpc('GET', '/customers');
check('a protected route refuses an anonymous caller', anonymous.status === 401,
  JSON.stringify(anonymous));

const badLogin = await rpc('POST', '/auth/login', {
  body: { username: 'admin', password: 'nope', remember: false },
});
check('a wrong password is rejected', badLogin.status === 401, JSON.stringify(badLogin));

const login = await rpc('POST', '/auth/login', {
  body: { username: 'admin', password: 'Laundry123', remember: false },
});
check('a correct password signs in', login.status === 200, JSON.stringify(login).slice(0, 200));
check('the envelope carries a session token', typeof login.token === 'string');

const token = login.token;

const me = await rpc('GET', '/auth/me', { token });
check('the session resolves', me.body?.user?.username === 'admin', JSON.stringify(me).slice(0, 200));

const services = await rpc('GET', '/services', { token });
check('a query-string route works', (services.body?.items?.length ?? 0) > 0);

const customer = await rpc('POST', '/customers', {
  token,
  body: { fullName: 'Smoke Tester', contactNumber: '09998887777', address: 'Candon City' },
});
check('a create returns 201 in the envelope', customer.status === 201,
  JSON.stringify(customer).slice(0, 200));

const customerId = customer.body?.customer?.customerId;
const fetched = await rpc('GET', '/customers/' + customerId, { token });
check('a path parameter is routed', fetched.body?.customer?.customerId === customerId,
  JSON.stringify(fetched).slice(0, 200));

const orHelper = await rpc('GET', '/transactions/or-number', { token, query: { value: 'X-1' } });
check('a literal path beats a parameter (/transactions/or-number)',
  orHelper.status === 200 && orHelper.body?.taken === false,
  JSON.stringify(orHelper).slice(0, 200));

const missing = await rpc('GET', '/nothing-here', { token });
check('an unknown path is a clean 404', missing.status === 404, JSON.stringify(missing).slice(0, 150));

const invalid = await rpc('POST', '/customers', { token, body: { fullName: '' } });
check('validation errors come back as 400 with field detail',
  invalid.status === 400 && Array.isArray(invalid.body?.error?.details),
  JSON.stringify(invalid).slice(0, 200));

const logout = await rpc('POST', '/auth/logout', { token });
check('signing out tells the client to drop its token', logout.token === null,
  JSON.stringify(logout).slice(0, 150));

server.close();
await rm(dataDir, { recursive: true, force: true });

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
