import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppsScriptGateway } from '../sheets/drivers/appsScript.js';
import { LocalSheetsGateway } from '../sheets/drivers/local.js';
import { GuardMismatchError, type SheetDefinition } from '../sheets/gateway.js';

/**
 * A faithful in-process replica of the doPost contract in apps-script/Code.gs,
 * backed by the local file driver.
 *
 * This exercises the real HTTP driver — request shape, response envelope, error
 * code mapping, token check — so that when the Web App is deployed for real the
 * only untested variable is the deployment itself.
 */
const TOKEN = 'test-token-0123456789';

const DEFINITIONS: SheetDefinition[] = [
  { name: 'Counters', headers: ['Name', 'Value', 'Updated At'] },
  { name: 'Transactions', headers: ['Transaction ID', 'O.R. Number', 'Customer Name'] },
];

let server: Server;
let gateway: AppsScriptGateway;
let dataDir: string;

/** Simulates a deployment that predates the batch operations. */
let legacyMode = false;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-apps-script-'));
  const backing = new LocalSheetsGateway(dataDir);
  await backing.connect();

  const app = express();
  app.use(express.text({ type: '*/*', limit: '1mb' }));

  app.post('/exec', (req, res) => {
    void (async () => {
      const ok = (data: unknown) => res.json({ ok: true, data });
      const fail = (code: string, message: string) =>
        res.json({ ok: false, error: { code, message } });

      let request: Record<string, unknown>;
      try {
        request = JSON.parse(typeof req.body === 'string' ? req.body : '{}');
      } catch {
        return fail('BAD_REQUEST', 'Missing request body');
      }

      if (request.token !== TOKEN) return fail('UNAUTHORIZED', 'Invalid token');

      try {
        switch (request.op) {
          case 'ping':
            return ok({ spreadsheetName: 'N & F Laundry', sheets: await backing.listSheets() });
          case 'listSheets':
            return ok(await backing.listSheets());
          case 'ensureSheets':
            return ok(await backing.ensureSheets(request.definitions as SheetDefinition[]));
          case 'readTable':
            return ok(await backing.readTable(request.sheet as string));
          case 'appendRows':
            return ok(await backing.appendRows(request.sheet as string, request.rows as string[][]));
          case 'updateRows':
            await backing.updateRows(request.sheet as string, request.updates as never);
            return ok({ updated: (request.updates as unknown[]).length });
          case 'bumpCounter':
            return ok({
              value: await backing.bumpCounter(
                request.name as string,
                request.delta as number,
                request.seedIfMissing as number,
              ),
            });
          case 'bumpCounters':
            if (legacyMode) return fail('UNKNOWN_OP', 'Unsupported operation');
            return ok({ values: await backing.bumpCounters(request.requests as never) });
          case 'appendMany':
            if (legacyMode) return fail('UNKNOWN_OP', 'Unsupported operation');
            return ok({ results: await backing.appendMany(request.batch as never) });
          case 'readTables':
            if (legacyMode) return fail('UNKNOWN_OP', 'Unsupported operation');
            return ok({ tables: await backing.readTables(request.sheets as string[]) });
          case 'clearSheetData': {
            if (request.confirm !== 'DELETE_ALL_ROWS') {
              return fail('CONFIRMATION_REQUIRED', 'Refusing to clear without confirmation');
            }
            const cleared = await backing.clearSheetData(
              request.sheet as string,
              'DELETE_ALL_ROWS',
            );
            return ok({ sheet: request.sheet, removed: cleared.removed });
          }
          default:
            return fail('UNKNOWN_OP', 'Unsupported operation');
        }
      } catch (error) {
        if (error instanceof GuardMismatchError) {
          return fail('GUARD_MISMATCH', error.message);
        }
        return fail('SCRIPT_ERROR', (error as Error).message);
      }
    })();
  });

  // A deployment that is not shared publicly answers with Google's sign-in HTML.
  app.post('/private', (_req, res) => res.type('html').send('<html>Sign in</html>'));

  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });

  const port = (server.address() as AddressInfo).port;
  gateway = new AppsScriptGateway({
    url: 'http://127.0.0.1:' + port + '/exec',
    token: TOKEN,
    timeoutMs: 5000,
    maxRetries: 1,
  });

  await gateway.ensureSheets(DEFINITIONS);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('Apps Script driver', () => {
  it('connects and reports the workbook', async () => {
    await expect(gateway.connect()).resolves.toBeUndefined();
    const latency = await gateway.ping();
    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it('creates missing sheets with their headers', async () => {
    const sheets = await gateway.listSheets();
    expect(sheets).toContain('Transactions');
    expect(sheets).toContain('Counters');

    const table = await gateway.readTable('Transactions');
    expect(table[0]).toEqual(['Transaction ID', 'O.R. Number', 'Customer Name']);
  });

  it('is idempotent — re-running ensureSheets keeps existing data', async () => {
    await gateway.appendRows('Transactions', [['NF-1', 'OR-000001', 'Maria Santos']]);
    const result = await gateway.ensureSheets(DEFINITIONS);
    expect(result.created).toHaveLength(0);
    expect(result.existing).toContain('Transactions');

    const table = await gateway.readTable('Transactions');
    expect(table).toHaveLength(2);
    expect(table[1]).toEqual(['NF-1', 'OR-000001', 'Maria Santos']);
  });

  it('appends rows and reports the starting row number', async () => {
    const before = (await gateway.readTable('Transactions')).length;
    const result = await gateway.appendRows('Transactions', [['NF-2', 'OR-000002', 'Jose Cruz']]);
    expect(result.startRow).toBe(before + 1);
    expect(result.rowCount).toBe(1);
  });

  it('increments a counter atomically under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => gateway.bumpCounter('OR_NUMBER', 1, 0)),
    );
    const unique = new Set(results);
    expect(unique.size).toBe(25);
    expect(Math.max(...results)).toBe(25);
    expect(Math.min(...results)).toBe(1);
  });

  it('honours the compare-and-swap guard on row updates', async () => {
    const table = await gateway.readTable('Transactions');
    const rowNumber = table.findIndex((row) => row[0] === 'NF-1') + 1;
    expect(rowNumber).toBeGreaterThan(1);

    await gateway.updateRow(
      'Transactions',
      rowNumber,
      ['NF-1', 'OR-000001', 'Maria Santos-Cruz'],
      { columnIndex: 0, expected: 'NF-1' },
    );
    const updated = await gateway.readTable('Transactions');
    expect(updated[rowNumber - 1]?.[2]).toBe('Maria Santos-Cruz');

    // A stale row number must be refused rather than overwriting a neighbour.
    await expect(
      gateway.updateRow('Transactions', rowNumber, ['x', 'y', 'z'], {
        columnIndex: 0,
        expected: 'SOMETHING-ELSE',
      }),
    ).rejects.toThrow(/changed since it was read/i);
  });

  it('rejects a bad token with a configuration error, not a data error', async () => {
    const badGateway = new AppsScriptGateway({
      url: gateway.target as string,
      token: 'wrong-token-value-here',
      timeoutMs: 5000,
      maxRetries: 0,
    });
    await expect(badGateway.ping()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('explains a non-public deployment instead of leaking parse errors', async () => {
    const privateGateway = new AppsScriptGateway({
      url: (gateway.target as string).replace('/exec', '/private'),
      token: TOKEN,
      timeoutMs: 5000,
      maxRetries: 0,
    });
    await expect(privateGateway.ping()).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
      message: expect.stringContaining('Anyone'),
    });
  });

  it('surfaces an unreachable endpoint as a connection problem', async () => {
    const deadGateway = new AppsScriptGateway({
      url: 'http://127.0.0.1:1/exec',
      token: TOKEN,
      timeoutMs: 2000,
      maxRetries: 0,
    });
    await expect(deadGateway.ping()).rejects.toMatchObject({
      code: 'DATA_SOURCE_UNAVAILABLE',
    });
  });
});

describe('batch operations', () => {
  it('allocates several counters in one call', async () => {
    const values = await gateway.bumpCounters([
      { name: 'BATCH_A', delta: 1, seedIfMissing: 10 },
      { name: 'BATCH_B', delta: 1, seedIfMissing: 0 },
      { name: 'BATCH_A', delta: 1, seedIfMissing: 10 },
    ]);
    // The repeated name is applied twice, so it lands on 12, not 11.
    expect(values.BATCH_A).toBe(12);
    expect(values.BATCH_B).toBe(1);
  });

  it('appends to several sheets in one call', async () => {
    const before = (await gateway.readTable('Transactions')).length;
    const results = await gateway.appendMany([
      { sheet: 'Transactions', rows: [['NF-B1', 'OR-000900', 'Batch One']] },
      { sheet: 'Counters', rows: [['BATCH_MARKER', '1', 'now']] },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.sheet).toBe('Transactions');
    expect(results[0]?.startRow).toBe(before + 1);

    const after = await gateway.readTable('Transactions');
    expect(after[after.length - 1]).toEqual(['NF-B1', 'OR-000900', 'Batch One']);
  });

  it('reads several tables in one call', async () => {
    const tables = await gateway.readTables(['Transactions', 'Counters']);
    expect(Object.keys(tables).sort()).toEqual(['Counters', 'Transactions']);
    expect(tables.Transactions?.[0]).toEqual(['Transaction ID', 'O.R. Number', 'Customer Name']);
  });

  it('falls back to per-item calls against a deployment that lacks them', async () => {
    legacyMode = true;
    try {
      const values = await gateway.bumpCounters([
        { name: 'LEGACY_A', delta: 1, seedIfMissing: 5 },
        { name: 'LEGACY_B', delta: 1, seedIfMissing: 0 },
      ]);
      expect(values.LEGACY_A).toBe(6);
      expect(values.LEGACY_B).toBe(1);

      const results = await gateway.appendMany([
        { sheet: 'Transactions', rows: [['NF-L1', 'OR-000901', 'Legacy One']] },
      ]);
      expect(results[0]?.startRow).toBeGreaterThan(1);

      const tables = await gateway.readTables(['Transactions']);
      expect(tables.Transactions?.length).toBeGreaterThan(1);
    } finally {
      legacyMode = false;
    }
  });
});

describe('maintenance clear', () => {
  it('keeps the header and reports how many rows went', async () => {
    await gateway.appendRows('Counters', [['TEMP_A', '1', 'now'], ['TEMP_B', '2', 'now']]);
    const before = await gateway.readTable('Counters');
    expect(before.length).toBeGreaterThan(1);

    const result = await gateway.clearSheetData('Counters', 'DELETE_ALL_ROWS');
    expect(result.removed).toBe(before.length - 1);

    const after = await gateway.readTable('Counters');
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(['Name', 'Value', 'Updated At']);
  });

  it('refuses without the exact confirmation phrase', async () => {
    await gateway.appendRows('Counters', [['STILL_HERE', '9', 'now']]);
    await expect(
      gateway.clearSheetData('Counters', 'please' as never),
    ).rejects.toThrow();

    // The row must survive a refused call.
    const table = await gateway.readTable('Counters');
    expect(table.some((row) => row[0] === 'STILL_HERE')).toBe(true);
  });

  it('is a no-op on a sheet that only has a header', async () => {
    await gateway.clearSheetData('Counters', 'DELETE_ALL_ROWS');
    const result = await gateway.clearSheetData('Counters', 'DELETE_ALL_ROWS');
    expect(result.removed).toBe(0);
  });
});
