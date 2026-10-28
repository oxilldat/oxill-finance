# Oxill Finance

Local-first personal finance planning for Obsidian. Oxill Finance turns Markdown notes with YAML frontmatter into an overview of income, expenses, accounts, transfers, categories, and future payments.

[English](#english) · [Русский](#русский)

## English

### What it does

- Shows income, expenses, balance, category breakdown, cash-flow dynamics, and operation history.
- Supports custom accounts, account-to-account transfers, and account balances calculated from notes.
- Provides yearly expense planning with a category-by-month heatmap.
- Creates and edits ordinary Markdown files instead of hiding financial records in a proprietary database.
- Imports and exports accounts, operations, transfers, plans, and categories as a single Excel workbook.
- Supports Russian and English interfaces, light and dark Obsidian themes, desktop and mobile layouts.

All financial data stays in your vault. The plugin does not use network requests, telemetry, external accounts, or cloud synchronization.

### Installation

#### Community plugins

Oxill Finance is being prepared for the Obsidian Community plugins directory. After it is accepted:

1. Open **Settings → Community plugins → Browse**.
2. Search for **Oxill Finance**.
3. Select **Install**, then **Enable**.

#### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub release.
2. Create `<vault>/.obsidian/plugins/oxill-finance/`.
3. Copy the three files into that directory.
4. Reload Obsidian and enable **Oxill Finance** under Community plugins.

### Quick start

Open Oxill Finance from the ribbon or command palette. Create at least one account, then add income and expense operations. The overview and account balances update from the notes stored in your vault.

By default, the plugin creates finance notes in:

- `Финансы/Операции` — income, expenses, and transfers;
- `Финансы/Счета` — accounts;
- `Финансы/Планирование` — planned expenses.

The destination folder for each note type can be changed independently in the plugin settings. Folder fields suggest existing vault folders while still allowing manual paths. Existing finance notes remain discoverable by their frontmatter and are not moved automatically when a destination changes.

### Excel import and export

Use **Settings → Oxill Finance** or the command palette to export all finance data, download an empty statement template, or import a completed `.xlsx` workbook as Markdown notes.

The workbook contains **Operations**, **Accounts**, **Planning**, **Categories**, and **Instructions** sheets. For a bank statement, paste one transaction per row into **Operations**. Required values are documented in the workbook. Dates remain Excel dates and amounts remain numeric.

Column headings and workbook instructions follow the selected Oxill Finance interface language. Import remains bilingual and accepts both Russian and English headings, including files created by earlier plugin versions.

Import previews counts and row errors before writing, blocks invalid files, never deletes notes, skips existing `finance_id` values, and reports unknown accounts. If `finance_id` is empty, Oxill Finance generates a stable ID from the row so importing the same data again does not create duplicates.

### Data format

Transaction:

```yaml
---
finance_type: transaction
finance_id: tx-example
operation: expense
amount: 850
date: "2026-10-22T12:00:00+03:00"
category: Groceries
account_id: account-main
comment: Optional comment
---
```

`operation` can be `income` or `expense`. `account_id` is optional: an operation without it remains part of the general analytics but does not affect an individual account.

Account:

```yaml
---
finance_type: account
finance_id: account-main
account_name: Main
icon: "💳"
---
```

Transfer:

```yaml
---
finance_type: transfer
finance_id: transfer-example
operation: transfer
amount: 5000
date: "2026-10-24T12:00:00+03:00"
from_account: account-main
to_account: account-savings
---
```

Transfers move money between accounts without creating false income or expenses.

Planned expense:

```yaml
---
finance_type: expense_plan
finance_id: plan-example
title: Tuition payment
amount: 35000
due_date: "2027-01-15T12:00:00+03:00"
category: Education
account_id: account-reserve
completion: create-expense
status: planned
---
```

`completion: mark-only` only marks the plan as paid. `completion: create-expense` also creates an ordinary expense operation. Completed plans receive `status: paid` and `paid_at`.

### Categories

Categories can be created before any operations exist. The overview displays up to eight segments: seven selected or largest categories and an aggregated **Other** segment. Deleting a category requires choosing a replacement; the plugin first moves all linked finance notes to that category and only then removes the original one.

### Current limitations

- Amounts are currently displayed in Russian rubles (`₽`).
- Currency conversion and exchange-rate history are not supported.
- Back up your vault before large-scale category migrations or manual frontmatter edits.

### Development

Requirements: Node.js and npm.

```shell
npm run check
npm test
npm run build
```

The production build creates `main.js`. Release packages also include `manifest.json` and `styles.css`.

## Русский

Oxill Finance — локальный инструмент финансового учёта и планирования внутри Obsidian. Источником истины остаются обычные Markdown-заметки с YAML frontmatter.

### Возможности

- обзор доходов, расходов, баланса, категорий, динамики и истории операций;
- пользовательские счета и переводы между ними без ложных доходов и расходов;
- годовое планирование будущих расходов в виде тепловой карты;
- импорт и экспорт операций, счетов, переводов, планов и категорий через единый Excel-файл;
- создание, переименование и удаление категорий с обязательным переносом связанных заметок;
- русский и английский интерфейс, светлая и тёмная темы, адаптивная компоновка.

Все финансовые данные остаются в хранилище. Плагин не выполняет сетевых запросов, не собирает телеметрию и не требует внешнего аккаунта.

### Начало работы

Откройте Oxill Finance через левую ленту или палитру команд. Создайте счёт, затем добавьте доходы и расходы. Плагин сохранит их отдельными заметками и автоматически пересчитает обзор и остатки по счетам.

Основные команды:

- `Oxill Finance: Открыть`;
- `Oxill Finance: Добавить расход`;
- `Oxill Finance: Добавить доход`;
- `Oxill Finance: Запланировать расход`.
- `Oxill Finance: Импортировать данные из Excel`;
- `Oxill Finance: Экспортировать данные в Excel`;
- `Oxill Finance: Скачать шаблон Excel`.

Для импорта банковской выписки скачайте шаблон, перенесите по одной операции в каждую строку листа `Operations` и выберите файл в настройках плагина. Перед созданием заметок Oxill Finance покажет количество найденных объектов и ошибки по конкретным строкам. Импорт не удаляет существующие заметки и не дублирует уже известные `finance_id`.

Названия столбцов и инструкция в Excel соответствуют выбранному языку интерфейса Oxill Finance. Импорт остаётся двуязычным: он принимает русские, английские и старые служебные заголовки.

В настройках можно независимо выбрать папки для операций, счетов и планирования. Поля предлагают существующие папки хранилища, но сохраняют возможность ручного ввода. Смена папки влияет только на новые заметки: существующие файлы не перемещаются и продолжают читаться по frontmatter.

Форматы заметок и правила полей приведены в англоязычном разделе [Data format](#data-format). Интерфейсный язык, категории и состав диаграммы на обзоре настраиваются в параметрах плагина.

### Поддержка и обратная связь

- [Telegram](https://t.me/oxilldat)
- [Boosty](https://boosty.to/oxilldat)
- [YouTube](https://www.youtube.com/@oxilldat)

## License

[MIT](LICENSE)
