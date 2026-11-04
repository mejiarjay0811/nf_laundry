import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { RangePreset } from '@shared/datetime';
import { manilaDateKey } from '@shared/datetime';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface RangeValue {
  preset: RangePreset;
  from?: string;
  to?: string;
}

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_year', label: 'This Year' },
];

/**
 * Date range control shared by the dashboard and the sales page. Presets cover
 * the everyday cases; the custom range is revealed only when asked for, so the
 * common path stays a single tap.
 */
export function DateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  className?: string;
}) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');
  const today = manilaDateKey();

  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="group"
        aria-label="Date range"
        className="flex flex-wrap items-center gap-1.5"
      >
        {PRESETS.map((preset) => {
          const active = value.preset === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setShowCustom(false);
                onChange({ preset: preset.value });
              }}
              className={cn(
                'h-9 rounded-lg border px-3 text-sm font-medium transition-colors',
                active
                  ? 'border-navy-900 bg-navy-900 text-white'
                  : 'border-slate-300 bg-white text-navy-700 hover:bg-slate-50',
              )}
            >
              {preset.label}
            </button>
          );
        })}

        <Button
          variant={value.preset === 'custom' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => {
            const next = !showCustom;
            setShowCustom(next);
            if (next) {
              onChange({ preset: 'custom', from: value.from ?? today, to: value.to ?? today });
            }
          }}
          icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
        >
          Custom
        </Button>
      </div>

      {showCustom ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <div>
            <label htmlFor="range-from" className="mb-1 block text-xs font-medium text-slate-600">
              From
            </label>
            <input
              id="range-from"
              type="date"
              max={value.to ?? today}
              value={value.from ?? today}
              onChange={(event) =>
                onChange({ preset: 'custom', from: event.target.value, to: value.to ?? today })
              }
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm focus:border-brand-500"
            />
          </div>
          <div>
            <label htmlFor="range-to" className="mb-1 block text-xs font-medium text-slate-600">
              To
            </label>
            <input
              id="range-to"
              type="date"
              min={value.from ?? undefined}
              value={value.to ?? today}
              onChange={(event) =>
                onChange({ preset: 'custom', from: value.from ?? today, to: event.target.value })
              }
              className="h-9 rounded-lg border border-slate-300 px-2 text-sm focus:border-brand-500"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
