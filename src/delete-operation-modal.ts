import { App, Modal } from "obsidian";

import { t } from "./i18n";
import { TransactionStore } from "./transaction-store";
import { FinanceTransaction, FinanceTransfer } from "./types";

export class DeleteOperationModal extends Modal {
  constructor(
    app: App,
    private readonly store: TransactionStore,
    private readonly operation: FinanceTransaction | FinanceTransfer,
    private readonly afterDelete: () => void,
  ) { super(app); }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: t("Удалить операцию?", "Delete transaction?") });
    this.contentEl.createEl("p", { text: t("Операция будет перемещена в корзину хранилища.", "The transaction will be moved to the vault trash.") });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Удалить", "Delete") }).addEventListener("click", () => void this.remove());
  }

  onClose(): void { this.contentEl.empty(); }

  private async remove(): Promise<void> {
    await this.store.deleteOperation(this.operation);
    this.afterDelete();
    this.close();
  }
}
