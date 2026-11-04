import { useEffect, useRef, useState } from 'react';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

/**
 * Who is signed in, and how to stop being signed in.
 *
 * It lives in the header because a till is often shared: the person at the
 * counter needs to see whose name is against the sales they are about to make,
 * without opening the navigation drawer to find out.
 *
 * Signing out still asks first — an accidental tap mid-queue means re-entering
 * a password with customers waiting.
 */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Signed in as ' + user.fullName + ', ' + user.role}
        className={cn(
          'flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors',
          open ? 'bg-slate-100' : 'hover:bg-slate-100',
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
          {initials(user.fullName)}
        </span>
        <span className="hidden min-w-0 text-left lg:block">
          <span className="block max-w-[9rem] truncate text-xs font-semibold leading-tight text-navy-900">
            {user.fullName}
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-500">
            {user.role}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">
              {initials(user.fullName)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-navy-900">
                {user.fullName}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-600">
                {user.role === 'Admin' ? (
                  <ShieldCheck className="h-3 w-3 text-brand-600" aria-hidden="true" />
                ) : (
                  <UserRound className="h-3 w-3 text-slate-400" aria-hidden="true" />
                )}
                {user.role === 'Admin' ? 'Administrator' : 'Counter staff'}
              </span>
            </span>
          </div>

          <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Signed in as
          </p>
          <p className="px-3 pb-2 text-xs text-slate-600">{user.username}</p>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
            className="flex w-full items-center gap-2.5 border-t border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        busy={busy}
        title="Sign out?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Stay signed in
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          You are signed in as <strong>{user.fullName}</strong>. Signing out returns you to the
          login screen and you will need your password to get back in.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Every saved sale stays saved — nothing is lost except what is currently typed into the
          till.
        </p>
      </Modal>
    </div>
  );
}
