import { describe, expect, it } from 'vitest';
import {
  computeTransactionMoney,
  countsTowardSales,
  derivePaymentStatus,
  derivePickupStatus,
} from '../calc.js';
import { toCentavos, toPesos, formatPeso } from '../money.js';
import { describePaymentModes, normaliseOrderStatus } from '../constants.js';

const money = (input: {
  unitPrice: number;
  quantity: number;
  discount?: number;
  additionalCharge?: number;
  paidAmount?: number;
}) =>
  computeTransactionMoney({
    unitPrice: toCentavos(input.unitPrice),
    quantity: input.quantity,
    discount: toCentavos(input.discount ?? 0),
    additionalCharge: toCentavos(input.additionalCharge ?? 0),
    paidAmount: toCentavos(input.paidAmount ?? 0),
  });

describe('money conversion', () => {
  it('converts pesos to integer centavos without float drift', () => {
    expect(toCentavos(175)).toBe(17500);
    expect(toCentavos(0.1)).toBe(10);
    expect(toCentavos('1,250.50')).toBe(125050);
    expect(toCentavos('\u20B1175')).toBe(17500);
    expect(toCentavos('')).toBe(0);
    expect(toCentavos(null)).toBe(0);
  });

  it('survives the classic 0.1 + 0.2 problem', () => {
    const total = toCentavos(0.1) + toCentavos(0.2);
    expect(toPesos(total)).toBe(0.3);
  });

  it('formats Philippine Peso', () => {
    expect(formatPeso(17500)).toBe('\u20B1175.00');
    expect(formatPeso(125050)).toBe('\u20B11,250.50');
    expect(formatPeso(0)).toBe('\u20B10.00');
  });
});

describe('transaction arithmetic', () => {
  it('computes the documented worked example: Wash/Dry x 3', () => {
    const result = money({ unitPrice: 175, quantity: 3 });
    expect(toPesos(result.subtotal)).toBe(525);
    expect(toPesos(result.total)).toBe(525);
  });

  it('applies total = subtotal - discount + additional charge', () => {
    const result = money({ unitPrice: 100, quantity: 2, discount: 30, additionalCharge: 50 });
    expect(toPesos(result.subtotal)).toBe(200);
    expect(toPesos(result.total)).toBe(220);
  });

  it('returns change when the customer overpays', () => {
    const result = money({ unitPrice: 175, quantity: 3, paidAmount: 600 });
    expect(toPesos(result.change)).toBe(75);
    expect(toPesos(result.balance)).toBe(0);
    expect(toPesos(result.appliedAmount)).toBe(525);
  });

  it('returns a balance when the customer underpays', () => {
    const result = money({ unitPrice: 100, quantity: 2, paidAmount: 120 });
    expect(toPesos(result.balance)).toBe(80);
    expect(toPesos(result.change)).toBe(0);
    expect(toPesos(result.appliedAmount)).toBe(120);
  });

  it('never produces negative money', () => {
    const result = money({ unitPrice: 100, quantity: 1, discount: -50, paidAmount: -20 });
    expect(result.discount).toBeGreaterThanOrEqual(0);
    expect(result.paidAmount).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.balance).toBeGreaterThanOrEqual(0);
    expect(result.change).toBeGreaterThanOrEqual(0);
  });

  it('caps a discount at the amount actually owed', () => {
    const result = money({ unitPrice: 100, quantity: 1, discount: 500 });
    expect(toPesos(result.total)).toBe(0);
    expect(toPesos(result.discount)).toBe(100);
  });
});

describe('derived statuses', () => {
  it('derives payment status from the money', () => {
    expect(derivePaymentStatus(money({ unitPrice: 100, quantity: 1, paidAmount: 100 }), false)).toBe('Paid');
    expect(derivePaymentStatus(money({ unitPrice: 100, quantity: 1, paidAmount: 40 }), false)).toBe('Partially Paid');
    expect(derivePaymentStatus(money({ unitPrice: 100, quantity: 1, paidAmount: 0 }), false)).toBe('Unpaid');
    expect(derivePaymentStatus(money({ unitPrice: 100, quantity: 1, paidAmount: 100 }), true)).toBe('Cancelled');
    expect(derivePaymentStatus(money({ unitPrice: 100, quantity: 1, paidAmount: 100 }), false, true)).toBe('Refunded');
  });

  it('projects pickup status from order status', () => {
    expect(derivePickupStatus('Received')).toBe('Pending');
    expect(derivePickupStatus('Ready for Pickup')).toBe('Ready');
    expect(derivePickupStatus('Picked Up')).toBe('Picked Up');
    expect(derivePickupStatus('Cancelled')).toBe('Cancelled');
  });

  it('folds the retired six-stage statuses back to Received', () => {
    // Rows written before the workflow was simplified must still read
    // sensibly rather than showing a status the app no longer offers.
    expect(normaliseOrderStatus('Washing')).toBe('Received');
    expect(normaliseOrderStatus('Drying')).toBe('Received');
    expect(normaliseOrderStatus('Folding')).toBe('Received');
    expect(normaliseOrderStatus('Ready for Pickup')).toBe('Ready for Pickup');
    expect(normaliseOrderStatus('Picked Up')).toBe('Picked Up');
    expect(normaliseOrderStatus('Cancelled')).toBe('Cancelled');
    expect(normaliseOrderStatus('')).toBe('Received');
    expect(normaliseOrderStatus('nonsense')).toBe('Received');
  });

  it('labels a sale by the methods that settled it', () => {
    expect(describePaymentModes([])).toBe('');
    expect(describePaymentModes(['Cash'])).toBe('Cash');
    expect(describePaymentModes(['GCash'])).toBe('GCash');
    expect(describePaymentModes(['Cash', 'GCash'])).toBe('Cash + GCash');
    expect(describePaymentModes(['Cash', 'Cash'])).toBe('Cash');
  });

  it('excludes cancelled and refunded rows from sales', () => {
    expect(countsTowardSales('Active', 'Paid')).toBe(true);
    expect(countsTowardSales('Active', 'Unpaid')).toBe(true);
    expect(countsTowardSales('Cancelled', 'Paid')).toBe(false);
    expect(countsTowardSales('Active', 'Refunded')).toBe(false);
    expect(countsTowardSales('Active', 'Cancelled')).toBe(false);
  });
});
