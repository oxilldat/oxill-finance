import { AbstractInputSuggest, App } from "obsidian";

export class CategorySuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly categories: () => readonly string[],
    onChoose: (category: string) => void,
  ) {
    super(app, inputEl);
    this.limit = 50;
    this.onSelect((category) => {
      this.setValue(category);
      onChoose(category);
      this.close();
    });
  }

  protected getSuggestions(query: string): string[] {
    const search = query.trim().toLocaleLowerCase();
    return this.categories()
      .filter((category) => search.length === 0 || category.toLocaleLowerCase().includes(search))
      .sort((left, right) => left.localeCompare(right));
  }

  renderSuggestion(category: string, el: HTMLElement): void {
    el.setText(category);
  }
}
