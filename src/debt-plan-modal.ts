import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceDebt } from "./types";

export type DebtPlanDirection = "pay" | "receive";

export class DebtPlanModal extends Modal {
  private debtId: string;
  private amount: string;
  private dueDate = localDateValue(new Date());
  private accountId = "";

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly direction: DebtPlanDirection,
    private readonly afterSave: () => void,
  ) {
    super(app);
    const debt = this.availableDebts()[0];
    this.debtId = debt?.id ?? "";
    this.amount = debt ? String(Math.abs(debt.amount)) : "";
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-planning-modal");
    this.renderForm();
  }

  onClose(): void { this.contentEl.empty(); }

  private renderForm(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.direction === "pay" ? t("Запланировать погашение долга", "Plan debt repayment") : t("Запланировать получение долга", "Plan debt collection") });
    const debts = this.availableDebts();
    new Setting(this.contentEl).setName(t("Долг", "Debt")).addDropdown((dropdown) => {
      for (const debt of debts) dropdown.addOption(debt.id, debt.name);
      dropdown.setValue(this.debtId).onChange((value) => {
        this.debtId = value;
        const debt = debts.find((item) => item.id === value);
        this.amount = debt ? String(Math.abs(debt.amount)) : "";
        this.renderForm();
      });
    });
    const debt = debts.find((item) => item.id === this.debtId);
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      if (debt) text.inputEl.max = String(Math.abs(debt.amount));
      text.inputEl.step = "0.01";
      text.setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Дата", "Date")).addText((text) => {
      text.inputEl.type = "date";
      text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
    });
    const accounts = this.store.getIndex().accounts;
    new Setting(this.contentEl)
      .setName(this.direction === "pay" ? t("Счёт списания", "Source account") : t("Счёт зачисления", "Destination account"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("Без счёта", "No account"));
        for (const account of accounts) dropdown.addOption(account.id, account.name);
        dropdown.setValue(this.accountId).onChange((value) => { this.accountId = value; });
      });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Запланировать", "Plan") }).addEventListener("click", () => void this.save());
  }

  private async save(): Promise<void> {
    const debt = this.availableDebts().find((item) => item.id === this.debtId);
    if (!debt) return void new Notice(t("Выберите активный долг", "Select an active debt"));
    const amount = Number(this.amount.replace(",", "."));
    const dueDate = new Date(`${this.dueDate}T12:00:00`);
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (amount - Math.abs(debt.amount) > 0.005) return void new Notice(t("Сумма превышает остаток долга", "Amount exceeds the remaining debt"));
    if (Number.isNaN(dueDate.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const common = { amount, dueDate, category: t("Долги", "Debts"), accountId: this.accountId || undefined, debtId: debt.id };
    if (this.direction === "pay") {
      await this.store.createExpensePlan({ ...common, title: t(`Погашение долга: ${debt.name}`, `Debt repayment: ${debt.name}`), completion: "create-expense" });
    } else {
      await this.store.createIncomePlan({ ...common, title: t(`Получение долга: ${debt.name}`, `Debt collection: ${debt.name}`), completion: "create-income" });
    }
    this.afterSave();
    new Notice(t("Операция добавлена в планирование", "Entry added to planning"));
    this.close();
  }

  private availableDebts(): FinanceDebt[] {
    return this.store.getIndex().debts.filter((debt) => !debt.archivedAt && (this.direction === "pay" ? debt.amount < 0 : debt.amount > 0));
  }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
