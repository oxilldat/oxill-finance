import { App, Menu, Modal, Notice, setIcon, Setting } from "obsidian";

import { CategorySuggest } from "./category-suggest";
import { normalizeAccountIcon } from "./core/account-icons";
import { hasSufficientFunds } from "./core/money";
import { TransactionStore } from "./transaction-store";
import { FinanceAccount, FinanceTransaction } from "./types";
import { TransactionKind } from "./types";
import { t } from "./i18n";
import { InteractiveDatePicker } from "./date-picker";

export class TransactionModal extends Modal {
  private amount = "";
  private category = "";
  private comment = "";
  private date = localDateValue(new Date());
  private accountId = "";
  private categorySuggest?: CategorySuggest;
  private accountMenu?: Menu;
  private accountMenuClosedAt = 0;
  private datePicker?: InteractiveDatePicker;

  constructor(
    app: App,
    private readonly kind: TransactionKind,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    initialAccountId?: string,
    private readonly categories: () => readonly string[] = () => [],
    private readonly transaction?: FinanceTransaction,
  ) {
    super(app);
    this.amount = transaction ? String(transaction.amount) : "";
    this.category = transaction?.category ?? "";
    this.comment = transaction?.comment ?? "";
    this.date = localDateValue(transaction?.date ?? new Date());
    this.accountId = transaction?.accountId ?? (initialAccountId && store.getAccount(initialAccountId)
      ? initialAccountId
      : store.getIndex().accounts[0]?.id ?? "");
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-transaction-modal");
    this.contentEl.createEl("h2", { text: this.transaction
      ? (this.kind === "income" ? t("Изменить доход", "Edit income") : t("Изменить расход", "Edit expense"))
      : (this.kind === "income" ? t("Добавить доход", "Add income") : t("Добавить расход", "Add expense")) });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).setValue(this.comment).onChange((value) => { this.comment = value; }));
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.step = "0.01";
      text.setPlaceholder("0").setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Категория", "Category")).addText((text) => {
      text.inputEl.addClass("oxf-transaction-category-input");
      text.setPlaceholder(this.kind === "income" ? t("Зарплата", "Salary") : t("Продукты", "Groceries")).setValue(this.category).onChange((value) => { this.category = value; });
      this.categorySuggest = new CategorySuggest(this.app, text.inputEl, this.categories, (category) => {
        this.category = category;
        text.setValue(category);
      });
    });
    const accounts = this.store.getIndex().accounts;
    if (accounts.length > 0) {
      new Setting(this.contentEl).setName(t("Счёт", "Account")).addButton((button) => {
        button.buttonEl.addClass("oxf-transaction-account-select");
        this.renderAccountButton(button.buttonEl, accounts);
        button.buttonEl.addEventListener("click", () => this.toggleAccountMenu(button.buttonEl, accounts));
      });
    }
    new Setting(this.contentEl).setName(t("Дата и время", "Date and time")).addText((text) => {
      text.setValue(this.date).onChange((value) => { this.date = value; });
      this.datePicker = new InteractiveDatePicker(text.inputEl, this.date, true, (value) => { this.date = value; });
    });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    const cancel = actions.createEl("button", { text: t("Отмена", "Cancel") });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") });
    save.addEventListener("click", () => void this.save());
  }

  onClose(): void {
    this.accountMenu?.close();
    this.accountMenu = undefined;
    this.categorySuggest?.close();
    this.categorySuggest = undefined;
    this.datePicker?.destroy();
    this.contentEl.empty();
  }

  private renderAccountButton(button: HTMLButtonElement, accounts: readonly FinanceAccount[]): void {
    button.empty();
    const account = accounts.find((item) => item.id === this.accountId);
    const icon = button.createSpan({ cls: "oxf-transaction-account-icon" });
    setIcon(icon, account ? normalizeAccountIcon(account.icon) : "wallet-cards");
    button.createSpan({ cls: "oxf-transaction-account-label", text: account?.name ?? t("Выберите счёт", "Select an account") });
    const chevron = button.createSpan({ cls: "oxf-transaction-account-chevron" });
    setIcon(chevron, "chevron-down");
  }

  private toggleAccountMenu(button: HTMLButtonElement, accounts: readonly FinanceAccount[]): void {
    if (this.accountMenu) {
      this.accountMenu.close();
      return;
    }
    if (performance.now() - this.accountMenuClosedAt < 180) return;
    const menu = new Menu();
    this.accountMenu = menu;
    for (const account of accounts) {
      menu.addItem((item) => item
        .setTitle(account.name)
        .setIcon(normalizeAccountIcon(account.icon))
        .setChecked(this.accountId === account.id)
        .onClick(() => {
          this.accountId = account.id;
          this.renderAccountButton(button, accounts);
        }));
    }
    menu.onHide(() => {
      if (this.accountMenu === menu) this.accountMenu = undefined;
      this.accountMenuClosedAt = performance.now();
    });
    const rect = button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const date = new Date(this.date);
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (!this.category.trim()) return void new Notice(t("Введите категорию", "Enter a category"));
    if (!this.accountId || !this.store.getAccount(this.accountId)) return void new Notice(t("Выберите счёт", "Select an account"));
    if (Number.isNaN(date.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const account = this.accountId ? this.store.getAccount(this.accountId) : undefined;
    const availableBalance = account?.balance ?? 0;
    const restoredBalance = this.transaction?.kind === "expense" && this.transaction.accountId === this.accountId
      ? availableBalance + this.transaction.amount
      : availableBalance;
    if (this.kind === "expense" && account && !hasSufficientFunds(restoredBalance, amount)) return void new Notice(t("На счёте недостаточно средств", "Insufficient funds in the account"));
    const input = {
      kind: this.kind,
      amount,
      date,
      category: this.category.trim(),
      comment: this.comment.trim() || undefined,
      accountId: this.accountId || undefined,
    };
    if (this.transaction) await this.store.updateTransaction(this.transaction, input);
    else await this.store.createTransaction(input);
    this.afterSave();
    new Notice(this.transaction ? t("Операция обновлена", "Transaction updated") : t("Финансовая заметка создана", "Finance note created"));
    this.close();
  }
}

function localDateValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
