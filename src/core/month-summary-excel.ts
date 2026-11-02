import * as XLSX from "xlsx";

import { getFinanceLocale } from "../i18n";
import type { FinanceMonthSummary } from "../types";

export function createMonthSummaryWorkbook(summary: FinanceMonthSummary): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const locale = getFinanceLocale();
  const labels = locale === "ru"
    ? { summary: "Итог", categories: "Категории", metric: "Показатель", plan: "План", actual: "Факт", variance: "Отклонение", variancePercent: "Отклонение, %", income: "Доходы", expenses: "Расходы", transfers: "Переводы", free: "Свободно", category: "Категория", period: "Период", generated: "Сформировано" }
    : { summary: "Summary", categories: "Categories", metric: "Metric", plan: "Plan", actual: "Actual", variance: "Variance", variancePercent: "Variance, %", income: "Income", expenses: "Expenses", transfers: "Transfers", free: "Free", category: "Category", period: "Period", generated: "Generated" };
  const plannedFree = summary.plannedIncome - summary.plannedExpenses - summary.plannedTransfers;
  const actualFree = summary.actualIncome - summary.actualExpenses - summary.actualTransfers;
  const rows: unknown[][] = [
    [labels.period, summary.period],
    [labels.generated, summary.generatedAt],
    [],
    [labels.metric, labels.plan, labels.actual, labels.variance, labels.variancePercent],
    metricRow(labels.income, summary.plannedIncome, summary.actualIncome),
    metricRow(labels.expenses, summary.plannedExpenses, summary.actualExpenses),
    metricRow(labels.transfers, summary.plannedTransfers, summary.actualTransfers),
    metricRow(labels.free, plannedFree, actualFree),
  ];
  const overview = appendReportSheet(book, labels.summary, rows, [22, 18, 18, 18, 18]);
  applyNumberFormat(overview, 4, 7, 1, 3, "#,##0.00");
  applyNumberFormat(overview, 4, 7, 4, 4, "0.0%");
  const categoryRows: unknown[][] = [[labels.category, labels.plan, labels.actual, labels.variance, labels.variancePercent]];
  for (const category of summary.categories) categoryRows.push(metricRow(category.name, category.planned, category.actual));
  const categories = appendReportSheet(book, labels.categories, categoryRows, [28, 18, 18, 18, 18]);
  applyNumberFormat(categories, 1, Math.max(1, categoryRows.length - 1), 1, 3, "#,##0.00");
  applyNumberFormat(categories, 1, Math.max(1, categoryRows.length - 1), 4, 4, "0.0%");
  return book;
}

function metricRow(label: string, planned: number, actual: number): unknown[] {
  const variance = actual - planned;
  return [label, planned, actual, variance, planned > 0 ? variance / planned : actual > 0 ? 1 : 0];
}

function appendReportSheet(book: XLSX.WorkBook, name: string, values: unknown[][], widths: number[]): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(values, { cellDates: true });
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(book, sheet, name);
  return sheet;
}

function applyNumberFormat(sheet: XLSX.WorkSheet, firstRow: number, lastRow: number, firstColumn: number, lastColumn: number, format: string): void {
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell) cell.z = format;
    }
  }
}
