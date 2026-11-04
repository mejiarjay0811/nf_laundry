import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The panel shown while the app starts.
 *
 * It is doing real work behind this: deciding whether a session is still valid
 * means asking the backend, which on a cold start can take several seconds. The
 * alternative is a blank white screen, which reads as a broken app rather than
 * a loading one.
 *
 * It leaves on a timer rather than when loading finishes, so it never flashes
 * up and vanishes on a fast connection — a splash that appears for 80ms is
 * worse than none at all.
 */
const SETTLE_MS = 1150;
const FADE_MS = 460;

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const hold = reduced ? 300 : SETTLE_MS;

    const start = window.setTimeout(() => setLeaving(true), hold);
    const finish = window.setTimeout(() => onDone(), hold + (reduced ? 20 : FADE_MS));
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(finish);
    };
  }, [onDone]);

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden',
        'bg-gradient-to-b from-navy-900 via-navy-900 to-[#0b1220]',
        leaving && 'splash',
      )}
      role="status"
      aria-label="Starting N & F Laundry POS"
    >
      <div className="splash-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative flex flex-col items-center">
        <span
          className="splash-mark flex h-28 w-28 items-center justify-center overflow-hidden rounded-[28px] ring-1 ring-white/20 sm:h-32 sm:w-32"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            boxShadow:
              '0 0 0 1px rgba(255,255,255,0.06), 0 30px 60px -25px rgba(0,0,0,0.9), 0 0 90px -30px rgba(56,132,255,0.55)',
          }}
        >
          <img
            src="/logo.png"
            alt=""
            className="h-full w-full object-cover"
            // A missing file must not leave an empty plate on the first screen
            // anyone sees.
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        </span>

        <p className="splash-word mt-6 text-[13px] font-semibold uppercase text-slate-300 sm:text-sm">
          N &amp; F Laundry
        </p>
        <p className="mt-1.5 text-[10px] uppercase tracking-[0.35em] text-slate-500 sm:text-[11px]">
          Point of Sale
        </p>
      </div>
    </div>
  );
}
