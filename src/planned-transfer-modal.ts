import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { PlannedTransfer } from "./types";

export class PlannedTransferModal extends Modal {
  private amount: string;
  private dueDate: string;
  private fromAccountId: string;
  private toAccountId: string;

  constructor(app: App, private readonly store: TransactionStore, private readonly afterSave: () => void, private readonly plan?: PlannedTransfer) {
    super(app);
    const accounts = store.getIndex().accounts;
    this.amount = plan ? String(plan.amount) : "";
    this.dueDate = localDateValue(plan?.dueDate ?? new Date());
    this.fromAccountId = plan?.fromAccountId ?? accounts[0]?.id ?? "";
    this.toAccountId = plan?.toAccountId ?? accounts.find((account) => account.id !== this.fromAccountId)?.id ?? "";
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.plan ? t("Изменить перевод", "Edit transfer") : t("Запланировать перевод", "Plan transfer") });
    const accounts = this.store.getIndex().accounts;
    const accountSelect = (setting: Setting, current: string, onChange: (value: string) => void): void => {
      setting.addDropdown((dropdown) => {
        for (const account of accounts) dropdown.addOption(account.id, account.name);
        dropdown.setValue(current).onChange(onChange);
      });
    };
    accountSelect(new Setting(this.contentEl).setName(t("Со счёта", "From account")), this.fromAccountId, (value) => { this.fromAccountId = value; });
    accountSelect(new Setting(this.contentEl).setName(t("На счёт", "To account")), this.toAccountId, (value) => { this.toAccountId = value; });
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number"; text.inputEl.min = "0.01"; text.inputEl.step = "0.01";
      text.setValue(this.amount).setPlaceholder("0").onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Дата", "Date")).addText((text) => {
      text.inputEl.type = "date"; text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
    });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }
  onClose(): void { this.contentEl.empty(); }
  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const dueDate = new Date(`${this.dueDate}T12:00:00`);
    if (this.fromAccountId === this.toAccountId) return void new Notice(t("Выберите разные счета", "Select different accounts"));
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (Number.isNaN(dueDate.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const input = { amount, dueDate, fromAccountId: this.fromAccountId, toAccountId: this.toAccountId };
    if (this.plan) await this.store.updatePlannedTransfer(this.plan, input); else await this.store.createPlannedTransfer(input);
    this.afterSave(); this.close();
  }
}

export class DeletePlannedTransferModal extends Modal {
  constructor(app: App, private readonly store: TransactionStore, private readonly plan: PlannedTransfer, private readonly afterDelete: () => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить плановый перевод?", "Delete planned transfer?") });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }
  onClose(): void { this.contentEl.empty(); }
  private async remove(): Promise<void> { await this.store.deletePlannedTransfer(this.plan); this.afterDelete(); this.close(); }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
