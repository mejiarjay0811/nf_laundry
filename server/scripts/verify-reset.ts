/**
 * Proves the promise the reset command makes: after clearing, the next sale is
 * issued OR-000001 again. Runs against whichever driver is configured, so it is
 * meant for the LOCAL store — it writes a real sale.
 *
 *   SHEETS_PROVIDER=local npx tsx server/scripts/verify-reset.ts
 */
import { getStore } from '../sheets/index.js';
import { createTransaction } from '../services/sale.service.js';
import { listServices } from '../services/catalog.service.js';

async function main(): Promise<void> {
  const store = getStore();
  if (store.gateway.name !== 'local') {
    console.error('\nRefusing to run: this writes a real sale. Use SHEETS_PROVIDER=local.\n');
    process.exit(1);
  }

  await store.connect();
  const services = await listServices();
  const service = services[0];
  if (!service) {
    console.error('\nNo active services configured.\n');
    process.exit(1);
  }

  const result = await createTransaction(
    {
      newCustomer: { fullName: 'Reset Probe', contactNumber: '09990002222' },
      orNumber: 'PROBE-' + Date.now().toString(36).toUpperCase(),
      serviceId: service.serviceId,
      quantity: 1,
      payments: [{ modeOfPayment: 'Cash', amount: service.price }],
      idempotencyKey: 'reset-probe-' + Date.now().toString(36),
    },
    { userId: 'USR-0001', username: 'admin', fullName: 'System Administrator', role: 'Admin' },
    {},
  );

  console.log('');
  console.log('  first sale after reset');
  console.log('    O.R. Number    : ' + result.transaction.orNumber);
  console.log('    Transaction ID : ' + result.transaction.transactionId);
  console.log('    Customer ID    : ' + result.customer.customerId);
  console.log(
    '    Payment ID     : ' +
      (result.payments.map((p) => p.paymentId).join(', ') || '(unpaid)'),
  );
  console.log('');

  const ok = result.transaction.orNumber.endsWith('000001');
  console.log(ok ? '  Numbering restarted correctly.' : '  UNEXPECTED: numbering did not restart.');
  console.log('');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error('\nverify-reset failed: ' + (error instanceof Error ? error.message : String(error)) + '\n');
  process.exit(1);
});
