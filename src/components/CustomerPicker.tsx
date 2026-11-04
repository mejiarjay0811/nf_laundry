import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Phone, Search, UserPlus, UserRound, X } from 'lucide-react';
import type { CustomerDto } from '@shared/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { initials, peso } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useDebounce } from '@/hooks/useDebounce';
import { useAuth } from '@/auth/AuthProvider';
import { useCustomerDirectory, type CustomerDirectory } from '@/hooks/useCustomerDirectory';

export interface NewCustomerDraft {
  fullName: string;
  contactNumber: string;
  address: string;
  /** Set once the cashier has confirmed a same-name warning. */
  allowDuplicateName?: boolean;
}

interface CustomerPickerProps {
  selected: CustomerDto | null;
  onSelect: (customer: CustomerDto | null) => void;
  draft: NewCustomerDraft | null;
  onDraftChange: (draft: NewCustomerDraft | null) => void;
  errors?: Partial<Record<'fullName' | 'contactNumber' | 'customer', string>>;
  disabled?: boolean;
}

/**
 * Address suggestions come from addresses the shop has already entered. A
 * laundry serves the same few streets repeatedly, so its own history is a
 * better source than a generic map lookup — and it needs no API key.
 */
function AddressField({
  value,
  onChange,
  disabled,
  directory,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  directory: CustomerDirectory;
}) {
  const [open, setOpen] = useState(false);

  // Drawn from the customer list already in memory, so suggestions appear as
  // the cashier types instead of a round trip behind every keystroke.
  const suggestions = useMemo(
    () =>
      directory
        .suggestAddresses(value)
        .filter((item) => item.toLowerCase() !== value.trim().toLowerCase()),
    [directory, value],
  );

  return (
    <div className="relative">
      <Input
        label="Address"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        leading={<MapPin className="h-4 w-4" aria-hidden="true" />}
        hint="Optional"
        autoComplete="off"
        disabled={disabled}
      />
      {open && suggestions.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-pop">
          {suggestions.map((address) => (
            <li key={address}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(address);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="text-slate-700">{address}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CustomerPicker({
  selected,
  onSelect,
  draft,
  onDraftChange,
  errors,
  disabled,
}: CustomerPickerProps) {
  const [term, setTerm] = useState('');
  const { can } = useAuth();
  const isAdmin = can('customers.viewSpending');
  const directory = useCustomerDirectory(!selected || Boolean(draft));

  /*
   * Matching happens locally against the loaded directory, so results appear on
   * the keystroke rather than after a round trip. The server is asked only when
   * the shop has more customers than one page holds and nothing matched here —
   * otherwise a customer beyond the first page would be invisible.
   */
  const localMatches = useMemo(
    () => (selected || draft ? [] : directory.search(term)),
    [directory, term, selected, draft],
  );

  const needsServer = directory.truncated && term.trim().length >= 2 && localMatches.length === 0;
  const debounced = useDebounce(term, 250);

  const { data: remote, isFetching } = useQuery({
    queryKey: ['customers', 'search', debounced],
    queryFn: ({ signal }) =>
      api.get<{ items: CustomerDto[] }>('/customers/search', { q: debounced }, signal),
    enabled: needsServer && debounced.trim().length >= 2,
    staleTime: 20_000,
  });

  const results = localMatches.length > 0 ? localMatches : (remote?.items ?? []);
  const searching = directory.isLoading || (needsServer && isFetching);

  if (selected) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
          {initials(selected.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-navy-900">{selected.fullName}</p>
          {selected.contactNumber ? (
            <p className="flex items-center gap-1 text-sm text-slate-600 tnum">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {selected.contactNumber}
            </p>
          ) : null}
          {selected.totalTransactions > 0 ? (
            <p className="mt-0.5 text-xs text-slate-500">
              {selected.totalTransactions} previous{' '}
              {selected.totalTransactions === 1 ? 'order' : 'orders'}
              {isAdmin ? ' · ' + peso(selected.totalSpending) + ' spent' : ''}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">First order</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSelect(null)}
          disabled={disabled}
          aria-label="Choose a different customer"
          className="h-8 w-8 shrink-0 px-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (draft) {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-navy-900">
            <UserPlus className="h-4 w-4 text-brand-600" aria-hidden="true" />
            New customer
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDraftChange(null)}
            disabled={disabled}
            className="h-8 px-2 text-xs"
          >
            Cancel
          </Button>
        </div>
        <Input
          label="Full name"
          value={draft.fullName}
          onChange={(event) => onDraftChange({ ...draft, fullName: event.target.value })}
          error={errors?.fullName}
          leading={<UserRound className="h-4 w-4" aria-hidden="true" />}
          autoComplete="name"
          required
          disabled={disabled}
        />
        <Input
          label="Contact number"
          value={draft.contactNumber}
          onChange={(event) => onDraftChange({ ...draft, contactNumber: event.target.value })}
          error={errors?.contactNumber}
          leading={<Phone className="h-4 w-4" aria-hidden="true" />}
          inputMode="tel"
          autoComplete="tel"
          placeholder="09XX XXX XXXX"
          hint="Optional"
          disabled={disabled}
        />
        <AddressField
          value={draft.address}
          onChange={(address) => onDraftChange({ ...draft, address })}
          disabled={disabled}
          directory={directory}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search name, number or ID"
          aria-label="Search customers"
          autoComplete="off"
          disabled={disabled}
          className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-9 text-base placeholder:text-slate-400 hover:border-slate-400 focus:border-brand-500 disabled:bg-slate-50"
        />
        {searching ? (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {errors?.customer ? (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {errors.customer}
        </p>
      ) : null}

      {term.trim().length >= 1 ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
          {results.length ? (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
              {results.map((customer) => (
                <li key={customer.customerId}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(customer);
                      setTerm('');
                    }}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-navy-700">
                      {initials(customer.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-navy-900">
                        {customer.fullName}
                      </span>
                      <span className="block text-xs text-slate-500 tnum">
                        {customer.contactNumber || 'No contact number'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !searching ? (
            <p className="px-3 py-4 text-center text-sm text-slate-500">
              No customer found for {'“'}
              {term.trim()}
              {'”'}.
            </p>
          ) : null}
        </div>
      ) : null}

      <Button
        variant="outline"
        className={cn('mt-2 w-full sm:w-auto')}
        disabled={disabled}
        onClick={() => onDraftChange({ fullName: term.trim(), contactNumber: '', address: '' })}
        icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
      >
        Register new customer
      </Button>
    </div>
  );
}
