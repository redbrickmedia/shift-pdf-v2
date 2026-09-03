import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL_TOOLS_CATEGORY_ID,
  getCategoryChipOrder,
  getDefaultSelectedCategory,
  isAllToolsCategory,
  shouldShowToolCatalog,
  shouldShowCategoryGroup,
  setToolCatalogOpen,
  toggleSelectedCategory,
  TOOL_CATALOG_OPEN_CLASS,
} from '../js/logic/home-catalog';
import {
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

afterEach(() => {
  resetWorkspaceFileIndicator();
});

describe('home catalog visibility', () => {
  it('hides the full catalog until search is active or a category is selected', () => {
    expect(
      shouldShowToolCatalog({ searchFocused: false, searchQuery: '' })
    ).toBe(false);
    expect(
      shouldShowToolCatalog({ searchFocused: false, searchQuery: '   ' })
    ).toBe(false);
    expect(
      shouldShowToolCatalog({
        searchFocused: false,
        searchQuery: '',
        selectedCategory: null,
      })
    ).toBe(false);
  });

  it('shows the catalog when search is focused or has a query', () => {
    expect(
      shouldShowToolCatalog({ searchFocused: true, searchQuery: '' })
    ).toBe(true);
    expect(
      shouldShowToolCatalog({ searchFocused: false, searchQuery: 'merge' })
    ).toBe(true);
  });

  it('shows the catalog when All tools is selected by default', () => {
    expect(
      shouldShowToolCatalog({
        searchFocused: false,
        searchQuery: '',
        selectedCategory: ALL_TOOLS_CATEGORY_ID,
      })
    ).toBe(true);
  });

  it('shows the catalog when a non-favorite category chip is selected', () => {
    expect(
      shouldShowToolCatalog({
        searchFocused: false,
        searchQuery: '',
        selectedCategory: 'Convert to PDF',
      })
    ).toBe(true);
    expect(
      shouldShowToolCatalog({
        searchFocused: false,
        searchQuery: '',
        selectedCategory: 'favorites',
      })
    ).toBe(false);
  });

  it('limits the grid to the selected category', () => {
    expect(
      shouldShowCategoryGroup({
        isFavorites: false,
        categoryName: 'Convert to PDF',
        selectedCategory: 'Convert to PDF',
      })
    ).toBe(true);
    expect(
      shouldShowCategoryGroup({
        isFavorites: true,
        categoryName: undefined,
        selectedCategory: 'Convert to PDF',
      })
    ).toBe(false);
    expect(
      shouldShowCategoryGroup({
        isFavorites: true,
        categoryName: undefined,
        selectedCategory: null,
      })
    ).toBe(true);
  });

  it('shows favorites above the full catalog when All tools is selected', () => {
    expect(
      shouldShowCategoryGroup({
        isFavorites: true,
        categoryName: undefined,
        selectedCategory: ALL_TOOLS_CATEGORY_ID,
      })
    ).toBe(true);
    expect(
      shouldShowCategoryGroup({
        isFavorites: false,
        categoryName: 'Popular Tools',
        selectedCategory: ALL_TOOLS_CATEGORY_ID,
      })
    ).toBe(true);
    expect(
      shouldShowCategoryGroup({
        isFavorites: false,
        categoryName: 'Secure PDF',
        selectedCategory: ALL_TOOLS_CATEGORY_ID,
      })
    ).toBe(true);
  });

  it('places the All tools chip first in the toolbar order', () => {
    expect(
      getCategoryChipOrder([
        'Popular Tools',
        'Edit & Annotate',
        'Convert to PDF',
      ])
    ).toEqual([
      ALL_TOOLS_CATEGORY_ID,
      'Popular Tools',
      'Edit & Annotate',
      'Convert to PDF',
    ]);
  });

  it('defaults to All tools when no stored category preference exists', () => {
    expect(getDefaultSelectedCategory()).toBe(ALL_TOOLS_CATEGORY_ID);
    expect(getDefaultSelectedCategory(null)).toBe(ALL_TOOLS_CATEGORY_ID);
    expect(getDefaultSelectedCategory('')).toBe(ALL_TOOLS_CATEGORY_ID);
    expect(getDefaultSelectedCategory('   ')).toBe(ALL_TOOLS_CATEGORY_ID);
    expect(isAllToolsCategory(getDefaultSelectedCategory())).toBe(true);
  });

  it('keeps an explicit stored category preference over the All tools default', () => {
    expect(getDefaultSelectedCategory('Secure PDF')).toBe('Secure PDF');
  });

  it('returns to All tools when a selected category chip is clicked again', () => {
    expect(toggleSelectedCategory(null, 'Secure PDF')).toBe('Secure PDF');
    expect(toggleSelectedCategory('Secure PDF', 'Secure PDF')).toBe(
      ALL_TOOLS_CATEGORY_ID
    );
    expect(
      toggleSelectedCategory(ALL_TOOLS_CATEGORY_ID, ALL_TOOLS_CATEGORY_ID)
    ).toBe(ALL_TOOLS_CATEGORY_ID);
    expect(toggleSelectedCategory('Popular Tools', ALL_TOOLS_CATEGORY_ID)).toBe(
      ALL_TOOLS_CATEGORY_ID
    );
  });

  it('toggles the catalog-open class on the landing grid', () => {
    const grid = document.createElement('div');
    setToolCatalogOpen(grid, true);
    expect(grid.classList.contains(TOOL_CATALOG_OPEN_CLASS)).toBe(true);
    setToolCatalogOpen(grid, false);
    expect(grid.classList.contains(TOOL_CATALOG_OPEN_CLASS)).toBe(false);
  });

  it('keeps the library table independent of the catalog-open class', () => {
    document.body.innerHTML = `
      <div id="grid-view"></div>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([{ name: 'shown.pdf', source: 'handoff' }]);
    setToolCatalogOpen(document.getElementById('grid-view'), false);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'My PDFs'
    );
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('shown.pdf');
  });

  it('keeps favorites ahead of catalog groups when All tools shows everything', () => {
    const groupOrder = ['favorites', 'Popular Tools', 'Secure PDF'];
    const visible = groupOrder.filter((name) =>
      shouldShowCategoryGroup({
        isFavorites: name === 'favorites',
        categoryName: name === 'favorites' ? undefined : name,
        selectedCategory: ALL_TOOLS_CATEGORY_ID,
      })
    );

    expect(visible).toEqual(groupOrder);
    expect(visible[0]).toBe('favorites');
  });
});
