import { COUNTER_KEYS, SHEETS, normaliseRole, type Role } from '../../shared/constants.js';
import { isOwnerRole } from '../../shared/permissions.js';
import { manilaIso } from '../../shared/datetime.js';
import type { SessionUser, UserDto } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { comparisonKey, normaliseText } from '../utils/ids.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../utils/password.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

export interface UserRecord extends UserDto {
  passwordHash: string;
  row: RowView;
}

function toRecord(row: RowView): UserRecord {
  return {
    userId: row.get('User ID'),
    username: row.get('Username'),
    passwordHash: row.get('Password Hash'),
    fullName: row.get('Full Name'),
    // Anything unrecognised falls to the least-privileged role rather than to
    // Staff: a typo in the sheet must never hand out the counter's till.
    role: normaliseRole(row.get('Role')),
    status: row.get('Status') === 'Inactive' ? 'Inactive' : 'Active',
    createdAt: row.get('Created At'),
    lastLogin: row.get('Last Login') || null,
    updatedAt: row.get('Updated At'),
    row,
  };
}

export function toUserDto(record: UserRecord): UserDto {
  const { passwordHash: _passwordHash, row: _row, ...dto } = record;
  return dto;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const table = await getStore().table(SHEETS.users);
  const needle = comparisonKey(username);
  const row = table.find((candidate) => comparisonKey(candidate.get('Username')) === needle);
  return row ? toRecord(row) : null;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const table = await getStore().table(SHEETS.users);
  const row = table.find((candidate) => candidate.get('User ID') === userId);
  return row ? toRecord(row) : null;
}

export async function listUsers(): Promise<UserDto[]> {
  const table = await getStore().table(SHEETS.users);
  return table.rows
    .map(toRecord)
    .map(toUserDto)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  role: Role;
  status?: 'Active' | 'Inactive';
}

export async function createUser(
  input: CreateUserInput,
  actor: SessionUser | null,
): Promise<UserDto> {
  const username = normaliseText(input.username, 40).toLowerCase().replace(/\s+/g, '');
  const fullName = normaliseText(input.fullName, 80);

  if (username.length < 3) throw badRequest('Username must be at least 3 characters.');
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw badRequest('Username may only contain letters, numbers, dots, dashes and underscores.');
  }
  if (!fullName) throw badRequest('Full name is required.');

  const strength = checkPasswordStrength(input.password);
  if (!strength.ok) throw badRequest(strength.problems.join(' '));

  return withNamedLock('users:write', async () => {
    const store = getStore();
    const existing = await findUserByUsername(username);
    if (existing) throw conflict('That username is already taken.');

    const userId = await nextEntityId(COUNTER_KEYS.userId, 'USR-', SHEETS.users, 'User ID', 4);
    const timestamp = manilaIso();
    const passwordHash = await hashPassword(input.password);

    await store.appendRecords(SHEETS.users, [
      {
        'User ID': userId,
        Username: username,
        'Password Hash': passwordHash,
        'Full Name': fullName,
        Role: input.role,
        Status: input.status ?? 'Active',
        'Created At': timestamp,
        'Last Login': '',
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'USER_CREATE',
      module: 'Users',
      entityId: userId,
      newValue: { username, fullName, role: input.role },
    });

    const created = await findUserById(userId);
    if (!created) throw notFound('The new user');
    return toUserDto(created);
  });
}

export interface UpdateUserInput {
  fullName?: string;
  role?: Role;
  status?: 'Active' | 'Inactive';
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: SessionUser,
): Promise<UserDto> {
  return withNamedLock('users:write', async () => {
    const store = getStore();
    const record = await findUserById(userId);
    if (!record) throw notFound('User');

    // Demoting or deactivating the last owner would lock everyone out of the
    // settings, the user list and the books, with no way back in from the app.
    const losesOwnership =
      (input.role !== undefined && !isOwnerRole(input.role)) || input.status === 'Inactive';
    if (isOwnerRole(record.role) && losesOwnership && (await countActiveAdmins()) <= 1) {
      throw conflict('This is the last active administrator. Promote another admin first.');
    }

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    if (input.fullName !== undefined) patch['Full Name'] = normaliseText(input.fullName, 80);
    if (input.role !== undefined) patch.Role = input.role;
    if (input.status !== undefined) patch.Status = input.status;

    await store.updateRecord(SHEETS.users, record.row, patch);
    await recordAudit({
      actor,
      action: 'USER_UPDATE',
      module: 'Users',
      entityId: userId,
      previousValue: { fullName: record.fullName, role: record.role, status: record.status },
      newValue: input,
    });

    const updated = await findUserById(userId);
    if (!updated) throw notFound('User');
    return toUserDto(updated);
  });
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  /** Null for a command-line reset, which the audit trail records as unattributed. */
  actor: SessionUser | null,
): Promise<void> {
  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) throw badRequest(strength.problems.join(' '));

  await withNamedLock('users:write', async () => {
    const store = getStore();
    const record = await findUserById(userId);
    if (!record) throw notFound('User');

    await store.updateRecord(SHEETS.users, record.row, {
      'Password Hash': await hashPassword(newPassword),
      'Updated At': manilaIso(),
    });

    await recordAudit({
      actor,
      action: 'PASSWORD_RESET',
      module: 'Users',
      entityId: userId,
      newValue: { username: record.username },
    });
  });
}

export async function touchLastLogin(userId: string): Promise<void> {
  const store = getStore();
  const record = await findUserById(userId);
  if (!record) return;
  await store.updateRecord(SHEETS.users, record.row, { 'Last Login': manilaIso() });
}

export async function countActiveAdmins(): Promise<number> {
  const table = await getStore().table(SHEETS.users);
  return table.rows.filter(
    (row) => isOwnerRole(normaliseRole(row.get('Role'))) && row.get('Status') !== 'Inactive',
  ).length;
}

export async function hasAnyUser(): Promise<boolean> {
  const table = await getStore().table(SHEETS.users, { fresh: true });
  return table.size > 0;
}

/** Self-service password change — requires the current password. */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const record = await findUserById(userId);
  if (!record) throw notFound('User');

  const valid = await verifyPassword(currentPassword, record.passwordHash);
  if (!valid) throw badRequest('Your current password is incorrect.');

  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) throw badRequest(strength.problems.join(' '));

  await withNamedLock('users:write', async () => {
    const fresh = await findUserById(userId);
    if (!fresh) throw notFound('User');
    await getStore().updateRecord(SHEETS.users, fresh.row, {
      'Password Hash': await hashPassword(newPassword),
      'Updated At': manilaIso(),
    });
  });

  await recordAudit({
    actor: { userId: record.userId, username: record.username },
    action: 'PASSWORD_RESET',
    module: 'Users',
    entityId: userId,
    newValue: { self: true },
  });
}
