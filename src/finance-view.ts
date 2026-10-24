import { ItemView, Menu, setIcon, WorkspaceLeaf } from "obsidian";

import { calculateSummary, selectCategorySlices } from "./core/finance";
import { TransactionStore } from "./transaction-store";
import { ExpensePlan, FinanceAccount, FinanceSummary, FinanceTransaction, PeriodKind, TransactionKind } from "./types";
import { localeCode, t } from "./i18n";

export const VIEW_TYPE_FINANCE = "oxill-finance-dashboard";
type NavigationItem = "overview" | "accounts" | "planning";
interface FinanceViewActions {
  openTransaction: (kind: TransactionKind, accountId?: string) => void;
  createAccount: () => void;
  editAccount: (account: FinanceAccount) => void;
  transfer: (accountId?: string) => void;
  deleteAccount: (account: FinanceAccount) => void;
  createPlan: (category?: string, dueDate?: Date) => void;
  editPlan: (plan: ExpensePlan) => void;
  deletePlan: (plan: ExpensePlan) => void;
  completePlan: (plan: ExpensePlan) => void;
  selectedCategories: () => string[];
  availableCategories: () => string[];
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
  private selectedPlanningCell?: { category: string; month: number };
  private activeSection: NavigationItem = "overview";
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
    donut.style.background = `conic-gradient(${stops.join(",")})`;
    const center = donut.createDiv();
    center.createSpan({ text: t("Расходы", "Expenses") });
    center.createEl("strong", { text: `${money(summary.expense)} ₽` });
    const legend = body.createDiv({ cls: "oxf-category-legend" });
    slices.forEach((slice, index) => {
      const row = legend.createDiv();
      const label = row.createDiv();
      const marker = label.createSpan({ cls: "oxf-category-marker" });
      marker.style.backgroundColor = colors[index] ?? colors[0] ?? "#7c6cf2";
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
      row.createSpan({ cls: "oxf-snapshot-icon", text: account.icon });
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
        bar.style.height = `${(bucket[kind] / max) * 100}%`;
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
    for (const account of accounts) this.renderAccountCard(grid, account, accounts.length);
  }

  private renderPlanning(container: HTMLElement): void {
    const plans = this.store.getIndex().plans;
    const yearPlans = plans.filter((plan) => plan.dueDate.getFullYear() === this.planningYear);
    const pending = yearPlans.filter((plan) => plan.status === "planned");
    const total = pending.reduce((sum, plan) => sum + plan.amount, 0);

    const heading = container.createDiv({ cls: "oxf-planning-heading" });
    const title = heading.createDiv();
    title.createEl("h2", { text: t("Планирование", "Planning") });
    title.createEl("p", { text: t("Годовая карта будущих расходов", "Annual map of future expenses") });
    const actions = heading.createDiv({ cls: "oxf-planning-actions" });
    const yearControl = actions.createDiv({ cls: "oxf-year-control" });
    const previous = yearControl.createEl("button", { attr: { type: "button", "aria-label": t("Предыдущий год", "Previous year") } });
    setIcon(previous, "chevron-left");
    previous.addEventListener("click", () => { this.planningYear -= 1; this.render(); });
    yearControl.createEl("strong", { text: String(this.planningYear) });
    const next = yearControl.createEl("button", { attr: { type: "button", "aria-label": t("Следующий год", "Next year") } });
    setIcon(next, "chevron-right");
    next.addEventListener("click", () => { this.planningYear += 1; this.render(); });
    actions.createEl("button", { cls: "mod-cta", text: t("+ Запланировать", "+ Plan expense"), attr: { type: "button" } })
      .addEventListener("click", () => this.actions.createPlan());

    const workspace = container.createDiv({ cls: "oxf-planning-workspace" });
    const summary = workspace.createDiv({ cls: "oxf-planning-summary" });
    this.renderPlanningMetric(summary, t("Запланировано", "Planned"), `${money(total)} ₽`);
    this.renderPlanningMetric(summary, t("Предстоящих", "Upcoming"), String(pending.length));
    this.renderPlanningHeatmap(workspace, yearPlans);
  }

  private renderPlanningMetric(container: HTMLElement, label: string, value: string): void {
    const card = container.createDiv({ cls: "oxf-card oxf-planning-metric" });
    card.createSpan({ text: label });
    card.createEl("strong", { text: value });
  }

  private renderPlanningHeatmap(container: HTMLElement, plans: ExpensePlan[]): void {
    const transactionCategories = this.store.getIndex().transactions
      .filter((transaction) => transaction.kind === "expense")
      .map((transaction) => transaction.category);
    const categories = [...new Set([...this.actions.availableCategories(), ...plans.map((plan) => plan.category), ...transactionCategories])]
      .sort((left, right) => left.localeCompare(right, localeCode()));
    const card = container.createDiv({ cls: "oxf-card oxf-planning-map-card" });
    const scroll = card.createDiv({ cls: "oxf-planning-map-scroll" });
    const grid = scroll.createDiv({ cls: "oxf-planning-map" });
    grid.createDiv({ cls: "oxf-planning-corner" });
    const monthLabels = planningMonthLabels();
    const monthNames = Array.from({ length: 12 }, (_, month) => capitalize(new Intl.DateTimeFormat(localeCode(), { month: "long" }).format(new Date(2020, month, 1))));
    for (let month = 0; month < monthLabels.length; month += 1) {
      grid.createDiv({ cls: "oxf-planning-month", text: monthLabels[month] ?? "", attr: { title: monthNames[month] ?? "" } });
    }
    if (categories.length === 0) {
      const empty = grid.createDiv({ cls: "oxf-planning-map-empty", text: t("Категории появятся после добавления расходов или планов", "Categories will appear after you add expenses or plans") });
      empty.style.gridColumn = "1 / -1";
      this.renderPlanningInspector(container, plans);
      return;
    }
    const totals = plans.reduce((result, plan) => {
      const key = `${plan.category}\u0000${plan.dueDate.getMonth()}`;
      result.set(key, (result.get(key) ?? 0) + plan.amount);
      return result;
    }, new Map<string, number>());
    const plansByCell = plans.reduce((result, plan) => {
      const key = `${plan.category}\u0000${plan.dueDate.getMonth()}`;
      const cellPlans = result.get(key);
      if (cellPlans) cellPlans.push(plan);
      else result.set(key, [plan]);
      return result;
    }, new Map<string, ExpensePlan[]>());
    const max = Math.max(...totals.values(), 1);
    for (const category of categories) {
      grid.createDiv({ cls: "oxf-planning-category", text: category });
      for (let month = 0; month < 12; month += 1) {
        const cellPlans = plansByCell.get(`${category}\u0000${month}`) ?? [];
        const sum = cellPlans.reduce((value, plan) => value + plan.amount, 0);
        const allPaid = cellPlans.length > 0 && cellPlans.every((plan) => plan.status === "paid");
        const level = sum > 0 ? Math.max(1, Math.ceil((sum / max) * 4)) : 0;
        const cell = grid.createEl("button", {
          cls: `oxf-planning-cell is-level-${level}${allPaid ? " is-checked" : ""}${this.selectedPlanningCell?.category === category && this.selectedPlanningCell.month === month ? " is-selected" : ""}`,
          attr: { type: "button", "aria-label": planningCellLabel(category, month, cellPlans) },
        });
        if (allPaid) setIcon(cell, "check");
        cell.addEventListener("click", () => {
          this.selectedPlanningCell = { category, month };
          this.render();
        });
      }
    }
    this.renderPlanningInspector(container, plans);
  }

  private renderPlanningInspector(container: HTMLElement, plans: ExpensePlan[]): void {
    const panel = container.createEl("aside", { cls: "oxf-card oxf-planning-inspector" });
    const monthLabels = planningMonthLabels();
    const selected = this.selectedPlanningCell;
    if (!selected) {
      panel.createEl("strong", { text: t("Нагрузка по месяцам", "Monthly load") });
      panel.createEl("p", { text: t("Выберите квадрат, чтобы посмотреть планы.", "Select a cell to view plans.") });
      const monthly = Array<number>(12).fill(0);
      for (const plan of plans) {
        if (plan.status === "planned") monthly[plan.dueDate.getMonth()] = (monthly[plan.dueDate.getMonth()] ?? 0) + plan.amount;
      }
      const max = Math.max(...monthly, 1);
      const chart = panel.createDiv({ cls: "oxf-planning-mini-chart" });
      for (let month = 0; month < 12; month += 1) {
        const column = chart.createDiv();
        const value = monthly[month] ?? 0;
        const bar = column.createDiv({ cls: value > 0 ? "has-value" : "", attr: { title: `${money(value)} ₽` } });
        bar.style.height = value > 0 ? `${(value / max) * 100}%` : "0";
        column.createSpan({ text: monthLabels[month] ?? "" });
      }
      return;
    }
    const monthName = capitalize(new Intl.DateTimeFormat(localeCode(), { month: "long" }).format(new Date(this.planningYear, selected.month, 1)));
    const heading = panel.createDiv({ cls: "oxf-planning-inspector-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("strong", { text: selected.category });
    headingText.createSpan({ text: `${monthName} ${this.planningYear}` });
    const close = heading.createEl("button", { attr: { type: "button", "aria-label": t("Закрыть детали", "Close details") } });
    setIcon(close, "x");
    close.addEventListener("click", () => { this.selectedPlanningCell = undefined; this.render(); });
    const cellPlans = plans.filter((plan) => plan.category === selected.category && plan.dueDate.getMonth() === selected.month);
    if (cellPlans.length === 0) panel.createEl("p", { text: t("В этом месяце расходов пока нет.", "There are no expenses in this month yet.") });
    else {
      const list = panel.createDiv({ cls: "oxf-inspector-plan-list" });
      for (const plan of cellPlans) {
        const item = list.createDiv({ cls: `oxf-inspector-plan${plan.status === "paid" ? " is-paid" : ""}` });
        const check = item.createEl("button", { attr: { type: "button", "aria-label": plan.status === "paid" ? t("Выполнено", "Completed") : t("Выполнить", "Complete") } });
        setIcon(check, plan.status === "paid" ? "circle-check-big" : "circle");
        check.disabled = plan.status === "paid";
        if (plan.status === "planned") check.addEventListener("click", () => this.actions.completePlan(plan));
        const text = item.createDiv();
        text.createEl("strong", { text: plan.title });
        text.createSpan({ text: `${plan.dueDate.getDate()} ${monthName.toLowerCase()} · ${money(plan.amount)} ₽` });
        const menu = item.createEl("button", { cls: "oxf-inspector-plan-menu", attr: { type: "button", "aria-label": t("Действия с планом", "Plan actions") } });
        setIcon(menu, "ellipsis");
        menu.addEventListener("click", (event) => this.showPlanMenu(event, plan));
      }
    }
    panel.createEl("button", { cls: "oxf-inspector-add", text: t("+ Добавить расход", "+ Add expense"), attr: { type: "button" } })
      .addEventListener("click", () => this.actions.createPlan(selected.category, new Date(this.planningYear, selected.month, 1, 12)));
  }

  private showPlanMenu(event: MouseEvent, plan: ExpensePlan): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("Изменить", "Edit")).setIcon("pencil").onClick(() => this.actions.editPlan(plan)));
    menu.addItem((item) => item.setTitle(t("Удалить", "Delete")).setIcon("trash-2").onClick(() => this.actions.deletePlan(plan)));
    menu.showAtMouseEvent(event);
  }

  private renderAccountCard(container: HTMLElement, account: FinanceAccount, accountCount: number): void {
    const card = container.createEl("section", { cls: "oxf-account-row" });
    card.createSpan({ cls: "oxf-account-icon", text: account.icon });
    const identity = card.createDiv({ cls: "oxf-account-identity" });
    identity.createEl("strong", { text: account.name });
    identity.createEl("span", { text: account.balance === 0 ? t("Нет средств", "No funds") : t("Доступно сейчас", "Available now") });
    card.createEl("strong", { cls: `oxf-account-balance${account.balance < 0 ? " is-negative" : ""}`, text: `${money(account.balance)} ₽` });
    const transfer = card.createEl("button", { cls: "oxf-account-transfer", text: t("Перевести", "Transfer"), attr: { type: "button" } });
    transfer.disabled = accountCount < 2 || account.balance <= 0;
    transfer.addEventListener("click", () => this.actions.transfer(account.id));
    const more = card.createEl("button", { cls: "oxf-account-more", text: "•••", attr: { type: "button", "aria-label": t(`Действия со счётом ${account.name}`, `Actions for account ${account.name}`) } });
    more.addEventListener("click", (event) => this.showAccountMenu(event, account));
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
      name.createEl("span", { text: transaction.comment ?? transaction.file.basename });
      row.createEl("time", { text: dateLabel(transaction.date) });
      row.createEl("span", { text: transaction.kind === "income" ? t("Доход", "Income") : t("Расход", "Expense") });
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
function planningCellLabel(category: string, month: number, plans: ExpensePlan[]): string {
  const monthName = new Intl.DateTimeFormat(localeCode(), { month: "long" }).format(new Date(2020, month, 1));
  if (plans.length === 0) return t(`${category}, ${monthName}: планов нет`, `${category}, ${monthName}: no plans`);
  const sum = plans.reduce((value, plan) => value + plan.amount, 0);
  const open = plans.filter((plan) => plan.status === "planned").length;
  return t(
    `${category}, ${monthName}: ${money(sum)} ₽, ${open > 0 ? `не выполнено ${open}` : "выполнено"}`,
    `${category}, ${monthName}: ${money(sum)} ₽, ${open > 0 ? `${open} pending` : "completed"}`,
  );
}
function categoryColors(): string[] {
  return ["#7c6cf2", "#4f8fe8", "#39a58a", "#e5a83e", "#dc6f57", "#a86dd4", "#58a6b3", "#87909a"];
}
function planningMonthLabels(): string[] {
  return t("Я,Ф,М,А,М,И,И,А,С,О,Н,Д", "J,F,M,A,M,J,J,A,S,O,N,D").split(",");
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
