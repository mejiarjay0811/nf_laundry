import { AppError, DATA_SOURCE_MESSAGES } from '../../errors.js';
import { logger } from '../../logger.js';
import { retry, withTimeout } from '../../utils/async.js';
import {
  GuardMismatchError,
  type AppendResult,
  type EnsureSheetsResult,
  type RowGuard,
  type SheetDefinition,
  type SheetsGateway,
} from '../gateway.js';

/** Round-trip accounting, so the cost of a request can be measured. */
export const callStats = {
  count: 0,
  totalMs: 0,
  reset() {
    this.count = 0;
    this.totalMs = 0;
  },
};

/**
 * Raised when the deployed script predates an operation this client knows about.
 * The gateway then falls back to the older one-at-a-time calls, so an
 * out-of-date deployment degrades in speed rather than breaking.
 */
export class UnsupportedOperationError extends Error {
  constructor(readonly op: string) {
    super('The deployed Apps Script does not support the "' + op + '" operation.');
    this.name = 'UnsupportedOperationError';
  }
}

interface ScriptSuccess<T> {
  ok: true;
  data: T;
}
interface ScriptFailure {
  ok: false;
  error: { code?: string; message?: string };
}
type ScriptResponse<T> = ScriptSuccess<T> | ScriptFailure;

export interface AppsScriptOptions {
  url: string;
  token: string;
  spreadsheetId?: string;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Talks to the Apps Script Web App deployed from apps-script/Code.gs.
 *
 * Why this is the recommended driver: Apps Script exposes LockService, which
 * gives genuine cross-request mutual exclusion. That is what makes O.R.
 * number generation and row updates atomic even under concurrent cashiers —
 * the Sheets REST API cannot offer that.
 */
export class AppsScriptGateway implements SheetsGateway {
  readonly name = 'apps-script' as const;
  readonly target: string | null;

  private readonly options: AppsScriptOptions;

  constructor(options: AppsScriptOptions) {
    this.options = options;
    this.target = options.spreadsheetId ?? options.url;
  }

  private async call<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({
      token: this.options.token,
      op,
      spreadsheetId: this.options.spreadsheetId,
      ...payload,
    });

    const execute = async (): Promise<T> => {
      const startedAt = Date.now();
      callStats.count += 1;
      let response: Response;
      try {
        response = await withTimeout(
          fetch(this.options.url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            redirect: 'follow',
          }),
          this.options.timeoutMs,
          'Apps Script ' + op,
        );
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') {
          throw new AppError('DATA_SOURCE_TIMEOUT', DATA_SOURCE_MESSAGES.timeout, { cause: error });
        }
        throw new AppError('DATA_SOURCE_UNAVAILABLE', DATA_SOURCE_MESSAGES.unavailable, {
          cause: error,
        });
      }

      const text = await response.text();

      if (!response.ok) {
        logger.error('Apps Script HTTP error', { op, status: response.status, body: text.slice(0, 400) });
        throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, {
          cause: new Error('HTTP ' + response.status),
        });
      }

      let parsed: ScriptResponse<T>;
      try {
        parsed = JSON.parse(text) as ScriptResponse<T>;
      } catch (error) {
        // Almost always an HTML sign-in page: the deployment is not public.
        logger.error('Apps Script returned non-JSON', { op, snippet: text.slice(0, 200) });
        throw new AppError(
          'NOT_CONFIGURED',
          'The data server rejected the request. Check that the Apps Script deployment is set to "Anyone" access.',
          { cause: error },
        );
      }

      if (!parsed.ok) {
        const code = parsed.error?.code ?? 'SCRIPT_ERROR';
        const message = parsed.error?.message ?? 'Unknown data server error';
        if (code === 'GUARD_MISMATCH') {
          throw new GuardMismatchError(String(payload.sheet ?? ''), Number(payload.rowNumber ?? 0));
        }
        if (code === 'UNAUTHORIZED') {
          throw new AppError('NOT_CONFIGURED', 'The data server rejected the access token.');
        }
        if (code === 'LOCK_TIMEOUT') {
          throw new AppError('CONFLICT', 'The system is busy saving another transaction. Please try again.');
        }
        if (code === 'SHEET_NOT_FOUND') {
          throw new AppError('NOT_FOUND', message);
        }
        if (code === 'UNKNOWN_OP') {
          throw new UnsupportedOperationError(op);
        }
        logger.error('Apps Script operation failed', { op, code, message });
        throw new AppError('DATA_SOURCE_ERROR', DATA_SOURCE_MESSAGES.read, {
          cause: new Error(code + ': ' + message),
        });
      }

      callStats.totalMs += Date.now() - startedAt;
      logger.debug('Apps Script op', { op, ms: Date.now() - startedAt });
      return parsed.data;
    };

    return retry(execute, {
      retries: this.options.maxRetries,
      label: 'Apps Script ' + op,
      shouldRetry: (error) =>
        error instanceof AppError &&
        (error.code === 'DATA_SOURCE_UNAVAILABLE' ||
          error.code === 'DATA_SOURCE_TIMEOUT' ||
          error.code === 'DATA_SOURCE_ERROR'),
    });
  }

  async connect(): Promise<void> {
    const info = await this.call<{ spreadsheetName: string; sheets: string[] }>('ping');
    logger.info('Connected to Google Sheets via Apps Script', {
      spreadsheet: info.spreadsheetName,
      sheets: info.sheets.length,
    });
  }

  async listSheets(): Promise<string[]> {
    return this.call<string[]>('listSheets');
  }

  async ensureSheets(definitions: readonly SheetDefinition[]): Promise<EnsureSheetsResult> {
    return this.call<EnsureSheetsResult>('ensureSheets', {
      definitions: definitions.map((d) => ({ name: d.name, headers: [...d.headers] })),
    });
  }

  async readTable(sheet: string): Promise<string[][]> {
    return this.call<string[][]>('readTable', { sheet });
  }

  async appendRows(sheet: string, rows: string[][]): Promise<AppendResult> {
    return this.call<AppendResult>('appendRows', { sheet, rows });
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
    await this.call<{ updated: number }>('updateRows', { sheet, updates });
  }

  async bumpCounter(name: string, delta: number, seedIfMissing: number): Promise<number> {
    const result = await this.call<{ value: number }>('bumpCounter', {
      name,
      delta,
      seedIfMissing,
    });
    return result.value;
  }

  /**
   * Each batch op degrades gracefully: if the deployed script is older than
   * this client it answers UNKNOWN_OP, and we fall back to the original
   * one-call-per-item path. The result is identical, just slower, so an
   * out-of-date deployment never takes the shop offline.
   */
  private warnedOps = new Set<string>();

  private warnOutdated(op: string): void {
    if (this.warnedOps.has(op)) return;
    this.warnedOps.add(op);
    logger.warn(
      'The deployed Apps Script predates the "' + op + '" operation; falling back to ' +
        'slower per-item calls. Re-deploy apps-script/Code.gs (Manage deployments -> ' +
        'New version) to restore full speed.',
    );
  }

  async bumpCounters(
    requests: Array<{ name: string; delta: number; seedIfMissing: number }>,
  ): Promise<Record<string, number>> {
    if (requests.length === 0) return {};
    try {
      const result = await this.call<{ values: Record<string, number> }>('bumpCounters', {
        requests,
      });
      return result.values;
    } catch (error) {
      if (!(error instanceof UnsupportedOperationError)) throw error;
      this.warnOutdated('bumpCounters');
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
  }

  async appendMany(
    batch: Array<{ sheet: string; rows: string[][] }>,
  ): Promise<Array<{ sheet: string } & AppendResult>> {
    if (batch.length === 0) return [];
    try {
      const result = await this.call<{
        results: Array<{ sheet: string; startRow: number; rowCount: number }>;
      }>('appendMany', { batch });
      return result.results;
    } catch (error) {
      if (!(error instanceof UnsupportedOperationError)) throw error;
      this.warnOutdated('appendMany');
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
  }

  async readTables(sheets: string[]): Promise<Record<string, string[][]>> {
    if (sheets.length === 0) return {};
    try {
      const result = await this.call<{ tables: Record<string, string[][]> }>('readTables', {
        sheets,
      });
      return result.tables;
    } catch (error) {
      if (!(error instanceof UnsupportedOperationError)) throw error;
      this.warnOutdated('readTables');
      const tables: Record<string, string[][]> = {};
      for (const sheet of sheets) tables[sheet] = await this.readTable(sheet);
      return tables;
    }
  }

  async clearSheetData(
    sheet: string,
    confirm: 'DELETE_ALL_ROWS',
  ): Promise<{ removed: number }> {
    const result = await this.call<{ sheet: string; removed: number }>('clearSheetData', {
      sheet,
      confirm,
    });
    return { removed: result.removed };
  }

  /**
   * What the DEPLOYED script reports about itself.
   *
   * A Web App serves a version snapshot, so saving the editor is not enough —
   * this is how you tell which build is actually answering. Older deployments
   * predate the version marker and report null.
   */
  async scriptInfo(): Promise<{
    version: string | null;
    ops: string[];
    spreadsheetName: string;
  }> {
    const info = await this.call<{
      spreadsheetName: string;
      version?: string;
      ops?: string[];
    }>('ping');
    return {
      version: info.version ?? null,
      ops: info.ops ?? [],
      spreadsheetName: info.spreadsheetName,
    };
  }

  async ping(): Promise<number> {
    const started = Date.now();
    await this.call('ping');
    return Date.now() - started;
  }
}
