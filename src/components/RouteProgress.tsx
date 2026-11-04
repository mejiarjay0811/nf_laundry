import { useEffect, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';

/**
 * A thin bar showing that the app is talking to the backend.
 *
 * Every request here is a round trip to Apps Script — two to four seconds is
 * normal and cannot be made shorter. What can be fixed is the app looking dead
 * while it waits: a screen that shows nothing is indistinguishable from a
 * screen that has frozen, and the natural response is to press the button
 * again.
 *
 * It waits a moment before appearing, because a bar that flashes up for 100ms
 * on a cached read is noise, and it holds briefly at the end so a quick
 * sequence of calls reads as one continuous action rather than a flicker.
 */
const APPEAR_AFTER_MS = 260;
const HOLD_MS = 200;

export function RouteProgress() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const busy = fetching + mutating > 0;

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (busy) {
      const timer = window.setTimeout(() => setVisible(true), APPEAR_AFTER_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setVisible(false), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
      aria-hidden="true"
    >
      <div
        className={
          'h-full w-full origin-left bg-brand-500 transition-opacity duration-200 ' +
          (visible ? 'route-progress opacity-100' : 'opacity-0')
        }
      />
    </div>
  );
}
