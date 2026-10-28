import { Modal, Notice } from "obsidian";
import * as XLSX from "xlsx";

import type OxillFinancePlugin from "./main";
import { getFinanceLocale, t } from "./i18n";
import { excelHeaders } from "./core/excel-schema";
import { NewAccount, NewExpensePlan, NewTransaction, NewTransfer } from "./transaction-store";
import { FinanceIndex } from "./types";

const SHEETS = { operations: "Operations", accounts: "Accounts", planning: "Planning", categories: "Categories", help: "Instructions" } as const;

export interface ExcelImportPreview {
  accounts: NewAccount[];
  transactions: NewTransaction[];
  transfers: NewTransfer[];
  plans: NewExpensePlan[];
  categories: string[];
  skipped: number;
  errors: string[];
}

type Row = Record<string, unknown>;

export function createFinanceWorkbook(index: FinanceIndex, categories: string[], template = false): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const locale = getFinanceLocale();
  const accountNames = new Map(index.accounts.map((account) => [account.id, account.name]));
  const operationRows: unknown[][] = [excelHeaders("operations", locale)];
  if (!template) {
    for (const item of index.transactions) operationRows.push([
      item.id, item.kind, item.amount, item.date, item.category, item.accountId ?? "",
      item.accountId ? accountNames.get(item.accountId) ?? "" : "", "", "", "", "", item.comment ?? "", item.file.path, item.externalId ?? "",
    ]);
    for (const item of index.transfers) operationRows.push([
      item.id, "transfer", item.amount, item.date, "", "", "", item.fromAccountId,
      accountNames.get(item.fromAccountId) ?? "", item.toAccountId, accountNames.get(item.toAccountId) ?? "", item.comment ?? "", item.file.path, item.externalId ?? "",
    ]);
  }
  appendSheet(book, SHEETS.operations, operationRows, [18, 12, 14, 20, 20, 20, 20, 20, 20, 20, 20, 28, 34, 22]);

  const accountRows: unknown[][] = [excelHeaders("accounts", locale)];
  if (!template) for (const account of index.accounts) accountRows.push([account.id, account.name, account.icon, account.balance, account.file.path]);
  appendSheet(book, SHEETS.accounts, accountRows, [22, 24, 10, 16, 34]);

  const planRows: unknown[][] = [excelHeaders("planning", locale)];
  if (!template) for (const plan of index.plans) planRows.push([
    plan.id, plan.title, plan.amount, plan.dueDate, plan.category, plan.accountId ?? "",
    plan.accountId ? accountNames.get(plan.accountId) ?? "" : "", plan.completion, plan.status, plan.paidAt ?? "", plan.file.path,
  ]);
  appendSheet(book, SHEETS.planning, planRows, [22, 28, 14, 20, 20, 20, 20, 20, 12, 20, 34]);
  appendSheet(book, SHEETS.categories, [excelHeaders("categories", locale), ...categories.map((name) => [name])], [28]);
  appendSheet(book, SHEETS.help, instructionRows(locale), [24, 92]);
  return book;
}

export function workbookToArray(book: XLSX.WorkBook): ArrayBuffer {
  const output: unknown = XLSX.write(book, { bookType: "xlsx", type: "array", cellDates: true });
  if (output instanceof ArrayBuffer) return output;
  if (output instanceof Uint8Array) return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  throw new Error(t("Не удалось собрать Excel-файл", "Could not build the Excel file"));
}

export function parseFinanceWorkbook(data: ArrayBuffer, index: FinanceIndex): ExcelImportPreview {
  const book = XLSX.read(data, { type: "array", cellDates: true });
  const result: ExcelImportPreview = { accounts: [], transactions: [], transfers: [], plans: [], categories: [], skipped: 0, errors: [] };
  const existingIds = new Set([
    ...index.accounts.map((item) => item.id), ...index.transactions.map((item) => item.id),
    ...index.transfers.map((item) => item.id), ...index.plans.map((item) => item.id),
  ]);
  const accountsById = new Map(index.accounts.map((item) => [item.id, item.id]));
  const accountsByName = new Map(index.accounts.map((item) => [normalize(item.name), item.id]));

  for (const [position, row] of rows(book, [SHEETS.accounts, "Счета"]).entries()) {
    const line = position + 2;
    try {
      const name = required(row, ["name", "название"], "name");
      const id = text(row, ["finance_id", "finance id", "id"]) || stableId("account", name);
      if (existingIds.has(id)) { result.skipped++; continue; }
      if (accountsByName.has(normalize(name))) { result.skipped++; continue; }
      result.accounts.push({ id, name, icon: text(row, ["icon", "иконка"]) || "wallet" });
      existingIds.add(id); accountsById.set(id, id); accountsByName.set(normalize(name), id);
    } catch (error) { result.errors.push(rowError(SHEETS.accounts, line, error)); }
  }

  for (const [position, row] of rows(book, [SHEETS.operations, "Операции"]).entries()) {
    const line = position + 2;
    try {
      const kind = parseKind(required(row, ["type", "operation", "тип", "операция"], "type"));
      const amount = positiveAmount(value(row, ["amount", "сумма"]));
      const date = parseDate(value(row, ["date", "дата"]));
      const externalId = text(row, ["external_id", "external id", "bank_id", "внешний_id", "внешний id"]);
      const signature = [kind, amount, date.toISOString(), text(row, ["category", "категория"]), externalId, text(row, ["comment", "комментарий"])].join("|");
      const id = text(row, ["finance_id", "finance id", "id"]) || stableId("operation", externalId ? `external:${externalId}` : signature);
      if (existingIds.has(id)) { result.skipped++; continue; }
      const comment = text(row, ["comment", "комментарий"]) || undefined;
      if (kind === "transfer") {
        const fromAccountId = resolveAccount(row, ["from_account_id", "from account id", "счет_откуда_id", "id счёта списания", "id счета списания"], ["from_account_name", "from account", "счет_откуда", "счёт списания", "счет списания"], accountsById, accountsByName);
        const toAccountId = resolveAccount(row, ["to_account_id", "to account id", "счет_куда_id", "id счёта зачисления", "id счета зачисления"], ["to_account_name", "to account", "счет_куда", "счёт зачисления", "счет зачисления"], accountsById, accountsByName);
        if (fromAccountId === toAccountId) throw new Error(t("Счета перевода должны отличаться", "Transfer accounts must be different"));
        result.transfers.push({ id, amount, date, fromAccountId, toAccountId, comment, externalId: externalId || undefined });
      } else {
        const category = required(row, ["category", "категория"], "category");
        const accountId = resolveOptionalAccount(row, ["account_id", "account id", "счет_id", "id счёта", "id счета"], ["account_name", "account", "счет", "счёт"], accountsById, accountsByName);
        result.transactions.push({ id, kind, amount, date, category, accountId, comment, externalId: externalId || undefined });
        if (!result.categories.includes(category)) result.categories.push(category);
      }
      existingIds.add(id);
    } catch (error) { result.errors.push(rowError(SHEETS.operations, line, error)); }
  }

  for (const [position, row] of rows(book, [SHEETS.planning, "Планирование"]).entries()) {
    const line = position + 2;
    try {
      const title = required(row, ["title", "название"], "title");
      const dueDate = parseDate(value(row, ["due_date", "due date", "дата", "срок"]));
      const category = required(row, ["category", "категория"], "category");
      const id = text(row, ["finance_id", "finance id", "id"]) || stableId("plan", `${title}|${dueDate.toISOString()}|${category}`);
      if (existingIds.has(id)) { result.skipped++; continue; }
      const completionText = normalize(text(row, ["completion", "completion action", "завершение", "действие при выполнении"]));
      const statusText = normalize(text(row, ["status", "статус"]));
      result.plans.push({
        id, title, amount: positiveAmount(value(row, ["amount", "сумма"])), dueDate, category,
        accountId: resolveOptionalAccount(row, ["account_id", "account id", "счет_id", "id счёта", "id счета"], ["account_name", "account", "счет", "счёт"], accountsById, accountsByName),
        completion: completionText === "create-expense" || completionText === "создать расход" ? "create-expense" : "mark-only",
        status: statusText === "paid" || statusText === "оплачен" ? "paid" : "planned",
        paidAt: value(row, ["paid_at", "paid at", "дата оплаты"]) ? parseDate(value(row, ["paid_at", "paid at", "дата оплаты"])) : undefined,
      });
      existingIds.add(id);
      if (!result.categories.includes(category)) result.categories.push(category);
    } catch (error) { result.errors.push(rowError(SHEETS.planning, line, error)); }
  }
  for (const row of rows(book, [SHEETS.categories, "Категории"])) {
    const name = text(row, ["name", "название"]);
    if (name && !result.categories.includes(name)) result.categories.push(name);
  }
  return result;
}

export class ExcelImportModal extends Modal {
  private preview?: ExcelImportPreview;
  constructor(private readonly plugin: OxillFinancePlugin) { super(plugin.app); }

  onOpen(): void {
    this.modalEl.addClass("oxf-excel-import-modal");
    this.setTitle(t("Импорт из Excel", "Import from Excel"));
    this.renderPicker();
  }

  private renderPicker(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: t("Выберите файл .xlsx. Сначала плагин проверит данные и покажет результат — заметки ещё не будут созданы.", "Choose an .xlsx file. The plugin will validate and preview it before creating any notes.") });
    const input = this.contentEl.createEl("input", { type: "file", attr: { accept: ".xlsx,.xls" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.readFile(file);
    });
  }

  private async readFile(file: File): Promise<void> {
    try {
      this.preview = parseFinanceWorkbook(await file.arrayBuffer(), this.plugin.getFinanceIndex());
      this.renderPreview(file.name);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Не удалось прочитать Excel-файл", "Could not read the Excel file"));
    }
  }

  private renderPreview(fileName: string): void {
    const preview = this.preview;
    if (!preview) return;
    this.contentEl.empty();
    this.contentEl.createEl("p", { cls: "oxf-excel-file-name", text: fileName });
    const summary = this.contentEl.createDiv({ cls: "oxf-excel-summary" });
    summary.createDiv({ text: `${t("Счета", "Accounts")}: ${preview.accounts.length}` });
    summary.createDiv({ text: `${t("Операции", "Operations")}: ${preview.transactions.length + preview.transfers.length}` });
    summary.createDiv({ text: `${t("Планы", "Plans")}: ${preview.plans.length}` });
    summary.createDiv({ text: `${t("Пропущено", "Skipped")}: ${preview.skipped}` });
    if (preview.errors.length > 0) {
      this.contentEl.createEl("h3", { text: t("Нужно исправить", "Needs attention") });
      const errors = this.contentEl.createEl("ul", { cls: "oxf-excel-errors" });
      for (const message of preview.errors.slice(0, 30)) errors.createEl("li", { text: message });
      if (preview.errors.length > 30) errors.createEl("li", { text: t(`И ещё ошибок: ${preview.errors.length - 30}`, `More errors: ${preview.errors.length - 30}`) });
    }
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    const choose = actions.createEl("button", { text: t("Другой файл", "Choose another") });
    choose.addEventListener("click", () => this.renderPicker());
    const apply = actions.createEl("button", { cls: "mod-cta", text: t("Создать заметки", "Create notes") });
    apply.disabled = preview.errors.length > 0 || preview.accounts.length + preview.transactions.length + preview.transfers.length + preview.plans.length === 0;
    apply.addEventListener("click", () => void this.applyImport());
  }

  private async applyImport(): Promise<void> {
    if (!this.preview) return;
    try {
      const count = await this.plugin.importFinanceExcel(this.preview);
      new Notice(t(`Импорт завершён. Создано заметок: ${count}`, `Import complete. Notes created: ${count}`));
      this.close();
    } catch (error) { new Notice(error instanceof Error ? error.message : t("Импорт не завершён", "Import did not complete")); }
  }
}

function appendSheet(book: XLSX.WorkBook, name: string, values: unknown[][], widths: number[]): void {
  const sheet = XLSX.utils.aoa_to_sheet(values, { cellDates: true });
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  if (values.length > 0 && values[0]) sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, values.length - 1), c: values[0].length - 1 } }) };
  XLSX.utils.book_append_sheet(book, sheet, name);
}

function instructionRows(locale: "ru" | "en"): unknown[][] {
  if (locale === "ru") return [excelHeaders("instructions", locale),
    ["Порядок работы", "Скачайте шаблон, вставьте банковские операции на лист Operations по одной операции в строке, затем импортируйте файл в Oxill Finance."],
    ["Тип", "Обязательно: income, expense или transfer. Также принимаются значения: доход, расход, перевод."],
    ["Сумма", "Обязательное положительное число без знака валюты."],
    ["Дата", "Дата Excel или ISO-дата, например 28.10.2026 14:30."],
    ["Категория", "Обязательна для дохода и расхода. Для перевода не используется."],
    ["ID счёта / Счёт", "Для дохода и расхода необязательно. Счёт должен существовать или быть указан на листе Accounts."],
    ["Счета перевода", "Для перевода обязательны счёт списания и счёт зачисления: ID или название."],
    ["ID", "Необязательный стабильный уникальный ID. Уже существующие ID пропускаются."],
    ["Внешний ID", "Необязательный ID банковской операции. Помогает избежать дублей, когда ID не заполнен."],
    ["Безопасность", "Импорт не удаляет заметки. Ошибки в строках блокируют импорт до исправления."],
  ];
  return [excelHeaders("instructions", locale),
    ["Workflow", "Download the template, paste bank transactions into Operations, keep one row per operation, then import the file in Oxill Finance."],
    ["Type", "Required: income, expense, or transfer. Russian values are accepted too."],
    ["Amount", "Required positive number. Do not include a currency symbol."],
    ["Date", "Required Excel date or ISO date, for example 2026-10-28 14:30."],
    ["Category", "Required for income and expense. Not used for transfers."],
    ["Account ID / Account", "Optional for income and expense. The account must already exist or be listed in Accounts."],
    ["Transfer accounts", "From account and to account are required for transfers. Use an account ID or name."],
    ["Finance ID", "Optional stable unique ID. Existing IDs are skipped."],
    ["External ID", "Optional bank operation ID. It helps prevent duplicates when Finance ID is empty."],
    ["Safety", "Import never deletes notes. Rows with errors block import until corrected."],
  ];
}

function rows(book: XLSX.WorkBook, names: string[]): Row[] {
  const sheetName = names.find((name) => book.Sheets[name]);
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  return sheet ? XLSX.utils.sheet_to_json<Row>(sheet, { defval: "", raw: true }) : [];
}

function value(row: Row, aliases: string[]): unknown {
  const lookup = new Map(Object.entries(row).map(([key, item]) => [normalize(key), item]));
  for (const alias of aliases) if (lookup.has(normalize(alias))) return lookup.get(normalize(alias));
  return "";
}
function text(row: Row, aliases: string[]): string { const item = value(row, aliases); return item === null || item === undefined ? "" : String(item).trim(); }
function required(row: Row, aliases: string[], label: string): string { const item = text(row, aliases); if (!item) throw new Error(`${label}: ${t("обязательное поле", "required field")}`); return item; }
function normalize(input: string): string { return input.trim().toLocaleLowerCase().replace(/\s+/g, " "); }
function positiveAmount(input: unknown): number {
  const parsed = typeof input === "number" ? input : Number(String(input).replace(/[\s\u00a0]/g, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(t("amount должен быть положительным числом", "amount must be a positive number"));
  return parsed;
}
function parseDate(input: unknown): Date {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
  if (typeof input === "number") {
    const parsed = XLSX.SSF.parse_date_code(input);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S));
  }
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) throw new Error(t("Некорректная дата", "Invalid date"));
  return date;
}
function parseKind(input: string): "income" | "expense" | "transfer" {
  const kind = normalize(input);
  if (kind === "income" || kind === "доход") return "income";
  if (kind === "expense" || kind === "расход") return "expense";
  if (kind === "transfer" || kind === "перевод") return "transfer";
  throw new Error(t("type должен быть income, expense или transfer", "type must be income, expense, or transfer"));
}
function resolveOptionalAccount(row: Row, idAliases: string[], nameAliases: string[], byId: Map<string, string>, byName: Map<string, string>): string | undefined {
  const id = text(row, idAliases); const name = text(row, nameAliases);
  if (!id && !name) return undefined;
  if (id && byId.has(id)) return id;
  if (name && byName.has(normalize(name))) return byName.get(normalize(name));
  throw new Error(t(`Счёт не найден: ${name || id}`, `Account not found: ${name || id}`));
}
function resolveAccount(row: Row, idAliases: string[], nameAliases: string[], byId: Map<string, string>, byName: Map<string, string>): string {
  const id = resolveOptionalAccount(row, idAliases, nameAliases, byId, byName);
  if (!id) throw new Error(t("Не указан счёт", "Account is required"));
  return id;
}
function stableId(prefix: string, input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) { hash ^= input.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return `import-${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function rowError(sheet: string, line: number, error: unknown): string { return `${sheet}, ${t("строка", "row")} ${line}: ${error instanceof Error ? error.message : t("неизвестная ошибка", "unknown error")}`; }
