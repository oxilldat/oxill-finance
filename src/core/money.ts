export function formatMoney(value: number, locale: string): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized);
}
