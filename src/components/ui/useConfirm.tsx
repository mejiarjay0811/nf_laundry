import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './Modal';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Ask before doing something that writes.
 *
 * Every action that changes a record goes through this, so a stray tap on a
 * phone cannot silently alter the books. It is a hook rather than a dialog per
 * screen because the alternative — copying a ConfirmDialog and a piece of
 * state into every page — is where confirmations quietly get missed.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (await confirm({ title: '…', message: '…' })) mutation.mutate(…);
 *   …
 *   {confirmDialog}
 */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((ok: boolean) => {
    // Held open while the mutation runs, so the dialog does not vanish and
    // leave the screen looking idle during a slow save.
    if (ok) setBusy(true);
    else setPending(null);
    resolver.current?.(ok);
    resolver.current = null;
    if (ok) {
      // Close once the caller has had a chance to start its work.
      window.setTimeout(() => {
        setPending(null);
        setBusy(false);
      }, 0);
    }
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      busy={busy}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={pending?.title ?? ''}
      message={pending?.message ?? null}
      {...(pending?.confirmLabel ? { confirmLabel: pending.confirmLabel } : {})}
      {...(pending?.cancelLabel ? { cancelLabel: pending.cancelLabel } : {})}
      {...(pending?.danger ? { danger: true } : {})}
    />
  );

  return { confirm, confirmDialog };
}
