import { SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { logger } from '../logger.js';
import { SHEET_DEFINITIONS } from './schema.js';
import type { SheetStore } from './store.js';

export interface WorkbookStatus {
  ready: boolean;
  present: string[];
  missing: string[];
}

/** Non-destructive check: which required sheets exist right now? */
export async function inspectWorkbook(store: SheetStore): Promise<WorkbookStatus> {
  const existing = new Set(await store.listSheets());
  const present: string[] = [];
  const missing: string[] = [];

  for (const definition of SHEET_DEFINITIONS) {
    if (existing.has(definition.name)) present.push(definition.name);
    else missing.push(definition.name);
  }
  return { ready: missing.length === 0, present, missing };
}

export interface InitialiseResult {
  created: string[];
  existing: string[];
  headersRepaired: string[];
  seeded: { services: number; settings: number };
}

/**
 * Idempotent workbook initialisation.
 *
 * Creates only what is missing. Existing sheets keep every row; missing header
 * columns are appended rather than the header being overwritten, so production
 * data is never clobbered.
 */
export async function initialiseWorkbook(
  store: SheetStore,
  seeders: {
    seedServices: () => Promise<number>;
    seedSettings: () => Promise<number>;
  },
): Promise<InitialiseResult> {
  const result = await store.ensureSheets();
  logger.info('Workbook structure verified', {
    created: result.created,
    repaired: result.headersRepaired,
  });

  const services = await seeders.seedServices();
  const settings = await seeders.seedSettings();

  return { ...result, seeded: { services, settings } };
}

/** Human-readable summary used by the setup script and the health endpoint. */
export function describeInit(result: InitialiseResult): string {
  const lines: string[] = [];
  lines.push('Workbook checked at ' + manilaIso());
  if (result.created.length) lines.push('  created:  ' + result.created.join(', '));
  if (result.existing.length) lines.push('  existing: ' + result.existing.join(', '));
  if (result.headersRepaired.length) {
    lines.push('  repaired headers: ' + result.headersRepaired.join(', '));
  }
  lines.push('  seeded services: ' + result.seeded.services);
  lines.push('  seeded settings: ' + result.seeded.settings);
  lines.push('  required sheets: ' + Object.values(SHEETS).join(', '));
  return lines.join('\n');
}
