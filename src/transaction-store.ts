import { App, normalizePath, TFile } from "obsidian";

import { ExpensePlan, ExpensePlanCompletion, FinanceAccount, FinanceIndex, FinanceTransaction, FinanceTransfer, TransactionKind } from "./types";
import { t } from "./i18n";

type Frontmatter = Record<string, unknown>;

export interface NewTransaction {
  kind: TransactionKind;
  amount: number;
  date: Date;
  category: string;
  comment?: string;
  accountId?: string;
}

export interface NewAccount { name: string; icon: string; }
export interface NewTransfer { amount: number; date: Date; fromAccountId: string; toAccountId: string; comment?: string; }
export interface NewExpensePlan {
  title: string;
  amount: number;
  dueDate: Date;
  category: string;
  accountId?: string;
  completion: ExpensePlanCompletion;
}

export class TransactionStore {
  private index: FinanceIndex = { transactions: [], accounts: [], transfers: [], plans: [], issues: [] };
  private listeners = new Set<() => void>();

  constructor(private readonly app: App, private readonly folder = "Финансы/Операции") {}

  refresh(): void {
    this.index = readFinanceIndex(this.app);
    for (const listener of this.listeners) listener();
  }

  getIndex(): FinanceIndex {
    return this.index;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createTransaction(input: NewTransaction): Promise<string> {
    await ensureFolder(this.app, this.folder);
    const id = `tx-${formatIdDate(input.date)}-${Math.random().toString(36).slice(2, 6)}`;
    const content = [
      "---",
      "finance_type: transaction",
      `finance_id: ${quote(id)}`,
      `operation: ${input.kind}`,
      `amount: ${input.amount}`,
      `date: ${quote(input.date.toISOString())}`,
      `category: ${quote(input.category)}`,
      ...(input.accountId ? [`account_id: ${quote(input.accountId)}`] : []),
      ...(input.comment ? [`comment: ${quote(input.comment)}`] : []),
      "---",
      "",
      `# ${input.kind === "income" ? t("Доход", "Income") : t("Расход", "Expense")}: ${input.category}`,
      "",
    ].join("\n");
    const path = normalizePath(`${this.folder}/${id}.md`);
    await this.app.vault.create(path, content);
    return path;
  }

  async createAccount(input: NewAccount): Promise<string> {
    const folder = "Финансы/Счета";
    await ensureFolder(this.app, folder);
    const id = `account-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const content = [
      "---", "finance_type: account", `finance_id: ${quote(id)}`,
      `account_name: ${quote(input.name)}`, `icon: ${quote(input.icon)}`, "---", "", `# ${input.icon} ${input.name}`, "",
    ].join("\n");
    const path = normalizePath(`${folder}/${safeFileName(input.name)}.md`);
    await this.app.vault.create(await availablePath(this.app, path), content);
    return id;
  }

  async updateAccount(account: FinanceAccount, input: NewAccount): Promise<void> {
    await this.app.fileManager.processFrontMatter(account.file, (data) => {
      data.account_name = input.name;
      data.icon = input.icon;
    });
  }

  async deleteAccount(account: FinanceAccount): Promise<void> {
    if (Math.abs(account.balance) > 0.005) throw new Error(t("Сначала переведите все средства на другой счёт", "Transfer all funds to another account first"));
    await this.app.vault.delete(account.file);
  }

  async createTransfer(input: NewTransfer): Promise<string> {
    await ensureFolder(this.app, this.folder);
    const id = `transfer-${formatIdDate(input.date)}-${Math.random().toString(36).slice(2, 6)}`;
    const content = [
      "---", "finance_type: transfer", `finance_id: ${quote(id)}`, "operation: transfer",
      `amount: ${input.amount}`, `date: ${quote(input.date.toISOString())}`,
      `from_account: ${quote(input.fromAccountId)}`, `to_account: ${quote(input.toAccountId)}`,
      ...(input.comment ? [`comment: ${quote(input.comment)}`] : []),
      "---", "", `# ${t("Перевод между счетами", "Transfer between accounts")}`, "",
    ].join("\n");
    const path = normalizePath(`${this.folder}/${id}.md`);
    await this.app.vault.create(path, content);
    return path;
  }

  async createExpensePlan(input: NewExpensePlan): Promise<string> {
    const folder = "Финансы/Планирование";
    await ensureFolder(this.app, folder);
    const id = `plan-${formatIdDate(input.dueDate)}-${Math.random().toString(36).slice(2, 6)}`;
    const content = [
      "---", "finance_type: expense_plan", `finance_id: ${quote(id)}`,
      `title: ${quote(input.title)}`, `amount: ${input.amount}`,
      `due_date: ${quote(input.dueDate.toISOString())}`, `category: ${quote(input.category)}`,
      ...(input.accountId ? [`account_id: ${quote(input.accountId)}`] : []),
      `completion: ${input.completion}`, "status: planned", "---", "", `# ${input.title}`, "",
    ].join("\n");
    const path = normalizePath(`${folder}/${safeFileName(input.title)}.md`);
    await this.app.vault.create(await availablePath(this.app, path), content);
    return id;
  }

  async updateExpensePlan(plan: ExpensePlan, input: NewExpensePlan): Promise<void> {
    await this.app.fileManager.processFrontMatter(plan.file, (data) => {
      data.title = input.title;
      data.amount = input.amount;
      data.due_date = input.dueDate.toISOString();
      data.category = input.category;
      data.completion = input.completion;
      if (input.accountId) data.account_id = input.accountId;
      else delete data.account_id;
    });
  }

  async deleteExpensePlan(plan: ExpensePlan): Promise<void> {
    await this.app.vault.delete(plan.file);
  }

  async completeExpensePlan(plan: ExpensePlan): Promise<void> {
    if (plan.status === "paid") return;
    plan.status = "paid";
    try {
      if (plan.completion === "create-expense") {
        const account = plan.accountId ? this.getAccount(plan.accountId) : undefined;
        if (account && plan.amount > account.balance) throw new Error(t("На выбранном счёте недостаточно средств", "Insufficient funds in the selected account"));
        await this.createTransaction({
          kind: "expense", amount: plan.amount, date: new Date(), category: plan.category,
          comment: `${t("План", "Plan")}: ${plan.title}`, accountId: plan.accountId,
        });
      }
      await this.app.fileManager.processFrontMatter(plan.file, (data) => {
        data.status = "paid";
        data.paid_at = new Date().toISOString();
      });
    } catch (error) {
      plan.status = "planned";
      throw error;
    }
  }

  async moveCategory(source: string, target: string): Promise<void> {
    if (!source || !target || source === target) {
      throw new Error(t("Выберите другую категорию для переноса", "Select a different destination category"));
    }
    const files = this.app.vault.getMarkdownFiles().filter((file) => {
      const data = this.app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
      return typeof data?.finance_type === "string" && data.category === source;
    });
    for (const file of files) {
      await this.app.fileManager.processFrontMatter(file, (data) => {
        if (data.category === source) data.category = target;
      });
    }
    this.refresh();
  }

  getAccount(id: string): FinanceAccount | undefined { return this.index.accounts.find((account) => account.id === id); }
}

export function readFinanceIndex(app: App): FinanceIndex {
  const transactions: FinanceTransaction[] = [];
  const accounts: FinanceAccount[] = [];
  const transfers: FinanceTransfer[] = [];
  const plans: ExpensePlan[] = [];
  const issues: FinanceIndex["issues"] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const data = app.metadataCache.getFileCache(file)?.frontmatter as Frontmatter | undefined;
    try {
      if (data?.finance_type === "transaction") transactions.push(parseTransaction(file, data));
      else if (data?.finance_type === "account") accounts.push(parseAccount(file, data));
      else if (data?.finance_type === "transfer") transfers.push(parseTransfer(file, data));
      else if (data?.finance_type === "expense_plan") plans.push(parseExpensePlan(file, data));
    } catch (error) {
      issues.push({ path: file.path, message: error instanceof Error ? error.message : t("Некорректная операция", "Invalid transaction") });
    }
  }
  transactions.sort((left, right) => right.date.getTime() - left.date.getTime());
  transfers.sort((left, right) => right.date.getTime() - left.date.getTime());
  plans.sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime());
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  for (const transaction of transactions) {
    if (!transaction.accountId) continue;
    const account = accountMap.get(transaction.accountId);
    if (account) account.balance += transaction.kind === "income" ? transaction.amount : -transaction.amount;
  }
  for (const transfer of transfers) {
    const from = accountMap.get(transfer.fromAccountId);
    const to = accountMap.get(transfer.toAccountId);
    if (from) from.balance -= transfer.amount;
    if (to) to.balance += transfer.amount;
  }
  accounts.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  return { transactions, accounts, transfers, plans, issues };
}

function parseTransaction(file: TFile, data: Frontmatter): FinanceTransaction {
  const kind = requiredString(data.operation, "operation");
  if (kind !== "income" && kind !== "expense") throw new Error(t("operation должен быть income или expense", "operation must be income or expense"));
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(t("amount должен быть числом больше нуля", "amount must be a number greater than zero"));
  const date = new Date(requiredString(data.date, "date"));
  if (Number.isNaN(date.getTime())) throw new Error(t("Некорректная дата", "Invalid date"));
  return {
    id: requiredString(data.finance_id, "finance_id"),
    kind,
    amount,
    date,
    category: optionalString(data.category) ?? t("Без категории", "Uncategorized"),
    comment: optionalString(data.comment),
    accountId: optionalString(data.account_id),
    file,
  };
}

function parseAccount(file: TFile, data: Frontmatter): FinanceAccount {
  return {
    id: requiredString(data.finance_id, "finance_id"),
    name: requiredString(data.account_name, "account_name"),
    icon: optionalString(data.icon) ?? "wallet-cards",
    balance: 0,
    file,
  };
}

function parseTransfer(file: TFile, data: Frontmatter): FinanceTransfer {
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(t("amount должен быть числом больше нуля", "amount must be a number greater than zero"));
  const date = new Date(requiredString(data.date, "date"));
  if (Number.isNaN(date.getTime())) throw new Error(t("Некорректная дата", "Invalid date"));
  return {
    id: requiredString(data.finance_id, "finance_id"), amount, date,
    fromAccountId: requiredString(data.from_account, "from_account"),
    toAccountId: requiredString(data.to_account, "to_account"),
    comment: optionalString(data.comment), file,
  };
}

function parseExpensePlan(file: TFile, data: Frontmatter): ExpensePlan {
  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(t("amount должен быть числом больше нуля", "amount must be a number greater than zero"));
  const dueDate = new Date(requiredString(data.due_date, "due_date"));
  if (Number.isNaN(dueDate.getTime())) throw new Error(t("Некорректная дата срока", "Invalid due date"));
  const status = optionalString(data.status) ?? "planned";
  if (status !== "planned" && status !== "paid") throw new Error(t("status должен быть planned или paid", "status must be planned or paid"));
  const completion = optionalString(data.completion) ?? "mark-only";
  if (completion !== "mark-only" && completion !== "create-expense") throw new Error(t("Некорректный completion", "Invalid completion value"));
  const paidAtValue = optionalString(data.paid_at);
  const paidAt = paidAtValue ? new Date(paidAtValue) : undefined;
  return {
    id: requiredString(data.finance_id, "finance_id"), title: requiredString(data.title, "title"), amount,
    dueDate, category: optionalString(data.category) ?? t("Без категории", "Uncategorized"), accountId: optionalString(data.account_id),
    status, completion, paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : undefined, file,
  };
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result) throw new Error(t(`Не заполнено поле ${field}`, `Missing field: ${field}`));
  return result;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
  let current = "";
  for (const part of normalizePath(folder).split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatIdDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || t("Счёт", "Account");
}

async function availablePath(app: App, path: string): Promise<string> {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot >= 0 ? path.slice(0, dot) : path;
  const extension = dot >= 0 ? path.slice(dot) : "";
  let index = 2;
  while (app.vault.getAbstractFileByPath(`${base} ${index}${extension}`)) index += 1;
  return `${base} ${index}${extension}`;
}
