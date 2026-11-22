import { App, Modal, Notice, Setting } from "obsidian";

import { TransactionStore } from "./transaction-store";
import { ExpensePlan, ExpensePlanCompletion } from "./types";
import { t } from "./i18n";
import { CategorySuggest } from "./category-suggest";
import { InteractiveDatePicker } from "./date-picker";
import { AccountSelect } from "./account-select";
import { SelectMenu } from "./select-menu";

export interface ExpensePlanDefaults { category?: string; dueDate?: Date; fundedByIncomePlanId?: string; }

export class ExpensePlanModal extends Modal {
  private title = "";
  private amount = "";
  private dueDate = localDateValue(new Date());
  private category = "";
  private accountId = "";
  private completion: ExpensePlanCompletion = "mark-only";
  private fundedByIncomePlanId?: string;
  private categorySuggest?: CategorySuggest;
  private datePicker?: InteractiveDatePicker;
  private accountSelect?: AccountSelect;
  private completionSelect?: SelectMenu;

  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly afterSave: () => void,
    private readonly plan?: ExpensePlan,
    defaults?: ExpensePlanDefaults,
    private readonly categories: () => string[] = () => [],
  ) {
    super(app);
    this.title = plan?.title ?? "";
    this.amount = plan ? String(plan.amount) : "";
    this.dueDate = localDateValue(plan?.dueDate ?? defaults?.dueDate ?? new Date());
    this.category = plan?.category ?? defaults?.category ?? "";
    this.accountId = plan?.accountId ?? store.getIndex().accounts[0]?.id ?? "";
    this.completion = plan?.completion ?? "mark-only";
    this.fundedByIncomePlanId = plan?.fundedByIncomePlanId ?? defaults?.fundedByIncomePlanId;
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-planning-modal");
    this.contentEl.createEl("h2", { text: this.plan ? t("Изменить план", "Edit plan") : t("Запланировать расход", "Plan expense") });
    new Setting(this.contentEl).setName(t("Название", "Name")).addText((text) =>
      text.setPlaceholder(t("Оплата университета", "University tuition")).setValue(this.title).onChange((value) => { this.title = value; }));
    new Setting(this.contentEl).setName(t("Сумма", "Amount")).addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "0.01";
      text.inputEl.step = "0.01";
      text.setPlaceholder("0").setValue(this.amount).onChange((value) => { this.amount = value; });
    });
    new Setting(this.contentEl).setName(t("Срок", "Due date")).addText((text) => {
      text.setValue(this.dueDate).onChange((value) => { this.dueDate = value; });
      this.datePicker = new InteractiveDatePicker(text.inputEl, this.dueDate, false, (value) => { this.dueDate = value; });
    });
    new Setting(this.contentEl).setName(t("Категория", "Category")).addText((text) => {
      text.setPlaceholder(t("Введите или выберите", "Type or choose"))
        .setValue(this.category)
        .onChange((value) => { this.category = value; });
      this.categorySuggest = new CategorySuggest(this.app, text.inputEl, () =>
        [...new Set([...this.categories(), ...(this.category ? [this.category] : [])])]
          .sort((left, right) => left.localeCompare(right)), (category) => { this.category = category; });
    });
    const accounts = this.store.getIndex().accounts;
    this.accountSelect = new AccountSelect(
      new Setting(this.contentEl).setName(t("Счёт", "Account")),
      accounts,
      this.accountId,
      (value) => { this.accountId = value; },
    );
    this.completionSelect = new SelectMenu(
      new Setting(this.contentEl).setName(t("При выполнении", "On completion")),
      [
        { value: "mark-only", label: t("Только отметить выполненным", "Mark as completed only"), icon: "circle-check" },
        { value: "create-expense", label: t("Создать фактический расход", "Create an actual expense"), icon: "receipt" },
      ],
      this.completion,
      (value) => { this.completion = value as ExpensePlanCompletion; },
    );
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-cta", text: this.plan ? t("Сохранить", "Save") : t("Создать", "Create") }).addEventListener("click", () => void this.save());
  }

  onClose(): void { this.completionSelect?.destroy(); this.accountSelect?.destroy(); this.categorySuggest?.close(); this.datePicker?.destroy(); this.contentEl.empty(); }

  private async save(): Promise<void> {
    const amount = Number(this.amount.replace(",", "."));
    const dueDate = new Date(`${this.dueDate}T12:00:00`);
    if (!this.title.trim()) return void new Notice(t("Введите название расхода", "Enter an expense name"));
    if (!Number.isFinite(amount) || amount <= 0) return void new Notice(t("Введите сумму больше нуля", "Enter an amount greater than zero"));
    if (Number.isNaN(dueDate.getTime())) return void new Notice(t("Введите корректный срок", "Enter a valid due date"));
    if (!this.category.trim()) return void new Notice(t("Введите или выберите категорию", "Enter or choose a category"));
    if (!this.accountId || !this.store.getAccount(this.accountId)) return void new Notice(t("Выберите счёт", "Select an account"));
    const input = {
      title: this.title.trim(), amount, dueDate, category: this.category.trim(),
      accountId: this.accountId, completion: this.completion,
      fundedByIncomePlanId: this.fundedByIncomePlanId,
    };
    if (this.plan) await this.store.updateExpensePlan(this.plan, input);
    else await this.store.createExpensePlan(input);
    this.afterSave();
    new Notice(this.plan ? t("План обновлён", "Plan updated") : t("Плановый расход создан", "Planned expense created"));
    this.close();
  }
}

export class DeleteExpensePlanModal extends Modal {
  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly plan: ExpensePlan,
    private readonly afterDelete: () => void,
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить план?", "Delete plan?") });
    this.contentEl.createEl("p", { text: t(
      `«${this.plan.title}» будет удалён. Уже созданные операции останутся в хранилище.`,
      `“${this.plan.title}” will be deleted. Existing transactions will remain in the vault.`,
    ) });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }

  onClose(): void { this.contentEl.empty(); }

  private async remove(): Promise<void> {
    await this.store.deleteExpensePlan(this.plan);
    this.afterDelete();
    new Notice(t("План удалён", "Plan deleted"));
    this.close();
  }
}

function localDateValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
