import { App, Modal, Notice, Setting } from "obsidian";

import { TransactionStore } from "./transaction-store";
import { TransactionKind } from "./types";
import { t } from "./i18n";

export class TransactionModal extends Modal {
  private amount = "";
  private category = "";
  private comment = "";
  private date = localDateValue(new Date());
  private accountId = "";

  constructor(
    app: App,
    private readonly kind: TransactionKind,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    initialAccountId?: string,
  ) {
    super(app);
    this.accountId = initialAccountId ?? "";
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-transaction-modal");
    this.contentEl.createEl("h2", { text: this.kind === "income" ? t("Добавить доход", "Add income") : t("Добавить расход", "Add expense") });
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.step = "0.01";
      text.setPlaceholder("0").onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Категория", "Category")).addText((text) =>
      text.setPlaceholder(this.kind === "income" ? t("Зарплата", "Salary") : t("Продукты", "Groceries")).onChange((value) => { this.category = value; }));
    const accounts = this.store.getIndex().accounts;
    if (accounts.length > 0) {
      new Setting(this.contentEl).setName(t("Счёт", "Account")).addDropdown((dropdown) => {
        dropdown.addOption("", t("Без счёта", "No account"));
        for (const account of accounts) dropdown.addOption(account.id, `${account.icon} ${account.name}`);
        dropdown.setValue(this.accountId).onChange((value) => { this.accountId = value; });
      });
    }
    new Setting(this.contentEl).setName(t("Дата и время", "Date and time")).addText((text) => {
      text.inputEl.type = "datetime-local";
      text.setValue(this.date).onChange((value) => { this.date = value; });
    });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).onChange((value) => { this.comment = value; }));
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    const cancel = actions.createEl("button", { text: t("Отмена", "Cancel") });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") });
    save.addEventListener("click", () => void this.save());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const date = new Date(this.date);
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (!this.category.trim()) return void new Notice(t("Введите категорию", "Enter a category"));
    if (Number.isNaN(date.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const account = this.accountId ? this.store.getAccount(this.accountId) : undefined;
    if (this.kind === "expense" && account && amount > account.balance) return void new Notice(t("На счёте недостаточно средств", "Insufficient funds in the account"));
    await this.store.createTransaction({
      kind: this.kind,
      amount,
      date,
      category: this.category.trim(),
      comment: this.comment.trim() || undefined,
      accountId: this.accountId || undefined,
    });
    this.afterSave();
    new Notice(t("Финансовая заметка создана", "Finance note created"));
    this.close();
  }
}

function localDateValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
