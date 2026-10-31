import { AbstractInputSuggest, App, TFile } from "obsidian";

export class MarkdownFileSuggest extends AbstractInputSuggest<TFile> {
  constructor(app: App, inputEl: HTMLInputElement, onChoose: (path: string) => void) {
    super(app, inputEl);
    this.limit = 50;
    this.onSelect((file) => {
      this.setValue(file.path);
      onChoose(file.path);
      this.close();
    });
  }

  protected getSuggestions(query: string): TFile[] {
    const search = query.trim().toLocaleLowerCase();
    return this.app.vault.getMarkdownFiles()
      .filter((file) => !isFinanceNote(this.app, file))
      .filter((file) => search.length === 0 || `${file.basename} ${file.path}`.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.basename.localeCompare(right.basename));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createDiv({ text: file.basename });
    el.createEl("small", { text: file.path });
  }
}

function isFinanceNote(app: App, file: TFile): boolean {
  return typeof app.metadataCache.getFileCache(file)?.frontmatter?.finance_type === "string";
}
