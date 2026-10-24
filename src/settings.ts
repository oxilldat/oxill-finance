import { App, Modal, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";

import type OxillFinancePlugin from "./main";
import authorAvatar from "../assets/ava.jpg";
import { FinanceLocale, setFinanceLocale, t } from "./i18n";

export interface OxillFinanceSettings {
  selectedCategories: string[];
  customCategories: string[];
  language: FinanceLocale;
}

export const DEFAULT_SETTINGS: OxillFinanceSettings = {
  selectedCategories: [], customCategories: [], language: "ru",
};

export class FinanceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: OxillFinancePlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const selectedCount = this.plugin.settings.selectedCategories.length;
    return [
      {
        type: "group",
        cls: "oxf-finance-settings-group",
        items: [{
          name: t("Язык", "Language"),
          desc: t("Язык интерфейса Oxill Finance.", "Oxill Finance interface language."),
          render: (setting) => {
            setting.addDropdown((dropdown) => dropdown
              .addOption("ru", "Русский")
              .addOption("en", "English")
              .setValue(this.plugin.settings.language)
              .onChange(async (value) => {
                this.plugin.settings.language = value === "en" ? "en" : "ru";
                setFinanceLocale(this.plugin.settings.language);
                await this.plugin.saveFinanceSettings();
                this.update();
              }));
          },
        }],
      },
      {
        type: "group",
        cls: "oxf-finance-settings-group",
        items: [{
          name: t("Управление категориями", "Manage categories"),
          desc: t("Добавляйте категории заранее и переносите заметки при удалении.", "Create categories in advance and move notes when deleting them."),
          render: (setting) => {
            setting.addButton((button) => button.setButtonText(t("Открыть", "Open")).setCta().onClick(() => this.openCategoryManager()));
          },
        }],
      },
      {
        type: "group",
        cls: "oxf-finance-settings-group",
        items: [{
          name: selectedCount === 0 ? t("Автоматический выбор", "Automatic selection") : t("Ручной выбор", "Manual selection"),
          desc: selectedCount === 0
            ? t("Сейчас диаграмма сама показывает крупнейшие категории по расходам.", "The chart currently shows the largest expense categories automatically.")
            : t(`Выбрано вручную: ${selectedCount} из 7.`, `Selected manually: ${selectedCount} of 7.`),
          render: (setting) => {
            setting.addButton((button) => button
              .setButtonText(t("Настроить", "Configure"))
              .setCta()
              .onClick(() => this.openOverviewCategories()));
          },
        }],
      },
      {
        name: t("Автор и поддержка", "Author and support"),
        searchable: false,
        render: (setting) => {
          setting.settingEl.empty();
          setting.settingEl.addClass("oxf-finance-author-setting");
          this.renderAuthorCard(setting.settingEl);
        },
      },
    ];
  }

  private openCategoryManager(): void {
    new RefreshableSettingsModal(
      this.app,
      t("Категории", "Categories"),
      (container, refresh) => this.renderCategoryManager(container, refresh),
    ).open();
  }

  private renderCategoryManager(items: HTMLElement, refresh: () => void): void {
    let value = "";
    let addButton: HTMLButtonElement;
    const addCategory = async (): Promise<void> => {
      const name = value.trim();
      if (!name) return;
      const duplicate = this.plugin.getAvailableCategories()
        .some((category) => category.localeCompare(name, undefined, { sensitivity: "accent" }) === 0);
      if (duplicate) {
        new Notice(t("Такая категория уже существует", "This category already exists"));
        return;
      }
      this.plugin.settings.customCategories = [...this.plugin.settings.customCategories, name];
      await this.plugin.saveFinanceSettings();
      refresh();
    };
    const create = new Setting(items)
      .setName(t("Новая категория", "New category"))
      .setDesc(t("Название можно будет использовать в планировании и новых операциях.", "The name can be used in planning and new transactions."))
      .addText((text) => {
        text.setPlaceholder(t("Например, Путешествия", "For example, Travel"));
        text.onChange((next) => {
          value = next;
          addButton.disabled = value.trim().length === 0;
        });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || value.trim().length === 0) return;
          event.preventDefault();
          void addCategory();
        });
      })
      .addButton((button) => {
        button.setButtonText(t("Добавить", "Add")).setCta().setDisabled(true).onClick(() => void addCategory());
        addButton = button.buttonEl;
      });
    create.setClass("oxf-finance-category-create");

    for (const category of this.plugin.getAvailableCategories()) {
      const isCustom = this.plugin.settings.customCategories.includes(category);
      new Setting(items)
        .setName(category)
        .setDesc(isCustom ? t("Добавлена вручную", "Added manually") : t("Найдена в финансовых заметках", "Found in finance notes"))
        .addExtraButton((button) => button
          .setIcon("trash-2")
          .setTooltip(t("Удалить категорию", "Delete category"))
          .onClick(() => this.openCategoryDelete(category, refresh)));
    }
  }

  private openOverviewCategories(): void {
    new RefreshableSettingsModal(
      this.app,
      t("Категории на обзоре", "Overview categories"),
      (container, refresh) => this.renderOverviewCategories(container, refresh),
    ).open();
  }

  private renderOverviewCategories(container: HTMLElement, refresh: () => void): void {
    const selectedCount = this.plugin.settings.selectedCategories.length;
    new Setting(container)
      .setName(t("Автоматический выбор", "Automatic selection"))
      .setDesc(selectedCount === 0
        ? t("Диаграмма показывает крупнейшие категории по расходам.", "The chart shows the largest expense categories.")
        : t(`Выбрано вручную: ${selectedCount} из 7.`, `Selected manually: ${selectedCount} of 7.`))
      .addButton((button) => button.setButtonText(t("Сбросить", "Reset")).setDisabled(selectedCount === 0).onClick(async () => {
        this.plugin.settings.selectedCategories = [];
        await this.plugin.saveFinanceSettings();
        refresh();
        this.update();
      }));
    const categories = this.plugin.getAvailableCategories();
    if (categories.length === 0) {
      new Setting(container)
        .setName(t("Пока нет категорий", "No categories yet"))
        .setDesc(t("Создайте первую категорию в соседнем разделе.", "Create the first category in the neighboring section."));
      return;
    }
    for (const category of categories) {
      new Setting(container).setName(category).addToggle((toggle) => toggle
        .setValue(this.plugin.settings.selectedCategories.includes(category))
        .onChange(async (enabled) => {
          const selected = this.plugin.settings.selectedCategories;
          if (enabled && selected.length >= 7) {
            new Notice(t("Можно выбрать не более семи категорий", "You can select no more than seven categories"));
            refresh();
            return;
          }
          this.plugin.settings.selectedCategories = enabled
            ? [...selected, category]
            : selected.filter((name) => name !== category);
          await this.plugin.saveFinanceSettings();
          refresh();
          this.update();
        }));
    }
  }

  private openCategoryDelete(category: string, refresh: () => void): void {
    const targets = this.plugin.getAvailableCategories().filter((name) => name !== category);
    if (targets.length === 0) {
      new Notice(t(
        "Сначала создайте другую категорию для переноса заметок",
        "Create another category before moving the notes",
      ));
      return;
    }
    new DeleteCategoryModal(this.app, category, targets, async (target) => {
      await this.plugin.mergeCategory(category, target);
      refresh();
      this.update();
    }).open();
  }

  private renderAuthorCard(container: HTMLElement): void {
    const card = container.createDiv({ cls: "oxf-finance-author-card" });
    const top = card.createDiv({ cls: "oxf-finance-author-top" });
    top.createEl("img", {
      cls: "oxf-finance-author-avatar",
      attr: { src: authorAvatar, alt: "oxill" },
    });
    const copy = top.createDiv({ cls: "oxf-finance-author-copy" });
    copy.createDiv({ cls: "oxf-finance-author-title", text: t("Нравится плагин?", "Like the plugin?") });
    copy.createEl("p", { text: t("Поддержите проект или подпишитесь", "Support the project or follow its updates") });

    const links = card.createDiv({ cls: "oxf-finance-social-links" });
    this.addSocialButton(links, "telegram", "Telegram", "https://t.me/oxilldat",
      "M21.7 3.4 18.5 19c-.2 1.1-.9 1.4-1.8.9l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9-8.1c.4-.4-.1-.6-.6-.2L6.1 12.8 1.3 11.3c-1-.3-1-1 .2-1.5L20.3 2.6c.9-.3 1.7.2 1.4.8Z");
    this.addSocialButton(links, "boosty", "Boosty", "https://boosty.to/oxilldat",
      "m13.1 2-3.8 7.4 2.5.1-3.7 6.7 3.4.1L9.7 22c5.5-1.8 9-5.2 9-9.2 0-2.8-1.8-4.8-4.5-5.5L16.6 2h-3.5Zm-.8 17.1 1.2-4.4-2.6-.1 3.4-6.2c1.6.5 2.6 1.8 2.6 3.7 0 2.7-1.7 5-4.6 7Z");
    this.addSocialButton(links, "youtube", "YouTube", "https://www.youtube.com/@oxilldat",
      "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z");
  }

  private addSocialButton(parent: HTMLElement, brand: string, label: string, url: string, pathData: string): void {
    const link = parent.createEl("a", {
      cls: `oxf-finance-social-button is-${brand}`,
      attr: { href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": label, title: label },
    });
    const svg = createSvg("svg", { attr: { viewBox: "0 0 24 24", "aria-hidden": "true" } });
    svg.appendChild(createSvg("path", { attr: { d: pathData } }));
    link.appendChild(svg);
  }
}

class RefreshableSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly renderer: (container: HTMLElement, refresh: () => void) => void,
  ) { super(app); }

  onOpen(): void {
    this.modalEl.addClass("oxf-finance-settings-modal");
    this.titleEl.setText(this.title);
    this.refresh();
  }

  onClose(): void { this.contentEl.empty(); }

  private refresh = (): void => {
    this.contentEl.empty();
    const card = this.contentEl.createDiv({ cls: "oxf-finance-settings-modal-card" });
    this.renderer(card, this.refresh);
  };
}

class DeleteCategoryModal extends Modal {
  private target: string;

  constructor(
    app: App,
    private readonly category: string,
    private readonly targets: string[],
    private readonly onConfirm: (target: string) => Promise<void>,
  ) {
    super(app);
    this.target = targets[0] ?? "";
  }

  onOpen(): void {
    this.titleEl.setText(t("Удалить категорию?", "Delete category?"));
    this.contentEl.createEl("p", {
      text: t(
        `Все заметки категории «${this.category}» будут перенесены в выбранную категорию.`,
        `All notes in “${this.category}” will be moved to the selected category.`,
      ),
    });
    new Setting(this.contentEl)
      .setName(t("Перенести в", "Move to"))
      .setDesc(t("Удаление без переноса невозможно.", "A category cannot be deleted without moving its notes."))
      .addDropdown((dropdown) => {
        for (const target of this.targets) dropdown.addOption(target, target);
        dropdown.setValue(this.target).onChange((value) => { this.target = value; });
      });
    const actions = this.contentEl.createDiv({ cls: "oxf-modal-actions" });
    actions.createEl("button", { text: t("Отмена", "Cancel") }).addEventListener("click", () => this.close());
    actions.createEl("button", { cls: "mod-warning", text: t("Перенести и удалить", "Move and delete") })
      .addEventListener("click", () => void this.confirm());
  }

  onClose(): void { this.contentEl.empty(); }

  private async confirm(): Promise<void> {
    try {
      await this.onConfirm(this.target);
      new Notice(t("Категория удалена, заметки перенесены", "Category deleted and notes moved"));
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("Не удалось перенести заметки", "Could not move the notes"));
    }
  }
}
