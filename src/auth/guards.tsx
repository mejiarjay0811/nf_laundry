import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Capability } from '@shared/permissions';
import { Spinner } from '@/components/ui/States';
import { landingPath } from '@/layouts/navigation';
import { useAuth } from './AuthProvider';

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-7 w-7" />
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

/**
 * A convenience guard only. Authorisation is enforced server-side on every
 * request; hiding a route here just keeps the UI honest.
 */
/**
 * Wraps a single element, or acts as a layout route when given no children.
 *
 * Takes a capability rather than a list of roles: a screen exists to let
 * someone do a thing, and enumerating which job titles may do it has to be
 * revisited every time a title is added.
 */
export function RequireCapability({
  needs,
  children,
}: {
  needs: Capability;
  children?: ReactNode;
}) {
  const { user, status, can } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  // Send them somewhere they can actually use. Redirecting everyone to the
  // dashboard would bounce staff to a screen they are not allowed to load.
  if (!can(needs)) return <Navigate to={landingPath(user.role)} replace />;
  return <>{children ?? <Outlet />}</>;
}

/** Shows its children only to an account holding the capability. */
export function Capable({ needs, children }: { needs: Capability; children: ReactNode }) {
  const { can } = useAuth();
  return can(needs) ? <>{children}</> : null;
}

/** Sends each account to the screen it starts the day on. */
export function Landing() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={landingPath(user.role)} replace />;
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : null;
}
