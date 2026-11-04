import { env } from '../env.js';
import { AppError, DATA_SOURCE_MESSAGES } from '../errors.js';
import { logger } from '../logger.js';
import { createSingleFlight } from '../utils/async.js';
import { TtlCache } from './cache.js';
import { GuardMismatchError, type RowGuard, type SheetsGateway } from './gateway.js';
import { PRIMARY_KEY_COLUMN, SHEET_DEFINITIONS } from './schema.js';
import { SheetTable, type RowView } from './table.js';

const singleFlight = createSingleFlight();

/**
 * The application's view of the workbook: cached tables, record-shaped writes,
 * and guarded updates. Services talk to this; nothing above it knows which
 * driver is in use.
 */
export class SheetStore {
  readonly gateway: SheetsGateway;
  private readonly cache: TtlCache;

  constructor(gateway: SheetsGateway, ttlSeconds = env.CACHE_TTL_SECONDS) {
    this.gateway = gateway;
    this.cache = new TtlCache(ttlSeconds);
  }

  async connect(): Promise<void> {
    await this.gateway.connect();
  }

  /** Cached, de-duplicated read of a whole sheet. */
  async table(sheet: string, options: { fresh?: boolean } = {}): Promise<SheetTable> {
    const key = 'table:' + sheet;
    if (!options.fresh) {
      const cached = this.cache.get<SheetTable>(key);
      if (cached) return cached;
    }

    return singleFlight(key, async () => {
      try {
        const matrix = await this.gateway.readTable(sheet);
        const table = new SheetTable(sheet, matrix);
        this.cache.set(key, table);
        return table;
      } catch (error) {
        if (error instanceof AppError) throw error;
        logger.error('Failed to read sheet', { sheet });
        throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, { cause: error });
      }
    });
  }

  invalidate(...sheets: string[]): void {
    for (const sheet of sheets) this.cache.invalidate('table:' + sheet);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  cacheStats() {
    return this.cache.stats();
  }

  /** Append record objects; missing columns are written as empty cells. */
  async appendRecords(
    sheet: string,
    records: Array<Record<string, string>>,
  ): Promise<{ startRow: number }> {
    if (records.length === 0) return { startRow: 0 };
    const table = await this.table(sheet);
    const rows = records.map((record) => {
      assertKnownColumns(sheet, table, record);
      return table.toRowArray(record);
    });

    try {
      const result = await this.gateway.appendRows(sheet, rows);
      this.invalidate(sheet);
      return { startRow: result.startRow };
    } catch (error) {
      this.invalidate(sheet);
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.write, { cause: error });
    }
  }

  /**
   * Patch an existing row. The row's primary key is used as a compare-and-swap
   * guard so a stale row number can never overwrite a different record.
   */
  async updateRecord(
    sheet: string,
    row: RowView,
    patch: Record<string, string>,
  ): Promise<void> {
    const table = await this.table(sheet);
    assertKnownColumns(sheet, table, patch);
    const values = table.mergeRow(row, patch);
    const guard = buildGuard(sheet, table, row);

    try {
      await this.gateway.updateRow(sheet, row.rowNumber, values, guard);
      this.invalidate(sheet);
    } catch (error) {
      this.invalidate(sheet);
      throw translateWriteError(error);
    }
  }

  /** Batch several row patches into a single round trip. */
  async updateRecords(
    sheet: string,
    patches: Array<{ row: RowView; patch: Record<string, string> }>,
  ): Promise<void> {
    if (patches.length === 0) return;
    const table = await this.table(sheet);
    const updates = patches.map(({ row, patch }) => {
      assertKnownColumns(sheet, table, patch);
      return {
        rowNumber: row.rowNumber,
        values: table.mergeRow(row, patch),
        guard: buildGuard(sheet, table, row),
      };
    });

    try {
      await this.gateway.updateRows(sheet, updates);
      this.invalidate(sheet);
    } catch (error) {
      this.invalidate(sheet);
      throw translateWriteError(error);
    }
  }

  async bumpCounter(name: string, seedIfMissing: number, delta = 1): Promise<number> {
    try {
      const value = await this.gateway.bumpCounter(name, delta, seedIfMissing);
      this.invalidate('Counters');
      return value;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.write, { cause: error });
    }
  }

  /**
   * Warm several tables in one round trip. Used before a sale so the pre-checks
   * (idempotency, pricing, duplicate customer) cost one call between them
   * rather than one each.
   */
  async warmTables(sheets: string[]): Promise<void> {
    const cold = sheets.filter((sheet) => !this.cache.get('table:' + sheet));
    if (cold.length === 0) return;
    try {
      const matrices = await this.gateway.readTables(cold);
      for (const [sheet, matrix] of Object.entries(matrices)) {
        this.cache.set('table:' + sheet, new SheetTable(sheet, matrix));
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, { cause: error });
    }
  }

  /** Force a fresh multi-table read, replacing whatever is cached. */
  async refreshTables(sheets: string[]): Promise<void> {
    if (sheets.length === 0) return;
    try {
      const matrices = await this.gateway.readTables(sheets);
      for (const [sheet, matrix] of Object.entries(matrices)) {
        this.cache.set('table:' + sheet, new SheetTable(sheet, matrix));
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, { cause: error });
    }
  }

  /** Allocate several sequence numbers in one atomic round trip. */
  async bumpCounters(
    requests: Array<{ name: string; delta: number; seedIfMissing: number }>,
  ): Promise<Record<string, number>> {
    try {
      const values = await this.gateway.bumpCounters(requests);
      this.invalidate('Counters');
      return values;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.write, { cause: error });
    }
  }

  /**
   * Append records to several sheets in one atomic round trip.
   * Either every row lands or none does.
   */
  async appendRecordsMany(
    batch: Array<{ sheet: string; records: Array<Record<string, string>> }>,
  ): Promise<Array<{ sheet: string; startRow: number; rowCount: number }>> {
    const prepared: Array<{ sheet: string; rows: string[][] }> = [];
    for (const entry of batch) {
      if (entry.records.length === 0) continue;
      const table = await this.table(entry.sheet);
      prepared.push({
        sheet: entry.sheet,
        rows: entry.records.map((record) => {
          assertKnownColumns(entry.sheet, table, record);
          return table.toRowArray(record);
        }),
      });
    }
    if (prepared.length === 0) return [];

    try {
      const results = await this.gateway.appendMany(prepared);
      this.invalidate(...prepared.map((entry) => entry.sheet));
      return results;
    } catch (error) {
      this.invalidate(...prepared.map((entry) => entry.sheet));
      if (error instanceof AppError) throw error;
      throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.write, { cause: error });
    }
  }

  /**
   * Apply row patches and appends as one unit of work.
   *
   * Where the driver supports it these share a single lock and a single commit,
   * which is the whole point: committing costs a round trip, and two writes that
   * belong to the same event should not pay for two.
   */
  async applyWrites(batch: {
    updates?: Array<{ sheet: string; row: RowView; patch: Record<string, string> }>;
    appends?: Array<{ sheet: string; records: Array<Record<string, string>> }>;
  }): Promise<void> {
    const updates: Array<{
      sheet: string;
      rowNumber: number;
      values: string[];
      guard?: RowGuard;
    }> = [];
    const appends: Array<{ sheet: string; rows: string[][] }> = [];
    const touched = new Set<string>();

    for (const entry of batch.updates ?? []) {
      const table = await this.table(entry.sheet);
      assertKnownColumns(entry.sheet, table, entry.patch);
      const guard = buildGuard(entry.sheet, table, entry.row);
      updates.push({
        sheet: entry.sheet,
        rowNumber: entry.row.rowNumber,
        values: table.mergeRow(entry.row, entry.patch),
        ...(guard ? { guard } : {}),
      });
      touched.add(entry.sheet);
    }

    for (const entry of batch.appends ?? []) {
      if (entry.records.length === 0) continue;
      const table = await this.table(entry.sheet);
      appends.push({
        sheet: entry.sheet,
        rows: entry.records.map((record) => {
          assertKnownColumns(entry.sheet, table, record);
          return table.toRowArray(record);
        }),
      });
      touched.add(entry.sheet);
    }

    if (updates.length === 0 && appends.length === 0) return;

    try {
      if (this.gateway.writeBatch) {
        await this.gateway.writeBatch({ updates, appends });
      } else {
        // Drivers without the combined primitive still get the same result,
        // just at the cost of one commit each.
        const bySheet = new Map<string, typeof updates>();
        for (const update of updates) {
          const list = bySheet.get(update.sheet) ?? [];
          list.push(update);
          bySheet.set(update.sheet, list);
        }
        for (const [sheet, list] of bySheet) {
          await this.gateway.updateRows(
            sheet,
            list.map(({ rowNumber, values, guard }) => ({ rowNumber, values, ...(guard ? { guard } : {}) })),
          );
        }
        if (appends.length > 0) await this.gateway.appendMany(appends);
      }
      this.invalidate(...touched);
    } catch (error) {
      this.invalidate(...touched);
      throw translateWriteError(error);
    }
  }

  async ensureSheets() {
    const result = await this.gateway.ensureSheets(SHEET_DEFINITIONS);
    this.invalidateAll();
    return result;
  }

  async listSheets(): Promise<string[]> {
    return this.gateway.listSheets();
  }

  async ping(): Promise<number> {
    return this.gateway.ping();
  }
}

function buildGuard(sheet: string, table: SheetTable, row: RowView) {
  const keyColumn = PRIMARY_KEY_COLUMN[sheet];
  if (!keyColumn) return undefined;
  const columnIndex = table.columnIndex(keyColumn);
  if (columnIndex < 0) return undefined;
  return { columnIndex, expected: row.get(keyColumn) };
}

/**
 * Guard against typos silently writing nothing: every key in a record must be
 * a real column in the sheet.
 */
function assertKnownColumns(
  sheet: string,
  table: SheetTable,
  record: Record<string, string>,
): void {
  for (const key of Object.keys(record)) {
    if (!table.hasColumn(key)) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Column "' + key + '" does not exist in sheet "' + sheet + '". Run the setup command to repair the workbook headers.',
      );
    }
  }
}

function translateWriteError(error: unknown): AppError {
  if (error instanceof GuardMismatchError) {
    return new AppError(
      'CONFLICT',
      'This record was changed by someone else. Reload the page and try again.',
      { cause: error },
    );
  }
  if (error instanceof AppError) return error;
  return new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.write, { cause: error });
}
