import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, ReceiptText, Wand2 } from 'lucide-react';
import { Input } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';

interface OrLookup {
  suggestion: string;
  candidate: string;
  taken: boolean;
}

/**
 * The O.R. number is transcribed from the shop's BIR receipt booklet, so it is
 * typed rather than generated. This checks availability as it is typed — the
 * cashier finds out before they finish the sale, not after.
 *
 * The check here is advisory. The authoritative uniqueness test runs inside the
 * locked create flow on the server, where two tills cannot race each other.
 */
export function OrNumberField({
  value,
  onChange,
  onAvailabilityChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onAvailabilityChange?: (taken: boolean) => void;
  error?: string;
  disabled?: boolean;
}) {
  const debounced = useDebounce(value.trim(), 400);
  const [suggested, setSuggested] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['transactions', 'or-number', debounced],
    queryFn: ({ signal }) =>
      api.get<OrLookup>('/transactions/or-number', { value: debounced }, signal),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (data?.suggestion) setSuggested(data.suggestion);
  }, [data?.suggestion]);

  const taken = Boolean(data?.taken && data.candidate === debounced && debounced.length > 0);

  useEffect(() => {
    onAvailabilityChange?.(taken);
  }, [taken, onAvailabilityChange]);

  const checked = debounced.length > 0 && data?.candidate === debounced && !isFetching;

  return (
    <div>
      <Input
        id="pos-or-number"
        label="O.R. number"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        leading={<ReceiptText className="h-4 w-4" aria-hidden="true" />}
        trailing={
          isFetching && debounced ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
          ) : checked && !taken ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          ) : checked && taken ? (
            <AlertCircle className="h-4 w-4 text-red-600" aria-hidden="true" />
          ) : null
        }
        // `||` not `??`: the caller clears this to '' rather than undefined,
        // and an empty string would otherwise suppress the duplicate warning.
        error={error || (taken ? 'That O.R. number has already been used.' : undefined)}
        hint={taken || error ? undefined : 'From your BIR receipt booklet'}
        placeholder="e.g. 0001234"
        autoComplete="off"
        spellCheck={false}
        required
        disabled={disabled}
      />

      {suggested && suggested.toUpperCase() !== value.trim().toUpperCase() ? (
        <button
          type="button"
          onClick={() => onChange(suggested)}
          disabled={disabled}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" />
          Next unused: <span className="font-mono">{suggested}</span>
        </button>
      ) : null}
    </div>
  );
}
