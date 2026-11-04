import { SheetStore } from '../server/sheets/store.js';
import { NativeSheetsGateway } from './gateway.js';

/**
 * Apps Script's replacement for server/sheets/index.ts.
 *
 * The real module picks a driver from configuration and imports all three to do
 * it, which would drag googleapis and node:fs into a bundle that has neither.
 * Here there is only one possible answer: the spreadsheet this script is bound
 * to.
 */
let store: SheetStore | null = null;

export function getStore(): SheetStore {
  if (!store) store = new SheetStore(new NativeSheetsGateway());
  return store;
}

export function setStoreForTesting(next: SheetStore | null): void {
  store = next;
}

export { SheetStore } from '../server/sheets/store.js';
export type { SheetsGateway } from '../server/sheets/gateway.js';
