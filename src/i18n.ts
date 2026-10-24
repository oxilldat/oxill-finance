export type FinanceLocale = "ru" | "en";

let locale: FinanceLocale = "ru";

export function setFinanceLocale(value: FinanceLocale): void {
  locale = value;
}

export function getFinanceLocale(): FinanceLocale {
  return locale;
}

export function t(russian: string, english: string): string {
  return locale === "en" ? english : russian;
}

export function localeCode(): string {
  return locale === "en" ? "en-US" : "ru-RU";
}
