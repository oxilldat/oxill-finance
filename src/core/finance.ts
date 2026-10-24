import { CategoryTotal, FinanceSummary, FinanceTransaction, FlowBucket, PeriodKind } from "../types";
import { localeCode, t } from "../i18n";

export function selectCategorySlices(categories: CategoryTotal[], selected: string[]): CategoryTotal[] {
  if (categories.length === 0) return [];
  const selectedNames = [...new Set(selected)].slice(0, 7);
  const categoryByName = new Map(categories.map((category) => [category.name, category]));
  const visible = selectedNames.length > 0
    ? selectedNames.map((name) => categoryByName.get(name)).filter((category): category is CategoryTotal => Boolean(category))
    : categories.slice(0, categories.length > 8 ? 7 : 8);
  const visibleNames = new Set(visible.map((category) => category.name));
  const hiddenTotals = categories.filter((category) => !visibleNames.has(category.name));
  const otherAmount = hiddenTotals.reduce((sum, category) => sum + category.amount, 0);
  const otherShare = hiddenTotals.reduce((sum, category) => sum + category.share, 0);
  return otherAmount > 0 ? [...visible, { name: t("Другое", "Other"), amount: otherAmount, share: otherShare }] : visible;
}

export function calculateSummary(
  transactions: FinanceTransaction[],
  period: PeriodKind,
  now = new Date(),
  rangeOverride?: { start: Date; end: Date; label: string },
): FinanceSummary {
  const range = rangeOverride ?? getRange(period, now);
  const visible: FinanceTransaction[] = [];
  let income = 0;
  let expense = 0;
  let balance = 0;
  const categoryMap = new Map<string, number>();
  for (const item of transactions) {
    balance += item.kind === "income" ? item.amount : -item.amount;
    if (!inRange(item.date, range.start, range.end)) continue;
    visible.push(item);
    if (item.kind === "income") income += item.amount;
    else {
      expense += item.amount;
      categoryMap.set(item.category, (categoryMap.get(item.category) ?? 0) + item.amount);
    }
  }
  visible.sort((left, right) => right.date.getTime() - left.date.getTime());
  const categories = [...categoryMap.entries()]
    .map(([name, amount]) => ({ name, amount, share: expense > 0 ? amount / expense : 0 }))
    .sort((left, right) => right.amount - left.amount);

  return {
    label: range.label,
    balance,
    income,
    expense,
    savingsRate: income > 0 ? (income - expense) / income : 0,
    flow: createFlow(visible, period, now, rangeOverride),
    categories,
    transactions: visible,
  };
}

function createFlow(
  transactions: FinanceTransaction[],
  period: PeriodKind,
  now: Date,
  rangeOverride?: { start: Date; end: Date },
): FlowBucket[] {
  const customUsesDays = rangeOverride ? daysBetween(rangeOverride.start, rangeOverride.end) <= 31 : false;
  const buckets = rangeOverride
    ? customUsesDays ? rangeDayBuckets(rangeOverride.start, rangeOverride.end) : rangeMonthBuckets(rangeOverride.start, rangeOverride.end)
    : period === "day"
      ? singleDayBucket(now)
      : period === "week"
      ? weekBuckets(now)
      : period === "month"
        ? dayBuckets(now)
        : monthBuckets(period, now);
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const transaction of transactions) {
    const key = rangeOverride
      ? customUsesDays ? dayKey(transaction.date) : monthKey(transaction.date)
      : period === "day" || period === "week" || period === "month"
      ? dayKey(transaction.date)
      : monthKey(transaction.date);
    const bucket = bucketByKey.get(key);
    if (bucket) bucket[transaction.kind] += transaction.amount;
  }
  return buckets.map(({ label, income, expense }) => ({ label, income, expense }));
}

function singleDayBucket(now: Date): Array<FlowBucket & { key: string }> {
  return [{ key: dayKey(now), label: String(now.getDate()), income: 0, expense: 0 }];
}

function rangeDayBuckets(start: Date, end: Date): Array<FlowBucket & { key: string }> {
  const count = daysBetween(start, end);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { key: dayKey(date), label: String(date.getDate()), income: 0, expense: 0 };
  });
}

function rangeMonthBuckets(start: Date, end: Date): Array<FlowBucket & { key: string }> {
  const count = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    return { key: monthKey(date), label: monthLabel(date), income: 0, expense: 0 };
  });
}

function dayBuckets(now: Date): Array<FlowBucket & { key: string }> {
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), index + 1);
    return { key: dayKey(date), label: String(index + 1), income: 0, expense: 0 };
  });
}

function weekBuckets(now: Date): Array<FlowBucket & { key: string }> {
  const mondayOffset = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const weekday = new Intl.DateTimeFormat(localeCode(), { weekday: "short" }).format(date).replace(".", "");
    return { key: dayKey(date), label: capitalize(weekday), income: 0, expense: 0 };
  });
}

function monthBuckets(period: PeriodKind, now: Date): Array<FlowBucket & { key: string }> {
  const count = period === "quarter" ? 3 : period === "half-year" ? 6 : 12;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - count + index + 1, 1);
    const label = new Intl.DateTimeFormat(localeCode(), { month: "short" }).format(date).replace(".", "");
    return { key: monthKey(date), label, income: 0, expense: 0 };
  });
}

function getRange(period: PeriodKind, now: Date): { start: Date; end: Date; label: string } {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  if (period === "day") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
      label: capitalize(new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "long", year: "numeric" }).format(now)),
    };
  }
  if (period === "week") {
    const mondayOffset = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
    const sunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const dayMonth = new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short" });
    return { start, end: new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59, 999), label: `${dayMonth.format(start)} — ${dayMonth.format(sunday)}` };
  }
  if (period === "month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end,
      label: capitalize(new Intl.DateTimeFormat(localeCode(), { month: "long", year: "numeric" }).format(now)),
    };
  }
  if (period === "half-year") {
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return { start, end, label: `${monthLabel(start)} — ${monthLabel(now)} ${now.getFullYear()}` };
  }
  if (period === "quarter") {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), quarterStartMonth, 1);
    const quarterEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999);
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    return { start, end: quarterEnd, label: t(`${quarter} квартал ${now.getFullYear()}`, `Q${quarter} ${now.getFullYear()}`) };
  }
  return {
    start: new Date(now.getFullYear(), 0, 1),
    end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
    label: t(`${now.getFullYear()} год`, String(now.getFullYear())),
  };
}

function inRange(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function monthLabel(date: Date): string {
  return capitalize(new Intl.DateTimeFormat(localeCode(), { month: "short" }).format(date).replace(".", ""));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function daysBetween(start: Date, end: Date): number {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.max(1, Math.round((endDay - startDay) / 86_400_000) + 1);
}
