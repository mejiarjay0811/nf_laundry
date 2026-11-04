import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The shop mark.
 *
 * The artwork carries its own solid background, so it fills the rounded tile
 * edge to edge rather than sitting inset on a plate. Padding it made the mark
 * shrink to an indistinct blue square at sidebar size — the logo was there, but
 * too small to read as anything.
 *
 * The rgba(255,255,255,0.12) plate stays underneath: it shows through if the
 * image is missing, and its ring and glow are what lift the tile off the navy.
 */
export function Logo({
  compact,
  size = 'md',
  className,
}: {
  compact?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  const box = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const radius = size === 'lg' ? 'rounded-2xl' : 'rounded-xl';

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className={cn(
          'relative flex shrink-0 items-center justify-center overflow-hidden',
          'logo-highlight ring-1 ring-white/20',
          'shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_8px_24px_-12px_rgba(0,0,0,0.6)]',
          radius,
          box,
        )}
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
        aria-hidden="true"
      >
        {failed ? (
          <svg viewBox="0 0 24 24" className="h-3/5 w-3/5 text-white" fill="none">
            <circle cx="12" cy="14" r="6" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="14" r="2.2" fill="currentColor" />
            <rect x="5" y="3.5" width="14" height="2.6" rx="1.3" fill="currentColor" />
          </svg>
        ) : (
          <img
            src="/logo.png"
            alt=""
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        )}
      </span>

      {compact ? null : (
        <span className="min-w-0">
          <span className="block text-sm font-bold leading-tight tracking-tight text-white">
            N &amp; F LAUNDRY
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-widest text-slate-400">
            House
          </span>
        </span>
      )}
    </div>
  );
}
