import { SHEETS, normaliseOrderStatus, type PaymentStatus } from '../../shared/constants.js';
import type { TrackingDto } from '../../shared/types.js';
import { notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import { balanceFor } from './loyalty.service.js';

/**
 * What a customer may see about their own order, without signing in.
 *
 * The link lives on a printed receipt, so anyone holding that paper can open
 * it — which is the point, and also the constraint. The reply carries what is
 * on the receipt they already have and nothing more: no address, no contact
 * number, no lifetime spend, and no way to walk from one order to another
 * customer's.
 *
 * Lookup needs the O.R. number *and* the surname. The O.R. is sequential, so
 * on its own it would let anyone read the whole day's orders by counting
 * upwards — a weak second factor still turns enumeration into guesswork.
 */

function surnameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

export async function trackOrder(orNumber: string, lastName: string): Promise<TrackingDto> {
  const wanted = orNumber.trim().toUpperCase();
  const surname = lastName.trim().toLowerCase();
  if (!wanted || surname.length < 2) throw notFound('Order');

  const table = await getStore().table(SHEETS.transactions);
  const row = table.rows.find(
    (entry) => entry.get('O.R. Number').trim().toUpperCase() === wanted,
  );

  // One message for "no such order" and for "wrong name", so the page cannot
  // be used to confirm that an O.R. number exists.
  if (!row || row.get('Status') !== 'Active') throw notFound('Order');

  const customerName = row.get('Customer Name');
  const matches =
    surnameOf(customerName) === surname || customerName.toLowerCase().includes(surname);
  if (!matches) throw notFound('Order');

  const customerId = row.get('Customer ID');
  const transactionId = row.get('Transaction ID');

  const loyaltyBalance = customerId
    ? await balanceFor(customerId).catch(() => null)
    : null;

  /*
   * Their own recent orders, by customer id. Capped and stripped to four
   * fields: enough to recognise "the one from last Tuesday", not enough to
   * reconstruct a spending history from a receipt someone dropped.
   */
  const recent = customerId
    ? table.rows
        .filter(
          (entry) =>
            entry.get('Customer ID') === customerId &&
            entry.get('Status') === 'Active' &&
            entry.get('Transaction ID') !== transactionId,
        )
        .sort((a, b) => b.get('Transaction Date').localeCompare(a.get('Transaction Date')))
        .slice(0, 5)
        .map((entry) => ({
          orNumber: entry.get('O.R. Number'),
          transactionDate: entry.get('Transaction Date'),
          serviceType: entry.get('Service Type'),
          orderStatus: normaliseOrderStatus(entry.get('Order Status')),
        }))
    : [];

  const orderStatus = normaliseOrderStatus(row.get('Order Status'));

  return {
    orNumber: row.get('O.R. Number'),
    customerName,
    serviceType: row.get('Service Type'),
    quantity: row.num('Quantity'),
    orderStatus,
    paymentStatus: (row.get('Payment Status') || 'Unpaid') as PaymentStatus,
    balance: row.num('Balance'),
    total: row.num('Total Payment'),
    transactionDate: row.get('Transaction Date'),
    expectedPickup: row.get('Expected Pickup'),
    readyAt: row.get('Pickup Status') === 'Ready' ? row.get('Time Stamp') : null,
    pickedUpAt: row.get('Date Picked Up') || null,
    loyaltyBalance,
    recent,
  };
}
