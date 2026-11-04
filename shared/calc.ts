import {
  addC,
  clampMinZeroC,
  multiplyC,
  subC,
  type Centavos,
} from './money.js';
import type { OrderStatus, PaymentStatus, PickupStatus } from './constants.js';

export interface TransactionMoneyInput {
  unitPrice: Centavos;
  quantity: number;
  discount: Centavos;
  additionalCharge: Centavos;
  paidAmount: Centavos;
}

export interface TransactionMoney {
  subtotal: Centavos;
  discount: Centavos;
  additionalCharge: Centavos;
  total: Centavos;
  paidAmount: Centavos;
  /** Money actually applied to the bill (never more than the total). */
  appliedAmount: Centavos;
  change: Centavos;
  balance: Centavos;
}

/**
 * The single source of truth for transaction arithmetic.
 * Used identically on the client (live preview) and the server (authority).
 *
 *   subtotal = quantity x unitPrice
 *   total    = subtotal - discount + additionalCharge
 *   change   = max(paid - total, 0)
 *   balance  = max(total - paid, 0)
 */
export function computeTransactionMoney(input: TransactionMoneyInput): TransactionMoney {
  const subtotal = multiplyC(input.unitPrice, input.quantity);
  const discount = clampMinZeroC(input.discount);
  const additionalCharge = clampMinZeroC(input.additionalCharge);

  // A discount may never exceed the subtotal plus surcharges.
  const grossBeforeDiscount = addC(subtotal, additionalCharge);
  const effectiveDiscount = discount > grossBeforeDiscount ? grossBeforeDiscount : discount;

  const total = clampMinZeroC(subC(grossBeforeDiscount, effectiveDiscount));
  const paidAmount = clampMinZeroC(input.paidAmount);

  const change = clampMinZeroC(subC(paidAmount, total));
  const balance = clampMinZeroC(subC(total, paidAmount));
  const appliedAmount = paidAmount > total ? total : paidAmount;

  return {
    subtotal,
    discount: effectiveDiscount,
    additionalCharge,
    total,
    paidAmount,
    appliedAmount,
    change,
    balance,
  };
}

/** Derive the payment status. Explicit terminal states win over arithmetic. */
export function derivePaymentStatus(
  money: Pick<TransactionMoney, 'total' | 'paidAmount'>,
  recordCancelled: boolean,
  refunded = false,
): PaymentStatus {
  if (recordCancelled) return 'Cancelled';
  if (refunded) return 'Refunded';
  if (money.total <= 0) return 'Paid';
  if (money.paidAmount >= money.total) return 'Paid';
  if (money.paidAmount > 0) return 'Partially Paid';
  return 'Unpaid';
}

/** Pickup status is a projection of the order status — never stored separately. */
export function derivePickupStatus(orderStatus: OrderStatus): PickupStatus {
  switch (orderStatus) {
    case 'Picked Up':
      return 'Picked Up';
    case 'Ready for Pickup':
      return 'Ready';
    case 'Cancelled':
      return 'Cancelled';
    default:
      return 'Pending';
  }
}

/** A transaction counts toward sales when it is neither cancelled nor refunded. */
export function countsTowardSales(
  recordStatus: string,
  paymentStatus: PaymentStatus,
): boolean {
  return recordStatus === 'Active' && paymentStatus !== 'Cancelled' && paymentStatus !== 'Refunded';
}
