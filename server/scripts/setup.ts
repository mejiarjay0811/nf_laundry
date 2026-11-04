/**
 * One-time (and safely repeatable) workbook setup.
 *
 *   npm run setup
 *
 * Creates any missing sheet, repairs missing header columns, seeds the default
 * services and settings, and creates the first administrator if the Users sheet
 * is empty. It never deletes or overwrites existing rows.
 */
import { env } from '../env.js';
import { logger, errorMeta } from '../logger.js';
import { getStore } from '../sheets/index.js';
import { describeInit, initialiseWorkbook } from '../sheets/init.js';
import { seedServices } from '../services/catalog.service.js';
import { seedSettings } from '../services/settings.service.js';
import { createUser, hasAnyUser } from '../services/user.service.js';
import { generateTemporaryPassword } from '../utils/password.js';

async function main(): Promise<void> {
  const store = getStore();

  console.log('\nN & F LAUNDRY POS — workbook setup');
  console.log('  provider: ' + store.gateway.name);
  if (store.gateway.name === 'local') {
    console.log('  data dir: ' + store.gateway.target);
  }
  console.log('');

  await store.connect();

  const result = await initialiseWorkbook(store, { seedServices, seedSettings });
  console.log(describeInit(result));
  console.log('');

  if (await hasAnyUser()) {
    console.log('Users sheet already has accounts — no administrator was created.');
  } else if (env.SHEETS_PROVIDER === 'apps-script') {
    /*
     * Against the Apps Script backend the password must be hashed there, not
     * here: the pepper mixed into every hash is generated inside that script
     * and never leaves it, so an account created on this machine would be
     * unable to sign in. Hashing locally and appearing to succeed would be the
     * worst outcome, so this hands over to the command that does it properly.
     */
    console.log('The workbook is ready, but it has no accounts yet.');
    console.log('');
    console.log('Create BOTH accounts a shop needs:');
    console.log('  npm run admin:password -- owner <choose-a-password>');
    console.log('  npm run admin:password -- sysadmin <choose-a-password> Admin');
    console.log('');
    console.log('That asks the deployment to hash the passwords, which is the only');
    console.log('place it can be done in a way that sign-in will accept.');
  } else {
    // Use || rather than ?? so a blank value in .env falls back to the default
    // instead of being passed through as an empty string.
    const username = env.SEED_ADMIN_USERNAME?.trim() || 'admin';
    const password = env.SEED_ADMIN_PASSWORD?.trim() || generateTemporaryPassword();
    const fullName = env.SEED_ADMIN_FULLNAME?.trim() || 'System Administrator';

    /*
     * TWO accounts, because administration and the business are separate
     * roles and neither can do the other's job.
     *
     * An Owner runs the shop but cannot create accounts; an Admin creates
     * accounts but cannot open the till. Seeding only one of them would leave
     * a shop that either cannot trade or cannot ever hire anybody — a
     * dead-end a new user would have no way to escape from inside the app.
     */
    await createUser({ username, password, fullName, role: 'Owner' }, null);

    const adminPassword = generateTemporaryPassword();
    await createUser(
      {
        username: 'sysadmin',
        password: adminPassword,
        fullName: 'System Administrator',
        role: 'Admin',
      },
      null,
    );

    console.log('Created two accounts:');
    console.log('');
    console.log('  OWNER — the shop: till, customers, reports, profit');
    console.log('    username: ' + username);
    console.log('    password: ' + password);
    console.log('');
    console.log('  ADMIN — accounts, settings and the audit log, and nothing else');
    console.log('    username: sysadmin');
    console.log('    password: ' + adminPassword);
    console.log('');
    console.log('  These passwords are not stored anywhere in plain text. Copy them now,');
    console.log('  sign in, and change them from Settings.');
  }

  console.log('\nSetup complete.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Setup failed', errorMeta(error));
    console.error('\nSetup failed: ' + (error instanceof Error ? error.message : String(error)));
    console.error('\nCheck your .env configuration and that the spreadsheet is shared correctly.\n');
    process.exit(1);
  });
