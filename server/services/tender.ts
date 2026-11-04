import { PAYMENT_MODES, type PaymentMode } from '../../shared/constants.js';
import { toCentavos, toPesos } from '../../shared/money.js';
import { badRequest } from '../errors.js';

/**
 * How money put on the counter is turned into ledger rows.
 *
 * Shared by the two places a customer can pay — ringing up a sale, and settling
 * a balance later — because they must behave identically. A ₱175 bill split
 * ₱100 cash and ₱75 GCash has to be recorded the same way whichever counter it
 * happens at, or the cash and GCash totals stop agreeing with the drawer.
 */

export interface PaymentLine {
  modeOfPayment: PaymentMode;
  amount: number;
  referenceNumber?: string;
}

export interface NormalisedLine {
  modeOfPayment: PaymentMode;
  amount: number;
  referenceNumber: string;
}

/**
 * Clean up the tender lines: drop empty ones, reject nonsense, and collapse
 * repeats of the same method so a sale never produces two "Cash" ledger rows
 * that have to be added up by eye.
 */
export function normalisePaymentLines(lines: PaymentLine[]): NormalisedLine[] {
  const byMode = new Map<PaymentMode, NormalisedLine>();

  for (const line of lines) {
    if (!PAYMENT_MODES.includes(line.modeOfPayment)) {
      throw badRequest('Unknown payment method.');
    }
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw badRequest('Payment amounts cannot be negative.');
    }
    if (amount === 0) continue;

    const existing = byMode.get(line.modeOfPayment);
    if (existing) {
      existing.amount = toPesos(toCentavos(existing.amount) + toCentavos(amount));
      existing.referenceNumber = existing.referenceNumber || (line.referenceNumber ?? '');
    } else {
      byMode.set(line.modeOfPayment, {
        modeOfPayment: line.modeOfPayment,
        amount,
        referenceNumber: line.referenceNumber ?? '',
      });
    }
  }

  return [...byMode.values()];
}

/**
 * Split the money that actually settles the bill across the tender lines.
 *
 * Non-cash is applied FIRST. You cannot hand back GCash, so any overshoot has
 * to come out of the cash the customer put on the counter: on a ₱175 bill paid
 * with ₱100 cash + ₱100 GCash, the GCash covers ₱100 in full and the cash
 * covers the remaining ₱75, leaving ₱25 change from the drawer. Applying in
 * tender order instead would have recorded ₱25 of GCash as change, which is
 * not a thing that can happen.
 */
export function distributeApplied(
  lines: NormalisedLine[],
  appliedC: number,
): Array<NormalisedLine & { appliedC: number }> {
  const order = [...lines].sort((a, b) => {
    const rank = (mode: PaymentMode) => (mode === 'Cash' ? 1 : 0);
    return rank(a.modeOfPayment) - rank(b.modeOfPayment);
  });

  let remaining = appliedC;
  const appliedByMode = new Map<PaymentMode, number>();
  for (const line of order) {
    const share = Math.min(remaining, toCentavos(line.amount));
    appliedByMode.set(line.modeOfPayment, share);
    remaining -= share;
  }

  // Returned in the original tender order so payment ids stay predictable.
  return lines.map((line) => ({
    ...line,
    appliedC: appliedByMode.get(line.modeOfPayment) ?? 0,
  }));
}

/**
 * Total tendered, in centavos. Integer arithmetic throughout: adding pesos as
 * floats is how a bill ends up a centavo short.
 */
export function tenderedTotalC(lines: NormalisedLine[]): number {
  return lines.reduce((sum, line) => sum + toCentavos(line.amount), 0);
}

/**
 * Reject an overpayment that has no cash in it.
 *
 * Change comes out of the drawer, so tendering more than the bill using GCash
 * alone cannot be settled — recording it would silently invent a refund.
 */
export function assertChangeIsPayable(lines: NormalisedLine[], changeC: number): void {
  if (changeC <= 0) return;
  const hasCash = lines.some((line) => line.modeOfPayment === 'Cash');
  if (!hasCash) {
    throw badRequest(
      'That is more than the amount due, and change cannot be given for a ' +
        'non-cash payment. Enter the exact amount.',
    );
  }
}
