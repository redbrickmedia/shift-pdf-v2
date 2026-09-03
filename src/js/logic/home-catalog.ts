export const TOOL_CATALOG_OPEN_CLASS = 'is-tool-catalog-open';
export const FAVORITES_CATEGORY_ID = 'favorites';
export const ALL_TOOLS_CATEGORY_ID = 'All tools';

export function isAllToolsCategory(
  selectedCategory: string | null | undefined
): boolean {
  return !selectedCategory || selectedCategory === ALL_TOOLS_CATEGORY_ID;
}

export function getDefaultSelectedCategory(
  storedCategory?: string | null
): string {
  if (storedCategory && storedCategory.trim()) {
    return storedCategory;
  }
  return ALL_TOOLS_CATEGORY_ID;
}

/** Chip order for the home catalog toolbar: All tools first, then categories. */
export function getCategoryChipOrder(categoryNames: string[]): string[] {
  return [ALL_TOOLS_CATEGORY_ID, ...categoryNames];
}

export function shouldShowToolCatalog(options: {
  searchFocused: boolean;
  searchQuery: string;
  selectedCategory?: string | null;
}): boolean {
  const hasQuery = options.searchQuery.trim().length > 0;
  const hasCategory =
    Boolean(options.selectedCategory) &&
    options.selectedCategory !== FAVORITES_CATEGORY_ID;
  return options.searchFocused || hasQuery || hasCategory;
}

export function setToolCatalogOpen(
  gridView: HTMLElement | null,
  open: boolean
): void {
  gridView?.classList.toggle(TOOL_CATALOG_OPEN_CLASS, open);
}

export function shouldShowCategoryGroup(options: {
  isFavorites: boolean;
  categoryName: string | null | undefined;
  selectedCategory: string | null;
}): boolean {
  if (isAllToolsCategory(options.selectedCategory)) return true;
  if (options.selectedCategory === FAVORITES_CATEGORY_ID) {
    return options.isFavorites;
  }
  return options.categoryName === options.selectedCategory;
}

export function toggleSelectedCategory(
  current: string | null,
  next: string
): string {
  if (next === ALL_TOOLS_CATEGORY_ID) return ALL_TOOLS_CATEGORY_ID;
  if (current === next) return ALL_TOOLS_CATEGORY_ID;
  return next;
}
