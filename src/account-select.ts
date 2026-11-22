import { ButtonComponent, Menu, setIcon, Setting } from "obsidian";

import { normalizeAccountIcon } from "./core/account-icons";
import { t } from "./i18n";
import type { FinanceAccount } from "./types";

export class AccountSelect {
  private menu?: Menu;
  private closedAt = 0;
  private button?: HTMLButtonElement;

  constructor(
    setting: Setting,
    private readonly accounts: readonly FinanceAccount[],
    private value: string,
    private readonly onChange: (value: string) => void,
    private readonly allowEmpty = false,
  ) {
    setting.addButton((component) => this.mount(component));
  }

  destroy(): void {
    this.menu?.close();
    this.menu = undefined;
  }

  private mount(component: ButtonComponent): void {
    this.button = component.buttonEl;
    this.button.addClass("oxf-account-select");
    this.render();
    this.button.addEventListener("click", () => this.toggle());
  }

  private render(): void {
    if (!this.button) return;
    this.button.empty();
    const account = this.accounts.find((item) => item.id === this.value);
    const icon = this.button.createSpan({ cls: "oxf-account-select-icon" });
    setIcon(icon, account ? normalizeAccountIcon(account.icon) : "circle-slash-2");
    this.button.createSpan({
      cls: "oxf-account-select-label",
      text: account?.name ?? (this.allowEmpty ? t("Без счёта", "No account") : t("Выберите счёт", "Select an account")),
    });
    const chevron = this.button.createSpan({ cls: "oxf-account-select-chevron" });
    setIcon(chevron, "chevron-down");
  }

  private toggle(): void {
    if (!this.button) return;
    if (this.menu) {
      this.menu.close();
      return;
    }
    if (performance.now() - this.closedAt < 180) return;

    const menu = new Menu();
    this.menu = menu;
    if (this.allowEmpty) {
      menu.addItem((item) => item
        .setTitle(t("Без счёта", "No account"))
        .setIcon("circle-slash-2")
        .setChecked(this.value === "")
        .onClick(() => this.select("")));
      menu.addSeparator();
    }
    for (const account of this.accounts) {
      menu.addItem((item) => item
        .setTitle(account.name)
        .setIcon(normalizeAccountIcon(account.icon))
        .setChecked(this.value === account.id)
        .onClick(() => this.select(account.id)));
    }
    menu.onHide(() => {
      if (this.menu === menu) this.menu = undefined;
      this.closedAt = performance.now();
    });
    const rect = this.button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private select(value: string): void {
    this.value = value;
    this.render();
    this.onChange(value);
  }
}
