import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The GCash payment mark.
 *
 * Uses `public/gcash.png` when the shop has supplied one, and otherwise draws a
 * plain wordmark badge in GCash's blue. The fallback deliberately does not try
 * to imitate the real logo: an approximation of someone else's trademark drawn
 * from memory looks wrong and misrepresents their brand, whereas the name in a
 * blue badge is unambiguous and honest about being a label rather than a logo.
 *
 * Drop a `gcash.png` into `public/` and it is picked up with no code change.
 */
export function GCashMark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 'sm' ? 'h-5 w-5' : 'h-7 w-7';

  if (failed) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-[#007DFE] font-bold text-white',
          size === 'sm' ? 'h-5 px-1 text-[9px]' : 'h-7 px-1.5 text-[10px]',
          className,
        )}
        aria-label="GCash"
      >
        GCash
      </span>
    );
  }

  return (
    <img
      src="/gcash.png"
      alt="GCash"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-md object-contain', box, className)}
    />
  );
}
