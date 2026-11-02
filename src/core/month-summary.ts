import type { FinanceIndex, FinanceMonthSummary, MonthSummaryCategory } from "../types";

export type MonthSummarySnapshot = Omit<FinanceMonthSummary, "id" | "generatedAt" | "file">;

export function monthPeriod(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function createMonthSummarySnapshot(index: FinanceIndex, year: number, month: number): MonthSummarySnapshot {
  const inMonth = (date: Date): boolean => date.getFullYear() === year && date.getMonth() === month;
  const expenses = index.transactions.filter((item) => item.kind === "expense" && inMonth(item.date));
  const income = index.transactions.filter((item) => item.kind === "income" && inMonth(item.date));
  const plans = index.plans.filter((item) => inMonth(item.dueDate));
  const incomePlans = index.incomePlans.filter((item) => inMonth(item.dueDate));
  const transferPlans = index.plannedTransfers.filter((item) => inMonth(item.dueDate));
  const transfers = index.transfers.filter((item) => inMonth(item.date));
  const categories = new Map<string, MonthSummaryCategory>();
  for (const plan of plans) {
    const row = categories.get(plan.category) ?? { name: plan.category, planned: 0, actual: 0 };
    row.planned += plan.amount;
    categories.set(plan.category, row);
  }
  for (const transaction of expenses) {
    const row = categories.get(transaction.category) ?? { name: transaction.category, planned: 0, actual: 0 };
    row.actual += transaction.amount;
    categories.set(transaction.category, row);
  }
  return {
    period: monthPeriod(year, month),
    plannedIncome: sum(incomePlans.map((item) => item.amount)),
    actualIncome: sum(income.map((item) => item.amount)),
    plannedExpenses: sum(plans.map((item) => item.amount)),
    actualExpenses: sum(expenses.map((item) => item.amount)),
    plannedTransfers: sum(transferPlans.map((item) => item.amount)),
    actualTransfers: sum(transfers.map((item) => item.amount)),
    categories: [...categories.values()].sort((left, right) => Math.abs((right.actual - right.planned)) - Math.abs((left.actual - left.planned))),
  };
}

export function expenseDeviationPercent(summary: Pick<FinanceMonthSummary, "plannedExpenses" | "actualExpenses">): number {
  if (summary.plannedExpenses <= 0) return summary.actualExpenses > 0 ? 100 : 0;
  return ((summary.actualExpenses - summary.plannedExpenses) / summary.plannedExpenses) * 100;
}

function sum(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
