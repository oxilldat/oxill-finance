import type { TFile } from "obsidian";

export type TransactionKind = "income" | "expense";
export type PeriodKind = "day" | "week" | "month" | "quarter" | "half-year" | "year";

export interface FinanceTransaction {
  id: string;
  kind: TransactionKind;
  amount: number;
  date: Date;
  category: string;
  comment?: string;
  accountId?: string;
  externalId?: string;
  file: TFile;
}

export interface FinanceAccount {
  id: string;
  name: string;
  icon: string;
  balance: number;
  file: TFile;
}

export interface FinanceTransfer {
  id: string;
  amount: number;
  date: Date;
  fromAccountId: string;
  toAccountId: string;
  comment?: string;
  externalId?: string;
  file: TFile;
}

export type ExpensePlanStatus = "planned" | "paid";
export type ExpensePlanCompletion = "mark-only" | "create-expense";

export interface ExpensePlan {
  id: string;
  title: string;
  amount: number;
  dueDate: Date;
  category: string;
  accountId?: string;
  status: ExpensePlanStatus;
  completion: ExpensePlanCompletion;
  paidAt?: Date;
  file: TFile;
}

export interface PlannedTransfer {
  id: string;
  amount: number;
  dueDate: Date;
  fromAccountId: string;
  toAccountId: string;
  status: ExpensePlanStatus;
  paidAt?: Date;
  file: TFile;
}

export interface FinanceDebt {
  id: string;
  personPath: string;
  icon: string;
  amount: number;
  comment?: string;
  file: TFile;
}

export interface FinanceIssue {
  path: string;
  message: string;
}

export interface FinanceIndex {
  transactions: FinanceTransaction[];
  accounts: FinanceAccount[];
  transfers: FinanceTransfer[];
  plans: ExpensePlan[];
  plannedTransfers: PlannedTransfer[];
  debts: FinanceDebt[];
  issues: FinanceIssue[];
}

export interface FlowBucket {
  label: string;
  income: number;
  expense: number;
}

export interface CategoryTotal {
  name: string;
  amount: number;
  share: number;
}

export interface FinanceSummary {
  label: string;
  balance: number;
  income: number;
  expense: number;
  savingsRate: number;
  flow: FlowBucket[];
  categories: CategoryTotal[];
  transactions: FinanceTransaction[];
}
