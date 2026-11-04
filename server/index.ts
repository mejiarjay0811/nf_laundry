import { createApp } from './app.js';
import { env } from './env.js';
import { logger, errorMeta } from './logger.js';
import { pruneLoginAttempts } from './services/auth.service.js';
import { getStore } from './sheets/index.js';
import { inspectWorkbook } from './sheets/init.js';

/**
 * Warn about the one configuration where sign-in cannot possibly work.
 *
 * Against the Apps Script backend every stored hash is peppered with a secret
 * that is derived inside the deployment and never leaves it, so this process
 * cannot verify any of them. The symptom is "Incorrect username or password"
 * for every account, forever, which reads as a forgotten password and sends
 * people round in circles resetting one. The tools that reset passwords ask
 * the deployment to hash, so they are unaffected — only serving sign-in here
 * is broken, and that is worth saying out loud at startup.
 */
function warnIfSignInCannotWork(provider: string): void {
  if (provider !== 'apps-script' || env.PASSWORD_PEPPER) return;
  logger.warn('Sign-in through this server will fail for every account.');
  logger.warn(
    'Passwords on the live sheet are hashed inside the Apps Script deployment ' +
      'with a pepper that never leaves it, so this process cannot check them.',
  );
  logger.warn('Sign in through the installed app, which talks to the deployment directly.');
}

async function main(): Promise<void> {
  const app = createApp();
  const store = getStore();

  warnIfSignInCannotWork(env.SHEETS_PROVIDER);

  // Boot even when the spreadsheet is unreachable — the UI then shows a clear
  // connection error instead of the server refusing to start.
  try {
    await store.connect();
    const workbook = await inspectWorkbook(store);
    if (!workbook.ready) {
      logger.warn('Workbook is missing required sheets', { missing: workbook.missing });
      logger.warn('Run "npm run setup" to create them.');
    } else {
      logger.info('Workbook ready', { sheets: workbook.present.length });
    }
  } catch (error) {
    logger.error('Could not reach the data source at startup', errorMeta(error));
    logger.error('The API will start, but requests will fail until this is fixed.');
  }

  const server = app.listen(env.PORT, () => {
    logger.info('N & F Laundry POS API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      provider: store.gateway.name,
    });
  });

  const prune = setInterval(pruneLoginAttempts, 5 * 60 * 1000);
  prune.unref();

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    clearInterval(prune);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', errorMeta(reason));
  });
}

main().catch((error) => {
  logger.error('Fatal startup error', errorMeta(error));
  process.exit(1);
});
