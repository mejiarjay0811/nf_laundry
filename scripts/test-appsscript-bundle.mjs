/**
 * End-to-end check of the built Apps Script backend.
 *
 * Runs apps-script/Bundle.gs — the exact file that gets deployed — inside a
 * stand-in for the Apps Script runtime, and puts a real day's work through it:
 * set up the workbook, create an administrator, sign in, register a customer,
 * ring up a split-payment sale, mark it collected, and read the reports back.
 *
 * This is what catches the things that only appear once the code is compiled
 * for that runtime — the synchronous promise trampoline above all — long
 * before anything is published.
 *
 * Usage:  npm run test:appsscript
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './appsscript-sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER_TOKEN = 'test-master-token';

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

function section(title) {
  console.log('\n' + title);
}

async function main() {
  const code = await readFile(path.join(root, 'apps-script', 'Bundle.gs'), 'utf8');
  const sandbox = createSandbox(code, { properties: { API_TOKEN: MASTER_TOKEN } });

  /* ------------------------------------------------------------ plumbing */

  section('Deployment');

  const status = JSON.parse(sandbox.context.doGet().getContent());
  check('doGet reports the running build', status.ok === true && Boolean(status.version),
    JSON.stringify(status));
  check('doGet never leaks the token', !JSON.stringify(status).includes(MASTER_TOKEN));

  const unauthorised = sandbox.post({ op: 'ping', token: 'wrong-token' });
  check('storage ops reject a bad master token',
    unauthorised.ok === false && unauthorised.error.code === 'UNAUTHORIZED',
    JSON.stringify(unauthorised));

  const ping = sandbox.post({ op: 'ping', token: MASTER_TOKEN });
  check('ping succeeds with the master token', ping.ok === true, JSON.stringify(ping));

  /* --------------------------------------------------------------- setup */

  section('Workbook setup');

  const setup = sandbox.post({ op: 'setup', token: MASTER_TOKEN });
  check('setup creates the workbook', setup.ok === true, JSON.stringify(setup).slice(0, 300));
  check('setup reports no users yet', setup.ok && setup.data.hasUsers === false);

  const sheets = sandbox.post({ op: 'listSheets', token: MASTER_TOKEN });
  const required = ['Users', 'Customers', 'Transactions', 'Payments', 'Services', 'Counters', 'AuditLogs', 'Settings'];
  const missing = required.filter((name) => !sheets.data.includes(name));
  check('every required sheet exists', missing.length === 0, 'missing: ' + missing.join(', '));

  const transactionsHeader = sandbox.get('Transactions')[0] ?? [];
  check('the Transactions sheet is wider than a default sheet',
    transactionsHeader.length > 26,
    'columns: ' + transactionsHeader.length);

  /* ---------------------------------------------------------------- auth */

  section('Accounts and sign-in');

  /*
   * Two accounts, because administration and the business are separate jobs.
   * The owner runs the shop and may not touch accounts or settings; the
   * administrator may do nothing but. Every business assertion below uses the
   * owner's token, and that separation is itself asserted further down.
   */
  const owner = sandbox.post({
    op: 'createAdmin',
    token: MASTER_TOKEN,
    username: 'owner',
    password: 'Laundry123',
    fullName: 'Shop Owner',
    role: 'Owner',
  });
  check('the first account is created as the owner', owner.ok === true, JSON.stringify(owner));
  check('the first account is an Owner, not an Admin', owner.data?.role === 'Owner',
    JSON.stringify(owner.data));

  const admin = sandbox.post({
    op: 'createAdmin',
    token: MASTER_TOKEN,
    username: 'admin',
    password: 'Laundry123',
    fullName: 'System Administrator',
    role: 'Admin',
  });
  check('a separate administrator is created', admin.ok === true, JSON.stringify(admin));

  const usersTable = sandbox.get('Users');
  const hashColumn = (usersTable[0] ?? []).indexOf('Password Hash');
  const storedHash = usersTable[1]?.[hashColumn] ?? '';
  check('the password is stored as a PBKDF2 hash', storedHash.startsWith('pbkdf2$'), storedHash.slice(0, 40));
  check('the plain password is nowhere in the workbook',
    !JSON.stringify(usersTable).includes('Laundry123'));

  const badLogin = sandbox.post({
    method: 'POST', path: '/auth/login',
    body: { username: 'admin', password: 'wrong-password', remember: false },
  });
  check('a wrong password is rejected', badLogin.status === 401, JSON.stringify(badLogin).slice(0, 200));
  check('the rejection does not say which half was wrong',
    /incorrect username or password/i.test(badLogin.body?.error?.message ?? ''),
    badLogin.body?.error?.message);

  const login = sandbox.post({
    method: 'POST', path: '/auth/login',
    body: { username: 'owner', password: 'Laundry123', remember: false },
  });
  check('a correct password signs in', login.status === 200, JSON.stringify(login).slice(0, 300));
  check('sign-in returns a session token', typeof login.token === 'string' && login.token.length > 20);
  check('sign-in returns the role from the sheet', login.body?.user?.role === 'Owner');

  const adminLogin = sandbox.post({
    method: 'POST', path: '/auth/login',
    body: { username: 'admin', password: 'Laundry123', remember: false },
  });
  check('the administrator signs in too', adminLogin.status === 200,
    JSON.stringify(adminLogin).slice(0, 200));
  const adminToken = adminLogin.token;

  const token = login.token;
  if (!token) {
    console.log('\nSign-in failed, so the remaining checks cannot run.');
    console.log(passed + ' passed, ' + failed + ' failed\n');
    process.exit(1);
  }

  const noToken = sandbox.post({ method: 'GET', path: '/customers' });
  check('a protected route refuses an anonymous caller', noToken.status === 401);

  const forgedToken = sandbox.post({
    method: 'GET', path: '/customers',
    token: token.split('.')[0] + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  });
  check('a forged signature is refused', forgedToken.status === 401,
    JSON.stringify(forgedToken).slice(0, 200));

  const me = sandbox.post({ method: 'GET', path: '/auth/me', token });
  check('the session resolves back to the user', me.body?.user?.username === 'owner',
    JSON.stringify(me).slice(0, 200));

  /* ----------------------------------------------------------- the sale */

  section('A day at the counter');

  const services = sandbox.post({ method: 'GET', path: '/services', token });
  check('the default services are seeded', (services.body?.items?.length ?? 0) > 0,
    JSON.stringify(services).slice(0, 200));
  const service = services.body.items[0];

  const customer = sandbox.post({
    method: 'POST', path: '/customers', token,
    body: { fullName: 'Rosa Delgado', contactNumber: '09171234567', address: 'Lalud, Candon City' },
  });
  check('a customer can be registered', customer.status === 201, JSON.stringify(customer).slice(0, 300));
  const customerId = customer.body?.customer?.customerId;

  const duplicate = sandbox.post({
    method: 'POST', path: '/customers', token,
    body: { fullName: 'Rosa Delgado', contactNumber: '09171234567', address: 'Lalud, Candon City' },
  });
  check('the same contact number is refused a second time', duplicate.status === 409,
    JSON.stringify(duplicate).slice(0, 250));

  // 175.00 paid as 100 cash + 75 GCash — the split the shop actually asked for.
  const unitPesos = service.price;
  const sale = sandbox.post({
    method: 'POST', path: '/transactions', token,
    body: {
      orNumber: 'OR-TEST-0001',
      customerId,
      serviceId: service.serviceId,
      quantity: 1,
      payments: [
        { amount: Math.min(100, unitPesos), modeOfPayment: 'Cash' },
        { amount: Math.max(unitPesos - 100, 0), modeOfPayment: 'GCash' },
      ].filter((entry) => entry.amount > 0),
      idempotencyKey: 'sale-key-000001',
    },
  });
  check('the sale is recorded', sale.status === 201, JSON.stringify(sale).slice(0, 400));

  const transactionId = sale.body?.transaction?.transactionId;
  check('the sale is fully paid', sale.body?.transaction?.paymentStatus === 'Paid',
    JSON.stringify(sale.body?.transaction ?? {}).slice(0, 300));
  check('a split is labelled as one', sale.body?.transaction?.modeOfPayment === 'Cash + GCash',
    sale.body?.transaction?.modeOfPayment);

  const replay = sandbox.post({
    method: 'POST', path: '/transactions', token,
    body: {
      orNumber: 'OR-TEST-0001', customerId, serviceId: service.serviceId, quantity: 1,
      payments: [{ amount: unitPesos, modeOfPayment: 'Cash' }],
      idempotencyKey: 'sale-key-000001',
    },
  });
  check('re-sending the same sale replays instead of duplicating',
    replay.status === 200 && replay.body?.replayed === true,
    JSON.stringify(replay).slice(0, 250));

  const duplicateOr = sandbox.post({
    method: 'POST', path: '/transactions', token,
    body: {
      orNumber: 'or-test-0001', customerId, serviceId: service.serviceId, quantity: 1,
      payments: [{ amount: unitPesos, modeOfPayment: 'Cash' }],
      idempotencyKey: 'sale-key-000002',
    },
  });
  check('a reused O.R. number is refused, whatever its case', duplicateOr.status === 409,
    JSON.stringify(duplicateOr).slice(0, 250));

  /* ------------------------------------------------------------- pickup */

  section('Pickup and reporting');

  const queueBefore = sandbox.post({ method: 'GET', path: '/transactions/pickup-queue', token });
  check('the new order is waiting in the pickup queue',
    (queueBefore.body?.items ?? []).some((item) => item.transactionId === transactionId),
    JSON.stringify(queueBefore).slice(0, 250));

  const ready = sandbox.post({
    method: 'POST', path: '/transactions/' + transactionId + '/status', token,
    body: { orderStatus: 'Ready for Pickup' },
  });
  check('an order can be marked ready', ready.status === 200, JSON.stringify(ready).slice(0, 250));

  const collected = sandbox.post({
    method: 'POST', path: '/transactions/' + transactionId + '/status', token,
    body: { orderStatus: 'Picked Up' },
  });
  check('an order can be marked collected', collected.status === 200,
    JSON.stringify(collected).slice(0, 250));

  const daily = sandbox.post({ method: 'GET', path: '/reports/daily', token });
  check('the daily report counts the sale', (daily.body?.totalTransactions ?? 0) === 1,
    JSON.stringify(daily).slice(0, 300));

  // The money is the part that must not be approximately right.
  check('the daily report totals the sale exactly', daily.body?.totalSales === unitPesos,
    'expected ' + unitPesos + ', got ' + daily.body?.totalSales);
  check('cash and GCash are split as they were tendered',
    daily.body?.cashSales === Math.min(100, unitPesos) &&
      daily.body?.gcashSales === Math.max(unitPesos - 100, 0),
    'cash ' + daily.body?.cashSales + ', gcash ' + daily.body?.gcashSales);
  check('the two halves add back up to the total',
    daily.body?.cashSales + daily.body?.gcashSales === daily.body?.totalSales);
  check('nothing is left outstanding on a paid sale', daily.body?.outstandingBalance === 0,
    String(daily.body?.outstandingBalance));

  const metrics = sandbox.post({ method: 'GET', path: '/dashboard/metrics', token });
  check('the dashboard separates cash from GCash',
    metrics.body?.cashSales !== undefined && metrics.body?.gcashSales !== undefined,
    Object.keys(metrics.body ?? {}).join(', '));

  /* -------------------------------------------------------------- roles */

  section('Authorisation');

  const staff = sandbox.post({
    method: 'POST', path: '/users', token: adminToken,
    body: { username: 'cashier', password: 'Cashier123', fullName: 'Counter Staff', role: 'Staff' },
  });
  check('only the administrator can create staff', staff.status === 201, JSON.stringify(staff).slice(0, 250));

  const staffLogin = sandbox.post({
    method: 'POST', path: '/auth/login',
    body: { username: 'cashier', password: 'Cashier123', remember: false },
  });
  check('the new staff account can sign in', staffLogin.status === 200,
    JSON.stringify(staffLogin).slice(0, 250));
  const staffToken = staffLogin.token;

  const staffSells = sandbox.post({ method: 'GET', path: '/transactions', token: staffToken });
  check('staff may use the till', staffSells.status === 200);

  const staffPrices = sandbox.post({
    method: 'PATCH', path: '/services/' + service.serviceId, token: staffToken,
    body: { price: 1 },
  });
  check('staff may not change prices', staffPrices.status === 403,
    JSON.stringify(staffPrices).slice(0, 200));

  const staffUsers = sandbox.post({ method: 'GET', path: '/users', token: staffToken });
  check('staff may not manage users', staffUsers.status === 403);

  const staffAudit = sandbox.post({ method: 'GET', path: '/audit-logs', token: staffToken });
  check('staff may not read the audit trail', staffAudit.status === 403);

  // Trading figures are the owner's. Hiding the menu is not enough — these are
  // the requests a staff account could still send by hand.
  for (const path of [
    '/dashboard/metrics',
    '/dashboard/alerts',
    '/reports/sales',
    '/reports/daily',
    '/reports/weekly',
    '/reports/monthly',
    '/reports/yearly',
  ]) {
    const denied = sandbox.post({ method: 'GET', path, token: staffToken });
    check('staff may not read ' + path, denied.status === 403, 'got ' + denied.status);
  }

  // ...but the owner still can.
  const adminReport = sandbox.post({ method: 'GET', path: '/reports/daily', token });
  check('the owner still reads reports', adminReport.status === 200,
    'got ' + adminReport.status);

  /*
   * The separation of duties, asserted from both sides. These two checks are
   * the whole point of splitting Admin from Owner: neither role can quietly
   * become the other.
   */
  section('Administration and the business are separate');

  for (const path of ['/reports/daily', '/reports/profit', '/dashboard/metrics', '/transactions']) {
    const refused = sandbox.post({ method: 'GET', path, token: adminToken });
    check('an administrator may not read ' + path, refused.status === 403,
      'got ' + refused.status);
  }

  const ownerSell = sandbox.post({ method: 'GET', path: '/services', token });
  check('the owner can still work the shop', ownerSell.status === 200, 'got ' + ownerSell.status);

  for (const path of ['/users', '/audit-logs', '/settings']) {
    const refused = sandbox.post({ method: 'GET', path, token });
    const expected = path === '/settings' ? 200 : 403;
    check(
      path === '/settings'
        ? 'the owner may read settings but not change them'
        : 'the owner may not reach ' + path,
      refused.status === expected,
      'got ' + refused.status,
    );
  }

  const ownerWritesSettings = sandbox.post({
    method: 'PATCH', path: '/settings', token,
    body: { values: { 'business.name': 'Should Not Apply' } },
  });
  check('the owner may not change settings', ownerWritesSettings.status === 403,
    'got ' + ownerWritesSettings.status);

  const ownerMakesUser = sandbox.post({
    method: 'POST', path: '/users', token,
    body: { username: 'sneaky', password: 'Password123', fullName: 'Nope', role: 'Owner' },
  });
  check('the owner may not create accounts', ownerMakesUser.status === 403,
    'got ' + ownerMakesUser.status);

  const staffPickup = sandbox.post({ method: 'GET', path: '/transactions/pickup-queue', token: staffToken });
  check('staff keep the pickup queue', staffPickup.status === 200, 'got ' + staffPickup.status);

  const staffCustomers = sandbox.post({ method: 'GET', path: '/customers', token: staffToken });
  check('staff keep customers', staffCustomers.status === 200, 'got ' + staffCustomers.status);

  // What a customer has spent is the owner's figure. Stripped from the
  // response, not merely hidden on screen — the response is readable by
  // anyone who can make the request.
  const adminCustomers = sandbox.post({ method: 'GET', path: '/customers', token });
  const adminSpend = (adminCustomers.body?.items ?? []).reduce(
    (sum, row) => sum + (row.totalSpending ?? 0),
    0,
  );
  check('an administrator sees customer spending', adminSpend > 0, 'total ' + adminSpend);

  const staffSpend = (staffCustomers.body?.items ?? []).reduce(
    (sum, row) => sum + (row.totalSpending ?? 0),
    0,
  );
  check('staff are not sent customer spending', staffSpend === 0, 'total ' + staffSpend);

  const staffSearch = sandbox.post({
    method: 'GET', path: '/customers/search', token: staffToken, query: { q: 'Rosa' },
  });
  check('nor through the search',
    (staffSearch.body?.items ?? []).every((row) => row.totalSpending === 0),
    JSON.stringify(staffSearch.body ?? {}).slice(0, 160));

  const staffDetail = sandbox.post({
    method: 'GET', path: '/customers/' + customerId, token: staffToken,
  });
  check('nor on the customer record',
    staffDetail.body?.customer?.totalSpending === 0 &&
      staffDetail.body?.stats?.totalSpending === 0,
    JSON.stringify(staffDetail.body?.stats ?? {}).slice(0, 160));
  check('but the outstanding balance is still there for collecting',
    staffDetail.body?.stats?.outstandingBalance !== undefined,
    JSON.stringify(staffDetail.body?.stats ?? {}).slice(0, 160));

  const staffCancels = sandbox.post({
    method: 'POST', path: '/transactions/' + transactionId + '/cancel', token: staffToken,
    body: { reason: 'testing role enforcement' },
  });
  check('staff may not cancel a transaction', staffCancels.status === 403);

  /* ------------------------------------------------------- rate limiting */

  section('Brute-force protection');

  let blocked = false;
  let lastMessage = '';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = sandbox.post({
      method: 'POST', path: '/auth/login',
      body: { username: 'cashier', password: 'not-the-password', remember: false },
    });
    lastMessage = response.body?.error?.message ?? '';
    if (response.status === 429) {
      blocked = true;
      break;
    }
  }
  check('repeated failures lock the account out', blocked,
    'last message: ' + lastMessage);

  const blockedDespiteCorrect = sandbox.post({
    method: 'POST', path: '/auth/login',
    body: { username: 'cashier', password: 'Cashier123', remember: false },
  });
  check('the lockout holds even for the right password',
    blockedDespiteCorrect.status === 429,
    JSON.stringify(blockedDespiteCorrect).slice(0, 200));

  /* ------------------------------------------------------------ soft delete */

  section('Cancellation is a soft delete');

  // An order already handed over cannot be cancelled — it has to be refunded.
  const cancelCollected = sandbox.post({
    method: 'POST', path: '/transactions/' + transactionId + '/cancel', token,
    body: { reason: 'customer changed their mind' },
  });
  check('a collected order cannot be cancelled', cancelCollected.status === 409,
    JSON.stringify(cancelCollected).slice(0, 250));

  const second = sandbox.post({
    method: 'POST', path: '/transactions', token,
    body: {
      orNumber: 'OR-TEST-0002', customerId, serviceId: service.serviceId, quantity: 1,
      payments: [{ amount: unitPesos, modeOfPayment: 'Cash' }],
      idempotencyKey: 'sale-key-000003',
    },
  });
  check('a second sale is recorded', second.status === 201, JSON.stringify(second).slice(0, 250));
  const secondId = second.body?.transaction?.transactionId;

  const rowsBefore = sandbox.get('Transactions').length;
  const cancelled = sandbox.post({
    method: 'POST', path: '/transactions/' + secondId + '/cancel', token,
    body: { reason: 'customer changed their mind' },
  });
  check('an administrator can cancel an uncollected order', cancelled.status === 200,
    JSON.stringify(cancelled).slice(0, 250));

  const rowsAfter = sandbox.get('Transactions').length;
  check('the row is kept, not deleted', rowsAfter === rowsBefore,
    'before ' + rowsBefore + ', after ' + rowsAfter);

  const statusColumn = sandbox.get('Transactions')[0].indexOf('Status');
  const cancelledRow = sandbox.get('Transactions').find((row) => row.includes(secondId));
  check('the row is marked Cancelled', cancelledRow?.[statusColumn] === 'Cancelled',
    cancelledRow?.[statusColumn]);

  const afterCancel = sandbox.post({ method: 'GET', path: '/reports/daily', token });
  check('a cancelled sale is left out of the takings',
    afterCancel.body?.totalSales === unitPesos,
    'expected ' + unitPesos + ', got ' + afterCancel.body?.totalSales);

  /* ------------------------------------------------- stock and spending */

  section('Inventory and expenses');

  const stockSheets = sandbox.post({ op: 'listSheets', token: MASTER_TOKEN });
  for (const name of ['Inventory', 'StockMovements', 'Expenses']) {
    check('the ' + name + ' sheet exists', stockSheets.data.includes(name));
  }

  const soap = sandbox.post({
    method: 'POST', path: '/inventory', token,
    body: {
      name: 'Powder Detergent', category: 'Detergent', unit: 'kg',
      quantity: 10, unitCost: 120, reorderLevel: 5, supplier: 'Local supplier',
    },
  });
  check('an inventory item can be added', soap.status === 201, JSON.stringify(soap).slice(0, 250));
  const itemId = soap.body?.item?.itemId;
  check('its stock value is quantity times cost', soap.body?.item?.stockValue === 1200,
    'got ' + soap.body?.item?.stockValue);
  check('it is not flagged low yet', soap.body?.item?.lowStock === false);

  const duplicateItem = sandbox.post({
    method: 'POST', path: '/inventory', token,
    body: { name: 'powder detergent', category: 'Detergent', unit: 'kg' },
  });
  check('the same item cannot be added twice', duplicateItem.status === 409,
    'got ' + duplicateItem.status);

  // Restocking books the purchase as an expense, so buying soap shows up in
  // the month's spending without being entered twice.
  const restock = sandbox.post({
    method: 'POST', path: '/inventory/' + itemId + '/movements', token,
    body: { type: 'Restock', quantity: 5, unitCost: 130, recordExpense: true },
  });
  check('restocking raises the balance', restock.body?.item?.quantity === 15,
    'got ' + restock.body?.item?.quantity);
  check('restocking records an expense', Boolean(restock.body?.expenseId),
    JSON.stringify(restock.body ?? {}).slice(0, 200));

  const used = sandbox.post({
    method: 'POST', path: '/inventory/' + itemId + '/movements', token,
    body: { type: 'Used', quantity: 11, reason: 'Daily consumption' },
  });
  check('using stock lowers the balance', used.body?.item?.quantity === 4,
    'got ' + used.body?.item?.quantity);
  check('it is now flagged low', used.body?.item?.lowStock === true);

  const overdraw = sandbox.post({
    method: 'POST', path: '/inventory/' + itemId + '/movements', token,
    body: { type: 'Used', quantity: 99 },
  });
  check('stock cannot be taken below zero', overdraw.status === 409,
    'got ' + overdraw.status + ': ' + JSON.stringify(overdraw.body).slice(0, 120));

  const movements = sandbox.post({
    method: 'GET', path: '/inventory/movements', token, query: { itemId },
  });
  check('every change left a movement behind', (movements.body?.total ?? 0) === 3,
    'got ' + movements.body?.total);

  const salary = sandbox.post({
    method: 'POST', path: '/expenses', token,
    body: { category: 'Salary', description: 'Staff wages', amount: 500, modeOfPayment: 'Cash', paidTo: 'Counter staff' },
  });
  check('an expense can be recorded', salary.status === 201, JSON.stringify(salary).slice(0, 200));

  const badExpense = sandbox.post({
    method: 'POST', path: '/expenses', token,
    body: { category: 'Salary', description: 'x', amount: 0 },
  });
  check('a zero-amount expense is refused', badExpense.status === 400, 'got ' + badExpense.status);

  const profit = sandbox.post({ method: 'GET', path: '/reports/profit', token, query: { preset: 'today' } });
  check('the profit report reaches the expenses', (profit.body?.expenses ?? 0) > 0,
    JSON.stringify(profit.body ?? {}).slice(0, 250));
  check('net is collections minus expenses',
    Math.abs((profit.body?.collected ?? 0) - (profit.body?.expenses ?? 0) - (profit.body?.net ?? 0)) < 0.005,
    'collected ' + profit.body?.collected + ', expenses ' + profit.body?.expenses + ', net ' + profit.body?.net);

  const voided = sandbox.post({
    method: 'POST', path: '/expenses/' + salary.body?.expense?.expenseId + '/void', token,
    body: { reason: 'entered twice' },
  });
  check('an expense is voided rather than deleted', voided.body?.expense?.status === 'Cancelled',
    JSON.stringify(voided.body ?? {}).slice(0, 200));

  const afterVoid = sandbox.post({ method: 'GET', path: '/reports/profit', token, query: { preset: 'today' } });
  check('a voided expense stops counting',
    (afterVoid.body?.expenses ?? 0) < (profit.body?.expenses ?? 0),
    'before ' + profit.body?.expenses + ', after ' + afterVoid.body?.expenses);

  section('Staff may not touch the books');

  for (const path of ['/inventory', '/expenses', '/reports/profit']) {
    const denied = sandbox.post({ method: 'GET', path, token: staffToken });
    check('staff may not read ' + path, denied.status === 403, 'got ' + denied.status);
  }
  const staffSpends = sandbox.post({
    method: 'POST', path: '/expenses', token: staffToken,
    body: { category: 'Other', description: 'nope', amount: 10 },
  });
  check('staff may not record an expense', staffSpends.status === 403, 'got ' + staffSpends.status);

  // An unpaid order to find, since by now everything else is settled or void.
  const owing = sandbox.post({
    method: 'POST', path: '/transactions', token,
    body: {
      orNumber: 'OR-TEST-0003', customerId, serviceId: service.serviceId, quantity: 1,
      payments: [],
      idempotencyKey: 'sale-key-000004',
    },
  });
  check('an unpaid order is recorded', owing.status === 201 && owing.body?.transaction?.balance > 0,
    JSON.stringify(owing.body?.transaction ?? {}).slice(0, 200));

  // Staff see only what is still owed, whatever they ask for.
  const staffAll = sandbox.post({
    method: 'GET', path: '/transactions', token: staffToken,
    query: { page: '1', pageSize: '50' },
  });
  const staffRows = staffAll.body?.items ?? [];
  check('staff are given only unpaid orders',
    staffRows.length > 0 && staffRows.every((row) => row.balance > 0),
    staffRows.length + ' rows, balances: ' + staffRows.map((r) => r.balance).join(', '));

  const adminAll = sandbox.post({
    method: 'GET', path: '/transactions', token, query: { page: '1', pageSize: '50' },
  });
  check('an administrator still sees everything',
    (adminAll.body?.items ?? []).length > staffRows.length,
    'admin ' + (adminAll.body?.items ?? []).length + ' vs staff ' + staffRows.length);

  /* ------------------------------------------------------------ summary */

  console.log('\n' + '-'.repeat(60));
  console.log(passed + ' passed, ' + failed + ' failed');
  console.log('HMAC calls: ' + sandbox.stats.hmacCalls + ', lock acquisitions: ' + sandbox.stats.locks);
  console.log('-'.repeat(60) + '\n');

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nThe harness itself failed:\n');
  console.error(error);
  process.exit(1);
});
