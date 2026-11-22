import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceDebt } from "./types";
import { summarizeDebtPlanning } from "./core/debts";
import { InteractiveDatePicker } from "./date-picker";
import { AccountSelect } from "./account-select";
import { SelectMenu } from "./select-menu";

export type DebtPlanDirection = "pay" | "receive";

export class DebtPlanModal extends Modal {
  private debtId: string;
  private amount: string;
  private dueDate = localDateValue(new Date());
  private accountId = "";
  private datePicker?: InteractiveDatePicker;
  private accountSelect?: AccountSelect;
  private debtSelect?: SelectMenu;

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly direction: DebtPlanDirection,
    private readonly afterSave: () => void,
    initialDebtId?: string,
  ) {
    super(app);
    const debts = this.availableDebts();
    const debt = debts.find((item) => item.id === initialDebtId) ?? debts[0];
    this.debtId = debt?.id ?? "";
    this.amount = debt ? String(this.planningStatus(debt).unplannedAmount) : "";
    this.accountId = this.store.getIndex().accounts[0]?.id ?? "";
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-planning-modal");
    this.renderForm();
  }

  onClose(): void { this.debtSelect?.destroy(); this.accountSelect?.destroy(); this.datePicker?.destroy(); this.contentEl.empty(); }

  private renderForm(): void {
    this.datePicker?.destroy();
    this.accountSelect?.destroy();
    this.debtSelect?.destroy();
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.direction === "pay" ? t("Запланировать погашение долга", "Plan debt repayment") : t("Запланировать получение долга", "Plan debt collection") });
    const debts = this.availableDebts();
    this.debtSelect = new SelectMenu(
      new Setting(this.contentEl).setName(t("Долг", "Debt")),
      debts.map((debt) => ({ value: debt.id, label: debt.name, icon: "hand-coins" })),
      this.debtId,
      (value) => {
        this.debtId = value;
        const debt = debts.find((item) => item.id === value);
        this.amount = debt ? String(this.planningStatus(debt).unplannedAmount) : "";
        this.renderForm();
      },
      t("Нет доступных долгов", "No available debts"),
    );
    const debt = debts.find((item) => item.id === this.debtId);
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      if (debt) text.inputEl.max = String(this.planningStatus(debt).unplannedAmount);
      text.inputEl.step = "0.01";
      text.setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Дата", "Date")).addText((text) => {
      text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
      this.datePicker = new InteractiveDatePicker(text.inputEl, this.dueDate, false, (value) => { this.dueDate = value; });
    });
    const accounts = this.store.getIndex().accounts;
    this.accountSelect = new AccountSelect(
      new Setting(this.contentEl).setName(this.direction === "pay" ? t("Счёт списания", "Source account") : t("Счёт зачисления", "Destination account")),
      accounts,
      this.accountId,
      (value) => { this.accountId = value; },
    );
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
    if (!this.accountId) return void new Notice(t("Создайте или выберите счёт", "Create or select an account"));
    if (amount - this.planningStatus(debt).unplannedAmount > 0.005) return void new Notice(t("Сумма превышает незапланированный остаток долга", "Amount exceeds the unplanned debt balance"));
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
    return this.store.getIndex().debts.filter((debt) =>
      !debt.archivedAt
      && (this.direction === "pay" ? debt.amount < 0 : debt.amount > 0)
      && this.planningStatus(debt).unplannedAmount > 0.005);
  }

  private planningStatus(debt: FinanceDebt): ReturnType<typeof summarizeDebtPlanning> {
    const index = this.store.getIndex();
    return summarizeDebtPlanning(debt, index.plans, index.incomePlans);
  }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
