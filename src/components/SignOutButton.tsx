import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Signing out is one tap away from the till, so it asks first.
 *
 * An accidental sign-out mid-queue means re-entering a password with customers
 * waiting — cheap to confirm, expensive to get wrong.
 */
export function SignOutButton() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await logout();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-navy-800 hover:text-white"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        busy={busy}
        title="Sign out?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Stay signed in
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirm()}>
              Sign out
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          You are signed in as <strong>{user?.fullName}</strong>. Signing out will return you to
          the login screen and you will need your password to get back in.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Every saved sale stays saved — nothing in progress is lost except what is currently
          typed into the till.
        </p>
      </Modal>
    </>
  );
}
