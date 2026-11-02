import { App, Modal, setIcon } from "obsidian";

import { expenseDeviationPercent } from "./core/month-summary";
import { localeCode, t } from "./i18n";
import type { FinanceMonthSummary } from "./types";

export class MonthSummaryModal extends Modal {
  constructor(
    app: App,
    private summary: FinanceMonthSummary,
    private readonly recalculate: () => Promise<FinanceMonthSummary>,
    private readonly showManualRecalculate: boolean,
    private readonly exportExcel: (summary: FinanceMonthSummary) => void,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("oxf-month-summary-modal");
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    const heading = this.contentEl.createDiv({ cls: "oxf-month-summary-heading" });
    const title = heading.createDiv();
    title.createEl("h2", { text: `${t("Факт", "Actual")}: ${periodLabel(this.summary.period)}` });
    title.createEl("p", { text: `${t("Сформировано", "Generated")}: ${new Intl.DateTimeFormat(localeCode(), { dateStyle: "medium" }).format(this.summary.generatedAt)}` });
    renderAccuracy(this.contentEl, this.summary);
    const totals = this.contentEl.createDiv({ cls: "oxf-month-summary-totals" });
    renderTotal(totals, t("Доходы", "Income"), this.summary.plannedIncome, this.summary.actualIncome);
    renderTotal(totals, t("Расходы", "Expenses"), this.summary.plannedExpenses, this.summary.actualExpenses);
    renderTotal(totals, t("Переводы", "Transfers"), this.summary.plannedTransfers, this.summary.actualTransfers);

    const table = this.contentEl.createDiv({ cls: "oxf-month-summary-table" });
    for (const label of [t("Категория", "Category"), t("План", "Plan"), t("Факт", "Actual"), t("Отклонение", "Variance")]) table.createEl("strong", { text: label });
    for (const category of this.summary.categories) {
      table.createSpan({ text: category.name });
      table.createSpan({ text: `${money(category.planned)} ₽` });
      table.createSpan({ text: `${money(category.actual)} ₽` });
      const variance = category.actual - category.planned;
      table.createSpan({ cls: variance > 0 ? "is-over" : variance < 0 ? "is-under" : "", text: `${variance > 0 ? "+" : ""}${money(variance)} ₽` });
    }
    if (this.summary.categories.length === 0) this.contentEl.createEl("p", { cls: "oxf-month-summary-empty", text: t("В этом месяце нет расходов для сравнения.", "There are no expenses to compare in this month.") });

    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    if (this.showManualRecalculate) {
      const recalculate = actions.createEl("button", { text: t("Пересчитать", "Recalculate"), attr: { type: "button" } });
      recalculate.addEventListener("click", async () => {
        recalculate.disabled = true;
        this.summary = await this.recalculate();
        this.render();
      });
    }
    const exportButton = actions.createEl("button", { cls: "oxf-month-summary-export", attr: { type: "button", "aria-label": t("Сформировать отчёт Excel", "Create Excel report"), title: t("Сформировать отчёт Excel", "Create Excel report") } });
    setIcon(exportButton, "file-spreadsheet");
    exportButton.addEventListener("click", () => this.exportExcel(this.summary));
    actions.createEl("button", { text: t("Закрыть", "Close"), attr: { type: "button" } }).addEventListener("click", () => this.close());
  }
}

export function renderAccuracy(container: HTMLElement, summary: FinanceMonthSummary): void {
  const deviation = expenseDeviationPercent(summary);
  const card = container.createDiv({ cls: "oxf-accuracy" });
  const labels = card.createDiv({ cls: "oxf-accuracy-labels" });
  labels.createSpan({ text: t("Экономия", "Under plan") });
  labels.createSpan({ text: t("Перерасход", "Over plan") });
  const track = card.createDiv({ cls: "oxf-accuracy-track" });
  track.createDiv({ cls: "oxf-accuracy-zone is-left" });
  track.createDiv({ cls: "oxf-accuracy-zone is-center" });
  track.createDiv({ cls: "oxf-accuracy-zone is-right" });
  const marker = track.createDiv({ cls: "oxf-accuracy-marker", attr: { "aria-label": `${deviation.toFixed(1)}%` } });
  marker.setCssProps({ left: `${Math.max(0, Math.min(100, 50 + deviation))}%` });
  card.createEl("strong", { text: `${deviation > 0 ? "+" : ""}${deviation.toFixed(1).replace(".", localeCode() === "ru" ? "," : ".")}%` });
  card.createSpan({ text: `${t("План", "Plan")} ${money(summary.plannedExpenses)} ₽ · ${t("Факт", "Actual")} ${money(summary.actualExpenses)} ₽` });
}

function renderTotal(container: HTMLElement, label: string, planned: number, actual: number): void {
  const item = container.createDiv();
  item.createSpan({ text: label });
  item.createEl("strong", { text: `${money(actual)} ₽` });
  item.createEl("small", { text: `${t("План", "Plan")}: ${money(planned)} ₽` });
}

function periodLabel(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, 1);
  const name = new Intl.DateTimeFormat(localeCode(), { month: "long", year: "numeric" }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function money(value: number): string { return new Intl.NumberFormat(localeCode(), { maximumFractionDigits: 2 }).format(value); }
