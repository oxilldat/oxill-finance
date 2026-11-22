import { App, Modal, Notice, setIcon, Setting } from "obsidian";

import { DEFAULT_ACCOUNT_ICON, normalizeAccountIcon } from "./core/account-icons";
import { hasSufficientFunds } from "./core/money";
import { IconPicker } from "./icon-picker";
import { TransactionStore } from "./transaction-store";
import { AccountKind, FinanceAccount, FinanceTransfer } from "./types";
import { t } from "./i18n";
import { InteractiveDatePicker } from "./date-picker";
import { AccountSelect } from "./account-select";
import { SelectMenu } from "./select-menu";

export class AccountModal extends Modal {
  private name: string;
  private icon: string;
  private kind: AccountKind;
  private iconPicker: IconPicker | null = null;
  private kindSelect?: SelectMenu;

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    private readonly account?: FinanceAccount,
  ) {
    super(app);
    this.name = account?.name ?? "";
    this.icon = normalizeAccountIcon(account?.icon);
    this.kind = account?.kind ?? "envelope";
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.account ? t("Изменить счёт", "Edit account") : t("Новый счёт", "New account") });
    new Setting(this.contentEl).setName(t("Название", "Name")).addText((text) =>
      text.setPlaceholder(t("Основной", "Main")).setValue(this.name).onChange((value) => { this.name = value; }));
    new Setting(this.contentEl)
      .setName(t("Иконка", "Icon"))
      .addButton((button) => {
        button.setButtonText(t("Выбрать", "Choose"));
        button.buttonEl.addClass("oxf-account-icon-select");
        this.renderIconButton(button.buttonEl);
        button.onClick(() => {
          if (this.iconPicker?.isOpen()) {
            this.iconPicker.close();
            return;
          }
          this.iconPicker = new IconPicker(
            button.buttonEl,
            this.icon,
            (icon) => {
              this.icon = icon;
              this.renderIconButton(button.buttonEl);
            },
            () => { this.iconPicker = null; },
          );
          this.iconPicker.open();
        });
      });
    this.kindSelect = new SelectMenu(
      new Setting(this.contentEl).setName(t("Тип счёта", "Account type")),
      [
        { value: "envelope", label: t("Конверт", "Envelope"), icon: "wallet-cards" },
        { value: "savings", label: t("Накопительный", "Savings"), icon: "piggy-bank" },
      ],
      this.kind,
      (value) => { this.kind = value === "savings" ? "savings" : "envelope"; },
    );
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }

  onClose(): void {
    this.iconPicker?.close();
    this.iconPicker = null;
    this.kindSelect?.destroy();
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    const name = this.name.trim();
    const icon = normalizeAccountIcon(this.icon) || DEFAULT_ACCOUNT_ICON;
    if (!name) return void new Notice(t("Введите название счёта", "Enter an account name"));
    if (this.account) await this.store.updateAccount(this.account, { name, icon, kind: this.kind });
    else await this.store.createAccount({ name, icon, kind: this.kind });
    this.afterSave();
    new Notice(this.account ? t("Счёт обновлён", "Account updated") : t("Счёт создан", "Account created"));
    this.close();
  }

  private renderIconButton(button: HTMLButtonElement): void {
    button.empty();
    const preview = button.createSpan({ cls: "oxf-account-icon-select-preview" });
    setIcon(preview, this.icon);
    button.createSpan({ text: t("Выбрать", "Choose") });
  }
}

export class TransferModal extends Modal {
  private fromAccountId: string;
  private toAccountId = "";
  private amount = "";
  private comment = "";
  private date = localDateTimeValue(new Date());
  private datePicker?: InteractiveDatePicker;
  private accountSelects: AccountSelect[] = [];

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    initialAccountId?: string,
    private readonly transfer?: FinanceTransfer,
  ) {
    super(app);
    this.fromAccountId = transfer?.fromAccountId ?? initialAccountId ?? store.getIndex().accounts[0]?.id ?? "";
    this.toAccountId = transfer?.toAccountId ?? "";
    this.amount = transfer ? String(transfer.amount) : "";
    this.comment = transfer?.comment ?? "";
    this.date = localDateTimeValue(transfer?.date ?? new Date());
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.transfer ? t("Изменить перевод", "Edit transfer") : t("Перевод между счетами", "Transfer between accounts") });
    const accounts = this.store.getIndex().accounts;
    const addAccountDropdown = (setting: Setting, current: string, onChange: (value: string) => void): void => {
      this.accountSelects.push(new AccountSelect(setting, accounts, current, onChange));
    };
    addAccountDropdown(new Setting(this.contentEl).setName(t("Со счёта", "From account")), this.fromAccountId, (value) => { this.fromAccountId = value; });
    addAccountDropdown(new Setting(this.contentEl).setName(t("На счёт", "To account")), this.toAccountId, (value) => { this.toAccountId = value; });
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.step = "0.01";
      text.setPlaceholder("0").setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).setValue(this.comment).onChange((value) => { this.comment = value; }));
    new Setting(this.contentEl).setName(t("Дата и время", "Date and time")).addText((text) => {
      text.setValue(this.date).onChange((value) => { this.date = value; });
      this.datePicker = new InteractiveDatePicker(text.inputEl, this.date, true, (value) => { this.date = value; });
    });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Перевести", "Transfer") }).addEventListener("click", () => void this.save());
  }

  onClose(): void {
    this.accountSelects.forEach((select) => select.destroy());
    this.accountSelects = [];
    this.datePicker?.destroy();
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const date = new Date(this.date);
    if (!this.fromAccountId || !this.toAccountId) return void new Notice(t("Выберите оба счёта", "Select both accounts"));
    if (this.fromAccountId === this.toAccountId) return void new Notice(t("Выберите разные счета", "Select different accounts"));
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (Number.isNaN(date.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    const source = this.store.getAccount(this.fromAccountId);
    const restoredBalance = (source?.balance ?? 0) + (this.transfer?.fromAccountId === this.fromAccountId ? this.transfer.amount : 0);
    if (!source || !hasSufficientFunds(restoredBalance, amount)) return void new Notice(t("На счёте недостаточно средств", "Insufficient funds in the account"));
    const input = {
      amount, date, fromAccountId: this.fromAccountId, toAccountId: this.toAccountId,
      comment: this.comment.trim() || undefined,
    };
    if (this.transfer) await this.store.updateTransfer(this.transfer, input);
    else await this.store.createTransfer(input);
    this.afterSave();
    new Notice(this.transfer ? t("Перевод обновлён", "Transfer updated") : t("Перевод создан", "Transfer created"));
    this.close();
  }
}

function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
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
      `${this.account.name} будет удалён. История операций останется в хранилище.`,
      `${this.account.name} will be deleted. Transaction history will remain in the vault.`,
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
