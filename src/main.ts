import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import { AccountModal, DeleteAccountModal, TransferModal } from "./account-modals";
import { FinanceView, VIEW_TYPE_FINANCE } from "./finance-view";
import { TransactionModal } from "./transaction-modal";
import { FinanceStorageFolders, TransactionStore } from "./transaction-store";
import { DeleteExpensePlanModal, ExpensePlanModal } from "./planning-modal";
import { ExpensePlan, FinanceAccount, TransactionKind } from "./types";
import { DEFAULT_SETTINGS, FinanceSettingTab, normalizeFinanceSettings, OxillFinanceSettings } from "./settings";
import { setFinanceLocale, t } from "./i18n";
import { createFinanceWorkbook, ExcelImportModal, ExcelImportPreview, workbookToArray } from "./excel";
import { FinanceIndex } from "./types";

export default class OxillFinancePlugin extends Plugin {
  private store!: TransactionStore;
  private refreshTimer?: number;
  settings: OxillFinanceSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = normalizeFinanceSettings({ ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<OxillFinanceSettings> | null) });
    setFinanceLocale(this.settings.language);
    this.store = new TransactionStore(this.app, () => this.getStorageFolders());
    this.registerView(VIEW_TYPE_FINANCE, (leaf) => new FinanceView(leaf, this.store, {
      openTransaction: (kind, accountId) => this.openTransactionModal(kind, accountId),
      createAccount: () => new AccountModal(this.app, this.store, () => this.scheduleRefresh(120)).open(),
      editAccount: (account) => new AccountModal(this.app, this.store, () => this.scheduleRefresh(120), account).open(),
      transfer: (accountId) => new TransferModal(this.app, this.store, () => this.scheduleRefresh(120), accountId).open(),
      deleteAccount: (account) => this.openDeleteAccountModal(account),
      createPlan: (category, dueDate) => new ExpensePlanModal(this.app, this.store, () => this.scheduleRefresh(120), undefined, { category, dueDate }).open(),
      editPlan: (plan) => new ExpensePlanModal(this.app, this.store, () => this.scheduleRefresh(120), plan).open(),
      deletePlan: (plan) => new DeleteExpensePlanModal(this.app, this.store, plan, () => this.scheduleRefresh(120)).open(),
      completePlan: (plan) => void this.completePlan(plan),
      selectedCategories: () => this.settings.selectedCategories,
      availableCategories: () => this.getAvailableCategories(),
    }));
    this.addSettingTab(new FinanceSettingTab(this.app, this));
    this.addCommand({ id: "open-finance", name: t("Открыть", "Open"), callback: () => void this.activateView() });
    this.addCommand({ id: "add-expense", name: t("Добавить расход", "Add expense"), callback: () => this.openTransactionModal("expense") });
    this.addCommand({ id: "add-income", name: t("Добавить доход", "Add income"), callback: () => this.openTransactionModal("income") });
    this.addCommand({ id: "add-expense-plan", name: t("Запланировать расход", "Plan expense"), callback: () =>
      new ExpensePlanModal(this.app, this.store, () => this.scheduleRefresh(120)).open() });
    this.addCommand({ id: "export-excel", name: t("Экспортировать данные в Excel", "Export data to Excel"), callback: () => this.exportFinanceExcel(false) });
    this.addCommand({ id: "import-excel", name: t("Импортировать данные из Excel", "Import data from Excel"), callback: () => this.openExcelImport() });
    this.addCommand({ id: "download-excel-template", name: t("Скачать шаблон Excel", "Download Excel template"), callback: () => this.exportFinanceExcel(true) });
    this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
      if (file.path.startsWith("Финансы/") || typeof cache.frontmatter?.finance_type === "string") this.scheduleRefresh();
    }));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.store.refresh());
  }

  onunload(): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_FINANCE)[0];
    const leaf: WorkspaceLeaf = existing ?? this.app.workspace.getLeaf(true);
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_FINANCE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private openTransactionModal(kind: TransactionKind, accountId?: string): void {
    new TransactionModal(this.app, kind, this.store, () => this.scheduleRefresh(120), accountId).open();
  }

  private openDeleteAccountModal(account: FinanceAccount): void {
    if (Math.abs(account.balance) > 0.005) {
      new Notice(t("Сначала переведите все средства на другой счёт", "Transfer all funds to another account first"));
      return;
    }
    new DeleteAccountModal(this.app, this.store, account, () => this.scheduleRefresh(120)).open();
  }

  private async completePlan(plan: ExpensePlan): Promise<void> {
    try {
      await this.store.completeExpensePlan(plan);
      this.scheduleRefresh(120);
      new Notice(plan.completion === "create-expense"
        ? t("План выполнен, расход создан", "Plan completed and expense created")
        : t("План выполнен", "Plan completed"));
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Не удалось выполнить план", "Could not complete the plan"));
    }
  }

  private scheduleRefresh(delay = 80): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined;
      this.store.refresh();
    }, delay);
  }

  getAvailableCategories(): string[] {
    const index = this.store.getIndex();
    return [...new Set([
      ...this.settings.customCategories,
      ...index.transactions.filter((item) => item.kind === "expense").map((item) => item.category),
      ...index.plans.map((plan) => plan.category),
    ])]
      .sort((left, right) => left.localeCompare(right, this.settings.language));
  }

  getFinanceIndex(): FinanceIndex { return this.store.getIndex(); }

  openExcelImport(): void { new ExcelImportModal(this).open(); }

  exportFinanceExcel(template: boolean): void {
    try {
      const book = createFinanceWorkbook(this.store.getIndex(), this.getAvailableCategories(), template);
      const blob = new Blob([workbookToArray(book)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.body.createEl("a", { attr: { href: url, download: template ? "oxill-finance-import-template.xlsx" : `oxill-finance-${new Date().toISOString().slice(0, 10)}.xlsx` } });
      link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      new Notice(template ? t("Шаблон Excel скачан", "Excel template downloaded") : t("Данные экспортированы в Excel", "Data exported to Excel"));
    } catch (error) { new Notice(error instanceof Error ? error.message : t("Не удалось создать Excel-файл", "Could not create the Excel file")); }
  }

  async importFinanceExcel(preview: ExcelImportPreview): Promise<number> {
    for (const account of preview.accounts) await this.store.createAccount(account);
    for (const transaction of preview.transactions) await this.store.createTransaction(transaction);
    for (const transfer of preview.transfers) await this.store.createTransfer(transfer);
    for (const plan of preview.plans) await this.store.createExpensePlan(plan);
    this.settings.customCategories = [...new Set([...this.settings.customCategories, ...preview.categories])];
    await this.saveFinanceSettings();
    return preview.accounts.length + preview.transactions.length + preview.transfers.length + preview.plans.length;
  }

  async mergeCategory(source: string, target: string): Promise<void> {
    await this.store.moveCategory(source, target);
    this.settings.customCategories = this.settings.customCategories.filter((name) => name !== source);
    const sourceWasSelected = this.settings.selectedCategories.includes(source);
    this.settings.selectedCategories = this.settings.selectedCategories.filter((name) => name !== source);
    if (sourceWasSelected && !this.settings.selectedCategories.includes(target) && this.settings.selectedCategories.length < 7) {
      this.settings.selectedCategories.push(target);
    }
    await this.saveFinanceSettings();
  }

  async saveFinanceSettings(): Promise<void> {
    this.settings = normalizeFinanceSettings(this.settings);
    await this.saveData(this.settings);
    this.store.refresh();
  }

  private getStorageFolders(): FinanceStorageFolders {
    return {
      operations: this.settings.operationsFolder,
      accounts: this.settings.accountsFolder,
      planning: this.settings.planningFolder,
    };
  }
}
