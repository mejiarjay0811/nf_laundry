/**
 * Client-side CSV export.
 *
 * Values are quoted defensively and any leading =, +, - or @ is prefixed with a
 * single quote so a spreadsheet cannot interpret exported data as a formula.
 */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  if (/["\n,]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const head = columns.map((column) => escapeCell(column.header)).join(',');
  const body = rows
    .map((row) => columns.map((column) => escapeCell(column.value(row))).join(','))
    .join('\n');
  return head + '\n' + body;
}

export function downloadCsv(filename: string, contents: string): void {
  // A BOM keeps Excel happy with the peso sign and other UTF-8 characters.
  const blob = new Blob(['\ufeff' + contents], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : filename + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv<T>(filename: string, rows: T[], columns: Array<CsvColumn<T>>): void {
  downloadCsv(filename, toCsv(rows, columns));
}
