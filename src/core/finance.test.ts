import assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";

import { calculateSummary, selectCategorySlices } from "./finance";
import { FinanceTransaction } from "../types";
import { setFinanceLocale } from "../i18n";
import { excelHeaders } from "./excel-schema";
import { normalizeAccountIcon } from "./account-icons";
import { splitDebtsByArchive, summarizeDebts } from "./debts";
import { calculateMonthlyPlanningBudget, calculatePlanningForecast } from "./planning";
import type { ExpensePlan, IncomePlan, PlannedTransfer } from "../types";
import { createMonthSummarySnapshot, expenseDeviationPercent } from "./month-summary";
import { createMonthSummaryWorkbook } from "./month-summary-excel";
import type { FinanceMonthSummary } from "../types";

test("нормализует старые символы счетов в иконки Obsidian", () => {
  assert.equal(normalizeAccountIcon("💳"), "credit-card");
  assert.equal(normalizeAccountIcon("🏦"), "landmark");
  assert.equal(normalizeAccountIcon("credit-card"), "credit-card");
  assert.equal(normalizeAccountIcon("неизвестная иконка"), "wallet-cards");
  assert.equal(normalizeAccountIcon("alarm-clock-check"), "alarm-clock-check");
});

test("разделяет долги по знаку суммы", () => {
  assert.deepEqual(summarizeDebts([{ amount: 500_000 }, { amount: -50_000 }, { amount: 2_000 }]), {
    owedToMe: 502_000,
    iOwe: 50_000,
  });
});

test("разделяет активные и архивные долги", () => {
  const active = { amount: 5_000, archivedAt: undefined };
  const archived = { amount: -3_000, archivedAt: new Date("2026-11-03T12:00:00Z") };
  assert.deepEqual(splitDebtsByArchive([active, archived]), { active: [active], archived: [archived] });
});

test("рассчитывает прогноз с плановыми доходами и расходами", () => {
  const file = { path: "plan.md" } as TFile;
  const expense = { amount: 30_000, status: "planned", file } as ExpensePlan;
  const paidExpense = { amount: 5_000, status: "paid", file } as ExpensePlan;
  const income = { amount: 50_000, status: "planned", file } as IncomePlan;
  const forecast = calculatePlanningForecast([
    transaction("income", 100_000, "2026-11-01T10:00:00", "Зарплата"),
    transaction("expense", 20_000, "2026-11-01T11:00:00", "Жильё"),
  ], [expense, paidExpense], [income]);
  assert.deepEqual(forecast, { plannedExpenses: 30_000, expectedIncome: 50_000, currentBalance: 80_000, forecastBalance: 100_000 });
});

test("рассчитывает свободные деньги выбранного месяца", () => {
  const file = { path: "plan.md" } as TFile;
  const expenses = [{ amount: 95_000, file }] as ExpensePlan[];
  const incomes = [{ amount: 135_000, file }] as IncomePlan[];
  const transfers = [{ amount: 40_000, file }] as PlannedTransfer[];
  assert.deepEqual(calculateMonthlyPlanningBudget(expenses, incomes, transfers), {
    income: 135_000,
    expenses: 95_000,
    transfers: 40_000,
    free: 0,
  });
});

test("фиксирует план и факт завершённого месяца", () => {
  const file = { path: "item.md" } as TFile;
  const index = {
    transactions: [
      transaction("income", 135_000, "2026-11-05T10:00:00", "Зарплата"),
      transaction("expense", 18_000, "2026-11-10T10:00:00", "Продукты"),
    ],
    transfers: [{ amount: 40_000, date: new Date("2026-11-06T10:00:00"), file }],
    plans: [{ amount: 15_000, category: "Продукты", dueDate: new Date("2026-11-01T10:00:00"), file }],
    incomePlans: [{ amount: 135_000, dueDate: new Date("2026-11-05T10:00:00"), file }],
    plannedTransfers: [{ amount: 40_000, dueDate: new Date("2026-11-06T10:00:00"), file }],
  } as unknown as Parameters<typeof createMonthSummarySnapshot>[0];
  const summary = createMonthSummarySnapshot(index, 2026, 10);
  assert.equal(summary.actualExpenses, 18_000);
  assert.equal(summary.plannedExpenses, 15_000);
  assert.equal(summary.categories[0]?.name, "Продукты");
  assert.equal(expenseDeviationPercent(summary), 20);
});

test("создаёт Excel-отчёт итогов месяца", () => {
  setFinanceLocale("ru");
  const summary = {
    period: "2026-10", generatedAt: new Date("2026-11-01T09:00:00Z"),
    plannedIncome: 135_000, actualIncome: 135_000,
    plannedExpenses: 95_000, actualExpenses: 101_400,
    plannedTransfers: 40_000, actualTransfers: 35_000,
    categories: [{ name: "Продукты", planned: 15_000, actual: 18_000 }],
  } as FinanceMonthSummary;
  const book = createMonthSummaryWorkbook(summary);
  assert.deepEqual(book.SheetNames, ["Итог", "Категории"]);
  assert.equal(book.Sheets["Итог"]?.["B5"]?.v, 135_000);
  assert.equal(book.Sheets["Категории"]?.["A2"]?.v, "Продукты");
});

const transaction = (kind: "income" | "expense", amount: number, date: string, category: string): FinanceTransaction => ({
  id: `${kind}-${amount}-${date}`,
  kind,
  amount,
  date: new Date(date),
  category,
  file: { basename: category, path: `${category}.md` } as TFile,
});

test("локализует заголовки Excel без изменения порядка столбцов", () => {
  const russian = excelHeaders("operations", "ru");
  const english = excelHeaders("operations", "en");
  assert.equal(russian.length, english.length);
  assert.deepEqual(russian.slice(0, 5), ["ID", "Тип", "Сумма", "Дата", "Категория"]);
  assert.deepEqual(english.slice(0, 5), ["Finance ID", "Type", "Amount", "Date", "Category"]);
  assert.equal(russian[8], "Счёт списания");
  assert.equal(english[8], "From account");
});

test("рассчитывает баланс и сводку месяца", () => {
  const summary = calculateSummary([
    transaction("income", 100_000, "2026-10-05T10:00:00", "Зарплата"),
    transaction("expense", 20_000, "2026-10-10T10:00:00", "Жильё"),
    transaction("expense", 5_000, "2026-09-10T10:00:00", "Продукты"),
  ], "month", new Date("2026-10-22T12:00:00"));

  assert.equal(summary.balance, 75_000);
  assert.equal(summary.income, 100_000);
  assert.equal(summary.expense, 20_000);
  assert.equal(summary.savingsRate, 0.8);
  assert.equal(summary.categories[0]?.name, "Жильё");
});

test("не делит на ноль при отсутствии доходов", () => {
  const summary = calculateSummary([
    transaction("expense", 900, "2026-10-20T10:00:00", "Кафе"),
  ], "month", new Date("2026-10-22T12:00:00"));
  assert.equal(summary.savingsRate, 0);
});

test("для недельного обзора группирует график по дням текущей недели", () => {
  const summary = calculateSummary([
    transaction("income", 10_000, "2026-10-19T10:00:00", "Подработка"),
    transaction("expense", 1_500, "2026-10-22T18:00:00", "Продукты"),
    transaction("expense", 700, "2026-10-12T18:00:00", "Транспорт"),
  ], "week", new Date("2026-10-22T12:00:00"));

  assert.equal(summary.flow.length, 7);
  assert.deepEqual(summary.flow.map((bucket) => bucket.label), ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]);
  assert.equal(summary.flow[0]?.income, 10_000);
  assert.equal(summary.flow[3]?.expense, 1_500);
  assert.equal(summary.flow.reduce((sum, bucket) => sum + bucket.expense, 0), 1_500);
});

test("для месячного обзора создаёт дневную шкалу всего месяца", () => {
  const summary = calculateSummary([], "month", new Date("2026-10-22T12:00:00"));
  assert.equal(summary.flow.length, 31);
  assert.equal(summary.flow[0]?.label, "1");
  assert.equal(summary.flow[30]?.label, "31");
});

test("группирует категории по правилу семь плюс другое", () => {
  const categories = Array.from({ length: 10 }, (_, index) => ({
    name: `Категория ${index + 1}`,
    amount: 100 - index,
    share: 0.1,
  }));
  const automatic = selectCategorySlices(categories, []);
  assert.equal(automatic.length, 8);
  assert.equal(automatic[7]?.name, "Другое");
  assert.equal(automatic[7]?.amount, 93 + 92 + 91);

  const manual = selectCategorySlices(categories, ["Категория 3", "Категория 7"]);
  assert.deepEqual(manual.slice(0, 2).map((category) => category.name), ["Категория 3", "Категория 7"]);
  assert.equal(manual[2]?.name, "Другое");
});

test("рассчитывает произвольный диапазон дат", () => {
  const summary = calculateSummary([
    transaction("income", 5_000, "2026-10-03T10:00:00", "Подработка"),
    transaction("expense", 700, "2026-10-05T10:00:00", "Кафе"),
    transaction("expense", 900, "2026-10-20T10:00:00", "Продукты"),
  ], "month", new Date("2026-10-24T12:00:00"), {
    start: new Date("2026-10-01T00:00:00"),
    end: new Date("2026-10-10T23:59:59"),
    label: "1–10 октября",
  });
  assert.equal(summary.income, 5_000);
  assert.equal(summary.expense, 700);
  assert.equal(summary.flow.length, 10);
  assert.equal(summary.label, "1–10 октября");
});

test("поддерживает день и квартал как отдельные периоды", () => {
  const transactions = [
    transaction("income", 2_000, "2026-10-24T10:00:00", "Подработка"),
    transaction("expense", 500, "2026-08-10T10:00:00", "Кафе"),
  ];
  const day = calculateSummary(transactions, "day", new Date("2026-10-24T12:00:00"));
  assert.equal(day.income, 2_000);
  assert.equal(day.expense, 0);
  assert.equal(day.flow.length, 1);

  const quarter = calculateSummary(transactions, "quarter", new Date("2026-08-24T12:00:00"));
  assert.equal(quarter.expense, 500);
  assert.equal(quarter.flow.length, 3);
  assert.equal(quarter.label, "3 квартал 2026");
});

test("локализует вычисляемые подписи на английский", () => {
  setFinanceLocale("en");
  try {
    const categories = Array.from({ length: 9 }, (_, index) => ({
      name: `Category ${index + 1}`, amount: 9 - index, share: (9 - index) / 45,
    }));
    assert.equal(selectCategorySlices(categories, [])[7]?.name, "Other");
    assert.equal(calculateSummary([], "quarter", new Date("2026-08-24T12:00:00")).label, "Q3 2026");
  } finally {
    setFinanceLocale("ru");
  }
});
