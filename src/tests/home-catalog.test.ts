import { afterEach, describe, expect, it } from 'vitest';

import {
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
  it('hides the full catalog until search is active', () => {
    expect(
      shouldShowToolCatalog({ searchFocused: false, searchQuery: '' })
    ).toBe(false);
    expect(
      shouldShowToolCatalog({ searchFocused: false, searchQuery: '   ' })
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

  it('toggles a selected category chip off when clicked again', () => {
    expect(toggleSelectedCategory(null, 'Secure PDF')).toBe('Secure PDF');
    expect(toggleSelectedCategory('Secure PDF', 'Secure PDF')).toBe(null);
  });

  it('toggles the catalog-open class on the landing grid', () => {
    const grid = document.createElement('div');
    setToolCatalogOpen(grid, true);
    expect(grid.classList.contains(TOOL_CATALOG_OPEN_CLASS)).toBe(true);
    setToolCatalogOpen(grid, false);
    expect(grid.classList.contains(TOOL_CATALOG_OPEN_CLASS)).toBe(false);
  });

  it('keeps the home file table visible while the catalog stays closed', () => {
    document.body.innerHTML = `
      <div id="grid-view"></div>
      <section id="shift-my-pdfs" hidden>
        <h2 id="shift-my-pdfs-heading">Open file</h2>
        <table><tbody id="shift-my-pdfs-body"></tbody></table>
      </section>
    `;
    setWorkspaceFiles([
      { name: 'shown.pdf', source: 'handoff' },
    ]);
    setToolCatalogOpen(document.getElementById('grid-view'), false);

    expect(document.getElementById('shift-my-pdfs')?.hidden).toBe(false);
    expect(document.getElementById('shift-my-pdfs-heading')?.textContent).toBe(
      'Active file'
    );
    expect(
      document.querySelector('#shift-my-pdfs-body tr')?.textContent
    ).toContain('shown.pdf');
  });
});
