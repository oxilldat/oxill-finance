import { App, Modal, Notice, setIcon, Setting, TFile } from "obsidian";

import { DEFAULT_ACCOUNT_ICON, normalizeAccountIcon } from "./core/account-icons";
import { MarkdownFileSuggest } from "./file-suggest";
import { IconPicker } from "./icon-picker";
import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceDebt } from "./types";
import { PersonNetworkConnector } from "./person-network-connector";

export class DebtModal extends Modal {
  private hasPersonNote: boolean;
  private name: string;
  private personPath: string;
  private icon: string;
  private amount: string;
  private isPositive: boolean;
  private comment: string;
  private iconPicker: IconPicker | null = null;

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly personNetwork: PersonNetworkConnector,
    private readonly connectorEnabled: boolean,
    private readonly afterSave: () => void,
    private readonly debt?: FinanceDebt,
  ) {
    super(app);
    this.hasPersonNote = Boolean(debt?.personPath);
    this.name = debt?.name ?? "";
    this.personPath = debt?.personPath ?? "";
    this.icon = normalizeAccountIcon(debt?.icon ?? "user-round");
    this.amount = debt ? String(Math.abs(debt.amount)) : "";
    this.isPositive = debt ? debt.amount >= 0 : true;
    this.comment = debt?.comment ?? "";
  }

  onOpen(): void {
    this.renderForm();
  }

  private renderForm(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.debt ? t("Изменить долг", "Edit debt") : t("Добавить долг", "Add debt") });
    if ((this.connectorEnabled && this.personNetwork.isAvailable()) || this.debt?.personPath) {
      new Setting(this.contentEl)
        .setName(t("Присутствует заметка человека", "Person note exists"))
        .setDesc(t("Использовать человека из Person Network.", "Use a person from Person Network."))
        .addToggle((toggle) => toggle
          .setValue(this.hasPersonNote)
          .setDisabled(!this.personNetwork.isAvailable())
          .onChange((value) => { this.hasPersonNote = value; this.iconPicker?.close(); this.renderForm(); }));
    }
    if (this.hasPersonNote) {
      const personSetting = new Setting(this.contentEl).setName(t("Заметка человека", "Person note"));
      personSetting.addText((text) => {
        const updatePath = (path: string): void => { this.personPath = path; };
        text.setPlaceholder(t("Люди/Иван.md", "People/John.md")).setValue(this.personPath).onChange(updatePath);
        new MarkdownFileSuggest(this.app, text.inputEl, updatePath, (file) => this.personNetwork.isPersonFile(file));
      });
    } else {
      new Setting(this.contentEl).setName(t("Название долга", "Debt name")).addText((text) => {
        text.setPlaceholder(t("Например, ремонт", "For example, repairs")).setValue(this.name).onChange((value) => { this.name = value; });
      });
      new Setting(this.contentEl).setName(t("Иконка", "Icon")).addButton((button) => {
        button.buttonEl.addClass("oxf-account-icon-select");
        const render = (): void => {
          button.buttonEl.empty();
          const preview = button.buttonEl.createSpan({ cls: "oxf-account-icon-select-preview" });
          setIcon(preview, this.icon);
          button.buttonEl.createSpan({ text: t("Выбрать", "Choose") });
        };
        render();
        button.onClick(() => {
          if (this.iconPicker?.isOpen()) return void this.iconPicker.close();
          this.iconPicker = new IconPicker(button.buttonEl, this.icon, (icon) => { this.icon = icon; render(); }, () => { this.iconPicker = null; });
          this.iconPicker.open();
        });
      });
    }
    new Setting(this.contentEl)
      .setName(t("Сумма", "Amount"))
      .addButton((button) => {
        button.buttonEl.addClass("oxf-debt-sign-toggle");
        const render = (): void => {
          button.buttonEl.empty();
          setIcon(button.buttonEl, this.isPositive ? "plus" : "minus");
          button.buttonEl.toggleClass("is-positive", this.isPositive);
          button.buttonEl.toggleClass("is-negative", !this.isPositive);
          button.buttonEl.setAttr("aria-label", this.isPositive
            ? t("Должен человек. Нажмите, чтобы изменить", "They owe me. Click to change")
            : t("Должен я. Нажмите, чтобы изменить", "I owe. Click to change"));
          button.buttonEl.setAttr("title", this.isPositive
            ? t("Должен человек", "They owe me")
            : t("Должен я", "I owe"));
        };
        render();
        button.onClick(() => { this.isPositive = !this.isPositive; render(); });
      })
      .addText((text) => {
        text.inputEl.type = "number"; text.inputEl.min = "0"; text.inputEl.step = "0.01";
        text.setPlaceholder("50000").setValue(this.amount).onChange((value) => { this.amount = value; });
      });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).setValue(this.comment).onChange((value) => { this.comment = value; }));
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.iconPicker?.close(); this.iconPicker = null; this.contentEl.empty(); }

  private async save(): Promise<void> {
    const name = this.name.trim();
    const personPath = this.personPath.trim();
    const magnitude = Math.abs(Number(this.amount.replace(",", ".")));
    const amount = this.isPositive ? magnitude : -magnitude;
    if (this.hasPersonNote) {
      const file = this.app.vault.getAbstractFileByPath(personPath);
      if (!personPath || !(file instanceof TFile) || !this.personNetwork.isPersonFile(file)) return void new Notice(t("Выберите заметку человека из Person Network", "Select a Person Network person note"));
    } else if (!name) return void new Notice(t("Введите название долга", "Enter a debt name"));
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return void new Notice(t("Введите ненулевую сумму со знаком", "Enter a non-zero signed amount"));
    const person = this.hasPersonNote ? this.personNetwork.getPerson(personPath) : undefined;
    const input = { name: person?.name ?? name, personPath: this.hasPersonNote ? personPath : undefined, amount, icon: normalizeAccountIcon(this.icon || DEFAULT_ACCOUNT_ICON), comment: this.comment.trim() || undefined };
    if (this.debt) await this.store.updateDebt(this.debt, input); else await this.store.createDebt(input);
    this.afterSave();
    new Notice(this.debt ? t("Долг обновлён", "Debt updated") : t("Долг добавлен", "Debt added"));
    this.close();
  }

}

export class DeleteDebtModal extends Modal {
  constructor(app: App, private readonly store: TransactionStore, private readonly debt: FinanceDebt, private readonly afterDelete: () => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить долг?", "Delete debt?") });
    this.contentEl.createEl("p", { text: t("Запись о долге будет перемещена в корзину.", "The debt note will be moved to trash.") });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }
  onClose(): void { this.contentEl.empty(); }
  private async remove(): Promise<void> { await this.store.deleteDebt(this.debt); this.afterDelete(); this.close(); }
}
