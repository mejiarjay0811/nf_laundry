import { useEffect, useState } from 'react';
import { Clock as ClockIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The date and time, in Manila.
 *
 * A till needs to show the working day: the O.R. book is dated by hand, and a
 * cashier reconciling a drawer wants to see the shop's clock rather than trust
 * whatever the phone or the PC happens to be set to. Fixed to Asia/Manila for
 * that reason — the same zone every figure in the app is bucketed by.
 *
 * Ticks once a minute, not once a second: a moving seconds counter draws the
 * eye continuously for no benefit at a counter.
 */
const MANILA = 'Asia/Manila';

function parts(now: Date) {
  const date = new Intl.DateTimeFormat('en-PH', {
    timeZone: MANILA,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);

  const time = new Intl.DateTimeFormat('en-PH', {
    timeZone: MANILA,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);

  return { date, time };
}

export function Clock({
  className,
  tone = 'light',
}: {
  className?: string;
  /** 'light' for white cards, 'dark' for the navy header. */
  tone?: 'light' | 'dark';
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Line the first tick up with the top of the minute so the display never
    // sits up to 59 seconds stale.
    const toNextMinute = 60_000 - (Date.now() % 60_000);
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, toNextMinute);

    return () => {
      window.clearTimeout(timeout);
      if (interval) window.clearInterval(interval);
    };
  }, []);

  const { date, time } = parts(now);

  return (
    <div
      className={cn(
        'flex items-center gap-2 whitespace-nowrap',
        tone === 'dark' ? 'text-slate-300' : 'text-slate-600',
        className,
      )}
    >
      <ClockIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
      <span className="text-sm tnum">
        <span className={tone === 'dark' ? 'text-white' : 'font-semibold text-navy-900'}>
          {time}
        </span>
        <span className="ml-2">{date}</span>
      </span>
    </div>
  );
}
