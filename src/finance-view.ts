import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";

import { calculateSummary, selectCategorySlices } from "./core/finance";
import { normalizeAccountIcon } from "./core/account-icons";
import { splitDebtsByArchive, summarizeDebts } from "./core/debts";
import { calculateMonthlyPlanningBudget } from "./core/planning";
import { monthPeriod } from "./core/month-summary";
import { renderAccuracy } from "./month-summary-modal";
import { TransactionStore } from "./transaction-store";
import { ExpensePlan, FinanceAccount, FinanceDebt, FinanceMonthSummary, FinanceSummary, FinanceTransaction, IncomePlan, PeriodKind, PlannedTransfer, TransactionKind } from "./types";
import { localeCode, t } from "./i18n";
import { ConnectedPerson } from "./person-network-connector";

export const VIEW_TYPE_FINANCE = "oxill-finance-dashboard";
type NavigationItem = "overview" | "accounts" | "debts" | "planning";
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
  createPlan: (category?: string, dueDate?: Date) => void;
  editPlan: (plan: ExpensePlan) => void;
  deletePlan: (plan: ExpensePlan) => void;
  completePlan: (plan: ExpensePlan) => void;
  createIncomePlan: () => void;
  editIncomePlan: (plan: IncomePlan) => void;
  deleteIncomePlan: (plan: IncomePlan) => void;
  completeIncomePlan: (plan: IncomePlan) => void;
  createPlannedTransfer: () => void;
  editPlannedTransfer: (plan: PlannedTransfer) => void;
  deletePlannedTransfer: (plan: PlannedTransfer) => void;
  completePlannedTransfer: (plan: PlannedTransfer) => void;
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
  private planningPanel: "expenses" | "timeline" = "expenses";
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
    if (this.activeSection === "overview") this.renderPeriod(topbar);
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
    const dynamics = container.createEl("section", { cls: "oxf-overview-section" });
    this.renderFlowChart(dynamics, summary);
    const operations = container.createEl("section", { cls: "oxf-overview-section" });
    this.renderHistory(operations, summary.transactions.slice(0, 20), t("Последние операции", "Recent transactions"));
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


  private renderFlowChart(container: HTMLElement, summary: FinanceSummary): void {
    const card = container.createEl("section", { cls: "oxf-card oxf-flow-card" });
    const heading = card.createDiv({ cls: "oxf-card-heading" });
    heading.createEl("strong", { text: t("Движение денег", "Cash flow") });
    const legend = heading.createDiv({ cls: "oxf-chart-legend" });
    legend.createSpan({ cls: "is-income", text: t("Доходы", "Income") });
    legend.createSpan({ cls: "is-expense", text: t("Расходы", "Expenses") });
    if (this.period === "month" && !this.customRange) {
      this.renderMonthHeatmap(card, summary);
      return;
    }
    const max = Math.max(...summary.flow.map((item) => item.income + item.expense), 1);
    const chart = card.createDiv({ cls: "oxf-bars-chart" });
    for (const bucket of summary.flow) {
      const column = chart.createDiv({ cls: "oxf-chart-column" });
      const bars = column.createDiv({ cls: "oxf-chart-bars" });
      for (const kind of ["expense", "income"] as const) {
        if (bucket[kind] <= 0) continue;
        const bar = bars.createDiv({ cls: `is-${kind}` });
        bar.setCssProps({ height: `${(bucket[kind] / max) * 100}%` });
        bar.setAttribute("title", `${kind === "income" ? t("Доходы", "Income") : t("Расходы", "Expenses")}: ${money(bucket[kind])} ₽`);
      }
      column.createSpan({ text: bucket.label });
    }
  }

  private renderMonthHeatmap(container: HTMLElement, summary: FinanceSummary): void {
    const weekdays = container.createDiv({ cls: "oxf-heatmap-weekdays" });
    for (const label of t("Пн,Вт,Ср,Чт,Пт,Сб,Вс", "Mon,Tue,Wed,Thu,Fri,Sat,Sun").split(",")) weekdays.createSpan({ text: label });

    const calendar = container.createDiv({ cls: "oxf-heatmap" });
    const now = this.anchorDate;
    const firstDayOffset = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
    for (let index = 0; index < firstDayOffset; index += 1) calendar.createDiv({ cls: "oxf-heatmap-blank" });

    const maxExpense = Math.max(...summary.flow.map((bucket) => bucket.expense), 1);
    for (const bucket of summary.flow) {
      const intensity = bucket.expense > 0 ? Math.max(1, Math.ceil((bucket.expense / maxExpense) * 4)) : 0;
      const cell = calendar.createDiv({ cls: `oxf-heatmap-cell is-level-${intensity}${bucket.income > 0 ? " has-income" : ""}` });
      cell.createSpan({ text: bucket.label });
      if (bucket.income > 0) cell.createDiv({ cls: "oxf-income-marker" });
      cell.setAttribute("aria-label", `+${money(bucket.income)} ₽ · −${money(bucket.expense)} ₽`);
    }
  }

  private renderAccounts(container: HTMLElement): void {
    const accounts = this.store.getIndex().accounts;
    const heading = container.createDiv({ cls: "oxf-accounts-heading" });
    const title = heading.createDiv();
    title.createEl("h2", { text: t("Счета", "Accounts") });
    title.createEl("p", { text: t("Баланс рассчитывается из доходов, расходов и переводов", "Balance is calculated from income, expenses, and transfers") });
    heading.createEl("button", { cls: "mod-cta", text: t("+ Создать счёт", "+ Create account"), attr: { type: "button" } })
      .addEventListener("click", () => this.actions.createAccount());

    const quickActions = container.createDiv({ cls: "oxf-accounts-actions" });
    this.renderQuickAction(quickActions, "+", t("Расход", "Expense"), () => this.actions.openTransaction("expense"));
    this.renderQuickAction(quickActions, "+", t("Доход", "Income"), () => this.actions.openTransaction("income"));
    const transferAction = this.renderQuickAction(quickActions, "⇄", t("Перевод", "Transfer"), () => this.actions.transfer());
    transferAction.disabled = accounts.length < 2;

    if (accounts.length === 0) {
      const empty = container.createDiv({ cls: "oxf-card oxf-accounts-empty" });
      empty.createEl("strong", { text: t("Счетов пока нет", "No accounts yet") });
      empty.createEl("p", { text: t("Создайте первый счёт, затем пополните его через доход.", "Create your first account, then fund it with an income transaction.") });
      return;
    }

    const grid = container.createDiv({ cls: "oxf-accounts-list" });
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

    const heading = container.createDiv({ cls: "oxf-planning-heading" });
    const title = heading.createDiv();
    title.createEl("h2", { text: t("Планирование", "Planning") });
    title.createEl("p", { text: this.planningYearOverview ? t("Годовой план доходов, расходов и переводов", "Annual income, expense, and transfer plan") : t("Доходы, расходы и переводы выбранного месяца", "Income, expenses, and transfers for the selected month") });
    const actions = heading.createDiv({ cls: "oxf-planning-actions" });
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

    const actualYearIncome = index.transactions.filter((item) => inSelectedYear(item.date) && item.kind === "income").reduce((sum, item) => sum + item.amount, 0);
    const actualYearExpenses = index.transactions.filter((item) => inSelectedYear(item.date) && item.kind === "expense").reduce((sum, item) => sum + item.amount, 0);
    this.renderPlanningOverview(container, budget, this.planningYearOverview ? undefined : monthSummary, this.planningYearOverview ? { income: actualYearIncome, expenses: actualYearExpenses } : undefined);
    if (this.planningYearOverview) {
      this.renderPlanningHeatmap(container, yearPlans, yearIncomePlans, yearTransfers);
      return;
    }
    const tabs = container.createDiv({ cls: "oxf-planning-tabs" });
    for (const [value, label] of [["expenses", t("Расходы", "Expenses")], ["timeline", t("События", "Timeline")]] as const) {
      const tab = tabs.createEl("button", { cls: this.planningPanel === value ? "is-active" : "", text: label, attr: { type: "button" } });
      tab.addEventListener("click", () => { this.planningPanel = value; this.render(); });
    }
    const workspace = container.createDiv({ cls: "oxf-month-planner" });
    if (this.planningPanel === "expenses") this.renderMonthlyExpenses(workspace, monthPlans);
    else this.renderPlanningTimeline(workspace, monthPlans, monthIncomePlans, monthTransfers);
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

  private renderMonthlyExpenses(container: HTMLElement, plans: ExpensePlan[]): void {
    const card = container.createDiv({ cls: "oxf-card oxf-month-expenses" });
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t("Расходы месяца", "Monthly expenses") });
    headingText.createSpan({ text: t(`${plans.length} планов · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`, `${plans.length} plans · ${money(plans.reduce((sum, plan) => sum + plan.amount, 0))} ₽`) });
    const add = heading.createEl("button", { attr: { type: "button", "aria-label": t("Добавить расход", "Add expense") } });
    setIcon(add, "plus");
    add.addEventListener("click", () => this.actions.createPlan(undefined, new Date(this.planningYear, this.planningMonth, 1, 12)));
    if (plans.length === 0) {
      card.createEl("p", { cls: "oxf-month-planner-empty", text: t("На этот месяц расходов пока нет.", "There are no expenses planned for this month.") });
      return;
    }
    const grouped = new Map<string, ExpensePlan[]>();
    for (const plan of plans) grouped.set(plan.category, [...(grouped.get(plan.category) ?? []), plan]);
    const categories = card.createDiv({ cls: "oxf-month-expense-groups" });
    for (const [category, categoryPlans] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, localeCode()))) {
      const group = categories.createEl("section", { cls: "oxf-month-expense-group" });
      const groupHeading = group.createDiv({ cls: "oxf-month-expense-group-heading" });
      const identity = groupHeading.createDiv();
      identity.createEl("strong", { text: category });
      identity.createSpan({ text: t(`${categoryPlans.length} платежей`, `${categoryPlans.length} payments`) });
      groupHeading.createEl("b", { text: `${money(categoryPlans.reduce((sum, plan) => sum + plan.amount, 0))} ₽` });
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

  private renderPlanningTimeline(container: HTMLElement, expenses: ExpensePlan[], incomes: IncomePlan[], transfers: PlannedTransfer[]): void {
    const card = container.createDiv({ cls: "oxf-card oxf-planning-timeline" });
    const heading = card.createDiv({ cls: "oxf-month-planner-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: t("События месяца", "Monthly timeline") });
    headingText.createSpan({ text: t("Доходы, расходы и переводы по датам", "Income, expenses, and transfers by date") });
    type TimelineItem = { kind: "expense" | "income" | "transfer"; date: Date; title: string; meta: string; amount: number; paid: boolean; complete: () => void; edit: () => void; remove: () => void };
    const accounts = new Map(this.store.getIndex().accounts.map((account) => [account.id, account.name]));
    const items: TimelineItem[] = [
      ...expenses.map((plan): TimelineItem => ({ kind: "expense", date: plan.dueDate, title: plan.title, meta: plan.category, amount: plan.amount, paid: plan.status === "paid", complete: () => this.actions.completePlan(plan), edit: () => this.actions.editPlan(plan), remove: () => this.actions.deletePlan(plan) })),
      ...incomes.map((plan): TimelineItem => ({ kind: "income", date: plan.dueDate, title: plan.title, meta: plan.category, amount: plan.amount, paid: plan.status === "paid", complete: () => this.actions.completeIncomePlan(plan), edit: () => this.actions.editIncomePlan(plan), remove: () => this.actions.deleteIncomePlan(plan) })),
      ...transfers.map((plan): TimelineItem => ({ kind: "transfer", date: plan.dueDate, title: `${accounts.get(plan.fromAccountId) ?? t("Неизвестный счёт", "Unknown account")} → ${accounts.get(plan.toAccountId) ?? t("Неизвестный счёт", "Unknown account")}`, meta: t("Перевод", "Transfer"), amount: plan.amount, paid: plan.status === "paid", complete: () => this.actions.completePlannedTransfer(plan), edit: () => this.actions.editPlannedTransfer(plan), remove: () => this.actions.deletePlannedTransfer(plan) })),
    ].sort((left, right) => left.date.getTime() - right.date.getTime());
    if (items.length === 0) {
      card.createEl("p", { cls: "oxf-month-planner-empty", text: t("На этот месяц событий пока нет.", "There are no events planned for this month.") });
      return;
    }
    const list = card.createDiv({ cls: "oxf-planning-timeline-list" });
    for (const item of items) {
      const row = list.createDiv({ cls: `oxf-planning-timeline-row is-${item.kind}${item.paid ? " is-paid" : ""}` });
      const date = row.createDiv({ cls: "oxf-planning-timeline-date" });
      date.createEl("strong", { text: String(item.date.getDate()) });
      date.createSpan({ text: new Intl.DateTimeFormat(localeCode(), { month: "short" }).format(item.date).replace(".", "") });
      const marker = row.createSpan({ cls: "oxf-planning-timeline-marker" });
      setIcon(marker, item.kind === "income" ? "circle-plus" : item.kind === "transfer" ? "arrow-left-right" : "receipt-text");
      const text = row.createDiv({ cls: "oxf-planning-timeline-text" });
      text.createEl("strong", { text: item.title });
      text.createSpan({ text: item.meta });
      row.createEl("b", { text: `${item.kind === "income" ? "+" : item.kind === "expense" ? "−" : ""}${money(item.amount)} ₽` });
      const complete = row.createEl("button", { attr: { type: "button", "aria-label": item.paid ? t("Выполнено", "Completed") : t("Выполнить", "Complete") } });
      setIcon(complete, item.paid ? "circle-check-big" : "circle");
      complete.disabled = item.paid;
      if (!item.paid) complete.addEventListener("click", item.complete);
      const more = row.createEl("button", { attr: { type: "button", "aria-label": t("Действия", "Actions") } });
      setIcon(more, "ellipsis");
      more.addEventListener("click", (event) => {
        const menu = new Menu();
        menu.addItem((menuItem) => menuItem.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(item.edit));
        menu.addItem((menuItem) => menuItem.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(item.remove));
        menu.showAtMouseEvent(event);
      });
    }
  }

  private showPlanningCreateMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Запланировать расход", "Plan expense")).setIcon("receipt-text").onClick(() => this.actions.createPlan()));
    menu.addItem((item) => item.setTitle(t("Запланировать доход", "Plan income")).setIcon("circle-plus").onClick(() => this.actions.createIncomePlan()));
    menu.addItem((item) => item.setTitle(t("Запланировать перевод", "Plan transfer")).setIcon("arrow-left-right").onClick(() => this.actions.createPlannedTransfer()));
    menu.showAtMouseEvent(event);
  }

  private renderDebts(container: HTMLElement): void {
    const split = splitDebtsByArchive(this.store.getIndex().debts);
    const debts = this.debtArchiveOpen ? split.archived : split.active;
    const { owedToMe, iOwe } = summarizeDebts(debts);
    const heading = container.createDiv({ cls: "oxf-accounts-heading" });
    const title = heading.createDiv();
    title.createEl("h2", { text: t("Долги", "Debts") });
    title.createEl("p", { text: this.debtArchiveOpen
      ? t("Закрытые долги", "Closed debts")
      : t("Личные долги и обязательства", "Personal debts and obligations") });
    const headingActions = heading.createDiv({ cls: "oxf-debt-heading-actions" });
    const archive = headingActions.createEl("button", {
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
    headingActions.createEl("button", { cls: "mod-cta", text: t("+ Добавить долг", "+ Add debt"), attr: { type: "button" } }).addEventListener("click", () => this.actions.createDebt());
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
      row.createEl("strong", { cls: `oxf-debt-amount ${debt.amount > 0 ? "is-positive" : "is-negative"}`, text: `${debt.amount > 0 ? "+" : "−"}${money(Math.abs(debt.amount))} ₽` });
      const more = row.createEl("button", { cls: "oxf-account-more", attr: { type: "button", "aria-label": t("Действия с долгом", "Debt actions") } }); setIcon(more, "ellipsis");
      more.addEventListener("click", (event) => {
        const menu = new Menu();
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
    const card = container.createEl("section", { cls: "oxf-account-row" });
    card.dataset.accountId = account.id;
    const dragHandle = card.createEl("button", {
      cls: "oxf-account-drag-handle",
      attr: { type: "button", draggable: "true", "aria-label": t(`Переместить счёт ${account.name}`, `Move account ${account.name}`) },
    });
    setIcon(dragHandle, "grip-vertical");
    dragHandle.addEventListener("dragstart", (event) => {
      this.draggedAccountId = account.id;
      card.addClass("is-dragging");
      event.dataTransfer?.setData("text/plain", account.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    dragHandle.addEventListener("dragend", () => {
      this.draggedAccountId = undefined;
      card.removeClass("is-dragging");
      this.clearAccountDropIndicators(container);
    });
    card.addEventListener("dragover", (event) => {
      if (!this.draggedAccountId || this.draggedAccountId === account.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      this.clearAccountDropIndicators(container);
      const after = event.clientY >= card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      card.addClass(after ? "is-drop-after" : "is-drop-before");
    });
    card.addEventListener("drop", (event) => {
      if (!this.draggedAccountId || this.draggedAccountId === account.id) return;
      event.preventDefault();
      const after = event.clientY >= card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
      const ids = accounts.map((item) => item.id).filter((id) => id !== this.draggedAccountId);
      const targetIndex = ids.indexOf(account.id);
      ids.splice(targetIndex + (after ? 1 : 0), 0, this.draggedAccountId);
      this.draggedAccountId = undefined;
      this.clearAccountDropIndicators(container);
      void this.actions.reorderAccounts(ids);
    });
    const icon = card.createSpan({ cls: "oxf-account-icon" });
    setIcon(icon, normalizeAccountIcon(account.icon));
    const identity = card.createDiv({ cls: "oxf-account-identity" });
    identity.createEl("strong", { text: account.name });
    identity.createSpan({ text: account.balance === 0 ? t("Нет средств", "No funds") : t("Доступно сейчас", "Available now") });
    card.createEl("strong", { cls: `oxf-account-balance${account.balance < 0 ? " is-negative" : ""}`, text: `${money(account.balance)} ₽` });
    const transfer = card.createEl("button", { cls: "oxf-account-transfer", text: t("Перевести", "Transfer"), attr: { type: "button" } });
    transfer.disabled = accounts.length < 2 || account.balance <= 0;
    transfer.addEventListener("click", () => this.actions.transfer(account.id));
    const more = card.createEl("button", { cls: "oxf-account-more", text: "•••", attr: { type: "button", "aria-label": t(`Действия со счётом ${account.name}`, `Actions for account ${account.name}`) } });
    more.addEventListener("click", (event) => this.showAccountMenu(event, account));
  }

  private clearAccountDropIndicators(container: HTMLElement): void {
    for (const row of Array.from(container.querySelectorAll(".oxf-account-row"))) {
      row.removeClass("is-drop-before", "is-drop-after");
    }
  }

  private showAccountMenu(event: MouseEvent, account: FinanceAccount): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Записать расход", "Record expense")).setIcon("minus-circle")
      .onClick(() => this.actions.openTransaction("expense", account.id)));
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

  private renderHistory(container: HTMLElement, transactions: FinanceTransaction[], title: string): void {
    const card = container.createEl("section", { cls: "oxf-card oxf-history-card" });
    const heading = card.createDiv({ cls: "oxf-history-heading" });
    heading.createEl("strong", { text: title });
    const actions = heading.createDiv();
    const expense = actions.createEl("button", { text: t("+ Расход", "+ Expense"), attr: { type: "button" } });
    expense.addEventListener("click", () => this.actions.openTransaction("expense"));
    const income = actions.createEl("button", { text: t("+ Доход", "+ Income"), attr: { type: "button" } });
    income.addEventListener("click", () => this.actions.openTransaction("income"));
    if (transactions.length === 0) return void card.createEl("p", { cls: "oxf-empty", text: t("За выбранный период операций нет.", "There are no transactions in the selected period.") });
    const columns = card.createDiv({ cls: "oxf-history-columns" });
    columns.createSpan({ text: t("Категория", "Category") });
    columns.createSpan({ text: t("Дата", "Date") });
    columns.createSpan({ text: t("Тип", "Type") });
    columns.createSpan({ text: t("Сумма", "Amount") });
    const list = card.createDiv({ cls: "oxf-history-list" });
    for (const transaction of transactions) {
      const row = list.createEl("button", { cls: "oxf-history-row", attr: { type: "button" } });
      const name = row.createDiv();
      name.createEl("strong", { text: transaction.category });
      name.createSpan({ text: transaction.comment ?? transaction.file.basename });
      row.createEl("time", { text: dateLabel(transaction.date) });
      row.createSpan({ text: transaction.kind === "income" ? t("Доход", "Income") : t("Расход", "Expense") });
      row.createEl("b", { cls: `is-${transaction.kind}`, text: `${transaction.kind === "income" ? "+" : "−"}${money(transaction.amount)} ₽` });
      row.addEventListener("click", () => void this.app.workspace.getLeaf(false).openFile(transaction.file));
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

function money(value: number): string { return new Intl.NumberFormat(localeCode(), { maximumFractionDigits: 0 }).format(value); }
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
