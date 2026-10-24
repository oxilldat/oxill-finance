import { App, Modal, Notice, Setting } from "obsidian";

import { TransactionStore } from "./transaction-store";
import { FinanceAccount } from "./types";
import { t } from "./i18n";

export class AccountModal extends Modal {
  private name: string;
  private icon: string;

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    private readonly account?: FinanceAccount,
  ) {
    super(app);
    this.name = account?.name ?? "";
    this.icon = account?.icon ?? "💳";
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.account ? t("Изменить счёт", "Edit account") : t("Новый счёт", "New account") });
    new Setting(this.contentEl).setName(t("Название", "Name")).addText((text) =>
      text.setPlaceholder(t("Основной", "Main")).setValue(this.name).onChange((value) => { this.name = value; }));
    new Setting(this.contentEl).setName(t("Иконка", "Icon")).setDesc(t("Эмодзи или короткий символ", "Emoji or a short symbol")).addText((text) =>
      text.setPlaceholder("💳").setValue(this.icon).onChange((value) => { this.icon = value; }));
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    const name = this.name.trim();
    const icon = this.icon.trim() || "💳";
    if (!name) return void new Notice(t("Введите название счёта", "Enter an account name"));
    if (this.account) await this.store.updateAccount(this.account, { name, icon });
    else await this.store.createAccount({ name, icon });
    this.afterSave();
    new Notice(this.account ? t("Счёт обновлён", "Account updated") : t("Счёт создан", "Account created"));
    this.close();
  }
}

export class TransferModal extends Modal {
  private fromAccountId: string;
  private toAccountId = "";
  private amount = "";
  private comment = "";

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    initialAccountId?: string,
  ) {
    super(app);
    this.fromAccountId = initialAccountId ?? store.getIndex().accounts[0]?.id ?? "";
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Перевод между счетами", "Transfer between accounts") });
    const accounts = this.store.getIndex().accounts;
    const addAccountDropdown = (setting: Setting, current: string, onChange: (value: string) => void): void => {
      setting.addDropdown((dropdown) => {
        dropdown.addOption("", t("Выберите счёт", "Select an account"));
        for (const account of accounts) dropdown.addOption(account.id, `${account.icon} ${account.name}`);
        dropdown.setValue(current).onChange(onChange);
      });
    };
    addAccountDropdown(new Setting(this.contentEl).setName(t("Со счёта", "From account")), this.fromAccountId, (value) => { this.fromAccountId = value; });
    addAccountDropdown(new Setting(this.contentEl).setName(t("На счёт", "To account")), this.toAccountId, (value) => { this.toAccountId = value; });
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.step = "0.01";
      text.setPlaceholder("0").onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).onChange((value) => { this.comment = value; }));
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Перевести", "Transfer") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.contentEl.empty(); }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    if (!this.fromAccountId || !this.toAccountId) return void new Notice(t("Выберите оба счёта", "Select both accounts"));
    if (this.fromAccountId === this.toAccountId) return void new Notice(t("Выберите разные счета", "Select different accounts"));
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    const source = this.store.getAccount(this.fromAccountId);
    if (!source || amount > source.balance) return void new Notice(t("На счёте недостаточно средств", "Insufficient funds in the account"));
    await this.store.createTransfer({
      amount, date: new Date(), fromAccountId: this.fromAccountId, toAccountId: this.toAccountId,
      comment: this.comment.trim() || undefined,
    });
    this.afterSave();
    new Notice(t("Перевод создан", "Transfer created"));
    this.close();
  }
}

export class DeleteAccountModal extends Modal {
  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly account: FinanceAccount,
    private readonly afterDelete: () => void,
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить счёт?", "Delete account?") });
    this.contentEl.createEl("p", { text: t(
      `${this.account.icon} ${this.account.name} будет удалён. История операций останется в хранилище.`,
      `${this.account.icon} ${this.account.name} will be deleted. Transaction history will remain in the vault.`,
    ) });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }

  onClose(): void { this.contentEl.empty(); }

  private async remove(): Promise<void> {
    try {
      await this.store.deleteAccount(this.account);
      this.afterDelete();
      new Notice(t("Счёт удалён", "Account deleted"));
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Не удалось удалить счёт", "Could not delete the account"));
    }
  }
}
