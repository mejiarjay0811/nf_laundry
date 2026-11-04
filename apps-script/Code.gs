/**
 * N & F LAUNDRY POS — Google Sheets storage gateway.
 *
 * This script is a DUMB STORAGE DRIVER. It performs no business logic, no
 * pricing, and no authorisation beyond a shared bearer token: all of that
 * lives in the Node/TypeScript backend. Its single job is to give the backend
 * ATOMIC access to the spreadsheet via LockService, which the Sheets REST API
 * cannot provide.
 *
 * SETUP
 *   1. Open the target spreadsheet -> Extensions -> Apps Script.
 *   2. Replace Code.gs with this file. Save.
 *   3. Project Settings -> Script properties -> add:
 *        API_TOKEN = <a long random string, same value as APPS_SCRIPT_TOKEN>
 *   4. Deploy -> New deployment -> type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Copy the /exec URL into APPS_SCRIPT_URL in the server .env.
 *
 * The "Anyone" setting exposes only this endpoint, and every request must
 * carry the API_TOKEN. Never commit the token.
 */

/**
 * Bump this whenever this file changes. The backend reports it, so you can
 * always tell which build is actually deployed rather than guessing — a
 * deployment serves a version SNAPSHOT, so saving the editor is not enough.
 */
var SCRIPT_VERSION = '4';

var LOCK_TIMEOUT_MS = 15000; // must stay below APPS_SCRIPT_TIMEOUT_MS
var MAX_COLUMNS = 52; // A..AZ

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return fail('BAD_REQUEST', 'Missing request body');
    }
    var request = JSON.parse(e.postData.contents);

    if (!isAuthorized(request.token)) {
      return fail('UNAUTHORIZED', 'Invalid token');
    }

    var op = String(request.op || '');
    switch (op) {
      case 'ping':          return ok(opPing());
      case 'listSheets':    return ok(opListSheets());
      case 'ensureSheets':  return ok(opEnsureSheets(request.definitions));
      case 'readTable':     return ok(opReadTable(request.sheet));
      case 'appendRows':    return ok(opAppendRows(request.sheet, request.rows));
      case 'updateRows':    return ok(opUpdateRows(request.sheet, request.updates));
      case 'bumpCounter':   return ok(opBumpCounter(request.name, request.delta, request.seedIfMissing));
      case 'bumpCounters':  return ok(opBumpCounters(request.requests));
      case 'appendMany':    return ok(opAppendMany(request.batch));
      case 'readTables':    return ok(opReadTables(request.sheets));
      case 'clearSheetData':return ok(opClearSheetData(request.sheet, request.confirm));
      default:              return fail('UNKNOWN_OP', 'Unsupported operation: ' + op);
    }
  } catch (error) {
    if (String(error && error.message).indexOf('LOCK_TIMEOUT') === 0) {
      return fail('LOCK_TIMEOUT', 'The spreadsheet is busy. Please retry.');
    }
    if (String(error && error.message).indexOf('GUARD_MISMATCH') === 0) {
      return fail('GUARD_MISMATCH', error.message);
    }
    if (String(error && error.message).indexOf('SHEET_NOT_FOUND') === 0) {
      return fail('SHEET_NOT_FOUND', error.message);
    }
    if (String(error && error.message).indexOf('CONFIRMATION_REQUIRED') === 0) {
      return fail('CONFIRMATION_REQUIRED', error.message);
    }
    return fail('SCRIPT_ERROR', String((error && error.message) || error));
  }
}

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } })
  ).setMimeType(ContentService.MimeType.JSON);
}

/* ----------------------------------------------------------------- helpers */

function ok(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(code, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: false, error: { code: code, message: message } })
  ).setMimeType(ContentService.MimeType.JSON);
}

function isAuthorized(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected || !token) return false;
  if (String(token).length !== expected.length) return false;
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ String(token).charCodeAt(i);
  }
  return mismatch === 0;
}

function book() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheetOrThrow(name) {
  var sheet = book().getSheetByName(name);
  if (!sheet) throw new Error('SHEET_NOT_FOUND: sheet "' + name + '" does not exist');
  return sheet;
}

/** Run fn while holding the script lock — the atomicity guarantee. */
function locked(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('LOCK_TIMEOUT: could not acquire script lock');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function toStringMatrix(values) {
  return values.map(function (row) {
    return row.map(function (cell) {
      if (cell === null || cell === undefined) return '';
      if (cell instanceof Date) return Utilities.formatDate(cell, 'Asia/Manila', "yyyy-MM-dd'T'HH:mm:ssXXX");
      return String(cell);
    });
  });
}

function trimTrailingEmpty(matrix) {
  var last = matrix.length;
  while (last > 0) {
    var row = matrix[last - 1];
    var empty = true;
    for (var i = 0; i < row.length; i++) {
      if (row[i] !== '') { empty = false; break; }
    }
    if (!empty) break;
    last--;
  }
  return matrix.slice(0, last);
}

/* -------------------------------------------------------------- operations */

function opPing() {
  var ss = book();
  var names = ss.getSheets().map(function (s) { return s.getName(); });
  return {
    spreadsheetName: ss.getName(),
    spreadsheetId: ss.getId(),
    sheets: names,
    version: SCRIPT_VERSION,
    ops: [
      'ping', 'listSheets', 'ensureSheets', 'readTable', 'appendRows', 'updateRows',
      'bumpCounter', 'bumpCounters', 'appendMany', 'readTables', 'clearSheetData',
    ],
  };
}

function opListSheets() {
  return book().getSheets().map(function (s) { return s.getName(); });
}

/**
 * Creates any missing sheet and writes its header row. Existing sheets are
 * never cleared: if columns are missing they are APPENDED to the header, so
 * production data is preserved.
 */
function opEnsureSheets(definitions) {
  return locked(function () {
    var ss = book();
    var result = { created: [], existing: [], headersRepaired: [] };

    for (var i = 0; i < definitions.length; i++) {
      var definition = definitions[i];
      var sheet = ss.getSheetByName(definition.name);

      if (!sheet) {
        sheet = ss.insertSheet(definition.name);
        // A new sheet is only 26 columns wide; Transactions needs 31, and
        // addressing a range past the grid edge throws. Widen it first.
        if (sheet.getMaxColumns() < definition.headers.length) {
          sheet.insertColumnsAfter(
            sheet.getMaxColumns(),
            definition.headers.length - sheet.getMaxColumns()
          );
        }
        // Force plain-text formatting so Sheets never re-interprets an ISO
        // date or a zero-padded O.R. number as a date/number on write.
        sheet
          .getRange(1, 1, sheet.getMaxRows(), definition.headers.length)
          .setNumberFormat('@');
        sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, definition.headers.length).setFontWeight('bold');
        sheet.autoResizeColumns(1, Math.min(definition.headers.length, 12));
        result.created.push(definition.name);
        continue;
      }

      result.existing.push(definition.name);
      var lastColumn = Math.max(1, sheet.getLastColumn());
      var header = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (v) {
        return v === null || v === undefined ? '' : String(v);
      });

      var hasHeader = false;
      for (var h = 0; h < header.length; h++) {
        if (header[h] !== '') { hasHeader = true; break; }
      }

      if (!hasHeader) {
        sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
        sheet.setFrozenRows(1);
        result.headersRepaired.push(definition.name);
        continue;
      }

      var missing = [];
      for (var c = 0; c < definition.headers.length; c++) {
        if (header.indexOf(definition.headers[c]) === -1) missing.push(definition.headers[c]);
      }
      if (missing.length > 0) {
        var needed = header.length + missing.length;
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

function opReadTable(name) {
  var sheet = sheetOrThrow(name);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) return [];
  var values = sheet.getRange(1, 1, lastRow, Math.min(lastColumn, MAX_COLUMNS)).getDisplayValues();
  return trimTrailingEmpty(toStringMatrix(values));
}

function opAppendRows(name, rows) {
  if (!rows || rows.length === 0) return { startRow: 0, rowCount: 0 };
  return locked(function () {
    var sheet = sheetOrThrow(name);
    var startRow = sheet.getLastRow() + 1;
    var width = 0;
    for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
    if (sheet.getMaxColumns() < width) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    }
    if (sheet.getMaxRows() < startRow + rows.length - 1) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 100);
    }
    var normalised = rows.map(function (row) {
      var copy = row.slice();
      while (copy.length < width) copy.push('');
      return copy;
    });
    sheet.getRange(startRow, 1, normalised.length, width).setValues(normalised);
    SpreadsheetApp.flush();
    return { startRow: startRow, rowCount: normalised.length };
  });
}

/**
 * Compare-and-swap row writes. When an update carries a guard, the guarded
 * cell must still hold the expected value or the whole batch is rejected —
 * this stops a stale row number from overwriting somebody else's record.
 */
function opUpdateRows(name, updates) {
  if (!updates || updates.length === 0) return { updated: 0 };
  return locked(function () {
    var sheet = sheetOrThrow(name);
    var lastRow = sheet.getLastRow();

    for (var i = 0; i < updates.length; i++) {
      var update = updates[i];
      if (update.rowNumber < 2 || update.rowNumber > lastRow) {
        throw new Error('GUARD_MISMATCH: row ' + update.rowNumber + ' is out of range');
      }
      if (update.guard) {
        var cell = sheet.getRange(update.rowNumber, update.guard.columnIndex + 1).getDisplayValue();
        if (String(cell) !== String(update.guard.expected)) {
          throw new Error(
            'GUARD_MISMATCH: row ' + update.rowNumber + ' in "' + name + '" changed since it was read'
          );
        }
      }
    }

    for (var j = 0; j < updates.length; j++) {
      var u = updates[j];
      sheet.getRange(u.rowNumber, 1, 1, u.values.length).setValues([u.values]);
    }
    SpreadsheetApp.flush();
    return { updated: updates.length };
  });
}

/**
 * Atomic counter increment. This is the primitive that guarantees O.R.
 * numbers are unique even when several cashiers save at the same instant.
 */
function opBumpCounter(name, delta, seedIfMissing) {
  return locked(function () {
    var sheet = book().getSheetByName('Counters');
    if (!sheet) throw new Error('SHEET_NOT_FOUND: sheet "Counters" does not exist');

    var lastRow = sheet.getLastRow();
    var header = sheet.getRange(1, 1, 1, Math.max(3, sheet.getLastColumn())).getDisplayValues()[0];
    var nameIndex = Math.max(0, header.indexOf('Name'));
    var valueIndex = header.indexOf('Value');
    if (valueIndex === -1) valueIndex = 1;
    var updatedIndex = header.indexOf('Updated At');

    var targetRow = -1;
    var current = Number(seedIfMissing) || 0;

    if (lastRow >= 2) {
      var body = sheet.getRange(2, 1, lastRow - 1, Math.max(3, header.length)).getDisplayValues();
      for (var i = 0; i < body.length; i++) {
        if (String(body[i][nameIndex]) === String(name)) {
          targetRow = i + 2;
          var parsed = Number(body[i][valueIndex]);
          current = isNaN(parsed) ? Number(seedIfMissing) || 0 : parsed;
          break;
        }
      }
    }

    var seed = Number(seedIfMissing) || 0;
    var next = Math.max(current, seed) + (Number(delta) || 0);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Manila', "yyyy-MM-dd'T'HH:mm:ssXXX");

    if (targetRow === -1) {
      var row = [];
      var width = Math.max(3, header.length);
      for (var k = 0; k < width; k++) row.push('');
      row[nameIndex] = name;
      row[valueIndex] = String(next);
      if (updatedIndex >= 0) row[updatedIndex] = stamp;
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([row]);
    } else {
      sheet.getRange(targetRow, valueIndex + 1).setValue(String(next));
      if (updatedIndex >= 0) sheet.getRange(targetRow, updatedIndex + 1).setValue(stamp);
    }
    SpreadsheetApp.flush();
    return { value: next };
  });
}

/* --------------------------------------------------------------- diagnostics */

/**
 * Run this from the Apps Script editor (select checkSetup -> Run) to confirm
 * the token is stored. It prints only the length and the first/last three
 * characters, never the whole secret, and it is never reachable over HTTP.
 */
function checkSetup() {
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!token) {
    Logger.log('API_TOKEN is NOT set.');
    Logger.log('Fix: Project Settings -> Script properties -> Add script property');
    Logger.log('     name API_TOKEN, paste the value, then click "Save script properties".');
  } else {
    Logger.log('API_TOKEN is set: ' + token.length + ' characters, ' +
               token.substring(0, 3) + '...' + token.substring(token.length - 3));
    Logger.log('It must be exactly 64 characters and match APPS_SCRIPT_TOKEN in .env.');
  }

  Logger.log('Spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')');
  var names = ss.getSheets().map(function (s) { return s.getName(); });
  Logger.log('Sheets: ' + names.join(', '));
}

/* ------------------------------------------------------------------ batching */

/**
 * Increment several counters inside ONE lock and ONE round trip.
 *
 * A sale needs an O.R. number, a transaction number, a payment id and possibly
 * a customer id. Doing those as four separate HTTPS calls cost ~10 seconds at
 * the counter; batched they cost one call, and the group is still atomic.
 */
function opBumpCounters(requests) {
  if (!requests || requests.length === 0) return { values: {} };
  return locked(function () {
    var sheet = book().getSheetByName('Counters');
    if (!sheet) throw new Error('SHEET_NOT_FOUND: sheet "Counters" does not exist');

    var header = sheet.getRange(1, 1, 1, Math.max(3, sheet.getLastColumn())).getDisplayValues()[0];
    var nameIndex = Math.max(0, header.indexOf('Name'));
    var valueIndex = header.indexOf('Value');
    if (valueIndex === -1) valueIndex = 1;
    var updatedIndex = header.indexOf('Updated At');
    var width = Math.max(3, header.length);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Manila', "yyyy-MM-dd'T'HH:mm:ssXXX");

    var lastRow = sheet.getLastRow();
    var body = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues() : [];

    var values = {};
    var appended = [];

    for (var i = 0; i < requests.length; i++) {
      var request = requests[i];
      var seed = Number(request.seedIfMissing) || 0;
      var delta = Number(request.delta) || 0;
      var found = -1;
      var current = seed;

      for (var j = 0; j < body.length; j++) {
        if (String(body[j][nameIndex]) === String(request.name)) {
          found = j;
          var parsed = Number(body[j][valueIndex]);
          current = isNaN(parsed) ? seed : parsed;
          break;
        }
      }

      var next = Math.max(current, seed) + delta;
      values[request.name] = next;

      if (found === -1) {
        var row = [];
        for (var k = 0; k < width; k++) row.push('');
        row[nameIndex] = request.name;
        row[valueIndex] = String(next);
        if (updatedIndex >= 0) row[updatedIndex] = stamp;
        body.push(row);
        appended.push(row);
      } else {
        body[found][valueIndex] = String(next);
        if (updatedIndex >= 0) body[found][updatedIndex] = stamp;
      }
    }

    if (body.length > 0) {
      if (sheet.getMaxRows() < body.length + 1) {
        sheet.insertRowsAfter(sheet.getMaxRows(), body.length + 10);
      }
      sheet.getRange(2, 1, body.length, width).setValues(body);
    }
    SpreadsheetApp.flush();
    return { values: values };
  });
}

/**
 * Append to several sheets inside ONE lock and ONE round trip.
 *
 * Resolved and resized in a first pass, written in a second. A sale writes a
 * customer, a payment and a transaction together; validating everything before
 * touching any sheet is what stops a missing sheet or a too-narrow grid from
 * leaving the sale half-written.
 */
function opAppendMany(batch) {
  if (!batch || batch.length === 0) return { results: [] };
  return locked(function () {
    var planned = [];

    // Pass 1 - resolve, size and normalise. Throws here write nothing.
    for (var i = 0; i < batch.length; i++) {
      var entry = batch[i];
      if (!entry.rows || entry.rows.length === 0) {
        planned.push({ sheet: entry.sheet, skip: true });
        continue;
      }
      var sheet = sheetOrThrow(entry.sheet);
      var width = 0;
      for (var r = 0; r < entry.rows.length; r++) {
        width = Math.max(width, entry.rows[r].length);
      }
      if (sheet.getMaxColumns() < width) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
      }
      var startRow = sheet.getLastRow() + 1;
      if (sheet.getMaxRows() < startRow + entry.rows.length - 1) {
        sheet.insertRowsAfter(sheet.getMaxRows(), entry.rows.length + 100);
      }
      var normalised = entry.rows.map(function (row) {
        var copy = row.slice();
        while (copy.length < width) copy.push('');
        return copy;
      });
      planned.push({
        sheet: entry.sheet,
        target: sheet,
        startRow: startRow,
        width: width,
        rows: normalised,
      });
    }

    // Pass 2 - write. Every range is known to be valid by this point.
    var results = [];
    for (var j = 0; j < planned.length; j++) {
      var plan = planned[j];
      if (plan.skip) {
        results.push({ sheet: plan.sheet, startRow: 0, rowCount: 0 });
        continue;
      }
      plan.target.getRange(plan.startRow, 1, plan.rows.length, plan.width).setValues(plan.rows);
      results.push({ sheet: plan.sheet, startRow: plan.startRow, rowCount: plan.rows.length });
    }

    SpreadsheetApp.flush();
    return { results: results };
  });
}

/** Read several whole tables in ONE round trip. No lock: reads only. */
function opReadTables(names) {
  var tables = {};
  for (var i = 0; i < names.length; i++) {
    tables[names[i]] = opReadTable(names[i]);
  }
  return { tables: tables };
}

/* --------------------------------------------------------------- maintenance */

/**
 * Remove every DATA row from a sheet, leaving the header row in place.
 *
 * Deliberately awkward to invoke: the caller must pass the exact confirmation
 * phrase, and no HTTP route in the backend reaches this. It exists only for the
 * "npm run reset:data" maintenance command, which is CLI-only and prints a
 * preview before it runs.
 */
function opClearSheetData(name, confirm) {
  if (confirm !== 'DELETE_ALL_ROWS') {
    throw new Error('CONFIRMATION_REQUIRED: refusing to clear "' + name + '" without confirmation');
  }
  return locked(function () {
    var sheet = sheetOrThrow(name);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sheet: name, removed: 0 };
    var removed = lastRow - 1;
    sheet.deleteRows(2, removed);
    SpreadsheetApp.flush();
    return { sheet: name, removed: removed };
  });
}
