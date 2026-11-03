import type { FinanceLocale } from "../i18n";

export type ExcelSheetKind = "operations" | "accounts" | "planning" | "incomePlanning" | "plannedTransfers" | "debts" | "categories" | "instructions";

const ENGLISH_HEADERS: Record<ExcelSheetKind, string[]> = {
  operations: [
    "Finance ID", "Type", "Amount", "Date", "Category", "Account ID", "Account",
    "From account ID", "From account", "To account ID", "To account", "Comment", "Note path", "External ID",
  ],
  accounts: ["Finance ID", "Name", "Icon", "Order", "Balance", "Note path"],
  planning: [
    "Finance ID", "Title", "Amount", "Due date", "Category", "Account ID", "Account",
    "Completion action", "Status", "Paid at", "Debt ID", "Note path",
  ],
  incomePlanning: [
    "Finance ID", "Title", "Amount", "Expected date", "Category", "Account ID", "Account",
    "Completion action", "Status", "Received at", "Debt ID", "Note path",
  ],
  plannedTransfers: ["Finance ID", "Amount", "Due date", "From account ID", "From account", "To account ID", "To account", "Status", "Paid at", "Note path"],
  debts: ["Finance ID", "Name", "Person note", "Icon", "Signed amount", "Repaid amount", "Comment", "Closed at", "Note path"],
  categories: ["Name"],
  instructions: ["Field", "Description"],
};

const RUSSIAN_HEADERS: Record<ExcelSheetKind, string[]> = {
  operations: [
    "ID", "Тип", "Сумма", "Дата", "Категория", "ID счёта", "Счёт",
    "ID счёта списания", "Счёт списания", "ID счёта зачисления", "Счёт зачисления",
    "Комментарий", "Путь к заметке", "Внешний ID",
  ],
  accounts: ["ID", "Название", "Иконка", "Порядок", "Баланс", "Путь к заметке"],
  planning: [
    "ID", "Название", "Сумма", "Срок", "Категория", "ID счёта", "Счёт",
    "Действие при выполнении", "Статус", "Дата оплаты", "ID долга", "Путь к заметке",
  ],
  incomePlanning: [
    "ID", "Название", "Сумма", "Ожидаемая дата", "Категория", "ID счёта", "Счёт",
    "Действие при получении", "Статус", "Дата получения", "ID долга", "Путь к заметке",
  ],
  plannedTransfers: ["ID", "Сумма", "Срок", "ID счёта списания", "Счёт списания", "ID счёта зачисления", "Счёт зачисления", "Статус", "Дата выполнения", "Путь к заметке"],
  debts: ["ID", "Название", "Заметка человека", "Иконка", "Сумма со знаком", "Погашено", "Комментарий", "Дата закрытия", "Путь к заметке"],
  categories: ["Название"],
  instructions: ["Поле", "Описание"],
};

export function excelHeaders(kind: ExcelSheetKind, locale: FinanceLocale): string[] {
  return [...(locale === "en" ? ENGLISH_HEADERS[kind] : RUSSIAN_HEADERS[kind])];
}
