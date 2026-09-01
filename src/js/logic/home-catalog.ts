export const TOOL_CATALOG_OPEN_CLASS = 'is-tool-catalog-open';
export const FAVORITES_CATEGORY_ID = 'favorites';

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
  if (!options.selectedCategory) return true;
  if (options.selectedCategory === FAVORITES_CATEGORY_ID) {
    return options.isFavorites;
  }
  return options.categoryName === options.selectedCategory;
}

export function toggleSelectedCategory(
  current: string | null,
  next: string
): string | null {
  return current === next ? null : next;
}
