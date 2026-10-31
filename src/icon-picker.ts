import { getIconIds, setIcon } from "obsidian";

import { t } from "./i18n";

const PAGE_SIZE = 240;
let iconCache: string[] | null = null;

function allIcons(): string[] {
  if (!iconCache) {
    const ids = getIconIds().map((id) => String(id).replace(/^lucide-/, ""));
    iconCache = [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  }
  return iconCache;
}

export class IconPicker {
  private pop: HTMLElement | null = null;
  private grid: HTMLElement | null = null;
  private note: HTMLElement | null = null;
  private onDocumentDown: ((event: MouseEvent) => void) | null = null;
  private onKey: ((event: KeyboardEvent) => void) | null = null;
  private onScroll: ((event: Event) => void) | null = null;

  constructor(
    private readonly anchorEl: HTMLElement,
    private readonly current: string,
    private readonly onPick: (icon: string) => void,
    private readonly onClose?: () => void,
  ) {}

  isOpen(): boolean { return this.pop !== null; }

  open(): void {
    const host = this.anchorEl.closest(".modal-content")
      ?? this.anchorEl.closest(".modal")
      ?? this.anchorEl.closest(".vertical-tab-content")
      ?? document.body;
    this.pop = host.createDiv({ cls: "oxf-icon-pop" });
    const search = this.pop.createEl("input", {
      cls: "oxf-icon-search",
      attr: { type: "search", placeholder: t("Поиск значка", "Search icons"), "aria-label": t("Поиск значка", "Search icons") },
    });
    this.grid = this.pop.createDiv({ cls: "oxf-icon-grid" });
    this.note = this.pop.createDiv({ cls: "oxf-icon-note" });
    this.renderGrid("");
    this.place();
    search.addEventListener("input", () => this.renderGrid(search.value));
    this.pop.addEventListener("mousedown", (event) => event.stopPropagation());
    this.onDocumentDown = (event) => {
      if (!this.pop) return;
      const target = event.target as Node;
      if (!this.pop.contains(target) && target !== this.anchorEl && !this.anchorEl.contains(target)) this.close();
    };
    this.onKey = (event) => { if (event.key === "Escape") this.close(); };
    this.onScroll = (event) => {
      if (this.pop && !this.pop.contains(event.target as Node)) this.close();
    };
    window.setTimeout(() => {
      if (!this.pop || !this.onDocumentDown || !this.onKey || !this.onScroll) return;
      search.focus();
      search.select();
      document.addEventListener("mousedown", this.onDocumentDown);
      document.addEventListener("keydown", this.onKey);
      window.addEventListener("scroll", this.onScroll, true);
    }, 0);
  }

  close(): void {
    if (!this.pop) return;
    if (this.onDocumentDown) document.removeEventListener("mousedown", this.onDocumentDown);
    if (this.onKey) document.removeEventListener("keydown", this.onKey);
    if (this.onScroll) window.removeEventListener("scroll", this.onScroll, true);
    this.onDocumentDown = null;
    this.onKey = null;
    this.onScroll = null;
    this.pop.remove();
    this.pop = null;
    this.onClose?.();
  }

  private place(): void {
    if (!this.pop) return;
    this.pop.setCssStyles({ left: "0px", top: "0px" });
    const zero = this.pop.getBoundingClientRect();
    const anchor = this.anchorEl.getBoundingClientRect();
    const width = this.pop.offsetWidth;
    const height = this.pop.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left));
    const top = anchor.bottom + height + 8 > window.innerHeight
      ? Math.max(8, anchor.top - height - 6)
      : anchor.bottom + 6;
    this.pop.setCssStyles({ left: `${left - zero.left}px`, top: `${top - zero.top}px` });
  }

  private renderGrid(query: string): void {
    if (!this.grid) return;
    this.grid.empty();
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const icons = allIcons();
    const found = normalizedQuery ? icons.filter((icon) => icon.includes(normalizedQuery)) : icons;
    const shown = found.slice(0, PAGE_SIZE);
    for (const icon of shown) {
      const cell = this.grid.createDiv({
        cls: `oxf-icon-cell${icon === this.current ? " is-active" : ""}`,
        attr: { "aria-label": icon, title: icon, role: "button", tabindex: "0" },
      });
      setIcon(cell, icon);
      const choose = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        this.onPick(icon);
        this.close();
      };
      cell.addEventListener("click", choose);
      cell.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") choose(event);
      });
    }
    if (!this.note) return;
    if (found.length === 0) this.note.setText(t("Ничего не найдено", "No icons found"));
    else if (found.length > shown.length) this.note.setText(t(
      `Показано ${shown.length} из ${found.length}. Уточните поиск`,
      `Showing ${shown.length} of ${found.length}. Refine your search`,
    ));
    else this.note.setText(t(`Найдено: ${found.length}`, `Found: ${found.length}`));
  }
}
