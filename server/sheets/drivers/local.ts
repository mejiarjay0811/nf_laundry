import { promises as fs } from 'node:fs';
import path from 'node:path';
import { manilaIso } from '../../../shared/datetime.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { Mutex } from '../../utils/mutex.js';
import {
  GuardMismatchError,
  type AppendResult,
  type EnsureSheetsResult,
  type RowGuard,
  type SheetDefinition,
  type SheetsGateway,
} from '../gateway.js';

/**
 * File-backed emulator of the spreadsheet contract.
 *
 * This is a STORAGE DRIVER, not seeded fake data — it holds whatever the
 * application writes to it, with the same row/column semantics as Sheets.
 * Used for local development, automated tests, and offline work.
 */
export class LocalSheetsGateway implements SheetsGateway {
  readonly name = 'local' as const;
  readonly target: string;

  private readonly dir: string;
  private readonly writeLock = new Mutex();

  constructor(dir: string) {
    this.dir = path.resolve(dir);
    this.target = this.dir;
  }

  async connect(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    logger.info('Local sheets driver ready', { dir: this.dir });
  }

  private filePath(sheet: string): string {
    const safe = sheet.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dir, safe + '.json');
  }

  private async readRaw(sheet: string): Promise<string[][] | null> {
    try {
      const contents = await fs.readFile(this.filePath(sheet), 'utf8');
      const parsed: unknown = JSON.parse(contents);
      if (!Array.isArray(parsed)) return null;
      return parsed as string[][];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      throw new AppError('DATA_SOURCE_ERROR', 'Local data file could not be read.', { cause: error });
    }
  }

  private async writeRaw(sheet: string, rows: string[][]): Promise<void> {
    const target = this.filePath(sheet);
    const temp = target + '.tmp';
    await fs.writeFile(temp, JSON.stringify(rows, null, 0), 'utf8');
    await fs.rename(temp, target);
  }

  async listSheets(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dir);
      return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  async ensureSheets(definitions: readonly SheetDefinition[]): Promise<EnsureSheetsResult> {
    const result: EnsureSheetsResult = { created: [], existing: [], headersRepaired: [] };
    await fs.mkdir(this.dir, { recursive: true });

    for (const definition of definitions) {
      const existing = await this.readRaw(definition.name);
      if (!existing || existing.length === 0) {
        await this.writeRaw(definition.name, [[...definition.headers]]);
        result.created.push(definition.name);
        continue;
      }
      result.existing.push(definition.name);

      const header = existing[0] ?? [];
      const missing = definition.headers.filter((h) => !header.includes(h));
      if (missing.length > 0) {
        // Append missing columns without disturbing existing data.
        const nextHeader = [...header, ...missing];
        const nextRows = existing.map((row, index) =>
          index === 0 ? nextHeader : padTo(row, nextHeader.length),
        );
        await this.writeRaw(definition.name, nextRows);
        result.headersRepaired.push(definition.name);
      }
    }
    return result;
  }

  async readTable(sheet: string): Promise<string[][]> {
    const rows = await this.readRaw(sheet);
    if (!rows) {
      throw new AppError('NOT_FOUND', 'Sheet "' + sheet + '" does not exist yet.');
    }
    return rows;
  }

  async appendRows(sheet: string, rows: string[][]): Promise<AppendResult> {
    return this.writeLock.runExclusive(async () => {
      const table = (await this.readRaw(sheet)) ?? [[]];
      const startRow = table.length + 1;
      table.push(...rows);
      await this.writeRaw(sheet, table);
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
    await this.writeLock.runExclusive(async () => {
      const table = await this.readRaw(sheet);
      if (!table) throw new AppError('NOT_FOUND', 'Sheet "' + sheet + '" does not exist yet.');

      for (const update of updates) {
        const index = update.rowNumber - 1;
        if (index < 1 || index >= table.length) {
          throw new AppError('CONFLICT', 'Row ' + update.rowNumber + ' is out of range.');
        }
        if (update.guard) {
          const current = table[index]?.[update.guard.columnIndex] ?? '';
          if (current !== update.guard.expected) {
            throw new GuardMismatchError(sheet, update.rowNumber);
          }
        }
        table[index] = update.values;
      }
      await this.writeRaw(sheet, table);
    });
  }

  async bumpCounter(name: string, delta: number, seedIfMissing: number): Promise<number> {
    return this.writeLock.runExclusive(async () => {
      const table = (await this.readRaw('Counters')) ?? [['Name', 'Value', 'Updated At']];
      const header = table[0] ?? [];
      const nameIndex = Math.max(0, header.indexOf('Name'));
      const valueIndex = Math.max(1, header.indexOf('Value'));
      const updatedIndex = header.indexOf('Updated At');

      let rowIndex = -1;
      for (let i = 1; i < table.length; i += 1) {
        if ((table[i]?.[nameIndex] ?? '') === name) {
          rowIndex = i;
          break;
        }
      }

      let next: number;
      if (rowIndex === -1) {
        next = seedIfMissing + delta;
        const row: string[] = new Array(Math.max(header.length, 3)).fill('');
        row[nameIndex] = name;
        row[valueIndex] = String(next);
        if (updatedIndex >= 0) row[updatedIndex] = manilaIso();
        table.push(row);
      } else {
        const current = Number(table[rowIndex]?.[valueIndex] ?? 0);
        const base = Number.isFinite(current) ? current : seedIfMissing;
        next = Math.max(base, seedIfMissing) + delta;
        const row = table[rowIndex] ?? [];
        row[valueIndex] = String(next);
        if (updatedIndex >= 0) row[updatedIndex] = manilaIso();
        table[rowIndex] = row;
      }

      await this.writeRaw('Counters', table);
      return next;
    });
  }

  /**
   * The batch variants exist so every driver honours one contract. Locally
   * there is no round-trip cost, but they still run under a single lock so the
   * group is atomic exactly as it is against Apps Script.
   */
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

  async readTables(sheets: string[]): Promise<Record<string, string[][]>> {
    const tables: Record<string, string[][]> = {};
    for (const sheet of sheets) tables[sheet] = await this.readTable(sheet);
    return tables;
  }

  async clearSheetData(
    sheet: string,
    confirm: 'DELETE_ALL_ROWS',
  ): Promise<{ removed: number }> {
    if (confirm !== 'DELETE_ALL_ROWS') {
      throw new AppError('VALIDATION_ERROR', 'Refusing to clear "' + sheet + '" without confirmation.');
    }
    return this.writeLock.runExclusive(async () => {
      const table = await this.readRaw(sheet);
      if (!table) throw new AppError('NOT_FOUND', 'Sheet "' + sheet + '" does not exist yet.');
      const removed = Math.max(0, table.length - 1);
      await this.writeRaw(sheet, table.length > 0 ? [table[0] ?? []] : []);
      return { removed };
    });
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await fs.access(this.dir);
    return Date.now() - started;
  }
}

function padTo(row: string[], length: number): string[] {
  const next = [...row];
  while (next.length < length) next.push('');
  return next;
}
