import { useEffect, useRef, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { queryClient } from './queryClient';

/**
 * Keeping the app level with the spreadsheet while nobody touches it.
 *
 * Google pushes nothing. The app learns about a change only by asking, and
 * React Query already asks on three occasions: when a screen opens, when the
 * window is focused again, and when the network returns. None of those fire
 * on the case that actually matters in a shop — the till that sits open on the
 * pickup queue all morning, focused the whole time, while the owner settles an
 * order from the back office or edits the sheet directly. Without a heartbeat
 * that screen is as stale as whenever it was opened.
 *
 * So: a slow tick that refreshes only what is on screen, only while the tab is
 * visible, and only when the data is already stale. Every call is a two-to-four
 * second round trip to Apps Script, and there are daily quotas on that, so this
 * is deliberately unhurried rather than a live feed.
 */

/** Long enough not to beat on the quota, short enough that a shelf is current. */
const HEARTBEAT_MS = 45_000;

/** After this long away, assume everything on screen is worth re-reading. */
const STALE_AFTER_HIDDEN_MS = 2 * 60_000;

type Listener = () => void;

let lastSyncedAt: number | null = null;
let syncing = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------- the pulse */

async function refreshVisibleData(force: boolean): Promise<void> {
  if (syncing) return;
  if (!onlineManager.isOnline()) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

  syncing = true;
  emit();
  try {
    /*
     * `type: 'active'` is the whole point: only queries a mounted screen is
     * actually rendering. Refetching the whole cache would pull reports and
     * customer pages nobody is looking at, which on this backend is seconds of
     * someone else's quota for nothing.
     */
    await queryClient.refetchQueries({ type: 'active', stale: !force });
    lastSyncedAt = Date.now();
  } catch {
    // A failed heartbeat is not an error worth showing: the next one is 45
    // seconds away, and any screen whose own query failed shows its own state.
  } finally {
    syncing = false;
    emit();
  }
}

/** Refresh everything on screen right now — the manual "sync" affordance. */
export function syncNow(): Promise<void> {
  return refreshVisibleData(true);
}

/* ----------------------------------------------------------- the readout */

export interface SyncState {
  online: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
}

let snapshot: SyncState = { online: true, syncing: false, lastSyncedAt: null };

function currentSnapshot(): SyncState {
  const online = onlineManager.isOnline();
  // useSyncExternalStore compares by identity, so a fresh object every call
  // would re-render on every tick. Only build one when something moved.
  if (
    snapshot.online !== online ||
    snapshot.syncing !== syncing ||
    snapshot.lastSyncedAt !== lastSyncedAt
  ) {
    snapshot = { online, syncing, lastSyncedAt };
  }
  return snapshot;
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (listener) => {
      const stop = subscribe(listener);
      const stopOnline = onlineManager.subscribe(listener);
      return () => {
        stop();
        stopOnline();
      };
    },
    currentSnapshot,
    () => snapshot,
  );
}

/* ------------------------------------------------------------ the driver */

/**
 * Runs the heartbeat for as long as someone is signed in.
 *
 * Mounted once, in the app shell. The timer is cleared whenever the tab is
 * hidden and started again on return, so a phone in a pocket is not making
 * requests, and a laptop lid closed over lunch comes back to fresh figures
 * instead of this morning's.
 */
export function useLiveSync(enabled: boolean): void {
  const hiddenSince = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;

    const start = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void refreshVisibleData(false), HEARTBEAT_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const away = hiddenSince.current ? Date.now() - hiddenSince.current : 0;
        hiddenSince.current = null;
        // Back after a real absence: do not wait for `staleTime` to lapse on
        // each query, just re-read what is on screen.
        void refreshVisibleData(away > STALE_AFTER_HIDDEN_MS);
        start();
      } else {
        hiddenSince.current = Date.now();
        window.clearInterval(timer);
      }
    };

    const onOnline = () => void refreshVisibleData(true);

    start();
    document.addEventListener('visibilitychange', onVisibility);
    const stopOnline = onlineManager.subscribe((online) => {
      if (online) onOnline();
    });

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      stopOnline();
    };
  }, [enabled]);
}
