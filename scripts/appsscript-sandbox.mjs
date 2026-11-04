/**
 * A stand-in for the Apps Script runtime, good enough to run the real bundle.
 *
 * Deploying to find out whether the build works is a slow and blind way to
 * test: the script is only reachable once published, and a failure there gives
 * a stack trace with no source. This models the services the bundle actually
 * touches — an in-memory workbook behind SpreadsheetApp, plus LockService,
 * PropertiesService, CacheService, ContentService and Utilities — so the
 * compiled artifact can be exercised locally, against a real Node crypto
 * implementation.
 *
 * It is a test double, not an emulator. It reproduces the semantics this code
 * depends on: 1-based ranges, display values as strings, sheets that start at
 * 26 columns, and a script lock.
 */
import { createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const DEFAULT_ROWS = 1000;
const DEFAULT_COLUMNS = 26;

/**
 * Counts calls into the fake Sheets service.
 *
 * Each of these is a call across into Google's service in the real runtime, and
 * that is what a request actually spends its time on — far more than the
 * JavaScript around it. Counting them here shows where a slow request is going
 * without needing to deploy and time it.
 */
export const opCounts = {
  read: 0,
  readCells: 0,
  write: 0,
  flush: 0,
  lock: 0,
  hmac: 0,
  reset() {
    this.read = 0;
    this.readCells = 0;
    this.write = 0;
    this.flush = 0;
    this.lock = 0;
    this.hmac = 0;
  },
};

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.numRows = numRows;
    this.numColumns = numColumns;
  }

  getValues() {
    opCounts.read += 1;
    opCounts.readCells += this.numRows * this.numColumns;
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const row = [];
      for (let c = 0; c < this.numColumns; c += 1) {
        row.push(this.sheet.read(this.row + r, this.column + c));
      }
      out.push(row);
    }
    return out;
  }

  getDisplayValues() {
    return this.getValues().map((row) => row.map((cell) => (cell === null ? '' : String(cell))));
  }

  getDisplayValue() {
    opCounts.read += 1;
    opCounts.readCells += 1;
    const value = this.sheet.read(this.row, this.column);
    return value === null ? '' : String(value);
  }

  setValues(values) {
    opCounts.write += 1;
    if (values.length !== this.numRows) {
      throw new Error(
        'The number of rows in the data does not match the number of rows in the range.',
      );
    }
    for (let r = 0; r < values.length; r += 1) {
      const row = values[r];
      if (row.length !== this.numColumns) {
        throw new Error(
          'The number of columns in the data does not match the number of columns in the range.',
        );
      }
      for (let c = 0; c < row.length; c += 1) {
        this.sheet.write(this.row + r, this.column + c, row[c]);
      }
    }
    return this;
  }

  setNumberFormat() {
    return this;
  }

  setFontWeight() {
    return this;
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();
    this.maxRows = DEFAULT_ROWS;
    this.maxColumns = DEFAULT_COLUMNS;
    this.frozenRows = 0;
  }

  key(row, column) {
    return row + ':' + column;
  }

  read(row, column) {
    return this.cells.get(this.key(row, column)) ?? '';
  }

  write(row, column, value) {
    if (row > this.maxRows || column > this.maxColumns) {
      throw new Error(
        'Those rows are out of bounds. (sheet "' + this.name + '", ' + row + ',' + column + ')',
      );
    }
    if (value === '' || value === null || value === undefined) this.cells.delete(this.key(row, column));
    else this.cells.set(this.key(row, column), String(value));
  }

  getName() {
    return this.name;
  }

  getMaxRows() {
    return this.maxRows;
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  getLastRow() {
    let last = 0;
    for (const key of this.cells.keys()) {
      const row = Number(key.split(':')[0]);
      if (row > last) last = row;
    }
    return last;
  }

  getLastColumn() {
    let last = 0;
    for (const key of this.cells.keys()) {
      const column = Number(key.split(':')[1]);
      if (column > last) last = column;
    }
    return last;
  }

  getRange(row, column, numRows = 1, numColumns = 1) {
    if (row < 1 || column < 1) throw new Error('Range coordinates are 1-based.');
    return new FakeRange(this, row, column, numRows, numColumns);
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    return this;
  }

  insertColumnsAfter(after, howMany) {
    this.maxColumns = Math.max(this.maxColumns, after + howMany);
    return this;
  }

  insertRowsAfter(after, howMany) {
    this.maxRows = Math.max(this.maxRows, after + howMany);
    return this;
  }

  deleteRows(position, howMany) {
    const moved = new Map();
    for (const [key, value] of this.cells) {
      const [row, column] = key.split(':').map(Number);
      if (row < position) {
        moved.set(key, value);
      } else if (row >= position + howMany) {
        moved.set(this.key(row - howMany, column), value);
      }
    }
    this.cells = moved;
    this.maxRows -= howMany;
    return this;
  }
}

class FakeSpreadsheet {
  constructor(name) {
    this.name = name;
    this.sheets = [];
  }

  getName() {
    return this.name;
  }

  getSheets() {
    return this.sheets;
  }

  getSheetByName(name) {
    return this.sheets.find((sheet) => sheet.name === name) ?? null;
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * Build the global environment and evaluate the bundle inside it.
 * Returns the sandbox so a test can call doPost and inspect the workbook.
 */
export function createSandbox(code, options = {}) {
  const spreadsheet = new FakeSpreadsheet(options.spreadsheetName ?? 'N & F Laundry');
  const properties = new Map(Object.entries(options.properties ?? {}));
  const cache = new Map();
  let lockHeld = false;
  const stats = { hmacCalls: 0, locks: 0 };

  const context = {
    console,
    Date,
    Math,
    JSON,
    RegExp,
    Error,
    TypeError,
    RangeError,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Symbol,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,

    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      flush: () => { opCounts.flush += 1; },
    },

    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (lockHeld) return false;
          lockHeld = true;
          stats.locks += 1;
          opCounts.lock += 1;
          return true;
        },
        releaseLock: () => {
          lockHeld = false;
        },
      }),
    },

    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
        setProperty: (key, value) => {
          properties.set(key, String(value));
        },
        deleteProperty: (key) => {
          properties.delete(key);
        },
      }),
    },

    CacheService: {
      getScriptCache: () => ({
        get: (key) => {
          const entry = cache.get(key);
          if (!entry) return null;
          if (entry.expires < Date.now()) {
            cache.delete(key);
            return null;
          }
          return entry.value;
        },
        put: (key, value, seconds) => {
          cache.set(key, { value, expires: Date.now() + seconds * 1000 });
        },
        remove: (key) => {
          cache.delete(key);
        },
      }),
    },

    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        content: text,
        setMimeType() {
          return this;
        },
        getContent() {
          return this.content;
        },
      }),
    },

    Utilities: {
      /**
       * Apps Script byte arrays are signed; the bundle converts on the way in
       * and out, so this double must be signed too or that conversion would go
       * untested.
       */
      computeHmacSha256Signature: (value, key) => {
        stats.hmacCalls += 1;
        opCounts.hmac += 1;
        const toBuffer = (bytes) =>
          Buffer.from(bytes.map((byte) => (byte < 0 ? byte + 256 : byte)));
        const digest = createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest();
        return Array.from(digest).map((byte) => (byte > 127 ? byte - 256 : byte));
      },
      getUuid: () => randomUUID(),
      sleep: () => undefined,
      formatDate: (date) => {
        // Only ever asked for Asia/Manila by this codebase.
        const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        return (
          shifted.getUTCFullYear() +
          '-' + pad(shifted.getUTCMonth() + 1, 2) +
          '-' + pad(shifted.getUTCDate(), 2) +
          'T' + pad(shifted.getUTCHours(), 2) +
          ':' + pad(shifted.getUTCMinutes(), 2) +
          ':' + pad(shifted.getUTCSeconds(), 2) +
          '+08:00'
        );
      },
    },
  };

  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'Bundle.gs' });

  return {
    context,
    spreadsheet,
    properties,
    stats,
    /** Post a request the way the deployment would receive it. */
    post(payload) {
      const output = context.doPost({ postData: { contents: JSON.stringify(payload) } });
      return JSON.parse(output.getContent());
    },
    get(sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) return [];
      const lastRow = sheet.getLastRow();
      const lastColumn = sheet.getLastColumn();
      if (lastRow === 0) return [];
      return sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
    },
  };
}
