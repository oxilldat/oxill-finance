import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceDebt } from "./types";

export class DebtPlanModal extends Modal {
  private amount: string;
  private dueDate = localDateValue(new Date());
  private accountId = "";

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly debt: FinanceDebt,
    private readonly afterSave: () => void,
  ) {
    super(app);
    this.amount = String(Math.abs(debt.amount));
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-planning-modal");
    this.contentEl.createEl("h2", { text: t("Запланировать погашение", "Plan repayment") });
    new Setting(this.contentEl).setName(t("Долг", "Debt")).setDesc(this.debt.name);
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.max = String(Math.abs(this.debt.amount));
      text.inputEl.step = "0.01";
      text.setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Дата", "Date")).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
    });
    const accounts = this.store.getIndex().accounts;
    new Setting(this.contentEl)
      .setName(this.debt.amount < 0 ? t("Счёт списания", "Source account") : t("Счёт зачисления", "Destination account"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("Без счёта", "No account"));
        for (const account of accounts) dropdown.addOption(account.id, account.name);
        dropdown.setValue(this.accountId).onChange((value) => { this.accountId = value; });
      });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Запланировать", "Plan") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const dueDate = new Date(`${this.dueDate}T12:00:00`);
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (amount - Math.abs(this.debt.amount) > 0.005) return void new Notice(t("Сумма превышает остаток долга", "Amount exceeds the remaining debt"));
    if (Number.isNaN(dueDate.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const common = {
      amount, dueDate, category: t("Долги", "Debts"), accountId: this.accountId || undefined, debtId: this.debt.id,
    };
    if (this.debt.amount < 0) {
      await this.store.createExpensePlan({
        ...common, title: t(`Погашение долга: ${this.debt.name}`, `Debt repayment: ${this.debt.name}`), completion: "create-expense",
      });
    } else {
      await this.store.createIncomePlan({
        ...common, title: t(`Возврат долга: ${this.debt.name}`, `Debt repayment: ${this.debt.name}`), completion: "create-income",
      });
    }
    this.afterSave();
    new Notice(t("Погашение добавлено в планирование", "Repayment added to planning"));
    this.close();
  }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
