import { useEffect, useState } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { syncNow, useSyncState } from '@/lib/sync';

/** "just now", "4m ago" — precision beyond the minute is noise here. */
function describeAge(at: number | null, now: number): string {
  if (!at) return 'not yet synced';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'synced just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return 'synced ' + minutes + 'm ago';
  return 'synced ' + Math.round(minutes / 60) + 'h ago';
}

/**
 * Whether the app is level with the spreadsheet, and a way to insist.
 *
 * Worth the space because the backend is a Google Sheet that other people and
 * other tills also write to. A cashier looking at a figure deserves to know
 * whether it is current, and when the shop's connection drops — which on
 * mobile data it will — the difference between "quiet" and "offline" is the
 * difference between carrying on and re-keying a sale that never saved.
 */
export function SyncStatus({ className }: { className?: string }) {
  const { online, syncing, lastSyncedAt } = useSyncState();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const offline = !online;

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={syncing}
      aria-label={offline ? 'Offline. Retry now.' : describeAge(lastSyncedAt, now) + '. Sync now.'}
      title={offline ? 'No connection to the backend' : describeAge(lastSyncedAt, now)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
        offline
          ? 'bg-red-50 text-red-700 hover:bg-red-100'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        className,
      )}
    >
      {offline ? (
        <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <RefreshCw
          className={cn('h-3.5 w-3.5', syncing && 'animate-spin')}
          aria-hidden="true"
        />
      )}
      {/* The words are for the desk; on a phone the icon carries it alone. */}
      <span className="hidden lg:inline tnum">
        {offline ? 'Offline' : syncing ? 'Syncing…' : describeAge(lastSyncedAt, now)}
      </span>
    </button>
  );
}

/**
 * A full-width warning when the connection is gone.
 *
 * Separate from the quiet indicator above on purpose: offline is the one state
 * where carrying on costs the shop real work, so it is said loudly and in
 * front of the screen rather than tucked into a corner of the header.
 */
export function OfflineBanner() {
  const { online } = useSyncState();
  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-red-600 px-3 py-2 text-xs font-medium text-white no-print"
    >
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        No connection. You can keep reading what is already loaded, but a sale will not save
        until this clears.
      </span>
    </div>
  );
}
