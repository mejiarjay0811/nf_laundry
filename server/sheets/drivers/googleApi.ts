import { google, type sheets_v4 } from 'googleapis';
import { manilaIso } from '../../../shared/datetime.js';
import { AppError, DATA_SOURCE_MESSAGES } from '../../errors.js';
import { logger } from '../../logger.js';
import { retry } from '../../utils/async.js';
import { withNamedLock } from '../../utils/mutex.js';
import {
  GuardMismatchError,
  type AppendResult,
  type EnsureSheetsResult,
  type RowGuard,
  type SheetDefinition,
  type SheetsGateway,
} from '../gateway.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const LAST_COLUMN = 'AZ';

export interface GoogleApiOptions {
  spreadsheetId: string;
  clientEmail?: string;
  privateKey?: string;
  keyFile?: string;
  maxRetries: number;
}

/** 0-based column index to an A1 column label (0 -> A, 26 -> AA). */
export function columnLabel(index: number): string {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

const quoteSheet = (name: string): string => "'" + name.replace(/'/g, "''") + "'";

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function translateGoogleError(error: unknown, label: string): AppError {
  const err = error as { code?: number | string; message?: string };
  const status = typeof err.code === 'number' ? err.code : Number(err.code);

  if (status === 401 || status === 403) {
    logger.error('Google Sheets permission error', { label, message: err.message });
    return new AppError(
      'NOT_CONFIGURED',
      'The service account cannot access this spreadsheet. Share the sheet with the service account email as an Editor.',
      { cause: error },
    );
  }
  if (status === 404) {
    return new AppError('NOT_FOUND', 'The spreadsheet or sheet could not be found.', { cause: error });
  }
  if (status === 429 || status === 503) {
    return new AppError('DATA_SOURCE_UNAVAILABLE', DATA_SOURCE_MESSAGES.unavailable, { cause: error });
  }
  if (err.message && /timeout|ETIMEDOUT|ENOTFOUND|ECONNRESET/i.test(err.message)) {
    return new AppError('DATA_SOURCE_TIMEOUT', DATA_SOURCE_MESSAGES.timeout, { cause: error });
  }
  logger.error('Google Sheets error', { label, message: err.message });
  return new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, { cause: error });
}

/**
 * Direct Sheets API v4 driver.
 *
 * Caveat: the Sheets REST API has no server-side lock, so atomicity of counter
 * increments comes from a PROCESS-level mutex. That is safe for a single Node
 * process (the normal deployment) but not for a horizontally scaled one — use
 * the apps-script driver if you need multiple server instances.
 */
export class GoogleApiGateway implements SheetsGateway {
  readonly name = 'google-api' as const;
  readonly target: string;

  private readonly options: GoogleApiOptions;
  private client: sheets_v4.Sheets | null = null;

  constructor(options: GoogleApiOptions) {
    this.options = options;
    this.target = options.spreadsheetId;
  }

  private async sheets(): Promise<sheets_v4.Sheets> {
    if (this.client) return this.client;
    try {
      const auth = this.options.keyFile
        ? new google.auth.GoogleAuth({ keyFile: this.options.keyFile, scopes: SCOPES })
        : new google.auth.GoogleAuth({
            credentials: {
              client_email: this.options.clientEmail,
              private_key: (this.options.privateKey ?? '').replace(/\n/g, '\n'),
            },
            scopes: SCOPES,
          });
      const authClient = (await auth.getClient()) as never;
      this.client = google.sheets({ version: 'v4', auth: authClient });
      return this.client;
    } catch (error) {
      throw new AppError('NOT_CONFIGURED', 'Google service account credentials are invalid.', {
        cause: error,
      });
    }
  }

  private async run<T>(label: string, fn: (api: sheets_v4.Sheets) => Promise<T>): Promise<T> {
    const api = await this.sheets();
    return retry(
      async () => {
        try {
          return await fn(api);
        } catch (error) {
          throw translateGoogleError(error, label);
        }
      },
      {
        retries: this.options.maxRetries,
        label,
        shouldRetry: (error) =>
          error instanceof AppError &&
          (error.code === 'DATA_SOURCE_UNAVAILABLE' || error.code === 'DATA_SOURCE_TIMEOUT'),
      },
    );
  }

  async connect(): Promise<void> {
    const titles = await this.listSheets();
    logger.info('Connected to Google Sheets via Sheets API', { sheets: titles.length });
  }

  async listSheets(): Promise<string[]> {
    return this.run('listSheets', async (api) => {
      const response = await api.spreadsheets.get({
        spreadsheetId: this.options.spreadsheetId,
        fields: 'sheets.properties.title',
      });
      return (response.data.sheets ?? [])
        .map((sheet) => sheet.properties?.title ?? '')
        .filter(Boolean);
    });
  }

  private async writeValues(range: string, values: string[][]): Promise<void> {
    await this.run('writeValues', async (api) => {
      await api.spreadsheets.values.update({
        spreadsheetId: this.options.spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: { values },
      });
    });
  }

  async ensureSheets(definitions: readonly SheetDefinition[]): Promise<EnsureSheetsResult> {
    const result: EnsureSheetsResult = { created: [], existing: [], headersRepaired: [] };
    const titles = new Set(await this.listSheets());

    const toCreate = definitions.filter((d) => !titles.has(d.name));
    if (toCreate.length > 0) {
      await this.run('createSheets', async (api) => {
        await api.spreadsheets.batchUpdate({
          spreadsheetId: this.options.spreadsheetId,
          requestBody: {
            // A sheet defaults to 26 columns; Transactions needs 31, and writing
            // past the grid edge is rejected. Size the grid to the schema.
            requests: toCreate.map((d) => ({
              addSheet: {
                properties: {
                  title: d.name,
                  gridProperties: {
                    frozenRowCount: 1,
                    columnCount: Math.max(26, d.headers.length + 2),
                    rowCount: 1000,
                  },
                },
              },
            })),
          },
        });
      });
      result.created.push(...toCreate.map((d) => d.name));
    }

    for (const definition of definitions) {
      const isNew = result.created.includes(definition.name);
      if (isNew) {
        await this.writeValues(quoteSheet(definition.name) + '!A1', [[...definition.headers]]);
        continue;
      }
      result.existing.push(definition.name);
      const table = await this.readTable(definition.name);
      const existingHeader = table[0] ?? [];
      if (existingHeader.length === 0) {
        await this.writeValues(quoteSheet(definition.name) + '!A1', [[...definition.headers]]);
        result.headersRepaired.push(definition.name);
        continue;
      }
      const missing = definition.headers.filter((h) => !existingHeader.includes(h));
      if (missing.length > 0) {
        await this.writeValues(quoteSheet(definition.name) + '!A1', [
          [...existingHeader, ...missing],
        ]);
        result.headersRepaired.push(definition.name);
      }
    }
    return result;
  }

  async readTable(sheet: string): Promise<string[][]> {
    return this.run('readTable:' + sheet, async (api) => {
      const response = await api.spreadsheets.values.get({
        spreadsheetId: this.options.spreadsheetId,
        range: quoteSheet(sheet) + '!A1:' + LAST_COLUMN,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      const values = (response.data.values ?? []) as unknown[][];
      return values.map((row) => row.map(stringify));
    });
  }

  async appendRows(sheet: string, rows: string[][]): Promise<AppendResult> {
    return this.run('appendRows:' + sheet, async (api) => {
      const response = await api.spreadsheets.values.append({
        spreadsheetId: this.options.spreadsheetId,
        range: quoteSheet(sheet) + '!A1',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
      });
      const updatedRange = response.data.updates?.updatedRange ?? '';
      const match = /![A-Z]+(\d+)/.exec(updatedRange);
      const startRow = match && match[1] ? Number(match[1]) : 0;
      return { startRow, rowCount: rows.length };
    });
  }

  async updateRow(
    sheet: string,
    rowNumber: number,
    values: string[],
    guard?: RowGuard,
  ): Promise<void> {
    await this.updateRows(sheet, [{ rowNumber, values, guard }]);
  }

  async updateRows(
    sheet: string,
    updates: Array<{ rowNumber: number; values: string[]; guard?: RowGuard }>,
  ): Promise<void> {
    if (updates.length === 0) return;

    await withNamedLock('sheet:' + sheet, async () => {
      const guarded = updates.filter((u) => u.guard !== undefined);
      if (guarded.length > 0) {
        const ranges = guarded.map((u) => {
          const guard = u.guard as RowGuard;
          return quoteSheet(sheet) + '!' + columnLabel(guard.columnIndex) + u.rowNumber;
        });
        const valueRanges = await this.run('guardRead:' + sheet, async (api) => {
          const response = await api.spreadsheets.values.batchGet({
            spreadsheetId: this.options.spreadsheetId,
            ranges,
            valueRenderOption: 'UNFORMATTED_VALUE',
          });
          return response.data.valueRanges ?? [];
        });
        guarded.forEach((update, index) => {
          const guard = update.guard as RowGuard;
          const actual = stringify(valueRanges[index]?.values?.[0]?.[0]);
          if (actual !== guard.expected) {
            throw new GuardMismatchError(sheet, update.rowNumber);
          }
        });
      }

      await this.run('updateRows:' + sheet, async (api) => {
        await api.spreadsheets.values.batchUpdate({
          spreadsheetId: this.options.spreadsheetId,
          requestBody: {
            valueInputOption: 'RAW',
            data: updates.map((u) => ({
              range:
                quoteSheet(sheet) + '!A' + u.rowNumber + ':' +
                columnLabel(Math.max(0, u.values.length - 1)) + u.rowNumber,
              values: [u.values],
            })),
          },
        });
      });
    });
  }

  async bumpCounter(name: string, delta: number, seedIfMissing: number): Promise<number> {
    return withNamedLock('counter:' + name, async () => {
      const table = await this.readTable('Counters');
      const header = table[0] ?? ['Name', 'Value', 'Updated At'];
      const nameIndex = Math.max(0, header.indexOf('Name'));
      const valueIndex = Math.max(1, header.indexOf('Value'));
      const updatedIndex = header.indexOf('Updated At');

      let rowNumber = -1;
      let current = seedIfMissing;
      for (let i = 1; i < table.length; i += 1) {
        if ((table[i]?.[nameIndex] ?? '') === name) {
          rowNumber = i + 1;
          const parsed = Number(table[i]?.[valueIndex] ?? 0);
          current = Number.isFinite(parsed) ? parsed : seedIfMissing;
          break;
        }
      }

      const next = Math.max(current, seedIfMissing) + delta;
      const row: string[] = new Array(Math.max(header.length, 3)).fill('');
      row[nameIndex] = name;
      row[valueIndex] = String(next);
      if (updatedIndex >= 0) row[updatedIndex] = manilaIso();

      if (rowNumber === -1) {
        await this.appendRows('Counters', [row]);
      } else {
        await this.writeValues(
          quoteSheet('Counters') + '!A' + rowNumber + ':' + columnLabel(row.length - 1) + rowNumber,
          [row],
        );
      }
      return next;
    });
  }

  async bumpCounters(
    requests: Array<{ name: string; delta: number; seedIfMissing: number }>,
  ): Promise<Record<string, number>> {
    const values: Record<string, number> = {};
    for (const request of requests) {
      values[request.name] = await this.bumpCounter(
        request.name,
        request.delta,
        request.seedIfMissing,
      );
    }
    return values;
  }

  async appendMany(
    batch: Array<{ sheet: string; rows: string[][] }>,
  ): Promise<Array<{ sheet: string } & AppendResult>> {
    const results: Array<{ sheet: string } & AppendResult> = [];
    for (const entry of batch) {
      if (entry.rows.length === 0) {
        results.push({ sheet: entry.sheet, startRow: 0, rowCount: 0 });
        continue;
      }
      const appended = await this.appendRows(entry.sheet, entry.rows);
      results.push({ sheet: entry.sheet, ...appended });
    }
    return results;
  }

  /** One batchGet instead of a request per sheet. */
  async readTables(sheets: string[]): Promise<Record<string, string[][]>> {
    if (sheets.length === 0) return {};
    return this.run('readTables', async (api) => {
      const response = await api.spreadsheets.values.batchGet({
        spreadsheetId: this.options.spreadsheetId,
        ranges: sheets.map((sheet) => quoteSheet(sheet) + '!A1:' + LAST_COLUMN),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      const tables: Record<string, string[][]> = {};
      (response.data.valueRanges ?? []).forEach((range, index) => {
        const name = sheets[index] as string;
        tables[name] = ((range.values ?? []) as unknown[][]).map((row) => row.map(stringify));
      });
      return tables;
    });
  }

  async clearSheetData(
    sheet: string,
    confirm: 'DELETE_ALL_ROWS',
  ): Promise<{ removed: number }> {
    if (confirm !== 'DELETE_ALL_ROWS') {
      throw new AppError('VALIDATION_ERROR', 'Refusing to clear "' + sheet + '" without confirmation.');
    }
    const table = await this.readTable(sheet);
    const removed = Math.max(0, table.length - 1);
    if (removed === 0) return { removed: 0 };

    const sheetId = await this.run('sheetId:' + sheet, async (api) => {
      const response = await api.spreadsheets.get({
        spreadsheetId: this.options.spreadsheetId,
        fields: 'sheets.properties(sheetId,title)',
      });
      const match = (response.data.sheets ?? []).find(
        (candidate) => candidate.properties?.title === sheet,
      );
      return match?.properties?.sheetId ?? null;
    });
    if (sheetId === null) throw new AppError('NOT_FOUND', 'Sheet "' + sheet + '" was not found.');

    await this.run('clearSheetData:' + sheet, async (api) => {
      await api.spreadsheets.batchUpdate({
        spreadsheetId: this.options.spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: table.length },
              },
            },
          ],
        },
      });
    });
    return { removed };
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.listSheets();
    return Date.now() - started;
  }
}
