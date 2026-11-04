/**
 * A materialised view of one sheet.
 *
 * Columns are resolved BY HEADER NAME, so reordering columns in the workbook
 * cannot silently corrupt reads. Row numbers are the real 1-based spreadsheet
 * row numbers, which is what write operations address.
 */
export interface RowView {
  readonly rowNumber: number;
  readonly values: readonly string[];
  get(column: string): string;
  num(column: string, fallback?: number): number;
}

export class SheetTable {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: readonly RowView[];
  private readonly indexByHeader: Map<string, number>;

  constructor(name: string, matrix: string[][]) {
    this.name = name;
    this.headers = matrix[0] ?? [];
    this.indexByHeader = new Map();
    this.headers.forEach((header, index) => {
      if (header && !this.indexByHeader.has(header)) this.indexByHeader.set(header, index);
    });

    const rows: RowView[] = [];
    for (let i = 1; i < matrix.length; i += 1) {
      const values = matrix[i] ?? [];
      if (values.every((cell) => cell === '' || cell === undefined)) continue;
      rows.push(this.createRow(i + 1, values));
    }
    this.rows = rows;
  }

  private createRow(rowNumber: number, values: string[]): RowView {
    const indexByHeader = this.indexByHeader;
    return {
      rowNumber,
      values,
      get(column: string): string {
        const index = indexByHeader.get(column);
        if (index === undefined) return '';
        return values[index] ?? '';
      },
      num(column: string, fallback = 0): number {
        const index = indexByHeader.get(column);
        if (index === undefined) return fallback;
        const raw = values[index];
        if (raw === undefined || raw === '') return fallback;
        const parsed = Number(String(raw).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : fallback;
      },
    };
  }

  columnIndex(column: string): number {
    const index = this.indexByHeader.get(column);
    return index === undefined ? -1 : index;
  }

  hasColumn(column: string): boolean {
    return this.indexByHeader.has(column);
  }

  /** Build a full row array in the sheet's own column order. */
  toRowArray(record: Record<string, string>): string[] {
    return this.headers.map((header) => record[header] ?? '');
  }

  /** Merge a partial record onto an existing row, preserving untouched cells. */
  mergeRow(row: RowView, patch: Record<string, string>): string[] {
    return this.headers.map((header, index) => {
      if (header in patch) return patch[header] ?? '';
      return row.values[index] ?? '';
    });
  }

  find(predicate: (row: RowView) => boolean): RowView | undefined {
    return this.rows.find(predicate);
  }

  filter(predicate: (row: RowView) => boolean): RowView[] {
    return this.rows.filter(predicate);
  }

  /** Index rows by a column value for O(1) lookups (last one wins). */
  indexBy(column: string): Map<string, RowView> {
    const map = new Map<string, RowView>();
    for (const row of this.rows) {
      const key = row.get(column);
      if (key) map.set(key, row);
    }
    return map;
  }

  get size(): number {
    return this.rows.length;
  }
}
