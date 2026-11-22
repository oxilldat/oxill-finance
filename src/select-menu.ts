import { ButtonComponent, Menu, setIcon, Setting } from "obsidian";

export interface SelectMenuOption {
  value: string;
  label: string;
  icon?: string;
}

/** A theme-aware replacement for native selects used across Finance UI. */
export class SelectMenu {
  private menu?: Menu;
  private button?: HTMLButtonElement;
  private closedAt = 0;

  constructor(
    setting: Setting,
    private readonly options: readonly SelectMenuOption[],
    private value: string,
    private readonly onChange: (value: string) => void | Promise<void>,
    private readonly emptyLabel = "—",
  ) {
    setting.addButton((component) => this.mount(component));
  }

  destroy(): void {
    this.menu?.close();
    this.menu = undefined;
  }

  private mount(component: ButtonComponent): void {
    this.button = component.buttonEl;
    this.button.addClass("oxf-select-menu");
    this.button.disabled = this.options.length === 0;
    this.render();
    this.button.addEventListener("click", () => this.toggle());
  }

  private render(): void {
    if (!this.button) return;
    this.button.empty();
    const selected = this.options.find((option) => option.value === this.value);
    const icon = this.button.createSpan({ cls: "oxf-select-menu-icon" });
    if (selected?.icon) setIcon(icon, selected.icon);
    this.button.createSpan({ cls: "oxf-select-menu-label", text: selected?.label ?? this.emptyLabel });
    const chevron = this.button.createSpan({ cls: "oxf-select-menu-chevron" });
    setIcon(chevron, "chevron-down");
  }

  private toggle(): void {
    if (!this.button || this.button.disabled) return;
    if (this.menu) {
      this.menu.close();
      return;
    }
    if (performance.now() - this.closedAt < 180) return;
    const menu = new Menu();
    this.menu = menu;
    for (const option of this.options) {
      menu.addItem((item) => {
        item.setTitle(option.label).setChecked(option.value === this.value);
        if (option.icon) item.setIcon(option.icon);
        item.onClick(() => {
          this.value = option.value;
          this.render();
          void this.onChange(option.value);
        });
      });
    }
    menu.onHide(() => {
      if (this.menu === menu) this.menu = undefined;
      this.closedAt = performance.now();
    });
    const rect = this.button.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }
}
