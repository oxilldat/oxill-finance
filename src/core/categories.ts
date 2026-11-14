export interface AddCategoryResult {
  added: boolean;
  categories: string[];
  name: string;
}

export function addCustomCategory(
  customCategories: readonly string[],
  availableCategories: readonly string[],
  value: string,
): AddCategoryResult {
  const name = value.trim();
  const categories = normalizeCategories(customCategories);
  if (!name || availableCategories.some((category) => sameCategory(category, name))) {
    return { added: false, categories, name };
  }
  return { added: true, categories: [...categories, name], name };
}

function normalizeCategories(categories: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of categories) {
    const name = value.trim();
    if (name && !result.some((category) => sameCategory(category, name))) result.push(name);
  }
  return result;
}

function sameCategory(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}
