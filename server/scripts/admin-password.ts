/**
 * Set an account's password on the Apps Script deployment.
 *
 *   npm run admin:password -- <username> <password>
 *
 * Hashing has to happen inside Apps Script. The pepper that goes into every
 * hash is generated there and never leaves, so a hash computed on this machine
 * could not be verified at sign-in. This script therefore asks the deployment
 * to do the work rather than doing it here.
 *
 * It is also the migration path for accounts created before the move: those
 * hold scrypt hashes that the Apps Script runtime has no way to check, and
 * running this once per account replaces them.
 */
import { env } from '../env.js';

interface ScriptResponse {
  ok: boolean;
  data?: { userId: string; username: string };
  error?: { code: string; message: string };
}

async function callScript(op: string, payload: Record<string, unknown>): Promise<ScriptResponse> {
  const response = await fetch(env.APPS_SCRIPT_URL as string, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: env.APPS_SCRIPT_TOKEN, op, ...payload }),
    redirect: 'follow',
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as ScriptResponse;
  } catch {
    throw new Error(
      'The deployment did not return JSON. It is probably not published to "Anyone".\n' +
        text.slice(0, 200),
    );
  }
}

async function main(): Promise<void> {
  const [username, password, role] = process.argv.slice(2);

  if (!username || !password) {
    console.error('\nUsage: npm run admin:password -- <username> <password> [role]\n');
    console.error('  role defaults to Owner (runs the shop).');
    console.error('  Pass Admin for the accounts-and-settings account.\n');
    process.exit(1);
  }

  if (env.SHEETS_PROVIDER !== 'apps-script' || !env.APPS_SCRIPT_URL) {
    console.error('\nThis command talks to the Apps Script deployment, so .env needs');
    console.error('SHEETS_PROVIDER=apps-script with APPS_SCRIPT_URL and APPS_SCRIPT_TOKEN set.\n');
    process.exit(1);
  }

  console.log('\nSetting the password for "' + username + '"...');

  let result = await callScript('resetPassword', { username, password });

  if (!result.ok && result.error?.code === 'NOT_FOUND') {
    console.log('No such account — creating it as an administrator instead.');
    result = await callScript('createAdmin', {
      username,
      password,
      fullName: 'System Administrator',
      // Owner by default: the account someone creates first is almost always
      // the one that has to open the shop, not the one that edits settings.
      role: role ?? 'Owner',
    });
  }

  if (!result.ok) {
    console.error('\nFailed: ' + (result.error?.message ?? 'unknown error') + '\n');
    process.exit(1);
  }

  console.log('Done. ' + result.data?.username + ' (' + result.data?.userId + ') can now sign in.');
  console.log('The password is not stored anywhere in plain text.\n');
}

main().catch((error) => {
  console.error('\n' + (error instanceof Error ? error.message : String(error)) + '\n');
  process.exit(1);
});
