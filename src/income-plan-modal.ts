import { App, Modal, Notice, Setting } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { IncomePlan, IncomePlanCompletion } from "./types";
import { CategorySuggest } from "./category-suggest";
import { InteractiveDatePicker } from "./date-picker";
import { AccountSelect } from "./account-select";
import { SelectMenu } from "./select-menu";

export class IncomePlanModal extends Modal {
  private title: string;
  private amount: string;
  private dueDate: string;
  private category: string;
  private accountId: string;
  private completion: IncomePlanCompletion;
  private categorySuggest?: CategorySuggest;
  private datePicker?: InteractiveDatePicker;
  private accountSelect?: AccountSelect;
  private completionSelect?: SelectMenu;

  constructor(app: App, private readonly store: TransactionStore, private readonly afterSave: () => void, private readonly plan?: IncomePlan, private readonly categories: () => readonly string[] = () => []) {
    super(app);
    this.title = plan?.title ?? "";
    this.amount = plan ? String(plan.amount) : "";
    this.dueDate = localDateValue(plan?.dueDate ?? new Date());
    this.category = plan?.category ?? "";
    this.accountId = plan?.accountId ?? store.getIndex().accounts[0]?.id ?? "";
    this.completion = plan?.completion ?? "mark-only";
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-planning-modal");
    this.contentEl.createEl("h2", { text: this.plan ? t("Изменить плановый доход", "Edit planned income") : t("Запланировать доход", "Plan income") });
    new Setting(this.contentEl).setName(t("Название", "Name")).addText((text) =>
      text.setPlaceholder(t("Зарплата", "Salary")).setValue(this.title).onChange((value) => { this.title = value; }));
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number"; text.inputEl.min = "0.01"; text.inputEl.step = "0.01";
      text.setPlaceholder("0").setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Ожидаемая дата", "Expected date")).addText((text) => {
      text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
      this.datePicker = new InteractiveDatePicker(text.inputEl, this.dueDate, false, (value) => { this.dueDate = value; });
    });
    new Setting(this.contentEl).setName(t("Категория дохода", "Income category")).addText((text) => {
      text.setPlaceholder(t("Введите или выберите", "Type or choose")).setValue(this.category).onChange((value) => { this.category = value; });
      this.categorySuggest = new CategorySuggest(this.app, text.inputEl, () => [...new Set([...this.categories(), ...(this.category ? [this.category] : [])])]
        .sort((left, right) => left.localeCompare(right)), (category) => { this.category = category; text.setValue(category); });
    });
    const accounts = this.store.getIndex().accounts;
    this.accountSelect = new AccountSelect(
      new Setting(this.contentEl).setName(t("Счёт зачисления", "Destination account")),
      accounts,
      this.accountId,
      (value) => { this.accountId = value; },
    );
    this.completionSelect = new SelectMenu(
      new Setting(this.contentEl).setName(t("При получении", "When received")),
      [
        { value: "mark-only", label: t("Только отметить полученным", "Mark as received only"), icon: "circle-check" },
        { value: "create-income", label: t("Создать фактический доход", "Create an actual income"), icon: "badge-dollar-sign" },
      ],
      this.completion,
      (value) => { this.completion = value as IncomePlanCompletion; },
    );
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: t("Сохранить", "Save") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.completionSelect?.destroy(); this.accountSelect?.destroy(); this.categorySuggest?.close(); this.datePicker?.destroy(); this.contentEl.empty(); }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const dueDate = new Date(`${this.dueDate}T12:00:00`);
    if (!this.title.trim()) return void new Notice(t("Введите название дохода", "Enter an income name"));
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (Number.isNaN(dueDate.getTime())) return void new Notice(t("Введите корректную дату", "Enter a valid date"));
    if (!this.category.trim()) return void new Notice(t("Введите категорию дохода", "Enter an income category"));
    if (!this.accountId || !this.store.getAccount(this.accountId)) return void new Notice(t("Выберите счёт", "Select an account"));
    const input = { title: this.title.trim(), amount, dueDate, category: this.category.trim(), accountId: this.accountId, completion: this.completion };
    if (this.plan) await this.store.updateIncomePlan(this.plan, input); else await this.store.createIncomePlan(input);
    this.afterSave();
    new Notice(this.plan ? t("Плановый доход обновлён", "Planned income updated") : t("Доход запланирован", "Income planned"));
    this.close();
  }
}

export class DeleteIncomePlanModal extends Modal {
  constructor(app: App, private readonly store: TransactionStore, private readonly plan: IncomePlan, private readonly afterDelete: () => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить плановый доход?", "Delete planned income?") });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }
  onClose(): void { this.contentEl.empty(); }
  private async remove(): Promise<void> { await this.store.deleteIncomePlan(this.plan); this.afterDelete(); this.close(); }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
