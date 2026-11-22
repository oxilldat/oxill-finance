import { App, Modal } from "obsidian";

import { formatMoney } from "./core/money";
import { localeCode, t } from "./i18n";
import { FinanceAccount, PlannedTransfer } from "./types";

export class CopyPlannedTransfersModal extends Modal {
  private readonly selectedIds: Set<string>;
  private copyButton?: HTMLButtonElement;
  private readonly accountNames: Map<string, string>;

  constructor(
    app: App,
    private readonly plans: readonly PlannedTransfer[],
    accounts: readonly FinanceAccount[],
    private readonly targetMonth: Date,
    private readonly onCopy: (plans: PlannedTransfer[]) => Promise<void>,
  ) {
    super(app);
    this.selectedIds = new Set(plans.map((plan) => plan.id));
    this.accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  }

  onOpen(): void {
    this.modalEl.addClass("oxf-copy-plans-modal");
    this.contentEl.createEl("h2", { text: t("Скопировать переводы", "Copy transfers") });
    const month = new Intl.DateTimeFormat(localeCode(), { month: "long", year: "numeric" }).format(this.targetMonth);
    this.contentEl.createEl("p", { cls: "oxf-copy-plans-description", text: t(`Выберите переводы для копирования в ${month}.`, `Choose transfers to copy to ${month}.`) });
    const toolbar = this.contentEl.createDiv({ cls: "oxf-copy-plans-toolbar" });
    toolbar.createEl("button", { text: t("Выбрать все", "Select all"), attr: { type: "button" } }).addEventListener("click", () => {
      for (const plan of this.plans) this.selectedIds.add(plan.id);
      this.renderList();
    });
    toolbar.createEl("button", { text: t("Снять выбор", "Clear selection"), attr: { type: "button" } }).addEventListener("click", () => {
      this.selectedIds.clear();
      this.renderList();
    });
    this.contentEl.createDiv({ cls: "oxf-copy-plans-list" });
    this.renderList();
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    this.copyButton = actions.createEl("button", { cls: "mod-cta", text: t("Скопировать", "Copy") });
    this.copyButton.addEventListener("click", () => void this.copy());
    this.updateCopyButton();
  }

  onClose(): void { this.contentEl.empty(); }

  private renderList(): void {
    const list = this.contentEl.querySelector<HTMLElement>(".oxf-copy-plans-list");
    if (!list) return;
    list.empty();
    const unknown = t("Неизвестный счёт", "Unknown account");
    for (const plan of [...this.plans].sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) {
      const row = list.createEl("label", { cls: "oxf-copy-plan-row" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selectedIds.has(plan.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selectedIds.add(plan.id); else this.selectedIds.delete(plan.id);
        this.updateCopyButton();
      });
      const identity = row.createDiv();
      identity.createEl("strong", { text: `${this.accountNames.get(plan.fromAccountId) ?? unknown} → ${this.accountNames.get(plan.toAccountId) ?? unknown}` });
      identity.createSpan({ text: new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "long" }).format(plan.dueDate) });
      row.createEl("b", { text: `${formatMoney(plan.amount, localeCode())} ₽` });
    }
    this.updateCopyButton();
  }

  private updateCopyButton(): void {
    if (!this.copyButton) return;
    this.copyButton.disabled = this.selectedIds.size === 0;
    this.copyButton.setText(t(`Скопировать (${this.selectedIds.size})`, `Copy (${this.selectedIds.size})`));
  }

  private async copy(): Promise<void> {
    const selected = this.plans.filter((plan) => this.selectedIds.has(plan.id));
    if (selected.length === 0) return;
    if (this.copyButton) this.copyButton.disabled = true;
    await this.onCopy(selected);
    this.close();
  }
}
