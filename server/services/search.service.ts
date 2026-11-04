import type { GlobalSearchResult } from '../../shared/types.js';
import { searchCustomers } from './customer.service.js';
import { toTransactionDto, toTransactionRecord, transactionsTable } from './transaction.service.js';

/**
 * Global search across customers and transactions.
 *
 * Runs entirely against the in-memory cached tables, so type-ahead never
 * generates spreadsheet traffic. The client debounces on top of this.
 */
export async function globalSearch(term: string, limit = 6): Promise<GlobalSearchResult> {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return { customers: [], transactions: [] };

  const digits = needle.replace(/\D/g, '');
  const table = await transactionsTable();

  const transactions = table.rows
    .map(toTransactionRecord)
    .map(toTransactionDto)
    .filter((item) => {
      if (item.status === 'Cancelled') return false;
      const haystack = (
        item.transactionId +
        ' ' +
        item.orNumber +
        ' ' +
        item.customerName +
        ' ' +
        item.serviceType
      ).toLowerCase();
      if (haystack.includes(needle)) return true;
      return digits.length >= 3 && item.contactNumber.replace(/\D/g, '').includes(digits);
    })
    .sort((a, b) => (b.timeStamp || '').localeCompare(a.timeStamp || ''))
    .slice(0, limit)
    .map((item) => ({
      transactionId: item.transactionId,
      orNumber: item.orNumber,
      customerName: item.customerName,
      totalPayment: item.totalPayment,
      paymentStatus: item.paymentStatus,
      orderStatus: item.orderStatus,
      transactionDate: item.transactionDate,
    }));

  const customers = (await searchCustomers(term, limit)).map((customer) => ({
    customerId: customer.customerId,
    fullName: customer.fullName,
    contactNumber: customer.contactNumber,
  }));

  return { customers, transactions };
}
