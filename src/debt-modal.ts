import { App, Modal, Notice, setIcon, Setting, TFile } from "obsidian";

import { DEFAULT_ACCOUNT_ICON, normalizeAccountIcon } from "./core/account-icons";
import { MarkdownFileSuggest } from "./file-suggest";
import { IconPicker } from "./icon-picker";
import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceDebt } from "./types";

export class DebtModal extends Modal {
  private personPath: string;
  private icon: string;
  private amount: string;
  private comment: string;
  private iconPicker: IconPicker | null = null;

  constructor(app: App, private readonly store: TransactionStore, private readonly afterSave: () => void, private readonly debt?: FinanceDebt) {
    super(app);
    this.personPath = debt?.personPath ?? "";
    this.icon = normalizeAccountIcon(debt?.icon ?? "user-round");
    this.amount = debt ? String(debt.amount) : "";
    this.comment = debt?.comment ?? "";
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: this.debt ? t("Изменить долг", "Edit debt") : t("Добавить долг", "Add debt") });
    new Setting(this.contentEl).setName(t("Заметка человека", "Person note")).addText((text) => {
      text.setPlaceholder(t("Люди/Иван.md", "People/John.md")).setValue(this.personPath).onChange((value) => { this.personPath = value; });
      new MarkdownFileSuggest(this.app, text.inputEl, (path) => { this.personPath = path; });
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
    new Setting(this.contentEl)
      .setName(t("Сумма со знаком", "Signed amount"))
      .setDesc(t("Минус — должен я, плюс — должен человек.", "Negative — I owe, positive — they owe me."))
      .addText((text) => {
        text.inputEl.type = "number"; text.inputEl.step = "0.01";
        text.setPlaceholder("+50000 / -50000").setValue(this.amount).onChange((value) => { this.amount = value; });
      });
    new Setting(this.contentEl).setName(t("Комментарий", "Comment")).addText((text) =>
      text.setPlaceholder(t("Необязательно", "Optional")).setValue(this.comment).onChange((value) => { this.comment = value; }));
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.iconPicker?.close(); this.iconPicker = null; this.contentEl.empty(); }

  private async save(): Promise<void> {
    const personPath = this.personPath.trim();
    const amount = Number(this.amount.replace(",", "."));
    const file = this.app.vault.getAbstractFileByPath(personPath);
    if (!personPath || !(file instanceof TFile) || file.extension !== "md") return void new Notice(t("Выберите существующую заметку человека", "Select an existing person note"));
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return void new Notice(t("Введите ненулевую сумму со знаком", "Enter a non-zero signed amount"));
    const input = { personPath, amount, icon: normalizeAccountIcon(this.icon || DEFAULT_ACCOUNT_ICON), comment: this.comment.trim() || undefined };
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
