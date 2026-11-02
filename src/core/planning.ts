import type { ExpensePlan, FinanceTransaction, IncomePlan, PlannedTransfer } from "../types";

export interface PlanningForecast {
  plannedExpenses: number;
  expectedIncome: number;
  currentBalance: number;
  forecastBalance: number;
}

export interface MonthlyPlanningBudget {
  income: number;
  expenses: number;
  transfers: number;
  free: number;
}

export function calculateMonthlyPlanningBudget(
  expensePlans: readonly ExpensePlan[],
  incomePlans: readonly IncomePlan[],
  transfers: readonly PlannedTransfer[],
): MonthlyPlanningBudget {
  const income = incomePlans.reduce((sum, plan) => sum + plan.amount, 0);
  const expenses = expensePlans.reduce((sum, plan) => sum + plan.amount, 0);
  const allocatedTransfers = transfers.reduce((sum, plan) => sum + plan.amount, 0);
  return { income, expenses, transfers: allocatedTransfers, free: income - expenses - allocatedTransfers };
}

export function calculatePlanningForecast(
  transactions: readonly FinanceTransaction[],
  expensePlans: readonly ExpensePlan[],
  incomePlans: readonly IncomePlan[],
): PlanningForecast {
  const currentBalance = transactions.reduce((sum, item) => sum + (item.kind === "income" ? item.amount : -item.amount), 0);
  const plannedExpenses = expensePlans.filter((plan) => plan.status === "planned").reduce((sum, plan) => sum + plan.amount, 0);
  const expectedIncome = incomePlans.filter((plan) => plan.status === "planned").reduce((sum, plan) => sum + plan.amount, 0);
  return { plannedExpenses, expectedIncome, currentBalance, forecastBalance: currentBalance + expectedIncome - plannedExpenses };
}
