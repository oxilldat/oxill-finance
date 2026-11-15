import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";

import { calculateSummary, getPeriodRange, selectCategorySlices } from "./core/finance";
import { normalizeAccountIcon } from "./core/account-icons";
import { splitDebtsByArchive, summarizeDebts } from "./core/debts";
import { summarizeDebtPlanning } from "./core/debts";
import { calculateMonthlyPlanningBudget } from "./core/planning";
import { calculateIncomeAllocation } from "./core/income-allocation";
import { formatMoney } from "./core/money";
import { monthPeriod } from "./core/month-summary";
import { renderAccuracy } from "./month-summary-modal";
import { TransactionStore } from "./transaction-store";
import { ExpensePlan, FinanceAccount, FinanceDebt, FinanceMonthSummary, FinanceSummary, FinanceTransaction, IncomePlan, PeriodKind, PlannedTransfer, TransactionKind } from "./types";
import { localeCode, t } from "./i18n";
import { ConnectedPerson } from "./person-network-connector";

export const VIEW_TYPE_FINANCE = "oxill-finance-dashboard";
type NavigationItem = "overview" | "accounts" | "debts" | "planning";
export type DebtPlanDirection = "pay" | "receive";
type RecentOperation = {
  kind: TransactionKind | "transfer";
  amount: number;
  date: Date;
  title: string;
  subtitle: string;
  file: FinanceTransaction["file"];
};
export interface FinanceViewActions {
  openTransaction: (kind: TransactionKind, accountId?: string) => void;
  createAccount: () => void;
  editAccount: (account: FinanceAccount) => void;
  transfer: (accountId?: string) => void;
  deleteAccount: (account: FinanceAccount) => void;
  reorderAccounts: (accountIds: string[]) => Promise<void>;
  createDebt: () => void;
  editDebt: (debt: FinanceDebt) => void;
  deleteDebt: (debt: FinanceDebt) => void;
  setDebtArchived: (debt: FinanceDebt, archived: boolean) => void;
  planDebtPayment: (direction: DebtPlanDirection, debtId?: string) => void;
  createPlan: (category?: string, dueDate?: Date, fundedByIncomePlanId?: string) => void;
  editPlan: (plan: ExpensePlan) => void;
  deletePlan: (plan: ExpensePlan) => void;
  completePlan: (plan: ExpensePlan) => void;
  createIncomePlan: () => void;
  editIncomePlan: (plan: IncomePlan) => void;
  deleteIncomePlan: (plan: IncomePlan) => void;
  completeIncomePlan: (plan: IncomePlan) => void;
  createPlannedTransfer: (dueDate?: Date, fundedByIncomePlanId?: string) => void;
  editPlannedTransfer: (plan: PlannedTransfer) => void;
  deletePlannedTransfer: (plan: PlannedTransfer) => void;
  completePlannedTransfer: (plan: PlannedTransfer) => void;
  setExpensePlanFunding: (plan: ExpensePlan, incomePlanId?: string) => void;
  setPlannedTransferFunding: (plan: PlannedTransfer, incomePlanId?: string) => void;
  ensureMonthSummary: (year: number, month: number) => void;
  openMonthSummary: (summary: FinanceMonthSummary) => void;
  selectedCategories: () => string[];
  availableCategories: () => string[];
  hiddenPlanningCategories: () => string[];
  connectedPerson: (path: string) => ConnectedPerson | undefined;
}
const PERIOD_SEQUENCE: PeriodKind[] = ["day", "week", "month", "quarter", "half-year", "year"];
function periodLabel(period: PeriodKind): string {
  const labels: Record<PeriodKind, string> = {
    day: t("День", "Day"), week: t("Неделя", "Week"), month: t("Месяц", "Month"),
    quarter: t("Квартал", "Quarter"), "half-year": t("Полгода", "Half-year"), year: t("Год", "Year"),
  };
  return labels[period];
}
export class FinanceView extends ItemView {
  private period: PeriodKind = "month";
  private anchorDate = new Date();
  private customRange?: { start: Date; end: Date };
  private calendarOpen = false;
  private calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  private calendarStart?: Date;
  private planningYear = new Date().getFullYear();
  private planningMonth = new Date().getMonth();
  private planningMonthPickerOpen = false;
  private planningYearOverview = false;
  private planningPanel: "expenses" | "transfers" | "income" = "expenses";
  private expenseFilterQuery = "";
  private expenseFilterCategory = "";
  private expenseFilterStatus: "all" | "planned" | "paid" = "all";
  private transferFilterQuery = "";
  private transferFilterAccountId = "";
  private transferFilterStatus: "all" | "planned" | "paid" = "all";
  private collapsedExpenseGroups = new Set<string>();
  private collapsedTransferGroups = new Set<string>();
  private draggedFundingItem?: { kind: "expense" | "transfer"; id: string };
  private expandedIncomeAllocations = new Set<string>();
  private unassignedAllocationOpen = true;
  private incomeAllocationPeriod?: string;
  private draggedAccountId?: string;
  private activeSection: NavigationItem = "overview";
  private debtArchiveOpen = false;
  private unsubscribe?: () => void;
  private resizeObserver?: ResizeObserver;
  private planningCompact = false;
  private planningNarrow = false;

  constructor(leaf: WorkspaceLeaf, private readonly store: TransactionStore, private readonly actions: FinanceViewActions) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_FINANCE; }
  getDisplayText(): string { return "Oxill Finance"; }
  getIcon(): string { return "chart-no-axes-combined"; }

  async onOpen(): Promise<void> {
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) return;
      this.updateResponsiveState(entry.contentRect.width);
    });
    this.resizeObserver.observe(this.contentEl);
    this.updateResponsiveState(this.contentEl.getBoundingClientRect().width);
    this.render();
  }
  async onClose(): Promise<void> { this.unsubscribe?.(); this.resizeObserver?.disconnect(); }

  private updateResponsiveState(width: number): void {
    const compact = this.planningCompact ? width < 1160 : width <= 1120;
    const narrow = this.planningNarrow ? width < 800 : width <= 760;
    if (compact === this.planningCompact && narrow === this.planningNarrow) return;
    this.planningCompact = compact;
    this.planningNarrow = narrow;
    this.applyResponsiveClasses();
  }

  private applyResponsiveClasses(): void {
    this.contentEl.toggleClass("is-planning-compact", this.planningCompact && !this.planningNarrow);
    this.contentEl.toggleClass("is-planning-narrow", this.planningNarrow);
    this.contentEl.toggleClass("is-planning-wide", !this.planningCompact && !this.planningNarrow);
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("oxf-view");
    this.applyResponsiveClasses();
    const layout = root.createDiv({ cls: "oxf-layout" });
    const main = layout.createEl("main", { cls: "oxf-main" });
    this.renderTopbar(main);
    if (this.activeSection === "accounts") {
      this.renderAccounts(main);
      this.renderIssues(main);
      return;
    }
    if (this.activeSection === "planning") {
      this.renderPlanning(main);
      this.renderIssues(main);
      return;
    }
    if (this.activeSection === "debts") {
      this.renderDebts(main);
      this.renderIssues(main);
      return;
    }
    const range = this.customRange ? { ...this.customRange, label: customRangeLabel(this.customRange.start, this.customRange.end) } : undefined;
    const summary = calculateSummary(this.store.getIndex().transactions, this.period, this.anchorDate, range);
    this.renderOverview(main, summary);
    this.renderIssues(main);
  }

  private renderTopbar(container: HTMLElement): void {
    const topbar = container.createDiv({ cls: "oxf-topbar" });
    const nav = topbar.createEl("nav", { attr: { "aria-label": t("Разделы финансов", "Finance sections") } });
    this.renderNavButton(nav, "overview", t("Обзор", "Overview"));
    this.renderNavButton(nav, "accounts", t("Счета", "Accounts"));
    this.renderNavButton(nav, "debts", t("Долги", "Debts"));
    this.renderNavButton(nav, "planning", t("Планирование", "Planning"));
    if (this.activeSection === "overview" || this.activeSection === "accounts") {
      const actions = topbar.createDiv({ cls: "oxf-topbar-actions" });
      this.renderPeriod(actions);
      if (this.activeSection === "accounts") {
        actions.createEl("button", { cls: "mod-cta oxf-create-account", text: t("+ Создать счёт", "+ Create account"), attr: { type: "button" } })
          .addEventListener("click", () => this.actions.createAccount());
      }
    } else if (this.activeSection === "planning") this.renderPlanningTopbarActions(topbar);
    else if (this.activeSection === "debts") this.renderDebtTopbarActions(topbar);
  }

  private renderPlanningTopbarActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "oxf-topbar-actions oxf-planning-actions" });
    const yearControl = actions.createDiv({ cls: "oxf-year-control" });
    const previous = yearControl.createEl("button", { attr: { type: "button", "aria-label": this.planningYearOverview ? t("Предыдущий год", "Previous year") : t("Предыдущий месяц", "Previous month") } });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => this.shiftPlanningMonth(-1));
    const selectedPeriod = this.planningYearOverview ? String(this.planningYear) : capitalize(new Intl.DateTimeFormat(localeCode(), { month: "long", year: "numeric" }).format(new Date(this.planningYear, this.planningMonth, 1)));
    yearControl.createEl("strong", { text: selectedPeriod });
    const next = yearControl.createEl("button", { attr: { type: "button", "aria-label": this.planningYearOverview ? t("Следующий год", "Next year") : t("Следующий месяц", "Next month") } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.shiftPlanningMonth(1));
    const monthPicker = yearControl.createEl("button", { cls: "oxf-month-picker-trigger", attr: { type: "button", "aria-label": t("Выбрать месяц", "Choose month"), "aria-expanded": String(this.planningMonthPickerOpen) } });
    setIcon(monthPicker, "calendar-days");
    monthPicker.addEventListener("click", () => { this.planningMonthPickerOpen = !this.planningMonthPickerOpen; this.render(); });
    if (this.planningMonthPickerOpen) this.renderPlanningMonthPicker(actions);
    const yearOverview = actions.createEl("button", { cls: this.planningYearOverview ? "is-active" : "", text: this.planningYearOverview ? t("Месяц", "Month") : t("Год", "Year"), attr: { type: "button" } });
    yearOverview.addEventListener("click", () => {
      this.planningYearOverview = !this.planningYearOverview;
      this.planningMonthPickerOpen = false;
      this.render();
    });
    actions.createEl("button", { cls: "mod-cta", text: t("+ Запланировать", "+ Plan"), attr: { type: "button" } })
      .addEventListener("click", (event) => this.showPlanningCreateMenu(event));
  }

  private renderDebtTopbarActions(container: HTMLElement): void {
    const actions = container.createDiv({ cls: "oxf-topbar-actions oxf-debt-heading-actions" });
    const archive = actions.createEl("button", {
      cls: `oxf-debt-archive-toggle${this.debtArchiveOpen ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-label": this.debtArchiveOpen ? t("Вернуться к активным долгам", "Return to active debts") : t("Архив долгов", "Debt archive"),
        title: this.debtArchiveOpen ? t("Активные долги", "Active debts") : t("Архив долгов", "Debt archive"),
        "aria-pressed": String(this.debtArchiveOpen),
      },
    });
    setIcon(archive, this.debtArchiveOpen ? "archive-restore" : "archive");
    archive.addEventListener("click", () => { this.debtArchiveOpen = !this.debtArchiveOpen; this.render(); });
    actions.createEl("button", { cls: "mod-cta", text: t("+ Добавить долг", "+ Add debt"), attr: { type: "button" } })
      .addEventListener("click", () => this.actions.createDebt());
  }

  private renderNavButton(container: HTMLElement, value: NavigationItem, label: string): void {
    const button = container.createEl("button", { cls: this.activeSection === value ? "is-active" : "", text: label, attr: { type: "button" } });
    button.addEventListener("click", () => { this.activeSection = value; this.render(); });
  }

  private renderPeriod(container: HTMLElement): void {
    const controls = container.createDiv({ cls: "oxf-period-control" });
    const previous = controls.createEl("button", { attr: { type: "button", "aria-label": t("Предыдущий масштаб периода", "Previous period scale") } });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => this.cyclePeriod(-1));
    controls.createSpan({ cls: "oxf-period-label", text: this.getPeriodLabel() });
    const next = controls.createEl("button", { attr: { type: "button", "aria-label": t("Следующий масштаб периода", "Next period scale") } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => this.cyclePeriod(1));
    const calendar = controls.createEl("button", {
      cls: `oxf-calendar-button${this.customRange ? " is-clear" : ""}`,
      attr: { type: "button", "aria-label": this.customRange ? t("Сбросить выбранный период", "Reset selected period") : t("Выбрать период", "Select period") },
    });
    setIcon(calendar, this.customRange ? "calendar-x" : "calendar-days");
    calendar.addEventListener("click", () => {
      if (this.customRange) {
        this.customRange = undefined;
        this.calendarStart = undefined;
        this.calendarOpen = false;
        this.anchorDate = new Date();
        this.render();
        return;
      }
      const opening = !this.calendarOpen;
      this.calendarOpen = opening;
      if (opening) {
        const visibleDate = this.calendarStart ?? this.anchorDate;
        this.calendarMonth = new Date(visibleDate.getFullYear(), visibleDate.getMonth(), 1);
      }
      this.render();
    });
    if (this.calendarOpen) this.renderCalendarPicker(controls);
  }

  private cyclePeriod(direction: -1 | 1): void {
    const currentIndex = this.customRange ? PERIOD_SEQUENCE.indexOf("month") : PERIOD_SEQUENCE.indexOf(this.period);
    const nextIndex = (currentIndex + direction + PERIOD_SEQUENCE.length) % PERIOD_SEQUENCE.length;
    this.period = PERIOD_SEQUENCE[nextIndex] ?? "month";
    this.anchorDate = new Date();
    this.customRange = undefined;
    this.calendarOpen = false;
    this.render();
  }

  private getPeriodLabel(): string {
    if (this.customRange) return customRangeLabel(this.customRange.start, this.customRange.end);
    return periodLabel(this.period);
  }

  private renderCalendarPicker(container: HTMLElement): void {
    const picker = container.createDiv({ cls: "oxf-calendar-picker" });
    const heading = picker.createDiv({ cls: "oxf-calendar-heading" });
    const previous = heading.createEl("button", { attr: { type: "button", "aria-label": t("Предыдущий месяц", "Previous month") } });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => {
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
      this.render();
    });
    heading.createEl("strong", { text: capitalize(new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(this.calendarMonth)) });
    const next = heading.createEl("button", { attr: { type: "button", "aria-label": t("Следующий месяц", "Next month") } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => {
      this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
      this.render();
    });
    const weekdays = picker.createDiv({ cls: "oxf-calendar-weekdays" });
    for (const label of t("Пн,Вт,Ср,Чт,Пт,Сб,Вс", "Mon,Tue,Wed,Thu,Fri,Sat,Sun").split(",")) weekdays.createSpan({ text: label });
    const days = picker.createDiv({ cls: "oxf-calendar-days" });
    const offset = (this.calendarMonth.getDay() + 6) % 7;
    for (let index = 0; index < offset; index += 1) days.createSpan();
    const count = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= count; day += 1) {
      const date = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth(), day);
      const classes = ["oxf-calendar-day"];
      if (this.calendarStart && sameDay(date, this.calendarStart)) classes.push("is-selected");
      if (this.customRange && date >= startOfDay(this.customRange.start) && date <= startOfDay(this.customRange.end)) classes.push("is-in-range");
      const button = days.createEl("button", { cls: classes.join(" "), text: String(day), attr: { type: "button" } });
      button.addEventListener("click", () => this.selectCalendarDate(date));
    }
    picker.createEl("p", { text: this.calendarStart ? t("Выберите конец периода", "Select the end date") : t("Выберите начало периода", "Select the start date") });
  }

  private selectCalendarDate(date: Date): void {
    if (!this.calendarStart) {
      this.calendarStart = date;
      this.render();
      return;
    }
    const start = date < this.calendarStart ? date : this.calendarStart;
    const endDate = date < this.calendarStart ? this.calendarStart : date;
    this.customRange = { start: startOfDay(start), end: endOfDay(endDate) };
    this.calendarStart = undefined;
    this.calendarOpen = false;
    this.render();
  }

  private renderOverview(container: HTMLElement, summary: FinanceSummary): void {
    this.renderFinanceHero(container, summary);
    const context = container.createDiv({ cls: "oxf-context-grid" });
    this.renderCategoryCard(context, summary);
    this.renderAccountsSnapshot(context);
    const operations = container.createEl("section", { cls: "oxf-overview-section" });
    const index = this.store.getIndex();
    const accountNames = new Map(index.accounts.map((account) => [account.id, account.name]));
    const range = this.customRange ?? getPeriodRange(this.period, this.anchorDate);
    const recentOperations: RecentOperation[] = [
      ...summary.transactions.map((transaction) => ({
        kind: transaction.kind,
        amount: transaction.amount,
        date: transaction.date,
        title: transaction.comment?.trim() || t("Без комментария", "No comment"),
        subtitle: transaction.category,
        file: transaction.file,
      })),
      ...index.transfers
        .filter((transfer) => transfer.date >= range.start && transfer.date <= range.end)
        .map((transfer) => ({
          kind: "transfer" as const,
          amount: transfer.amount,
          date: transfer.date,
          title: transfer.comment?.trim() || t("Перевод между счетами", "Account transfer"),
          subtitle: `${accountNames.get(transfer.fromAccountId) ?? t("Неизвестный счёт", "Unknown account")} → ${accountNames.get(transfer.toAccountId) ?? t("Неизвестный счёт", "Unknown account")}`,
          file: transfer.file,
        })),
    ].sort((left, right) => right.date.getTime() - left.date.getTime()).slice(0, 20);
    this.renderRecentOperations(operations, recentOperations);
  }

  private renderFinanceHero(container: HTMLElement, summary: FinanceSummary): void {
    const hero = container.createEl("section", { cls: "oxf-card oxf-finance-hero" });
    const content = hero.createDiv({ cls: "oxf-hero-content" });
    content.createEl("strong", { cls: "oxf-hero-balance", text: `${money(summary.balance)} ₽` });
    const net = summary.income - summary.expense;
    content.createEl("p", { text: `${summary.label}: ${net >= 0 ? "+" : "−"}${money(Math.abs(net))} ₽` });

    if (summary.income > 0 || summary.expense > 0) {
      const metrics = hero.createDiv({ cls: `oxf-hero-metrics${summary.income === 0 || summary.expense === 0 ? " has-one" : ""}` });
      if (summary.income > 0) this.renderHeroMetric(metrics, t("Доходы", "Income"), summary.income, "is-income");
      if (summary.expense > 0) this.renderHeroMetric(metrics, t("Расходы", "Expenses"), summary.expense, "is-expense");
    }

    const actions = hero.createDiv({ cls: "oxf-quick-actions" });
    this.renderQuickAction(actions, "+", t("Расход", "Expense"), () => this.actions.openTransaction("expense"));
    this.renderQuickAction(actions, "+", t("Доход", "Income"), () => this.actions.openTransaction("income"));
    const transfer = this.renderQuickAction(actions, "⇄", t("Перевод", "Transfer"), () => this.actions.transfer());
    transfer.disabled = this.store.getIndex().accounts.length < 2;
  }

  private renderHeroMetric(container: HTMLElement, label: string, value: number, className: string): void {
    const metric = container.createDiv({ cls: `oxf-hero-metric ${className}` });
    metric.createSpan({ text: label });
    metric.createEl("strong", { text: `${money(value)} ₽` });
  }

  private renderQuickAction(container: HTMLElement, icon: string, label: string, callback: () => void): HTMLButtonElement {
    const button = container.createEl("button", { attr: { type: "button", "aria-label": label } });
    button.createSpan({ cls: "oxf-quick-action-icon", text: icon });
    button.createSpan({ text: label });
    button.addEventListener("click", callback);
    return button;
  }

  private renderCategoryCard(container: HTMLElement, summary: FinanceSummary): void {
    const card = container.createEl("section", { cls: "oxf-card oxf-category-card" });
    const heading = card.createDiv({ cls: "oxf-card-heading" });
    heading.createEl("strong", { text: t("Категории", "Categories") });
    heading.createSpan({ text: t(`${money(summary.expense)} ₽ расходов`, `${money(summary.expense)} ₽ spent`) });
    const slices = selectCategorySlices(summary.categories, this.actions.selectedCategories());
    if (slices.length === 0) {
      card.createEl("p", { text: t("Добавьте расходы, чтобы увидеть распределение по категориям.", "Add expenses to see the category breakdown.") });
      return;
    }
    const body = card.createDiv({ cls: "oxf-category-body" });
    const donut = body.createDiv({ cls: "oxf-category-donut", attr: { "aria-label": t("Распределение расходов по категориям", "Expense breakdown by category") } });
    const colors = categoryColors();
    let cursor = 0;
    const stops = slices.map((slice, index) => {
      const start = cursor;
      cursor += slice.share * 100;
      return `${colors[index] ?? colors[0]} ${start}% ${cursor}%`;
    });
    donut.setCssProps({ background: `conic-gradient(${stops.join(",")})` });
    const center = donut.createDiv();
    center.createSpan({ text: t("Расходы", "Expenses") });
    center.createEl("strong", { text: `${money(summary.expense)} ₽` });
    const legend = body.createDiv({ cls: "oxf-category-legend" });
    slices.forEach((slice, index) => {
      const row = legend.createDiv();
      const label = row.createDiv();
      label.createSpan({ cls: `oxf-category-marker is-color-${index + 1}` });
      label.createSpan({ text: slice.name });
      row.createEl("strong", { text: `${Math.round(slice.share * 100)}%` });
    });
  }

  private renderAccountsSnapshot(container: HTMLElement): void {
    const accounts = this.store.getIndex().accounts;
    const card = container.createEl("section", { cls: "oxf-card oxf-accounts-snapshot" });
    const heading = card.createDiv({ cls: "oxf-card-heading" });
    heading.createEl("strong", { text: t("Счета", "Accounts") });
    const open = heading.createEl("button", { text: t("Все счета", "All accounts"), attr: { type: "button" } });
    open.addEventListener("click", () => { this.activeSection = "accounts"; this.render(); });
    if (accounts.length === 0) {
      card.createEl("p", { text: t("Создайте первый счёт, чтобы распределять средства.", "Create your first account to allocate funds.") });
      return;
    }
    const list = card.createDiv({ cls: "oxf-snapshot-list" });
    for (const account of accounts.slice(0, 4)) {
      const row = list.createDiv();
      const icon = row.createSpan({ cls: "oxf-snapshot-icon" });
      setIcon(icon, normalizeAccountIcon(account.icon));
      row.createSpan({ text: account.name });
      row.createEl("strong", { text: `${money(account.balance)} ₽` });
    }
  }
  private renderAccounts(container: HTMLElement): void {
    const accounts = this.store.getIndex().accounts;
    if (accounts.length === 0) {
      const empty = container.createDiv({ cls: "oxf-card oxf-accounts-empty" });
      empty.createEl("strong", { text: t("Счетов пока нет", "No accounts yet") });
      empty.createEl("p", { text: t("Создайте первый счёт, затем пополните его через доход.", "Create your first account, then fund it with an income transaction.") });
      return;
    }

    const grid = container.createDiv({ cls: "oxf-account-grid" });
    grid.addEventListener("dragover", (event) => {
      if (!this.draggedAccountId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      const target = (event.target as HTMLElement).closest<HTMLElement>(".oxf-account-card");
      if (target && target.dataset.accountId !== this.draggedAccountId) this.previewAccountOrder(grid, target, event);
    });
    grid.addEventListener("drop", (event) => {
      if (!this.draggedAccountId) return;
      event.preventDefault();
      const target = (event.target as HTMLElement).closest<HTMLElement>(".oxf-account-card");
      if (target && target.dataset.accountId !== this.draggedAccountId) this.previewAccountOrder(grid, target, event);
      const ids = Array.from(grid.querySelectorAll<HTMLElement>(".oxf-account-card"))
        .map((item) => item.dataset.accountId)
        .filter((id): id is string => Boolean(id));
      this.draggedAccountId = undefined;
      this.clearAccountDropIndicators(grid);
      void this.actions.reorderAccounts(ids);
    });
    for (const account of accounts) this.renderAccountCard(grid, account, accounts);
  }

  private renderPlanning(container: HTMLElement): void {
    const index = this.store.getIndex();
    const inSelectedMonth = (date: Date): boolean => date.getFullYear() === this.planningYear && date.getMonth() === this.planningMonth;
    const inSelectedYear = (date: Date): boolean => date.getFullYear() === this.planningYear;
    const hiddenCategories = this.actions.hiddenPlanningCategories();
    const yearPlans = index.plans.filter((plan) => inSelectedYear(plan.dueDate) && !hiddenCategories.includes(plan.category));
    const yearIncomePlans = index.incomePlans.filter((plan) => inSelectedYear(plan.dueDate));
    const yearTransfers = index.plannedTransfers.filter((plan) => inSelectedYear(plan.dueDate));
    const monthPlans = yearPlans.filter((plan) => inSelectedMonth(plan.dueDate));
    const monthIncomePlans = index.incomePlans.filter((plan) => inSelectedMonth(plan.dueDate));
    const monthTransfers = index.plannedTransfers.filter((plan) => inSelectedMonth(plan.dueDate));
    const budget = calculateMonthlyPlanningBudget(
      this.planningYearOverview ? yearPlans : monthPlans,
      this.planningYearOverview ? yearIncomePlans : monthIncomePlans,
      this.planningYearOverview ? yearTransfers : monthTransfers,
    );
    const monthSummary = index.monthSummaries.find((item) => item.period === monthPeriod(this.planningYear, this.planningMonth));
    const hasActualOperations = index.transactions.some((item) => inSelectedMonth(item.date) && (item.kind === "income" || item.kind === "expense"));
    if (!this.planningYearOverview && !monthSummary && hasActualOperations) this.actions.ensureMonthSummary(this.planningYear, this.planningMonth);

    const actualYearIncome = index.transactions.filter((item) => inSelectedYear(item.date) && item.kind === "income").reduce((sum, item) => sum + item.amount, 0);
    const actualYearExpenses = index.transactions.filter((item) => inSelectedYear(item.date) && item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
    this.renderPlanningOverview(container, budget, this.planningYearOverview ? undefined : monthSummary, this.planningYearOverview ? { income: actualYearIncome, expenses: actualYearExpenses } : undefined);
    if (this.planningYearOverview) {
      this.renderPlanningHeatmap(container, yearPlans, yearIncomePlans, yearTransfers);
      return;
    }
    const listToolbar = container.createDiv({ cls: "oxf-planning-list-toolbar" });
    const tabs = listToolbar.createDiv({ cls: "oxf-planning-tabs" });
    for (const [value, label] of [
      ["expenses", t("Расходы", "Expenses")],
      ["transfers", t("Переводы", "Transfers")],
      ["income", t("По доходам", "By income")],
    ] as const) {
      const tab = tabs.createEl("button", { cls: this.planningPanel === value ? "is-active" : "", text: label, attr: { type: "button" } });
      tab.addEventListener("click", () => { this.planningPanel = value; this.render(); });
    }
    const workspace = container.createDiv({ cls: "oxf-month-planner" });
    const renderActivePanel = (): void => {
      workspace.empty();
      if (this.planningPanel === "expenses") {
        const filtered = this.filterExpensePlans(monthPlans);
        this.renderMonthlyExpenses(workspace, filtered, filtered.length !== monthPlans.length);
      } else if (this.planningPanel === "transfers") {
        const filtered = this.filterPlannedTransfers(monthTransfers);
        this.renderMonthlyTransfers(workspace, filtered, filtered.length !== monthTransfers.length);
      } else {
        this.renderIncomeAllocation(workspace, monthIncomePlans, monthPlans, monthTransfers);
      }
    };
    if (this.planningPanel === "expenses" || this.planningPanel === "transfers") {
      this.renderPlanningListFilters(listToolbar, monthPlans, monthTransfers, renderActivePanel);
    }
    renderActivePanel();
  }

  private renderPlanningListFilters(
    container: HTMLElement,
    expenses: ExpensePlan[],
    transfers: PlannedTransfer[],
    refresh: () => void,
  ): void {
    const filters = container.createDiv({ cls: "oxf-planning-list-filters" });
    const isExpenses = this.planningPanel === "expenses";
    const searchBox = filters.createDiv({ cls: "oxf-planning-filter-search" });
    const searchIcon = searchBox.createSpan();
    setIcon(searchIcon, "search");
    const query = searchBox.createEl("input", {
      attr: {
        type: "search",
        value: isExpenses ? this.expenseFilterQuery : this.transferFilterQuery,
        placeholder: t("Поиск", "Search"),
        "aria-label": t("Поиск по планам", "Search plans"),
      },
    });
    query.addEventListener("input", () => {
      if (isExpenses) this.expenseFilterQuery = query.value;
      else this.transferFilterQuery = query.value;
      updateResetState();
      refresh();
    });

    const groupOptions: Array<{ value: string; label: string }> = [{ value: "", label: isExpenses ? t("Все категории", "All categories") : t("Все счета", "All accounts") }];
    if (isExpenses) {
      for (const category of [...new Set(expenses.map((plan) => plan.category))].sort((left, right) => left.localeCompare(right, localeCode()))) {
        groupOptions.push({ value: category, label: category });
      }
    } else {
      const accountNames = new Map(this.store.getIndex().accounts.map((account) => [account.id, account.name]));
      const ids = [...new Set(transfers.map((plan) => plan.fromAccountId))]
        .sort((left, right) => (accountNames.get(left) ?? left).localeCompare(accountNames.get(right) ?? right, localeCode()));
      for (const id of ids) groupOptions.push({ value: id, label: accountNames.get(id) ?? t("Неизвестный счёт", "Unknown account") });
    }
    this.createPlanningFilterMenu(
      filters,
      groupOptions,
      isExpenses ? this.expenseFilterCategory : this.transferFilterAccountId,
      isExpenses ? t("Категория", "Category") : t("Исходный счёт", "Source account"),
      (value) => {
        if (isExpenses) this.expenseFilterCategory = value;
        else this.transferFilterAccountId = value;
        updateResetState();
        refresh();
      },
    );

    const statusOptions = [
      { value: "all", label: t("Все статусы", "All statuses") },
      { value: "planned", label: t("Предстоит", "Upcoming") },
      { value: "paid", label: t("Выполнено", "Completed") },
    ];
    this.createPlanningFilterMenu(
      filters,
      statusOptions,
      isExpenses ? this.expenseFilterStatus : this.transferFilterStatus,
      t("Статус", "Status"),
      (value) => {
        const status = value as "all" | "planned" | "paid";
        if (isExpenses) this.expenseFilterStatus = status;
        else this.transferFilterStatus = status;
        updateResetState();
        refresh();
      },
    );

    const reset = filters.createEl("button", {
      cls: "oxf-planning-filter-reset",
      attr: { type: "button", "aria-label": t("Сбросить фильтр", "Reset filter") },
    });
    setIcon(reset, "x");
    const updateResetState = (): void => {
      const hasFilter = isExpenses
        ? Boolean(this.expenseFilterQuery || this.expenseFilterCategory || this.expenseFilterStatus !== "all")
        : Boolean(this.transferFilterQuery || this.transferFilterAccountId || this.transferFilterStatus !== "all");
      reset.toggleClass("is-visible", hasFilter);
      reset.disabled = !hasFilter;
    };
    updateResetState();
    reset.addEventListener("click", () => {
      if (isExpenses) {
        this.expenseFilterQuery = "";
        this.expenseFilterCategory = "";
        this.expenseFilterStatus = "all";
      } else {
        this.transferFilterQuery = "";
        this.transferFilterAccountId = "";
        this.transferFilterStatus = "all";
      }
      this.render();
    });
  }

  private createPlanningFilterMenu(
    container: HTMLElement,
    options: Array<{ value: string; label: string }>,
    selectedValue: string,
    ariaLabel: string,
    onSelect: (value: string) => void,
  ): HTMLButtonElement {
    const selected = options.find((option) => option.value === selectedValue) ?? options[0];
    const button = container.createEl("button", {
      cls: "oxf-planning-filter-menu",
      attr: { type: "button", "aria-label": ariaLabel, "aria-haspopup": "menu" },
    });
    const label = button.createSpan({ text: selected?.label ?? "" });
    const chevron = button.createSpan();
    setIcon(chevron, "chevron-down");
    button.addEventListener("click", (event) => {
      const menu = new Menu();
      for (const option of options) {
        menu.addItem((item) => item
          .setTitle(option.label)
          .setChecked(option.value === selectedValue)
          .onClick(() => {
            selectedValue = option.value;
            label.setText(option.label);
            onSelect(option.value);
          }));
      }
      menu.showAtMouseEvent(event);
    });
    return button;
  }

  private filterExpensePlans(plans: ExpensePlan[]): ExpensePlan[] {
    const query = this.expenseFilterQuery.trim().toLocaleLowerCase(localeCode());
    return plans.filter((plan) =>
      (!query || `${plan.title} ${plan.category}`.toLocaleLowerCase(localeCode()).includes(query))
      && (!this.expenseFilterCategory || plan.category === this.expenseFilterCategory)
      && (this.expenseFilterStatus === "all" || plan.status === this.expenseFilterStatus));
  }

  private filterPlannedTransfers(plans: PlannedTransfer[]): PlannedTransfer[] {
    const query = this.transferFilterQuery.trim().toLocaleLowerCase(localeCode());
    const accountNames = new Map(this.store.getIndex().accounts.map((account) => [account.id, account.name]));
    return plans.filter((plan) =>
      (!query || `${accountNames.get(plan.fromAccountId) ?? ""} ${accountNames.get(plan.toAccountId) ?? ""}`.toLocaleLowerCase(localeCode()).includes(query))
      && (!this.transferFilterAccountId || plan.fromAccountId === this.transferFilterAccountId)
      && (this.transferFilterStatus === "all" || plan.status === this.transferFilterStatus));
  }

  private shiftPlanningMonth(delta: number): void {
    if (this.planningYearOverview) {
      this.planningYear += delta;
      this.planningMonthPickerOpen = false;
      this.render();
      return;
    }
    const next = new Date(this.planningYear, this.planningMonth + delta, 1);
    this.planningYear = next.getFullYear();
    this.planningMonth = next.getMonth();
    this.planningMonthPickerOpen = false;
    this.planningYearOverview = false;
    this.render();
  }

  private renderPlanningOverview(container: HTMLElement, budget: ReturnType<typeof calculateMonthlyPlanningBudget>, summary?: FinanceMonthSummary, annualActual?: { income: number; expenses: number }): void {
    const card = container.createDiv({ cls: "oxf-card oxf-planning-overview" });
    const metrics = card.createDiv({ cls: "oxf-planning-overview-metrics" });
    for (const [label, value, className] of [
      [t("Доходы", "Income"), budget.income, "is-income"],
      [t("Расходы", "Expenses"), budget.expenses, "is-expense"],
      [t("Переводы", "Transfers"), budget.transfers, "is-transfer"],
      [t("Свободно", "Free"), budget.free, budget.free < 0 ? "is-danger" : "is-free"],
    ] as const) {
      const metric = metrics.createDiv({ cls: `oxf-planning-overview-metric ${className}` });
      metric.createSpan({ text: label });
      metric.createEl("strong", { text: `${money(value)} ₽` });
    }
    const fact = card.createDiv({ cls: `oxf-planning-overview-fact${summary ? " is-ready" : ""}` });
    fact.createEl("strong", { text: annualActual ? t("Факт за год", "Actual for year") : t("Факт", "Actual") });
    if (annualActual) {
      fact.createEl("b", { text: `${money(annualActual.income - annualActual.expenses)} ₽` });
      fact.createSpan({ text: `${t("Доходы", "Income")} +${money(annualActual.income)} ₽ · ${t("Расходы", "Expenses")} −${money(annualActual.expenses)} ₽` });
      return;
    }
    if (summary) {
      renderAccuracy(fact, summary);
      fact.addEventListener("click", () => this.actions.openMonthSummary(summary));
      fact.setAttr("role", "button");
      fact.setAttr("tabindex", "0");
      fact.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") this.actions.openMonthSummary(summary); });
      return;
    }
    fact.createEl("span", { text: t("Появится после первой операции", "Appears after the first operation") });
  }

  private renderPlanningMonthPicker(container: HTMLElement): void {
    const picker = container.createDiv({ cls: "oxf-month-picker" });
    picker.createEl("strong", { text: String(this.planningYear) });
    const grid = picker.createDiv({ cls: "oxf-month-picker-grid" });
    const formatter = new Intl.DateTimeFormat(localeCode(), { month: "short" });
    for (let month = 0; month < 12; month += 1) {
      const button = grid.createEl("button", {
        cls: month === this.planningMonth ? "is-active" : "",
        text: capitalize(formatter.format(new Date(2020, month, 1)).replace(".", "")),
        attr: { type: "button" },
      });
      button.addEventListener("click", () => {
        this.planningMonth = month;
        this.planningMonthPickerOpen = false;
        this.planningYearOverview = false;
        this.render();
      });
    }
  }

  private renderMonthlyExpenses(container: HTMLElement, plans: ExpensePlan[], isFiltered = false): void {
    const card = container.createDiv({ cls: "oxf-card oxf-month-expenses" });
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t("Расходы месяца", "Monthly expenses") });
    headingText.createSpan({ text: t(`${plans.length} планов · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`, `${plans.length} plans · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`) });
    const add = heading.createEl("button", { attr: { type: "button", "aria-label": t("Добавить расход", "Add expense") } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.actions.createPlan(undefined, new Date(this.planningYear, this.planningMonth, 1, 12)));
    if (plans.length === 0) {
      card.createEl("p", { cls: "oxf-month-planner-empty", text: isFiltered ? t("По фильтру ничего не найдено.", "No matching plans found.") : t("На этот месяц расходов пока нет.", "There are no expenses planned for this month.") });
      return;
    }
    const grouped = new Map<string, ExpensePlan[]>();
    for (const plan of plans) grouped.set(plan.category, [...(grouped.get(plan.category) ?? []), plan]);
    const categories = card.createDiv({ cls: "oxf-month-expense-groups" });
    for (const [category, categoryPlans] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, localeCode()))) {
      const isCollapsed = this.collapsedExpenseGroups.has(category);
      const group = categories.createEl("section", { cls: `oxf-month-expense-group${isCollapsed ? "" : " is-open"}` });
      const groupHeading = group.createEl("button", { cls: "oxf-month-expense-group-heading", attr: { type: "button", "aria-expanded": String(!isCollapsed) } });
      const chevron = groupHeading.createSpan({ cls: "oxf-month-expense-group-chevron" });
      setIcon(chevron, "chevron-right");
      const identity = groupHeading.createDiv();
      identity.createEl("strong", { text: category });
      identity.createSpan({ text: t(`${categoryPlans.length} платежей`, `${categoryPlans.length} payments`) });
      groupHeading.createEl("b", { text: `${money(categoryPlans.reduce((sum, plan) => sum + plan.amount, 0))} ₽` });
      groupHeading.addEventListener("click", () => {
        if (isCollapsed) this.collapsedExpenseGroups.delete(category);
        else this.collapsedExpenseGroups.add(category);
        this.render();
      });
      if (isCollapsed) continue;
      for (const plan of categoryPlans.sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) {
        const row = group.createDiv({ cls: `oxf-month-plan-row${plan.status === "paid" ? " is-paid" : ""}` });
        const check = row.createEl("button", { attr: { type: "button", "aria-label": plan.status === "paid" ? t("Выполнено", "Completed") : t("Выполнить", "Complete") } });
        setIcon(check, plan.status === "paid" ? "circle-check-big" : "circle");
        check.disabled = plan.status === "paid";
        if (plan.status === "planned") check.addEventListener("click", () => this.actions.completePlan(plan));
        const text = row.createDiv();
        text.createEl("strong", { text: plan.title });
        text.createSpan({ text: new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "long" }).format(plan.dueDate) });
        row.createEl("b", { text: `${money(plan.amount)} ₽` });
        const more = row.createEl("button", { attr: { type: "button", "aria-label": t("Действия с планом", "Plan actions") } });
        setIcon(more, "ellipsis");
        more.addEventListener("click", (event) => this.showPlanMenu(event, plan));
      }
    }
  }

  private renderMonthlyTransfers(container: HTMLElement, plans: PlannedTransfer[], isFiltered = false): void {
    const card = container.createDiv({ cls: "oxf-card oxf-month-expenses" });
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t("Переводы месяца", "Monthly transfers") });
    headingText.createSpan({ text: t(`${plans.length} переводов · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`, `${plans.length} transfers · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`) });
    const add = heading.createEl("button", { attr: { type: "button", "aria-label": t("Добавить перевод", "Add transfer") } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.actions.createPlannedTransfer(new Date(this.planningYear, this.planningMonth, 1, 12)));
    if (plans.length === 0) {
      card.createEl("p", { cls: "oxf-month-planner-empty", text: isFiltered ? t("По фильтру ничего не найдено.", "No matching plans found.") : t("На этот месяц переводов пока нет.", "There are no transfers planned for this month.") });
      return;
    }
    const accountNames = new Map(this.store.getIndex().accounts.map((account) => [account.id, account.name]));
    const unknownAccount = t("Неизвестный счёт", "Unknown account");
    const grouped = new Map<string, PlannedTransfer[]>();
    for (const plan of plans) grouped.set(plan.fromAccountId, [...(grouped.get(plan.fromAccountId) ?? []), plan]);
    const groups = card.createDiv({ cls: "oxf-month-expense-groups" });
    for (const [accountId, accountPlans] of [...grouped.entries()].sort(([left], [right]) =>
      (accountNames.get(left) ?? unknownAccount).localeCompare(accountNames.get(right) ?? unknownAccount, localeCode()))) {
      const isCollapsed = this.collapsedTransferGroups.has(accountId);
      const group = groups.createEl("section", { cls: `oxf-month-expense-group${isCollapsed ? "" : " is-open"}` });
      const groupHeading = group.createEl("button", { cls: "oxf-month-expense-group-heading", attr: { type: "button", "aria-expanded": String(!isCollapsed) } });
      const chevron = groupHeading.createSpan({ cls: "oxf-month-expense-group-chevron" });
      setIcon(chevron, "chevron-right");
      const identity = groupHeading.createDiv();
      identity.createEl("strong", { text: accountNames.get(accountId) ?? unknownAccount });
      identity.createSpan({ text: t(`${accountPlans.length} переводов`, `${accountPlans.length} transfers`) });
      groupHeading.createEl("b", { text: `${money(accountPlans.reduce((sum, plan) => sum + plan.amount, 0))} ₽` });
      groupHeading.addEventListener("click", () => {
        if (isCollapsed) this.collapsedTransferGroups.delete(accountId);
        else this.collapsedTransferGroups.add(accountId);
        this.render();
      });
      if (isCollapsed) continue;
      for (const plan of accountPlans.sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) {
        const row = group.createDiv({ cls: `oxf-month-plan-row is-transfer${plan.status === "paid" ? " is-paid" : ""}` });
        const check = row.createEl("button", { attr: { type: "button", "aria-label": plan.status === "paid" ? t("Выполнено", "Completed") : t("Выполнить", "Complete") } });
        setIcon(check, plan.status === "paid" ? "circle-check-big" : "circle");
        check.disabled = plan.status === "paid";
        if (plan.status === "planned") check.addEventListener("click", () => this.actions.completePlannedTransfer(plan));
        const text = row.createDiv();
        text.createEl("strong", { text: `${accountNames.get(plan.fromAccountId) ?? unknownAccount} → ${accountNames.get(plan.toAccountId) ?? unknownAccount}` });
        text.createSpan({ text: new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "long" }).format(plan.dueDate) });
        row.createEl("b", { text: `${money(plan.amount)} ₽` });
        const more = row.createEl("button", { attr: { type: "button", "aria-label": t("Действия с переводом", "Transfer actions") } });
        setIcon(more, "ellipsis");
        more.addEventListener("click", (event) => {
          const menu = new Menu();
          menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => this.actions.editPlannedTransfer(plan)));
          menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => this.actions.deletePlannedTransfer(plan)));
          menu.showAtMouseEvent(event);
        });
      }
    }
  }

  private renderIncomeAllocation(container: HTMLElement, incomes: IncomePlan[], expenses: ExpensePlan[], transfers: PlannedTransfer[]): void {
    const card = container.createDiv({ cls: "oxf-card oxf-income-allocation" });
    const assignedIncomeIds = new Set(incomes.map((income) => income.id));
    const unassignedExpenses = expenses.filter((plan) => !plan.fundedByIncomePlanId || !assignedIncomeIds.has(plan.fundedByIncomePlanId));
    const unassignedTransfers = transfers.filter((plan) => !plan.fundedByIncomePlanId || !assignedIncomeIds.has(plan.fundedByIncomePlanId));
    const allocated = expenses.filter((plan) => plan.fundedByIncomePlanId && assignedIncomeIds.has(plan.fundedByIncomePlanId)).reduce((sum, plan) => sum + plan.amount, 0)
      + transfers.filter((plan) => plan.fundedByIncomePlanId && assignedIncomeIds.has(plan.fundedByIncomePlanId)).reduce((sum, plan) => sum + plan.amount, 0);
    const incomeTotal = incomes.reduce((sum, income) => sum + income.amount, 0);
    const period = `${this.planningYear}-${this.planningMonth}`;
    if (this.incomeAllocationPeriod !== period) {
      this.incomeAllocationPeriod = period;
      this.expandedIncomeAllocations.clear();
      if (incomes[0]) this.expandedIncomeAllocations.add(incomes[0].id);
      this.unassignedAllocationOpen = true;
    }
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t("Распределение доходов", "Income allocation") });
    headingText.createSpan({ text: `${t("Нераспределено", "Unallocated")}: ${money(incomeTotal - allocated)} ₽` });
    if (incomes.length === 0) {
      card.createEl("p", { cls: "oxf-month-planner-empty", text: t("Сначала запланируйте доход на этот месяц.", "Plan an income for this month first.") });
      return;
    }
    const groups = card.createDiv({ cls: "oxf-income-allocation-groups" });
    for (const income of [...incomes].sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) {
      const incomeExpenses = expenses.filter((plan) => plan.fundedByIncomePlanId === income.id);
      const incomeTransfers = transfers.filter((plan) => plan.fundedByIncomePlanId === income.id);
      this.renderIncomeAllocationGroup(groups, income, incomeExpenses, incomeTransfers, incomes);
    }
    if (unassignedExpenses.length > 0 || unassignedTransfers.length > 0) {
      this.renderUnassignedFundingGroup(groups, unassignedExpenses, unassignedTransfers, incomes);
    }
  }

  private renderIncomeAllocationGroup(container: HTMLElement, income: IncomePlan, expenses: ExpensePlan[], transfers: PlannedTransfer[], incomes: IncomePlan[]): void {
    const allocation = calculateIncomeAllocation(income.amount, expenses, transfers);
    const isOpen = this.expandedIncomeAllocations.has(income.id);
    const group = container.createEl("section", { cls: `oxf-income-allocation-group${isOpen ? " is-open" : ""}${allocation.overallocated ? " is-overallocated" : ""}${income.status === "paid" ? " is-paid" : ""}` });
    this.registerFundingDropTarget(group, income.id, expenses, transfers);
    const heading = group.createDiv({ cls: "oxf-income-allocation-heading", attr: { role: "button", tabindex: "0", "aria-expanded": String(isOpen) } });
    const chevron = heading.createSpan({ cls: "oxf-income-allocation-chevron" });
    setIcon(chevron, "chevron-right");
    const identity = heading.createDiv({ cls: "oxf-income-allocation-identity" });
    identity.createEl("strong", { text: income.title });
    identity.createSpan({ text: `${new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "long" }).format(income.dueDate)} · ${income.category}` });
    const totals = heading.createDiv({ cls: "oxf-income-allocation-totals" });
    totals.createEl("b", { text: `${money(income.amount)} ₽` });
    totals.createSpan({ text: `${t("Нераспределено", "Unallocated")}: ${money(allocation.unallocated)} ₽` });
    const actions = heading.createDiv({ cls: "oxf-income-allocation-actions" });
    const complete = actions.createEl("button", { attr: { type: "button", "aria-label": income.status === "paid" ? t("Доход получен", "Income received") : t("Отметить доход полученным", "Mark income as received") } });
    setIcon(complete, income.status === "paid" ? "circle-check-big" : "circle");
    complete.disabled = income.status === "paid";
    if (income.status === "planned") complete.addEventListener("click", () => this.actions.completeIncomePlan(income));
    const add = actions.createEl("button", { attr: { type: "button", "aria-label": t("Добавить план к доходу", "Add plan to income") } });
    setIcon(add, "plus");
    add.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("Добавить расход", "Add expense")).setIcon("receipt-text").onClick(() => this.actions.createPlan(undefined, income.dueDate, income.id)));
      menu.addItem((item) => item.setTitle(t("Добавить перевод", "Add transfer")).setIcon("arrow-left-right").onClick(() => this.actions.createPlannedTransfer(income.dueDate, income.id)));
      menu.showAtMouseEvent(event);
    });
    const more = actions.createEl("button", { attr: { type: "button", "aria-label": t("Действия с доходом", "Income actions") } });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => this.actions.editIncomePlan(income)));
      menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => this.actions.deleteIncomePlan(income)));
      menu.showAtMouseEvent(event);
    });
    const toggle = (): void => {
      if (isOpen) this.expandedIncomeAllocations.delete(income.id);
      else this.expandedIncomeAllocations.add(income.id);
      this.render();
    };
    heading.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest("button")) toggle(); });
    heading.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !(event.target as HTMLElement).closest("button")) {
        event.preventDefault();
        toggle();
      }
    });
    if (!isOpen) return;
    const list = group.createDiv({ cls: "oxf-income-allocation-list" });
    if (expenses.length === 0 && transfers.length === 0) {
      list.createEl("p", { cls: "oxf-income-allocation-empty", text: t("Перетащите сюда расход или перевод", "Drag an expense or transfer here") });
      return;
    }
    for (const plan of [...expenses].sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) this.renderFundingExpenseRow(list, plan, incomes);
    for (const plan of [...transfers].sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())) this.renderFundingTransferRow(list, plan, incomes);
  }

  private renderUnassignedFundingGroup(container: HTMLElement, expenses: ExpensePlan[], transfers: PlannedTransfer[], incomes: IncomePlan[]): void {
    const group = container.createEl("section", { cls: `oxf-income-allocation-group is-unassigned${this.unassignedAllocationOpen ? " is-open" : ""}` });
    this.registerFundingDropTarget(group, undefined, expenses, transfers);
    const heading = group.createDiv({ cls: "oxf-income-allocation-heading", attr: { role: "button", tabindex: "0", "aria-expanded": String(this.unassignedAllocationOpen) } });
    const chevron = heading.createSpan({ cls: "oxf-income-allocation-chevron" });
    setIcon(chevron, "chevron-right");
    const identity = heading.createDiv({ cls: "oxf-income-allocation-identity" });
    identity.createEl("strong", { text: t("Нераспределённые планы", "Unallocated plans") });
    identity.createSpan({ text: t(`${expenses.length} расходов · ${transfers.length} переводов`, `${expenses.length} expenses · ${transfers.length} transfers`) });
    const total = [...expenses, ...transfers].reduce((sum, plan) => sum + plan.amount, 0);
    const totals = heading.createDiv({ cls: "oxf-income-allocation-totals" });
    totals.createEl("b", { text: `${money(total)} ₽` });
    const toggle = (): void => { this.unassignedAllocationOpen = !this.unassignedAllocationOpen; this.render(); };
    heading.addEventListener("click", toggle);
    heading.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
    });
    if (!this.unassignedAllocationOpen) return;
    const list = group.createDiv({ cls: "oxf-income-allocation-list" });
    for (const plan of expenses) this.renderFundingExpenseRow(list, plan, incomes);
    for (const plan of transfers) this.renderFundingTransferRow(list, plan, incomes);
  }

  private renderFundingExpenseRow(container: HTMLElement, plan: ExpensePlan, incomes: IncomePlan[]): void {
    const row = container.createDiv({ cls: `oxf-income-allocation-row is-expense${plan.status === "paid" ? " is-paid" : ""}` });
    this.makeFundingRowDraggable(row, "expense", plan.id);
    const marker = row.createSpan({ cls: "oxf-income-allocation-marker" });
    setIcon(marker, "receipt-text");
    const text = row.createDiv();
    text.createEl("strong", { text: plan.title });
    text.createSpan({ text: `${plan.category} · ${new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short" }).format(plan.dueDate).replace(".", "")}` });
    row.createEl("b", { text: `${money(plan.amount)} ₽` });
    const more = row.createEl("button", { attr: { type: "button", "aria-label": t("Действия с расходом", "Expense actions") } });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => this.showFundingMenu(event, "expense", plan, incomes));
  }

  private renderFundingTransferRow(container: HTMLElement, plan: PlannedTransfer, incomes: IncomePlan[]): void {
    const accounts = new Map(this.store.getIndex().accounts.map((account) => [account.id, account.name]));
    const unknown = t("Неизвестный счёт", "Unknown account");
    const row = container.createDiv({ cls: `oxf-income-allocation-row is-transfer${plan.status === "paid" ? " is-paid" : ""}` });
    this.makeFundingRowDraggable(row, "transfer", plan.id);
    const marker = row.createSpan({ cls: "oxf-income-allocation-marker" });
    setIcon(marker, "arrow-left-right");
    const text = row.createDiv();
    text.createEl("strong", { text: `${accounts.get(plan.fromAccountId) ?? unknown} → ${accounts.get(plan.toAccountId) ?? unknown}` });
    text.createSpan({ text: new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short" }).format(plan.dueDate).replace(".", "") });
    row.createEl("b", { text: `${money(plan.amount)} ₽` });
    const more = row.createEl("button", { attr: { type: "button", "aria-label": t("Действия с переводом", "Transfer actions") } });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => this.showFundingMenu(event, "transfer", plan, incomes));
  }

  private makeFundingRowDraggable(row: HTMLElement, kind: "expense" | "transfer", id: string): void {
    row.draggable = true;
    row.addEventListener("dragstart", (event) => {
      this.draggedFundingItem = { kind, id };
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      row.addClass("is-dragging");
    });
    row.addEventListener("dragend", () => { this.draggedFundingItem = undefined; row.removeClass("is-dragging"); });
  }

  private registerFundingDropTarget(target: HTMLElement, incomePlanId: string | undefined, expenses: ExpensePlan[], transfers: PlannedTransfer[]): void {
    target.addEventListener("dragover", (event) => { event.preventDefault(); target.addClass("is-drop-target"); });
    target.addEventListener("dragleave", (event) => { if (!target.contains(event.relatedTarget as Node | null)) target.removeClass("is-drop-target"); });
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.removeClass("is-drop-target");
      const dragged = this.draggedFundingItem;
      this.draggedFundingItem = undefined;
      if (!dragged) return;
      if (dragged.kind === "expense") {
        const plan = this.store.getIndex().plans.find((item) => item.id === dragged.id) ?? expenses.find((item) => item.id === dragged.id);
        if (plan) this.actions.setExpensePlanFunding(plan, incomePlanId);
      } else {
        const plan = this.store.getIndex().plannedTransfers.find((item) => item.id === dragged.id) ?? transfers.find((item) => item.id === dragged.id);
        if (plan) this.actions.setPlannedTransferFunding(plan, incomePlanId);
      }
    });
  }

  private showFundingMenu(event: MouseEvent, kind: "expense" | "transfer", plan: ExpensePlan | PlannedTransfer, incomes: IncomePlan[]): void {
    const menu = new Menu();
    for (const income of incomes) {
      menu.addItem((item) => item.setTitle(`${t("Назначить", "Assign")}: ${income.title}`).setIcon("wallet-cards").onClick(() => {
        if (kind === "expense") this.actions.setExpensePlanFunding(plan as ExpensePlan, income.id);
        else this.actions.setPlannedTransferFunding(plan as PlannedTransfer, income.id);
      }));
    }
    const fundedBy = plan.fundedByIncomePlanId;
    if (fundedBy) menu.addItem((item) => item.setTitle(t("Убрать распределение", "Remove allocation")).setIcon("unlink").onClick(() => {
      if (kind === "expense") this.actions.setExpensePlanFunding(plan as ExpensePlan);
      else this.actions.setPlannedTransferFunding(plan as PlannedTransfer);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => {
      if (kind === "expense") this.actions.editPlan(plan as ExpensePlan);
      else this.actions.editPlannedTransfer(plan as PlannedTransfer);
    }));
    menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => {
      if (kind === "expense") this.actions.deletePlan(plan as ExpensePlan);
      else this.actions.deletePlannedTransfer(plan as PlannedTransfer);
    }));
    menu.showAtMouseEvent(event);
  }

  private showPlanningCreateMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Запланировать расход", "Plan expense")).setIcon("receipt-text").onClick(() => this.actions.createPlan()));
    menu.addItem((item) => item.setTitle(t("Запланировать доход", "Plan income")).setIcon("circle-plus").onClick(() => this.actions.createIncomePlan()));
    menu.addItem((item) => item.setTitle(t("Запланировать перевод", "Plan transfer")).setIcon("arrow-left-right").onClick(() => this.actions.createPlannedTransfer()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("Погашение долга", "Debt repayment")).setIcon("circle-minus").onClick(() => this.actions.planDebtPayment("pay")));
    menu.addItem((item) => item.setTitle(t("Получение долга", "Debt collection")).setIcon("circle-plus").onClick(() => this.actions.planDebtPayment("receive")));
    menu.showAtMouseEvent(event);
  }

  private renderDebts(container: HTMLElement): void {
    const split = splitDebtsByArchive(this.store.getIndex().debts);
    const debts = this.debtArchiveOpen ? split.archived : split.active;
    const { owedToMe, iOwe } = summarizeDebts(debts);
    const summary = container.createDiv({ cls: "oxf-debt-summary" });
    this.renderPlanningMetric(summary, this.debtArchiveOpen ? t("Вернули мне", "Repaid to me") : t("Мне должны", "Owed to me"), `+${money(owedToMe)} ₽`);
    this.renderPlanningMetric(summary, this.debtArchiveOpen ? t("Вернул я", "Repaid by me") : t("Я должен", "I owe"), `−${money(iOwe)} ₽`);
    if (debts.length === 0) {
      const empty = container.createDiv({ cls: "oxf-card oxf-accounts-empty" });
      empty.createEl("strong", { text: this.debtArchiveOpen ? t("Архив долгов пуст", "Debt archive is empty") : t("Долгов пока нет", "No debts yet") });
      empty.createEl("p", { text: this.debtArchiveOpen
        ? t("Закрытые долги появятся здесь.", "Closed debts will appear here.")
        : t("Добавьте долг по названию или свяжите его с заметкой человека.", "Add a debt by name or link it to a person note.") });
      return;
    }
    const list = container.createDiv({ cls: "oxf-accounts-list" });
    for (const debt of debts) {
      const row = list.createDiv({ cls: "oxf-debt-row" });
      const connectedPerson = debt.personPath ? this.actions.connectedPerson(debt.personPath) : undefined;
      if (connectedPerson) this.renderPersonAvatar(row, connectedPerson);
      else {
        const icon = row.createSpan({ cls: "oxf-account-icon" });
        setIcon(icon, normalizeAccountIcon(debt.icon));
      }
      const identity = row.createDiv({ cls: "oxf-account-identity" });
      if (debt.personPath) {
        const person = identity.createEl("button", { cls: "oxf-debt-person", text: debt.name, attr: { type: "button" } });
        person.addEventListener("click", () => void this.app.workspace.openLinkText(debt.personPath ?? "", debt.file.path));
      } else identity.createEl("strong", { text: debt.name });
      if (!this.debtArchiveOpen) {
        const planning = summarizeDebtPlanning(debt, this.store.getIndex().plans, this.store.getIndex().incomePlans);
        if (planning.plannedAmount > 0) {
          const date = planning.nextDueDate
            ? new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short" }).format(planning.nextDueDate).replace(".", "")
            : "";
          identity.createSpan({ text: t(
            `Запланировано ${money(planning.plannedAmount)} ₽${date ? ` · ${date}` : ""} · осталось ${money(planning.unplannedAmount)} ₽`,
            `Planned ${money(planning.plannedAmount)} ₽${date ? ` · ${date}` : ""} · ${money(planning.unplannedAmount)} ₽ left`,
          ) });
        }
      }
      row.createEl("strong", { cls: `oxf-debt-amount ${debt.amount > 0 ? "is-positive" : "is-negative"}`, text: `${debt.amount > 0 ? "+" : "−"}${money(Math.abs(debt.amount))} ₽` });
      const more = row.createEl("button", { cls: "oxf-account-more", attr: { type: "button", "aria-label": t("Действия с долгом", "Debt actions") } }); setIcon(more, "ellipsis");
      more.addEventListener("click", (event) => {
        const menu = new Menu();
        if (!this.debtArchiveOpen) {
          const planning = summarizeDebtPlanning(debt, this.store.getIndex().plans, this.store.getIndex().incomePlans);
          menu.addItem((item) => item
            .setTitle(debt.amount < 0 ? t("Запланировать погашение", "Plan repayment") : t("Запланировать получение", "Plan collection"))
            .setIcon("calendar-plus")
            .setDisabled(planning.unplannedAmount <= 0.005)
            .onClick(() => this.actions.planDebtPayment(debt.amount < 0 ? "pay" : "receive", debt.id)));
          menu.addSeparator();
        }
        menu.addItem((item) => item
          .setTitle(this.debtArchiveOpen ? t("Вернуть в активные", "Restore to active") : t("Закрыть долг", "Close debt"))
          .setIcon(this.debtArchiveOpen ? "archive-restore" : "circle-check")
          .onClick(() => this.actions.setDebtArchived(debt, !this.debtArchiveOpen)));
        menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => this.actions.editDebt(debt)));
        menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => this.actions.deleteDebt(debt)));
        menu.showAtMouseEvent(event);
      });
    }
  }

  private renderPersonAvatar(container: HTMLElement, person: ConnectedPerson): void {
    const avatar = container.createSpan({ cls: "oxf-person-avatar", attr: { "aria-label": person.name } });
    if (person.photoUrl) avatar.createEl("img", { attr: { src: person.photoUrl, alt: person.name } });
    else avatar.createSpan({ text: person.name.trim().charAt(0).toLocaleUpperCase() || "?" });
  }

  private renderPlanningMetric(container: HTMLElement, label: string, value: string): void {
    const card = container.createDiv({ cls: "oxf-card oxf-planning-metric" });
    card.createSpan({ text: label });
    card.createEl("strong", { text: value });
  }

  private renderPlanningHeatmap(container: HTMLElement, expenses: ExpensePlan[], incomes: IncomePlan[], transfers: PlannedTransfer[]): void {
    const card = container.createDiv({ cls: "oxf-card oxf-year-plan" });
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t(`План на ${this.planningYear} год`, `${this.planningYear} plan`) });
    headingText.createSpan({ text: t("Нажмите на месяц, чтобы перейти к деталям", "Select a month to open its details") });
    const months = card.createDiv({ cls: "oxf-year-plan-grid" });
    const formatter = new Intl.DateTimeFormat(localeCode(), { month: "long" });
    for (let month = 0; month < 12; month += 1) {
      const monthExpenses = expenses.filter((plan) => plan.dueDate.getMonth() === month);
      const monthIncomes = incomes.filter((plan) => plan.dueDate.getMonth() === month);
      const monthTransfers = transfers.filter((plan) => plan.dueDate.getMonth() === month);
      const budget = calculateMonthlyPlanningBudget(monthExpenses, monthIncomes, monthTransfers);
      const button = months.createEl("button", { cls: `oxf-year-plan-month${month === this.planningMonth ? " is-active" : ""}`, attr: { type: "button" } });
      const monthHeading = button.createDiv();
      monthHeading.createEl("strong", { text: capitalize(formatter.format(new Date(2020, month, 1))) });
      monthHeading.createSpan({ text: t(`${monthExpenses.length + monthIncomes.length + monthTransfers.length} событий`, `${monthExpenses.length + monthIncomes.length + monthTransfers.length} events`) });
      const values = button.createDiv({ cls: "oxf-year-plan-values" });
      values.createSpan({ cls: "is-income", text: `+${money(budget.income)} ₽` });
      values.createSpan({ cls: "is-expense", text: `−${money(budget.expenses)} ₽` });
      values.createSpan({ cls: "is-transfer", text: `→${money(budget.transfers)} ₽` });
      values.createEl("b", { cls: budget.free < 0 ? "is-danger" : "", text: `${money(budget.free)} ₽` });
      button.addEventListener("click", () => {
        this.planningMonth = month;
        this.planningYearOverview = false;
        this.planningPanel = "expenses";
        this.render();
      });
    }
  }

  private showPlanMenu(event: MouseEvent, plan: ExpensePlan): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => this.actions.editPlan(plan)));
    menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => this.actions.deletePlan(plan)));
    menu.showAtMouseEvent(event);
  }

  private renderAccountCard(container: HTMLElement, account: FinanceAccount, accounts: FinanceAccount[]): void {
    const card = container.createEl("section", { cls: "oxf-card oxf-account-card", attr: { draggable: "true" } });
    card.dataset.accountId = account.id;
    const heading = card.createDiv({ cls: "oxf-account-card-heading" });
    const icon = heading.createSpan({ cls: "oxf-account-icon" });
    setIcon(icon, normalizeAccountIcon(account.icon));
    card.addEventListener("dragstart", (event) => {
      if ((event.target as HTMLElement).closest("button")) {
        event.preventDefault();
        return;
      }
      this.draggedAccountId = account.id;
      card.addClass("is-dragging");
      event.dataTransfer?.setData("text/plain", account.id);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        const emptyDragImage = document.body.createDiv({ cls: "oxf-empty-drag-image" });
        event.dataTransfer.setDragImage(emptyDragImage, 0, 0);
        window.setTimeout(() => emptyDragImage.remove(), 0);
      }
    });
    card.addEventListener("dragend", () => {
      const cancelled = this.draggedAccountId !== undefined;
      this.draggedAccountId = undefined;
      card.removeClass("is-dragging");
      this.clearAccountDropIndicators(container);
      if (cancelled) this.render();
    });
    const identity = heading.createDiv({ cls: "oxf-account-identity" });
    identity.createEl("strong", { text: account.name });
    identity.createSpan({ text: `${t("Доступно сейчас", "Available now")}: ${money(account.balance)} ₽` });
    this.renderAccountCategoryChart(card, account.id);
    const footer = card.createDiv({ cls: "oxf-account-card-footer" });
    const transfer = footer.createEl("button", { cls: "oxf-account-transfer", text: t("Перевести", "Transfer"), attr: { type: "button" } });
    transfer.disabled = accounts.length < 2 || account.balance <= 0;
    transfer.addEventListener("click", () => this.actions.transfer(account.id));
    const more = footer.createEl("button", { cls: "oxf-account-more", text: "•••", attr: { type: "button", "aria-label": t(`Действия со счётом ${account.name}`, `Actions for account ${account.name}`) } });
    more.addEventListener("click", (event) => this.showAccountMenu(event, account));
  }

  private clearAccountDropIndicators(container: HTMLElement): void {
    for (const row of Array.from(container.querySelectorAll(".oxf-account-card"))) {
      row.removeClass("is-drop-before", "is-drop-after");
    }
  }

  private previewAccountOrder(container: HTMLElement, target: HTMLElement, event: DragEvent): void {
    if (!this.draggedAccountId) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>(".oxf-account-card"));
    const dragged = cards.find((card) => card.dataset.accountId === this.draggedAccountId);
    if (!dragged || dragged === target) return;
    const targetRect = target.getBoundingClientRect();
    const multiColumn = container.clientWidth >= targetRect.width * 1.75;
    const before = multiColumn
      ? event.clientX < targetRect.left + targetRect.width / 2
      : event.clientY < targetRect.top + targetRect.height / 2;
    const reference = before ? target : target.nextElementSibling;
    if (reference === dragged || (!reference && dragged === container.lastElementChild)) return;
    const positions = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
    container.insertBefore(dragged, reference);
    for (const card of cards) {
      if (card === dragged) continue;
      const previous = positions.get(card);
      if (!previous) continue;
      const next = card.getBoundingClientRect();
      const deltaX = previous.left - next.left;
      const deltaY = previous.top - next.top;
      if (deltaX === 0 && deltaY === 0) continue;
      card.animate(
        [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "translate(0, 0)" }],
        { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
      );
    }
  }

  private renderAccountCategoryChart(container: HTMLElement, accountId: string): void {
    const range = this.customRange ?? getPeriodRange(this.period, this.anchorDate);
    const expenses = this.store.getIndex().transactions.filter((transaction) =>
      transaction.kind === "expense"
      && transaction.accountId === accountId
      && transaction.date >= range.start
      && transaction.date <= range.end);
    const total = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
    const totals = new Map<string, number>();
    for (const expense of expenses) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
    const categories = [...totals.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((left, right) => right.amount - left.amount);
    const visible = categories.slice(0, categories.length > 4 ? 3 : 4);
    if (categories.length > 4) visible.push({
      name: t("Другое", "Other"),
      amount: categories.slice(3).reduce((sum, category) => sum + category.amount, 0),
    });
    const chart = container.createDiv({ cls: `oxf-account-category-chart${total === 0 ? " is-empty" : ""}` });
    const donut = chart.createDiv({ cls: "oxf-account-category-donut" });
    if (total > 0) {
      let cursor = 0;
      const colors = categoryColors();
      const stops = visible.map((category, index) => {
        const start = cursor;
        cursor += (category.amount / total) * 100;
        return `${colors[index] ?? colors[0]} ${start}% ${cursor}%`;
      });
      donut.setCssProps({ background: `conic-gradient(${stops.join(",")})` });
    }
    const center = donut.createDiv();
    center.createSpan({ text: t("Расходы", "Expenses") });
    center.createEl("strong", { text: `${money(total)} ₽` });
    const legend = chart.createDiv({ cls: "oxf-account-category-legend" });
    if (visible.length === 0) {
      legend.createSpan({ cls: "oxf-account-category-empty", text: t("Нет расходов за период", "No expenses for this period") });
      return;
    }
    visible.forEach((category, index) => {
      const row = legend.createDiv();
      row.createSpan({ cls: `oxf-category-marker is-color-${index + 1}` });
      row.createSpan({ text: category.name });
      row.createEl("strong", { text: `${Math.round((category.amount / total) * 100)}%` });
    });
  }

  private showAccountMenu(event: MouseEvent, account: FinanceAccount): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Изменить счёт", "Edit account")).setIcon("pencil")
      .onClick(() => this.actions.editAccount(account)));
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(t("Удалить счёт", "Delete account")).setIcon("trash-2");
      if (Math.abs(account.balance) > 0.005) item.setDisabled(true);
      item.onClick(() => this.actions.deleteAccount(account));
    });
    menu.showAtMouseEvent(event);
  }

  private renderRecentOperations(container: HTMLElement, operations: RecentOperation[]): void {
    const card = container.createEl("section", { cls: "oxf-card oxf-history-card" });
    const heading = card.createDiv({ cls: "oxf-history-heading" });
    heading.createEl("strong", { text: t("Последние операции", "Recent transactions") });
    if (operations.length === 0) return void card.createEl("p", { cls: "oxf-empty", text: t("За выбранный период операций нет.", "There are no transactions in the selected period.") });
    const columns = card.createDiv({ cls: "oxf-history-columns" });
    columns.createSpan({ text: t("Комментарий", "Comment") });
    columns.createSpan({ text: t("Дата", "Date") });
    columns.createSpan({ text: t("Сумма", "Amount") });
    const list = card.createDiv({ cls: "oxf-history-list" });
    for (const operation of operations) {
      const row = list.createEl("button", { cls: "oxf-history-row", attr: { type: "button" } });
      const name = row.createDiv();
      const title = name.createDiv({ cls: "oxf-operation-title" });
      title.createSpan({ cls: `oxf-operation-dot is-${operation.kind}`, attr: { "aria-hidden": "true" } });
      title.createEl("strong", { text: operation.title });
      name.createSpan({ text: operation.subtitle });
      row.createEl("time", { text: dateLabel(operation.date) });
      const prefix = operation.kind === "income" ? "+" : operation.kind === "expense" ? "−" : "→";
      row.createEl("b", { cls: `is-${operation.kind}`, text: `${prefix}${money(operation.amount)} ₽` });
      row.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(operation.file));
    }
  }

  private renderIssues(container: HTMLElement): void {
    const issues = this.store.getIndex().issues;
    if (issues.length === 0) return;
    const notice = container.createEl("details", { cls: "oxf-issues" });
    notice.createEl("summary", { text: t(`Не удалось прочитать заметки: ${issues.length}`, `Could not read notes: ${issues.length}`) });
    for (const issue of issues) notice.createEl("p", { text: `${issue.path}: ${issue.message}` });
  }
}

function money(value: number): string { return formatMoney(value, localeCode()); }
function dateLabel(date: Date): string { return new Intl.DateTimeFormat(localeCode(), { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function categoryColors(): string[] {
  return ["#7c6cf2", "#4f8fe8", "#39a58a", "#e5a83e", "#dc6f57", "#a86dd4", "#58a6b3", "#87909a"];
}
function customRangeLabel(start: Date, end: Date): string {
  const formatter = new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short", year: "numeric" });
  return `${formatter.format(start)} — ${formatter.format(end)}`;
}
function startOfDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function endOfDay(date: Date): Date { return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999); }
function sameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
