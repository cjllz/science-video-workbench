import { parse } from "csv-parse/sync";
import { nanoid } from "nanoid";
import { readSheet } from "read-excel-file/node";
import type { DataAsset, DataCell } from "../shared/video.js";

function normalizeCell(value: unknown): DataCell {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "是" : "否";
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text.replace(/,/g, "").replace(/%$/, ""));
  if (Number.isFinite(numeric) && /^[-+]?\d[\d,.]*%?$/.test(text)) return text.endsWith("%") ? numeric / 100 : numeric;
  return text.slice(0, 120);
}

function uniqueColumns(row: DataCell[], width: number): string[] {
  const used = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = String(row[index] ?? "").trim() || `字段 ${index + 1}`;
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count ? `${base} ${count + 1}` : base;
  });
}

function identifyNumericColumns(columns: string[], rows: DataCell[][]): string[] {
  const numeric = columns.filter((_column, index) => {
    const values = rows.map((row) => row[index]).filter((value) => value !== null);
    const numeric = values.filter((value) => typeof value === "number");
    return numeric.length >= 2 && numeric.length / Math.max(values.length, 1) >= 0.6;
  });
  const score = (column: string): number => {
    if (/率|比例|占比|数量|数值|金额|均值|平均|中位|指标/.test(column)) return 3;
    if (/^(年份?|月份?|日期|时间|序号|编号|id)$/i.test(column)) return 0;
    return 1;
  };
  return numeric.sort((left, right) => score(right) - score(left));
}

function formatValue(value: number): string {
  if (Math.abs(value) > 0 && Math.abs(value) < 1) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function summarize(name: string, columns: string[], rows: DataCell[][], rowCount: number, numericColumns: string[]): string {
  const base = `上传的数据《${name.replace(/\.[^.]+$/, "")}》包含${rowCount}条记录、${columns.length}个字段。`;
  const numericColumn = numericColumns[0];
  if (!numericColumn) return base;
  const index = columns.indexOf(numericColumn);
  const values = rows.map((row) => row[index]).filter((value): value is number => typeof value === "number");
  if (values.length < 2) return base;
  return `${base}${numericColumn}在当前数据中从${formatValue(values[0])}变化到${formatValue(values.at(-1)!)}。`;
}

export async function parseDataAsset(name: string, extension: string, buffer: Buffer): Promise<DataAsset> {
  let rawRows: unknown[][];
  if (extension === ".csv") {
    rawRows = parse(buffer, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }) as unknown[][];
  } else {
    rawRows = await readSheet(buffer) as unknown[][];
  }
  if (rawRows.length < 2) throw new Error("数据文件至少需要表头和一行数据");
  const width = Math.min(12, Math.max(...rawRows.slice(0, 501).map((row) => row.length)));
  const normalized = rawRows.slice(0, 501).map((row) => Array.from({ length: width }, (_, index) => normalizeCell(row[index])));
  const columns = uniqueColumns(normalized[0], width);
  const rows = normalized.slice(1).filter((row) => row.some((cell) => cell !== null));
  if (!rows.length) throw new Error("数据文件没有可用的数据行");
  const numericColumns = identifyNumericColumns(columns, rows);
  const createdAt = new Date().toISOString();
  return {
    id: nanoid(12),
    name: name.slice(0, 120),
    columns,
    rows,
    rowCount: Math.max(0, rawRows.length - 1),
    numericColumns,
    summary: summarize(name, columns, rows, Math.max(0, rawRows.length - 1), numericColumns),
    createdAt
  };
}
