/**
 * The storage driver contract. Everything above this line is business logic;
 * everything below it is "how do we talk to a spreadsheet".
 *
 * Three implementations exist:
 *   - apps-script : Google Apps Script Web App (recommended; atomic via LockService)
 *   - google-api  : Sheets API v4 with a service account (process-level locking)
 *   - local       : file-backed emulator with identical semantics (dev/test)
 */

export interface SheetDefinition {
  /** Sheet/tab name inside the workbook. */
  name: string;
  /** Ordered header row. */
  headers: readonly string[];
  /** Columns that must be unique across the sheet (validated by services). */
  uniqueBy?: readonly string[];
}

export interface RowGuard {
  /** Zero-based column index that must still match before writing. */
  columnIndex: number;
  expected: string;
}

export interface AppendResult {
  /** 1-based spreadsheet row number of the first appended row. */
  startRow: number;
  rowCount: number;
}

export interface EnsureSheetsResult {
  created: string[];
  existing: string[];
  headersRepaired: string[];
}

export interface SheetsGateway {
  readonly name: 'apps-script' | 'google-api' | 'local';
  /** Human-readable target (spreadsheet id or local path) for diagnostics. */
  readonly target: string | null;

  connect(): Promise<void>;
  listSheets(): Promise<string[]>;
  ensureSheets(definitions: readonly SheetDefinition[]): Promise<EnsureSheetsResult>;

  /** Full table including the header row as index 0. */
  readTable(sheet: string): Promise<string[][]>;

  appendRows(sheet: string, rows: string[][]): Promise<AppendResult>;

  /**
   * Overwrite a single row. When a guard is supplied the write is rejected if
   * the guarded cell no longer holds the expected value (compare-and-swap),
   * which protects against writing to the wrong row after a manual sheet edit.
   */
  updateRow(
    sheet: string,
    rowNumber: number,
    values: string[],
    guard?: RowGuard,
  ): Promise<void>;

  /** Batched variant — one round trip for many row writes. */
  updateRows(
    sheet: string,
    updates: Array<{ rowNumber: number; values: string[]; guard?: RowGuard }>,
  ): Promise<void>;

  /**
   * Atomically increment a named counter and return the NEW value.
   * If the counter does not exist it is created at `seedIfMissing` first.
   * This is the primitive that guarantees unique O.R. numbers.
   */
  bumpCounter(name: string, delta: number, seedIfMissing: number): Promise<number>;

  /* ---------------------------------------------------------------- batching
   *
   * A remote gateway costs a full round trip per call, so a sale that makes a
   * dozen of them is unusably slow at a counter. These three collapse the hot
   * path into one round trip each, and the write batches run under a single
   * lock so the group is still atomic.
   */

  /** Increment several counters at once; returns the new value of each. */
  bumpCounters(
    requests: Array<{ name: string; delta: number; seedIfMissing: number }>,
  ): Promise<Record<string, number>>;

  /** Append to several sheets at once. */
  appendMany(
    batch: Array<{ sheet: string; rows: string[][] }>,
  ): Promise<Array<{ sheet: string } & AppendResult>>;

  /** Read several whole tables at once. */
  readTables(sheets: string[]): Promise<Record<string, string[][]>>;

  /**
   * Apply row updates and appends together, under one lock and one commit.
   *
   * Optional: drivers that cannot do better are called through the separate
   * update and append paths instead. It exists because committing a spreadsheet
   * is expensive — two writes that could share one commit otherwise cost twice
   * as much wall-clock as they need to, which is felt on every sign-in.
   */
  writeBatch?(batch: {
    updates: Array<{ sheet: string; rowNumber: number; values: string[]; guard?: RowGuard }>;
    appends: Array<{ sheet: string; rows: string[][] }>;
  }): Promise<void>;

  /**
   * Remove every data row from a sheet, keeping its header.
   *
   * The only destructive primitive in the contract. Nothing in the HTTP API
   * reaches it — it exists for the CLI maintenance command, and the caller must
   * pass the confirmation phrase so it cannot fire by accident.
   */
  clearSheetData(sheet: string, confirm: 'DELETE_ALL_ROWS'): Promise<{ removed: number }>;

  /** Round-trip latency in milliseconds; throws when unreachable. */
  ping(): Promise<number>;
}

export class GuardMismatchError extends Error {
  constructor(sheet: string, rowNumber: number) {
    super('Row ' + rowNumber + ' in "' + sheet + '" changed since it was read.');
    this.name = 'GuardMismatchError';
  }
}
