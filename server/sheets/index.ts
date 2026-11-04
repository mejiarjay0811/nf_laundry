import path from 'node:path';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { AppsScriptGateway } from './drivers/appsScript.js';
import { GoogleApiGateway } from './drivers/googleApi.js';
import { LocalSheetsGateway } from './drivers/local.js';
import type { SheetsGateway } from './gateway.js';
import { SheetStore } from './store.js';

function createGateway(): SheetsGateway {
  switch (env.SHEETS_PROVIDER) {
    case 'apps-script':
      return new AppsScriptGateway({
        url: env.APPS_SCRIPT_URL as string,
        token: env.APPS_SCRIPT_TOKEN as string,
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID,
        timeoutMs: env.APPS_SCRIPT_TIMEOUT_MS,
        maxRetries: env.SHEETS_MAX_RETRIES,
      });

    case 'google-api':
      return new GoogleApiGateway({
        spreadsheetId: env.GOOGLE_SPREADSHEET_ID as string,
        clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: env.GOOGLE_PRIVATE_KEY,
        keyFile: env.GOOGLE_APPLICATION_CREDENTIALS,
        maxRetries: env.SHEETS_MAX_RETRIES,
      });

    case 'local':
    default:
      return new LocalSheetsGateway(path.resolve(process.cwd(), env.LOCAL_DATA_DIR));
  }
}

let store: SheetStore | null = null;

export function getStore(): SheetStore {
  if (!store) {
    const gateway = createGateway();
    store = new SheetStore(gateway);
    logger.info('Data layer initialised', {
      provider: gateway.name,
      target: gateway.target,
    });
  }
  return store;
}

/** Test seam — lets the integration suite point at a temporary directory. */
export function setStoreForTesting(next: SheetStore | null): void {
  store = next;
}

export { SheetStore } from './store.js';
export type { SheetsGateway } from './gateway.js';
