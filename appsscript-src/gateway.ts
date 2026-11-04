import { manilaIso } from '../shared/datetime.js';
import {
  GuardMismatchError,
  type AppendResult,
  type EnsureSheetsResult,
  type RowGuard,
  type SheetDefinition,
  type SheetsGateway,
} from '../server/sheets/gateway.js';

/**
 * Storage driver that runs INSIDE Apps Script.
 *
 * The HTTP driver in server/sheets/drivers/appsScript.ts pays ~2.5s per call to
 * reach this same spreadsheet from outside. Here the business logic is running
 * in Apps Script already, so it talks to SpreadsheetApp directly — no network
 * hop, no token, no batching tricks needed.
 *
 * Everything that mutates runs under LockService, exactly as the Web App
 * operations do, so concurrent tills still cannot interleave.
 */

// Apps Script globals. Typed loosely because the runtime supplies them.
declare const SpreadsheetApp: any;
declare const LockService: any;
declare const Utilities: any;

const LOCK_TIMEOUT_MS = 25000;
const MAX_COLUMNS = 52;

function book(): any {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheetOrThrow(name: string): any {
  const sheet = book().getSheetByName(name);
  if (!sheet) throw new Error('SHEET_NOT_FOUND: sheet "' + name + '" does not exist');
  return sheet;
}

/** Run under the script lock. The atomicity guarantee for every write. */
function locked<T>(fn: () => T): T {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('LOCK_TIMEOUT: could not acquire script lock');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function toStringMatrix(values: unknown[][]): string[][] {
  return values.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return '';
      if (cell instanceof Date) {
        return Utilities.formatDate(cell, 'Asia/Manila', "yyyy-MM-dd'T'HH:mm:ssXXX");
      }
      return String(cell);
    }),
  );
}

function trimTrailingEmpty(matrix: string[][]): string[][] {
  let last = matrix.length;
  while (last > 0) {
    const row = matrix[last - 1] ?? [];
    if (row.some((cell) => cell !== '')) break;
    last -= 1;
  }
  return matrix.slice(0, last);
}

export class NativeSheetsGateway implements SheetsGateway {
  readonly name = 'apps-script' as const;
  readonly target: string;

  constructor() {
    this.target = 'active-spreadsheet';
  }

  async connect(): Promise<void> {
    // Nothing to connect to; the spreadsheet is already bound to this script.
  }

  async listSheets(): Promise<string[]> {
    return book()
      .getSheets()
      .map((sheet: any) => sheet.getName() as string);
  }

  async ensureSheets(definitions: readonly SheetDefinition[]): Promise<EnsureSheetsResult> {
    return locked(() => {
      const spreadsheet = book();
      const result: EnsureSheetsResult = { created: [], existing: [], headersRepaired: [] };

      for (const definition of definitions) {
        let sheet = spreadsheet.getSheetByName(definition.name);

        if (!sheet) {
          sheet = spreadsheet.insertSheet(definition.name);
          // A new sheet is only 26 columns wide; Transactions needs 31.
          if (sheet.getMaxColumns() < definition.headers.length) {
            sheet.insertColumnsAfter(
              sheet.getMaxColumns(),
              definition.headers.length - sheet.getMaxColumns(),
            );
          }
          sheet
            .getRange(1, 1, sheet.getMaxRows(), definition.headers.length)
            .setNumberFormat('@');
          sheet.getRange(1, 1, 1, definition.headers.length).setValues([[...definition.headers]]);
          sheet.setFrozenRows(1);
          sheet.getRange(1, 1, 1, definition.headers.length).setFontWeight('bold');
          result.created.push(definition.name);
          continue;
        }

        result.existing.push(definition.name);
        const lastColumn = Math.max(1, sheet.getLastColumn());
        const header: string[] = sheet
          .getRange(1, 1, 1, lastColumn)
          .getValues()[0]
          .map((v: unknown) => (v === null || v === undefined ? '' : String(v)));

        if (!header.some((value) => value !== '')) {
          sheet.getRange(1, 1, 1, definition.headers.length).setValues([[...definition.headers]]);
          sheet.setFrozenRows(1);
          result.headersRepaired.push(definition.name);
          continue;
        }

        const missing = definition.headers.filter((h) => header.indexOf(h) === -1);
        if (missing.length > 0) {
          const needed = header.length + missing.length;
          if (sheet.getMaxColumns() < needed) {
            sheet.insertColumnsAfter(sheet.getMaxColumns(), needed - sheet.getMaxColumns());
          }
          sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
          result.headersRepaired.push(definition.name);
        }
      }
      return result;
    });
  }

  async readTable(sheet: string): Promise<string[][]> {
    const target = sheetOrThrow(sheet);
    const lastRow = target.getLastRow();
    const lastColumn = target.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) return [];
    const values = target
      .getRange(1, 1, lastRow, Math.min(lastColumn, MAX_COLUMNS))
      .getDisplayValues();
    return trimTrailingEmpty(toStringMatrix(values));
  }

  async readTables(sheets: string[]): Promise<Record<string, string[][]>> {
    const tables: Record<string, string[][]> = {};
    for (const sheet of sheets) tables[sheet] = await this.readTable(sheet);
    return tables;
  }

  async appendRows(sheet: string, rows: string[][]): Promise<AppendResult> {
    const results = await this.appendMany([{ sheet, rows }]);
    const first = results[0];
    return { startRow: first?.startRow ?? 0, rowCount: first?.rowCount ?? 0 };
  }

  async appendMany(
    batch: Array<{ sheet: string; rows: string[][] }>,
  ): Promise<Array<{ sheet: string } & AppendResult>> {
    if (batch.length === 0) return [];
    return locked(() => {
      // Resolve and size everything before writing anything, so a bad sheet
      // name cannot leave a sale half-written.
      const planned = batch.map((entry) => {
        if (!entry.rows || entry.rows.length === 0) {
          return { sheet: entry.sheet, skip: true as const };
        }
        const target = sheetOrThrow(entry.sheet);
        let width = 0;
        for (const row of entry.rows) width = Math.max(width, row.length);
        if (target.getMaxColumns() < width) {
          target.insertColumnsAfter(target.getMaxColumns(), width - target.getMaxColumns());
        }
        const startRow = target.getLastRow() + 1;
        if (target.getMaxRows() < startRow + entry.rows.length - 1) {
          target.insertRowsAfter(target.getMaxRows(), entry.rows.length + 100);
        }
        const normalised = entry.rows.map((row) => {
          const copy = row.slice();
          while (copy.length < width) copy.push('');
          return copy;
        });
        return { sheet: entry.sheet, skip: false as const, target, startRow, width, rows: normalised };
      });

      const results: Array<{ sheet: string } & AppendResult> = [];
      for (const plan of planned) {
        if (plan.skip) {
          results.push({ sheet: plan.sheet, startRow: 0, rowCount: 0 });
          continue;
        }
        plan.target.getRange(plan.startRow, 1, plan.rows.length, plan.width).setValues(plan.rows);
        results.push({ sheet: plan.sheet, startRow: plan.startRow, rowCount: plan.rows.length });
      }
      SpreadsheetApp.flush();
      return results;
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
    locked(() => {
      const target = sheetOrThrow(sheet);
      const lastRow = target.getLastRow();

      // Check every guard before writing any row.
      for (const update of updates) {
        if (update.rowNumber < 2 || update.rowNumber > lastRow) {
          throw new GuardMismatchError(sheet, update.rowNumber);
        }
        if (update.guard) {
          const cell = target
            .getRange(update.rowNumber, update.guard.columnIndex + 1)
            .getDisplayValue();
          if (String(cell) !== String(update.guard.expected)) {
            throw new GuardMismatchError(sheet, update.rowNumber);
          }
        }
      }

      for (const update of updates) {
        target.getRange(update.rowNumber, 1, 1, update.values.length).setValues([update.values]);
      }
      SpreadsheetApp.flush();
    });
  }

  /**
   * Updates and appends in one lock, committed once.
   *
   * Every commit is a round trip to the Sheets backend, so a sign-in that
   * stamps "Last Login" and writes an audit row costs two of them when it only
   * needs one. Guards are checked before anything is written, so a group either
   * lands whole or not at all.
   */
  async writeBatch(batch: {
    updates: Array<{ sheet: string; rowNumber: number; values: string[]; guard?: RowGuard }>;
    appends: Array<{ sheet: string; rows: string[][] }>;
  }): Promise<void> {
    if (batch.updates.length === 0 && batch.appends.length === 0) return;

    locked(() => {
      // Resolve and check everything first.
      const updates = batch.updates.map((update) => {
        const target = sheetOrThrow(update.sheet);
        if (update.rowNumber < 2 || update.rowNumber > target.getLastRow()) {
          throw new GuardMismatchError(update.sheet, update.rowNumber);
        }
        if (update.guard) {
          const cell = target
            .getRange(update.rowNumber, update.guard.columnIndex + 1)
            .getDisplayValue();
          if (String(cell) !== String(update.guard.expected)) {
            throw new GuardMismatchError(update.sheet, update.rowNumber);
          }
        }
        return { target, update };
      });

      const appends = batch.appends
        .filter((entry) => entry.rows && entry.rows.length > 0)
        .map((entry) => {
          const target = sheetOrThrow(entry.sheet);
          let width = 0;
          for (const row of entry.rows) width = Math.max(width, row.length);
          if (target.getMaxColumns() < width) {
            target.insertColumnsAfter(target.getMaxColumns(), width - target.getMaxColumns());
          }
          const startRow = target.getLastRow() + 1;
          if (target.getMaxRows() < startRow + entry.rows.length - 1) {
            target.insertRowsAfter(target.getMaxRows(), entry.rows.length + 100);
          }
          const rows = entry.rows.map((row) => {
            const copy = row.slice();
            while (copy.length < width) copy.push('');
            return copy;
          });
          return { target, startRow, width, rows };
        });

      for (const { target, update } of updates) {
        target.getRange(update.rowNumber, 1, 1, update.values.length).setValues([update.values]);
      }
      for (const plan of appends) {
        plan.target.getRange(plan.startRow, 1, plan.rows.length, plan.width).setValues(plan.rows);
      }
      SpreadsheetApp.flush();
    });
  }

  async bumpCounter(name: string, delta: number, seedIfMissing: number): Promise<number> {
    const values = await this.bumpCounters([{ name, delta, seedIfMissing }]);
    return values[name] ?? 0;
  }

  async bumpCounters(
    requests: Array<{ name: string; delta: number; seedIfMissing: number }>,
  ): Promise<Record<string, number>> {
    if (requests.length === 0) return {};
    return locked(() => {
      const sheet = sheetOrThrow('Counters');
      const width = Math.max(3, sheet.getLastColumn());
      const header: string[] = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
      const nameIndex = Math.max(0, header.indexOf('Name'));
      let valueIndex = header.indexOf('Value');
      if (valueIndex === -1) valueIndex = 1;
      const updatedIndex = header.indexOf('Updated At');
      const stamp = manilaIso();

      const lastRow = sheet.getLastRow();
      const body: string[][] =
        lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues() : [];

      const values: Record<string, number> = {};

      for (const request of requests) {
        const seed = Number(request.seedIfMissing) || 0;
        const delta = Number(request.delta) || 0;
        let found = -1;
        let current = seed;

        for (let i = 0; i < body.length; i += 1) {
          if (String(body[i]?.[nameIndex]) === String(request.name)) {
            found = i;
            const parsed = Number(body[i]?.[valueIndex]);
            current = Number.isFinite(parsed) ? parsed : seed;
            break;
          }
        }

        const next = Math.max(current, seed) + delta;
        values[request.name] = next;

        if (found === -1) {
          const row: string[] = new Array(width).fill('');
          row[nameIndex] = request.name;
          row[valueIndex] = String(next);
          if (updatedIndex >= 0) row[updatedIndex] = stamp;
          body.push(row);
        } else {
          const row = body[found] as string[];
          row[valueIndex] = String(next);
          if (updatedIndex >= 0) row[updatedIndex] = stamp;
        }
      }

      if (body.length > 0) {
        if (sheet.getMaxRows() < body.length + 1) {
          sheet.insertRowsAfter(sheet.getMaxRows(), body.length + 10);
        }
        sheet.getRange(2, 1, body.length, width).setValues(body);
      }
      SpreadsheetApp.flush();
      return values;
    });
  }

  async clearSheetData(
    sheet: string,
    confirm: 'DELETE_ALL_ROWS',
  ): Promise<{ removed: number }> {
    if (confirm !== 'DELETE_ALL_ROWS') {
      throw new Error('CONFIRMATION_REQUIRED: refusing to clear "' + sheet + '"');
    }
    return locked(() => {
      const target = sheetOrThrow(sheet);
      const lastRow = target.getLastRow();
      if (lastRow < 2) return { removed: 0 };
      const removed = lastRow - 1;
      target.deleteRows(2, removed);
      SpreadsheetApp.flush();
      return { removed };
    });
  }

  async ping(): Promise<number> {
    const started = Date.now();
    book().getName();
    return Date.now() - started;
  }
}
