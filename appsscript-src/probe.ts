import { computeTransactionMoney, derivePaymentStatus } from '../shared/calc.js';
import { toCentavos, toPesos, formatPeso } from '../shared/money.js';
import { manilaDateKey, manilaIso } from '../shared/datetime.js';
import { createTransactionSchema } from '../server/validators/index.js';

export function probe(): string {
  const money = computeTransactionMoney({
    unitPrice: toCentavos(175),
    quantity: 2,
    discount: 0,
    additionalCharge: 0,
    paidAmount: toCentavos(500),
  });
  const parsed = createTransactionSchema.safeParse({
    orNumber: '0001',
    customerId: 'CUST-00001',
    serviceId: 'SVC-001',
    quantity: 2,
    idempotencyKey: 'probe-key-12345',
  });
  return JSON.stringify({
    total: formatPeso(money.total),
    change: toPesos(money.change),
    status: derivePaymentStatus(money, false),
    today: manilaDateKey('2026-09-03T17:30:00Z'),
    stamp: manilaIso('2026-09-03T11:35:04Z'),
    zodOk: parsed.success,
  });
}
(globalThis as any).probe = probe;
