export function formatMoney(value: number, locale: string): string {
  const normalized = Object.is(value, -0) ? 0 : value;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized);
}

export function toMinorUnits(value: number): number {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
}

export function fromMinorUnits(value: number): number {
  return value / 100;
}

export function hasSufficientFunds(balance: number, amount: number): boolean {
  return toMinorUnits(balance) >= toMinorUnits(amount);
}

export function isZeroMoney(value: number): boolean {
  return toMinorUnits(value) === 0;
}
