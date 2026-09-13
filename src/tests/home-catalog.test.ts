import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

  it('spaces the category chip row', async () => {
    const css = await readFile(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );
    const from = css.indexOf('.shift-category-chips {');
    const rule = css.slice(from, css.indexOf('}', from));

    expect(from).toBeGreaterThan(-1);
    expect(rule).toContain('display: flex');
    expect(rule).toContain('gap: 8px');
  });

  /**
   * Search + chips stay put because #grid-view is the overflow owner — not
   * because .shift-tool-search is sticky. Favorites live in #tool-grid inside
   * that pane, so they scroll with the tools.
   */
  it('scrolls the catalog tools inside #grid-view, not the page', async () => {
    const css = await readFile(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );
    const searchFrom = css.indexOf('.shift-tool-search {');
    const searchRule = css.slice(searchFrom, css.indexOf('}', searchFrom));
    const paneFrom = css.indexOf('body.shift-home:has(#tool-grid) #grid-view');
    const paneRule = css.slice(paneFrom, css.indexOf('}', paneFrom));
    const appFrom = css.indexOf('body.shift-home:has(#tool-grid) #app');
    const appRule = css.slice(appFrom, css.indexOf('}', appFrom));
    const catalog = await readFile(
      resolve(process.cwd(), 'all-tools.html'),
      'utf8'
    );

    expect(searchFrom).toBeGreaterThan(-1);
    expect(searchRule).not.toContain('position: sticky');
    expect(searchRule).not.toContain('z-index:');
    expect(searchRule).not.toContain('margin-top: calc');
    expect(paneFrom).toBeGreaterThan(-1);
    expect(paneRule).toContain('overflow-y: auto');
    expect(paneRule).toContain('min-height: 0');
    expect(appFrom).toBeGreaterThan(-1);
    expect(appRule).toContain('flex: 1 1 auto');
    expect(appRule).toContain('min-height: 0');
    // Search + chips only: Favorite Tools is injected into #tool-grid.
    expect(catalog).toMatch(
      /class="shift-tool-search"[\s\S]*id="home-category-chips"[\s\S]*<\/div>\s*<div id="grid-view"/
    );
    expect(catalog).toContain('id="tool-grid"');
  });
});
