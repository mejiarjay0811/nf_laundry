import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, UserPlus } from 'lucide-react';
import { formatDateTime } from '@shared/datetime';
import { ROLES, type Role } from '@shared/constants';
import { ROLE_DESCRIPTIONS } from '@shared/permissions';
import type { UserDto } from '@shared/types';

/**
 * A colour each, so a wrong role is noticeable in a list rather than something
 * you have to read. Owner and Admin are deliberately different: they are the
 * two that matter most and the two most easily confused.
 */
const ROLE_TONE: Record<string, 'purple' | 'blue' | 'green' | 'yellow' | 'slate'> = {
  Owner: 'purple',
  Admin: 'yellow',
  Manager: 'green',
  Staff: 'blue',
  Viewer: 'slate',
};
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, SkeletonTable } from '@/components/ui/States';
import { TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api, errorMessage } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';

function NewUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('Staff');

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) => api.post<{ user: UserDto }>('/users', body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User created', result.user.fullName + ' can now sign in.');
      setUsername('');
      setPassword('');
      setFullName('');
      setRole('Staff');
      onClose();
    },
    onError: (error) => toast.error('Unable to create user', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Add user"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={username.length < 3 || password.length < 8 || fullName.trim().length < 2}
            onClick={() =>
              void (async () => {
                const ok = await confirm({
                  title: 'Create this account?',
                  confirmLabel: 'Create account',
                  message: (
                    <>
                      <strong>{username.trim()}</strong> will be created as a <strong>{role}</strong>.
                    </>
                  ),
                });
                if (ok) {
                  mutation.mutate({ username: username.trim(), password, fullName: fullName.trim(), role });
                }
              })()
            }
          >
            Create user
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
          autoFocus
          disabled={mutation.isPending}
        />
        <Input
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoCapitalize="none"
          spellCheck={false}
          hint="Letters, numbers, dots, dashes and underscores."
          required
          disabled={mutation.isPending}
        />
        <Input
          label="Temporary password"
          type="text"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="At least 8 characters with a letter and a number. Share it securely."
          required
          disabled={mutation.isPending}
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          hint="Staff can take orders and payments. Admins also manage prices, users and reports."
          disabled={mutation.isPending}
        >
          {ROLES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

function EditUserDialog({
  user,
  open,
  onClose,
}: {
  user: UserDto;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [status, setStatus] = useState<'Active' | 'Inactive'>(user.status);

  const mutation = useMutation({
    mutationFn: (body: Record<string, string>) =>
      api.patch<{ user: UserDto }>('/users/' + user.userId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated');
      onClose();
    },
    onError: (error) => toast.error('Unable to update user', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Edit user"
      description={user.username}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Save changes to this account?',
                confirmLabel: 'Save changes',
                danger: status === 'Inactive',
                message: (
                  <>
                    <strong>{user.username}</strong> will be a <strong>{role}</strong> and{' '}
                    <strong>{status === 'Active' ? 'able to sign in' : 'blocked from signing in'}</strong>.
                    {role !== user.role ? ' Changing the role changes what they can see.' : ''}
                  </>
                ),
              });
              if (ok) mutation.mutate({ fullName: fullName.trim(), role, status });
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          disabled={mutation.isPending}
        />
        <Select
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          disabled={mutation.isPending}
        >
          {ROLES.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-slate-500">{ROLE_DESCRIPTIONS[role]}</p>
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as 'Active' | 'Inactive')}
          hint="Deactivating a user signs them out immediately."
          disabled={mutation.isPending}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </Select>
      </div>
    </Modal>
    {confirmDialog}
    </>
  );
}

function ResetPasswordDialog({
  user,
  open,
  onClose,
}: {
  user: UserDto;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/users/' + user.userId + '/reset-password', { password }),
    onSuccess: () => {
      toast.success('Password reset', 'Share the new password with ' + user.fullName + '.');
      setPassword('');
      onClose();
    },
    onError: (error) => toast.error('Unable to reset password', errorMessage(error)),
  });

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title="Reset password"
      description={user.fullName + ' \u00B7 ' + user.username}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={password.length < 8}
            onClick={async () => {
              const ok = await confirm({
                title: 'Reset this password?',
                confirmLabel: 'Reset password',
                danger: true,
                message: (
                  <>
                    <strong>{user.username}</strong> will have to use the new password from now on.
                    Their current one stops working immediately.
                  </>
                ),
              });
              if (ok) mutation.mutate();
            }}
          >
            Reset password
          </Button>
        </>
      }
    >
      <Input
        label="New password"
        type="text"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        hint="At least 8 characters with a letter and a number."
        autoFocus
        disabled={mutation.isPending}
      />
    </Modal>
    {confirmDialog}
    </>
  );
}

export default function Users() {
  useDocumentTitle('Users');
  const { user: currentUser } = useAuth();
  const [newOpen, setNewOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserDto | null>(null);
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null);

  const query = useQuery({
    queryKey: ['users'],
    queryFn: ({ signal }) => api.get<{ items: UserDto[] }>('/users', undefined, signal),
    staleTime: 60_000,
  });

  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Who can sign in, and what they are allowed to do."
        actions={
          <Button
            size="sm"
            onClick={() => setNewOpen(true)}
            icon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
          >
            Add user
          </Button>
        }
      />

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load users"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Username</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((account) => (
                <Tr key={account.userId}>
                  <Td>
                    <span className="font-medium text-navy-900">{account.fullName}</span>
                    {account.userId === currentUser?.userId ? (
                      <span className="ml-1.5 text-xs text-slate-400">(you)</span>
                    ) : null}
                  </Td>
                  <Td className="font-mono text-xs text-slate-600">{account.username}</Td>
                  <Td>
                    <Badge tone={ROLE_TONE[account.role] ?? 'blue'}>
                      {account.role}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={account.status === 'Active' ? 'green' : 'slate'}>
                      {account.status}
                    </Badge>
                  </Td>
                  <Td className="text-slate-600 tnum">
                    {account.lastLogin ? formatDateTime(account.lastLogin) : 'Never'}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditTarget(account)}
                        icon={<Pencil className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetTarget(account)}
                        icon={<KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                      >
                        Reset
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      <NewUserDialog open={newOpen} onClose={() => setNewOpen(false)} />
      {editTarget ? (
        <EditUserDialog
          key={editTarget.userId}
          user={editTarget}
          open
          onClose={() => setEditTarget(null)}
        />
      ) : null}
      {resetTarget ? (
        <ResetPasswordDialog
          key={resetTarget.userId}
          user={resetTarget}
          open
          onClose={() => setResetTarget(null)}
        />
      ) : null}
    </>
  );
}
