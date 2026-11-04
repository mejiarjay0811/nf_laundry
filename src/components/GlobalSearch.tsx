import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ReceiptText, Search, User } from 'lucide-react';
import type { GlobalSearchResult } from '@shared/types';
import { api } from '@/lib/api';
import { peso } from '@/lib/format';
import { useDebounce } from '@/hooks/useDebounce';

/**
 * Debounced global search. The query only fires at two characters and the
 * server answers from its cached tables, so typing never hits the spreadsheet.
 */
export function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounce(term, 300);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: ({ signal }) =>
      api.get<GlobalSearchResult>('/dashboard/search', { q: debounced }, signal),
    enabled: debounced.trim().length >= 2,
    staleTime: 15_000,
  });

  useEffect(() => {
    const onClickAway = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setTerm('');
    navigate(path);
  };

  const hasResults =
    (data?.customers.length ?? 0) > 0 || (data?.transactions.length ?? 0) > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <label htmlFor="global-search" className="sr-only">
        Search customers, O.R. numbers and transactions
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          id="global-search"
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="Search customer, O.R. no., contact…"
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500"
        />
        {isFetching ? (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {open && debounced.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1.5 shadow-pop">
          {!hasResults && !isFetching ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No matches for “{debounced}”.
            </p>
          ) : null}

          {data?.customers.length ? (
            <div className="pb-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Customers
              </p>
              {data.customers.map((customer) => (
                <button
                  key={customer.customerId}
                  type="button"
                  onClick={() => go('/customers/' + customer.customerId)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <User className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium text-navy-800">
                    {customer.fullName}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500 tnum">
                    {customer.contactNumber}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {data?.transactions.length ? (
            <div className="border-t border-slate-100 pt-1">
              <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Transactions
              </p>
              {data.transactions.map((transaction) => (
                <button
                  key={transaction.transactionId}
                  type="button"
                  onClick={() => go('/transactions/' + transaction.transactionId)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <ReceiptText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="shrink-0 font-mono text-xs font-medium text-navy-800">
                    {transaction.orNumber}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    {transaction.customerName}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-navy-800 tnum">
                    {peso(transaction.totalPayment)}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
