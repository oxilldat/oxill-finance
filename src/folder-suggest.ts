import { AbstractInputSuggest, App, TFolder } from "obsidian";

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(app: App, inputEl: HTMLInputElement, onChoose: (path: string) => void) {
    super(app, inputEl);
    this.limit = 50;
    this.onSelect((folder) => {
      this.setValue(folder.path);
      onChoose(folder.path);
      this.close();
    });
  }

  protected getSuggestions(query: string): TFolder[] {
    const search = query.trim().toLocaleLowerCase();
    return this.app.vault.getAllLoadedFiles()
      .filter((item): item is TFolder => item instanceof TFolder && item.path !== "/")
      .filter((folder) => search.length === 0 || folder.path.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }
}
