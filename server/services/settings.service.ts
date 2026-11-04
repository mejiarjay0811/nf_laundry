import { DEFAULT_SETTINGS, SETTINGS_KEYS, SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import type { SessionUser, SettingsDto } from '../../shared/types.js';
import { badRequest } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';

/** Settings keys a client is allowed to write. Anything else is rejected. */
const WRITABLE_KEYS = new Set<string>(Object.values(SETTINGS_KEYS));

export async function getSettings(): Promise<SettingsDto> {
  const table = await getStore().table(SHEETS.settings);
  const values: SettingsDto = { ...DEFAULT_SETTINGS };
  for (const row of table.rows) {
    const key = row.get('Key');
    if (key) values[key] = row.get('Value');
  }
  return values;
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const settings = await getSettings();
  return settings[key] ?? DEFAULT_SETTINGS[key] ?? fallback;
}

export async function getNumericSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getBooleanSetting(key: string, fallback: boolean): Promise<boolean> {
  const raw = await getSetting(key, String(fallback));
  return raw === 'true' || raw === '1';
}

/** Write defaults for any key that is not present yet. Returns how many. */
export async function seedSettings(): Promise<number> {
  return withNamedLock('settings:write', async () => {
    const store = getStore();
    const table = await store.table(SHEETS.settings, { fresh: true });
    const existing = new Set(table.rows.map((row) => row.get('Key')));
    const timestamp = manilaIso();

    const missing = Object.entries(DEFAULT_SETTINGS)
      .filter(([key]) => !existing.has(key))
      .map(([key, value]) => ({
        Key: key,
        Value: value,
        'Updated At': timestamp,
        'Updated By': 'system',
      }));

    if (missing.length > 0) await store.appendRecords(SHEETS.settings, missing);
    return missing.length;
  });
}

export async function updateSettings(
  patch: Record<string, string>,
  actor: SessionUser,
): Promise<SettingsDto> {
  const entries = Object.entries(patch);
  if (entries.length === 0) return getSettings();

  for (const [key] of entries) {
    if (!WRITABLE_KEYS.has(key)) {
      throw badRequest('Unknown setting: ' + key);
    }
  }

  return withNamedLock('settings:write', async () => {
    const store = getStore();
    const table = await store.table(SHEETS.settings, { fresh: true });
    const byKey = table.indexBy('Key');
    const timestamp = manilaIso();

    const previous: Record<string, string> = {};
    const updates: Array<{ row: RowView; patch: Record<string, string> }> = [];
    const inserts: Array<Record<string, string>> = [];

    for (const [key, rawValue] of entries) {
      const value = normaliseText(rawValue, 2000);
      const row = byKey.get(key);
      if (row) {
        previous[key] = row.get('Value');
        updates.push({
          row,
          patch: { Value: value, 'Updated At': timestamp, 'Updated By': actor.username },
        });
      } else {
        previous[key] = DEFAULT_SETTINGS[key] ?? '';
        inserts.push({
          Key: key,
          Value: value,
          'Updated At': timestamp,
          'Updated By': actor.username,
        });
      }
    }

    if (updates.length > 0) await store.updateRecords(SHEETS.settings, updates);
    if (inserts.length > 0) await store.appendRecords(SHEETS.settings, inserts);

    await recordAudit({
      actor,
      action: 'SETTINGS_UPDATE',
      module: 'Settings',
      entityId: Object.keys(patch).join(','),
      previousValue: previous,
      newValue: patch,
    });

    return getSettings();
  });
}

/** Receipt/business info projection used by the receipt renderer. */
export async function getBusinessProfile() {
  const settings = await getSettings();
  return {
    name: settings[SETTINGS_KEYS.businessName] || 'N & F LAUNDRY',
    address: settings[SETTINGS_KEYS.businessAddress] || '',
    contact: settings[SETTINGS_KEYS.businessContact] || '',
    email: settings[SETTINGS_KEYS.businessEmail] || '',
    logo: settings[SETTINGS_KEYS.businessLogo] || '',
    receiptHeader: settings[SETTINGS_KEYS.receiptHeader] || 'N & F LAUNDRY',
    receiptFooter: settings[SETTINGS_KEYS.receiptFooter] || '',
    showQr: (settings[SETTINGS_KEYS.receiptShowQr] ?? 'true') === 'true',
    paperWidth: settings[SETTINGS_KEYS.receiptPaperWidth] || '80mm',
  };
}
