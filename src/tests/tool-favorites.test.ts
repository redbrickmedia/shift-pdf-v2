import { describe, expect, it, vi } from 'vitest';
import {
  applyFavoritePinTitles,
  FAVORITE_CATALOG_COPY_ATTR,
  loadFavoriteToolIds,
  parseFavoriteToolIds,
  partitionToolIdsByFavorites,
  placeFavoriteToolCards,
  saveFavoriteRailSnapshot,
  saveFavoriteToolIds,
  titleForFavoritePin,
  toggleFavoriteToolId,
  TOOL_FAVORITES_RAIL_KEY,
  TOOL_FAVORITES_STORAGE_KEY,
} from '../js/logic/tool-favorites';

const validToolIds = new Set(['merge-pdf', 'split-pdf', 'compress-pdf']);

describe('tool favorites', () => {
  it('parses only unique, known stable tool IDs', () => {
    const stored = JSON.stringify([
      'merge-pdf',
      'unknown',
      42,
      'merge-pdf',
      'split-pdf',
    ]);

    expect(parseFavoriteToolIds(stored, validToolIds)).toEqual([
      'merge-pdf',
      'split-pdf',
    ]);
  });

  it('rejects malformed, oversized, and non-array storage values', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(parseFavoriteToolIds('{bad json', validToolIds)).toEqual([]);
    expect(
      parseFavoriteToolIds(JSON.stringify({ id: 'merge-pdf' }), validToolIds)
    ).toEqual([]);
    expect(parseFavoriteToolIds('x'.repeat(4097), validToolIds)).toEqual([]);

    warning.mockRestore();
  });

  it('bounds the saved favorites list', () => {
    const ids = Array.from({ length: 50 }, (_, index) => `tool-${index}`);
    const allIds = new Set(ids);

    expect(parseFavoriteToolIds(JSON.stringify(ids), allIds)).toHaveLength(40);
  });

  it('tolerates unavailable storage reads and writes', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(loadFavoriteToolIds(validToolIds, unavailableStorage)).toEqual([]);
    expect(saveFavoriteToolIds(['merge-pdf'], unavailableStorage)).toBe(false);

    warning.mockRestore();
  });

  it('adds and removes a favorite without duplicates', () => {
    expect(toggleFavoriteToolId(['merge-pdf'], 'split-pdf')).toEqual([
      'merge-pdf',
      'split-pdf',
    ]);
    expect(
      toggleFavoriteToolId(['merge-pdf', 'split-pdf'], 'merge-pdf')
    ).toEqual(['split-pdf']);
  });

  it('assigns each tool to favorites or the catalog exactly once', () => {
    const partition = partitionToolIdsByFavorites(
      ['merge-pdf', 'split-pdf', 'compress-pdf'],
      ['split-pdf', 'missing-tool']
    );

    expect(partition).toEqual({
      favoriteIds: ['split-pdf'],
      catalogIds: ['merge-pdf', 'compress-pdf'],
    });
    expect([...partition.favoriteIds, ...partition.catalogIds]).toHaveLength(
      new Set([...partition.favoriteIds, ...partition.catalogIds]).size
    );
  });

  it('keeps extra catalog copies in place and hides them only when favorited', () => {
    const favorites = document.createElement('div');
    const popular = document.createElement('div');
    const organize = document.createElement('div');
    const popularMerge = document.createElement('div');
    popularMerge.dataset.toolId = 'merge-pdf';
    const organizeMerge = document.createElement('div');
    organizeMerge.dataset.toolId = 'merge-pdf';
    const compress = document.createElement('div');
    compress.dataset.toolId = 'compress-pdf';
    popular.append(popularMerge);
    organize.append(organizeMerge, compress);

    const cardsByToolId = new Map<string, HTMLElement[]>([
      ['merge-pdf', [popularMerge, organizeMerge]],
      ['compress-pdf', [compress]],
    ]);
    const originalContainers = new Map<HTMLElement, HTMLElement>([
      [popularMerge, popular],
      [organizeMerge, organize],
      [compress, organize],
    ]);

    placeFavoriteToolCards(cardsByToolId, originalContainers, [], favorites);

    expect(popular.contains(popularMerge)).toBe(true);
    expect(organize.contains(organizeMerge)).toBe(true);
    expect(organizeMerge.hidden).toBe(false);

    placeFavoriteToolCards(
      cardsByToolId,
      originalContainers,
      ['merge-pdf'],
      favorites
    );

    expect(favorites.contains(popularMerge)).toBe(true);
    expect(organize.contains(organizeMerge)).toBe(true);
    expect(organizeMerge.hidden).toBe(true);
    expect(organizeMerge.getAttribute(FAVORITE_CATALOG_COPY_ATTR)).toBe(
      'hidden'
    );
    expect(organize.contains(compress)).toBe(true);
    expect(
      favorites.querySelectorAll('[data-tool-id="merge-pdf"]')
    ).toHaveLength(1);
  });

  it('caches the rail pins the boot script paints from', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    saveFavoriteRailSnapshot(
      [{ name: 'Split PDF', href: '/split-pdf.html', icon: 'ph-scissors' }],
      storage
    );

    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify([
        { name: 'Split PDF', href: '/split-pdf.html', icon: 'ph-scissors' },
      ])
    );
  });

  it('bounds and tolerates failure when caching rail pins', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pins = Array.from({ length: 50 }, (_, index) => ({
      name: `Tool ${index}`,
      href: `/tool-${index}.html`,
      icon: 'ph-file',
    }));
    const storage = { getItem: vi.fn(), setItem: vi.fn() };

    saveFavoriteRailSnapshot(pins, storage);
    const cached = JSON.parse(storage.setItem.mock.calls[0][1] as string);
    expect(cached).toHaveLength(40);

    expect(
      saveFavoriteRailSnapshot(pins, {
        setItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      })
    ).toBe(false);

    warning.mockRestore();
  });

  it('uses the dedicated local storage key', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify(['merge-pdf'])),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual(['merge-pdf']);
    expect(storage.getItem).toHaveBeenCalledWith(TOOL_FAVORITES_STORAGE_KEY);

    saveFavoriteToolIds(['split-pdf'], storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_STORAGE_KEY,
      JSON.stringify(['split-pdf'])
    );
  });

  it('titles a pin only when the name is hidden or truncated', () => {
    expect(
      titleForFavoritePin({
        name: 'PDF Workflow Builder',
        collapsed: false,
        overflowing: false,
      })
    ).toBe('');
    expect(
      titleForFavoritePin({
        name: 'PDF Workflow Builder',
        collapsed: false,
        overflowing: true,
      })
    ).toBe('PDF Workflow Builder');
    expect(
      titleForFavoritePin({
        name: 'Split PDF',
        collapsed: true,
        overflowing: false,
      })
    ).toBe('Split PDF');
  });

  it('sets the native tooltip from measured overflow', () => {
    const root = document.createElement('div');
    const overflowing = document.createElement('a');
    overflowing.className = 'shift-favorite-link';
    const overflowingLabel = document.createElement('span');
    overflowingLabel.className = 'shift-nav-label';
    overflowingLabel.textContent = 'PDF Workflow Builder';
    Object.defineProperty(overflowingLabel, 'scrollWidth', { value: 180 });
    Object.defineProperty(overflowingLabel, 'clientWidth', { value: 120 });
    overflowing.append(overflowingLabel);

    const fits = document.createElement('a');
    fits.className = 'shift-favorite-link';
    fits.title = 'stale';
    const fitsLabel = document.createElement('span');
    fitsLabel.className = 'shift-nav-label';
    fitsLabel.textContent = 'Split PDF';
    Object.defineProperty(fitsLabel, 'scrollWidth', { value: 80 });
    Object.defineProperty(fitsLabel, 'clientWidth', { value: 80 });
    fits.append(fitsLabel);

    root.append(overflowing, fits);
    applyFavoritePinTitles(root, false);

    expect(overflowing.title).toBe('PDF Workflow Builder');
    expect(fits.hasAttribute('title')).toBe(false);
  });
});
