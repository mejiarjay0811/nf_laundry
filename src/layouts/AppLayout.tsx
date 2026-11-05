import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Menu, Plus } from 'lucide-react';
import type { AlertItem } from '@shared/types';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ProfileMenu } from '@/components/ProfileMenu';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { AlertsPanel } from '@/components/AlertsPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouteProgress } from '@/components/RouteProgress';
import { OfflineBanner, SyncStatus } from '@/components/SyncStatus';
import { Spinner } from '@/components/ui/States';
import { useOperationalCounts } from '@/hooks/useOperationalCounts';
import { useLiveSync } from '@/lib/sync';
import { useWarmCache } from '@/hooks/useWarmCache';
import { mobileNavigation } from './navigation';
import { badgeFor, Sidebar } from './Sidebar';

/**
 * Shown while a screen's code is fetched.
 *
 * Reserves height so the page does not jump when the real content lands, and
 * fades in after a moment — a spinner that appears for 60ms is just a flicker,
 * and most of these loads are that fast.
 */
function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-6 w-6 animate-in-late text-slate-400" />
    </div>
  );
}

export function AppLayout() {
  const { user, can } = useAuth();
  // Alerts summarise trading, so they follow the reports permission rather than
  // any notion of being an administrator — an Admin has no business reading them.
  const seesAlerts = can('reports.view');
  const [navOpen, setNavOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const counts = useOperationalCounts();

  // Warm the shared reads so the till and the queue open without a wait.
  useWarmCache(Boolean(user));

  // Keep whatever is on screen level with the sheet, which other tills and the
  // owner's own spreadsheet edits also write to.
  useLiveSync(Boolean(user));

  /*
   * Alerts summarise trading, so the server serves them to administrators only.
   * Asking as staff would mean a rejected request every two minutes — slow, and
   * it would fill the log with failures that are not faults.
   */
  const { data: alerts } = useQuery({
    queryKey: ['dashboard', 'alerts'],
    queryFn: ({ signal }) =>
      api.get<{ items: AlertItem[] }>('/dashboard/alerts', undefined, signal),
    enabled: seesAlerts,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const alertCount = alerts?.items.reduce((sum, alert) => sum + alert.count, 0) ?? 0;

  if (!user) return null;

  const mobileItems = mobileNavigation(user.role);

  return (
    <div className="app-enter min-h-screen bg-slate-100">
      <Sidebar
        role={user.role}
        fullName={user.fullName}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="lg:pl-64">
        <header className="app-header sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur no-print">
          <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="Open navigation"
              className="rounded-lg p-2 text-navy-700 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>

            <div className="hidden min-w-0 flex-1 sm:block">
              <GlobalSearch />
            </div>

            {/* No clock here. The Dashboard and the till each show one where it
                is actually read, and a third copy in the header just repeated
                them on the two screens that already had it. */}
            <div className="flex-1 sm:hidden" />

            <SyncStatus className="shrink-0" />

            <div className="flex shrink-0 items-center gap-1.5">
              {seesAlerts ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setAlertsOpen((open) => !open)}
                    aria-label={
                      alertCount > 0 ? alertCount + ' alerts need attention' : 'No active alerts'
                    }
                    aria-expanded={alertsOpen}
                    className="relative rounded-lg p-2 text-navy-700 hover:bg-slate-100"
                  >
                    <Bell className="h-5 w-5" aria-hidden="true" />
                    {alertCount > 0 ? (
                      <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white tnum">
                        {alertCount > 99 ? '99+' : alertCount}
                      </span>
                    ) : null}
                  </button>
                  {alertsOpen ? (
                    <AlertsPanel
                      alerts={alerts?.items ?? []}
                      onClose={() => setAlertsOpen(false)}
                    />
                  ) : null}
                </div>
              ) : null}

              {/* Route change, not a page load: reloading the app to reach the
                  till costs a fresh sign-in check and several seconds. */}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate('/pos')}
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                className="hidden sm:inline-flex"
              >
                New Sale
              </Button>

              {/* Who is at the till, and the way out. */}
              <ProfileMenu />
            </div>
          </div>

          <div className="border-t border-slate-100 px-3 py-2 sm:hidden">
            <GlobalSearch />
          </div>

          <OfflineBanner />
          <RouteProgress />
        </header>

        <main className="px-3 pb-24 pt-3 sm:px-5 sm:pb-8 sm:pt-4 lg:px-7">
          {/* Keyed on the route so recovering is as simple as navigating away
              and back, rather than reloading the whole app. */}
          <ErrorBoundary key={location.pathname}>
            {/*
             * The suspense boundary belongs here, around the page only.
             * Screens are code-split, so loading one suspends — and with the
             * boundary above the layout the whole shell was being torn down
             * and rebuilt for it, replaying the app's zoom-in. That was the
             * flash when moving between pages. Keeping it inside means the
             * sidebar and header stay put and only the content area waits.
             */}
            <Suspense fallback={<PageFallback />}>
              <div className="page-enter">
                <Outlet />
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <nav
        className="app-mobile-nav fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_-8px_rgb(15_23_42/0.25)] backdrop-blur md:hidden no-print"
        aria-label="Quick navigation"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: 'repeat(' + mobileItems.length + ', minmax(0, 1fr))' }}
        >
          {mobileItems.map((item) => {
            const Icon = item.icon;
            const active = item.matchPrefix
              ? location.pathname.startsWith(item.to)
              : location.pathname === item.to;
            const badge = badgeFor(item.to, counts);
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  aria-label={badge ? item.label + ', ' + badge.value + ' needing attention' : undefined}
                  className={cn(
                    'flex flex-col items-center gap-1 pb-1.5 pt-2 text-[11px] font-semibold transition-colors',
                    active ? 'text-brand-700' : 'text-slate-500 active:text-slate-700',
                  )}
                >
                  {/*
                    The icon sits in a pill that fills in when the tab is
                    current. A colour change alone is easy to miss at a glance
                    on a phone held at arm's length over a counter, and the
                    pill gives the thumb something to aim at as well.
                  */}
                  <span
                    className={cn(
                      'relative flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200',
                      active ? 'bg-brand-100' : 'bg-transparent',
                    )}
                  >
                    <Icon
                      className={cn('h-5 w-5 transition-transform', active && 'scale-110')}
                      aria-hidden="true"
                    />
                    {badge ? (
                      <span
                        className={cn(
                          'absolute right-1.5 top-0 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4 ring-2 ring-white tnum',
                          badge.tone,
                        )}
                      >
                        {badge.value > 99 ? '99+' : badge.value}
                      </span>
                    ) : null}
                  </span>
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
