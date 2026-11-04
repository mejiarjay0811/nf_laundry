import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CustomerDto, Paginated } from '@shared/types';
import { api } from '@/lib/api';

/**
 * The customer list, held in the browser so type-ahead is instant.
 *
 * Searching used to ask the server on every keystroke, and each of those was a
 * round trip to Apps Script — two to three seconds to filter a list the client
 * could hold in its entirety. A laundry serves hundreds of customers, not
 * millions, so one fetch covers the shop and every subsequent keystroke is
 * local.
 *
 * If the shop ever outgrows a single page, `truncated` says so and the caller
 * falls back to asking the server.
 */
const PAGE_SIZE = 200;

export interface CustomerDirectory {
  customers: CustomerDto[];
  /** True when the shop has more customers than were loaded. */
  truncated: boolean;
  isLoading: boolean;
  /** Local type-ahead, matching the server's rules. */
  search: (term: string, limit?: number) => CustomerDto[];
  /** Addresses already used by the shop, for the new-customer form. */
  suggestAddresses: (term: string, limit?: number) => string[];
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

export function useCustomerDirectory(enabled = true): CustomerDirectory {
  const { data, isLoading } = useQuery({
    queryKey: ['customers', 'directory'],
    queryFn: ({ signal }) =>
      api.get<Paginated<CustomerDto>>(
        '/customers',
        { page: 1, pageSize: PAGE_SIZE, sortBy: 'name' },
        signal,
      ),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const customers = useMemo(
    () => (data?.items ?? []).filter((customer) => customer.status !== 'Inactive'),
    [data],
  );

  const truncated = (data?.total ?? 0) > customers.length;

  const search = useCallback(
    (term: string, limit = 8): CustomerDto[] => {
      const needle = term.trim().toLowerCase();
      if (needle.length < 1) return [];
      const wanted = digitsOf(needle);

      const matches = customers.filter((customer) => {
        const name = customer.fullName.toLowerCase();
        if (name.includes(needle)) return true;
        if (customer.customerId.toLowerCase().includes(needle)) return true;
        return Boolean(wanted) && digitsOf(customer.contactNumber).includes(wanted);
      });

      // A name that starts with what was typed is almost always the one meant.
      return matches
        .sort((a, b) => {
          const aStarts = a.fullName.toLowerCase().startsWith(needle) ? 0 : 1;
          const bStarts = b.fullName.toLowerCase().startsWith(needle) ? 0 : 1;
          return aStarts - bStarts || a.fullName.localeCompare(b.fullName);
        })
        .slice(0, limit);
    },
    [customers],
  );

  const suggestAddresses = useCallback(
    (term: string, limit = 6): string[] => {
      const needle = term.trim().toLowerCase();
      if (needle.length < 2) return [];

      const seen = new Map<string, string>();
      for (const customer of customers) {
        const address = customer.address?.trim();
        if (!address) continue;
        const key = address.toLowerCase();
        if (seen.has(key) || !key.includes(needle)) continue;
        seen.set(key, address);
      }

      return [...seen.values()]
        .sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(needle) ? 0 : 1;
          const bStarts = b.toLowerCase().startsWith(needle) ? 0 : 1;
          return aStarts - bStarts || a.localeCompare(b);
        })
        .slice(0, limit);
    },
    [customers],
  );

  return { customers, truncated, isLoading, search, suggestAddresses };
}
