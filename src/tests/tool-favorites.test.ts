import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAVORITE_TOOL_IDS,
  FAVORITE_CATALOG_COPY_ATTR,
  getDefaultFavoriteToolIds,
  loadFavoriteToolIds,
  parseFavoriteToolIds,
  partitionToolIdsByFavorites,
  placeFavoriteToolCards,
  saveFavoriteRailSnapshot,
  saveFavoriteToolIds,
  toggleFavoriteToolId,
  TOOL_FAVORITES_MIGRATED_KEY,
  TOOL_FAVORITES_RAIL_KEY,
  TOOL_FAVORITES_STORAGE_KEY,
} from '../js/logic/tool-favorites';

const validToolIds = new Set([
  'merge-pdf',
  'split-pdf',
  'compress-pdf',
  'pdf-converter',
  'sign-pdf',
]);

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

  it('seeds former prepinned tools when storage is empty', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) return null;
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return null;
        return null;
      }),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([
      'compress-pdf',
      'merge-pdf',
      'pdf-converter',
      'sign-pdf',
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_STORAGE_KEY,
      JSON.stringify([...DEFAULT_FAVORITE_TOOL_IDS])
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_MIGRATED_KEY,
      '1'
    );
  });

  it('returns defaults without writing when storage is unavailable', () => {
    expect(loadFavoriteToolIds(validToolIds, undefined)).toEqual(
      getDefaultFavoriteToolIds(validToolIds)
    );
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

    expect(loadFavoriteToolIds(validToolIds, unavailableStorage)).toEqual(
      getDefaultFavoriteToolIds(validToolIds)
    );
    expect(saveFavoriteToolIds(['merge-pdf'], unavailableStorage)).toBe(false);

    warning.mockRestore();
  });

  it('merges former prepinned tools into older saved lists once', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) {
          return JSON.stringify(['split-pdf']);
        }
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return null;
        return null;
      }),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([
      'compress-pdf',
      'merge-pdf',
      'pdf-converter',
      'sign-pdf',
      'split-pdf',
    ]);
  });

  it('does not re-seed after a former prepinned tool is unpinned', () => {
    const stored = JSON.stringify(['merge-pdf', 'split-pdf']);
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) return stored;
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return '1';
        return null;
      }),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([
      'merge-pdf',
      'split-pdf',
    ]);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('unpins a former prepinned tool and allows re-pinning', () => {
    const withoutCompress = toggleFavoriteToolId(
      [...DEFAULT_FAVORITE_TOOL_IDS],
      'compress-pdf'
    );
    expect(withoutCompress).toEqual(['merge-pdf', 'pdf-converter', 'sign-pdf']);
    expect(toggleFavoriteToolId(withoutCompress, 'compress-pdf')).toEqual([
      'merge-pdf',
      'pdf-converter',
      'sign-pdf',
      'compress-pdf',
    ]);
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

  it('keeps sidebar Tools pins and catalog favorites in the same id list', () => {
    const favorites = document.createElement('div');
    const popular = document.createElement('div');
    const compress = document.createElement('div');
    compress.dataset.toolId = 'compress-pdf';
    const merge = document.createElement('div');
    merge.dataset.toolId = 'merge-pdf';
    popular.append(compress, merge);

    const cardsByToolId = new Map<string, HTMLElement[]>([
      ['compress-pdf', [compress]],
      ['merge-pdf', [merge]],
    ]);
    const originalContainers = new Map<HTMLElement, HTMLElement>([
      [compress, popular],
      [merge, popular],
    ]);

    let favoriteIds = loadFavoriteToolIds(validToolIds, {
      getItem: () => null,
      setItem: () => {},
    });
    placeFavoriteToolCards(
      cardsByToolId,
      originalContainers,
      favoriteIds,
      favorites
    );
    expect(favorites.contains(compress)).toBe(true);

    favoriteIds = toggleFavoriteToolId(favoriteIds, 'compress-pdf');
    placeFavoriteToolCards(
      cardsByToolId,
      originalContainers,
      favoriteIds,
      favorites
    );
    expect(favorites.contains(compress)).toBe(false);
    expect(popular.contains(compress)).toBe(true);
    expect(favoriteIds.includes('compress-pdf')).toBe(false);
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
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) {
          return JSON.stringify(['merge-pdf']);
        }
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return '1';
        return null;
      }),
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
});

describe('sidebar pinned tools', () => {
  const sidebar = () =>
    new DOMParser().parseFromString(
      readFileSync('src/partials/navbar.html', 'utf8'),
      'text/html'
    );

  it('does not put native tooltips on the nav links', () => {
    const links = Array.from(sidebar().querySelectorAll('a.shift-nav-link'));
    const keys = links.map((link) => link.getAttribute('data-nav'));

    expect(keys).toContain('my-pdfs');
    expect(keys).toContain('home');
    expect(links.some((link) => link.hasAttribute('title'))).toBe(false);
  });

  it('leads with My PDFs and the active file, then Tools with an in-section favorites rail', () => {
    const doc = sidebar();
    const content = doc.querySelector('.shift-sidebar-content');
    const order = Array.from(content?.children ?? []).map(
      (child) => child.id || child.className
    );
    const library = doc.getElementById('shift-open-files');
    const tools = doc.querySelector('.shift-tools');
    const toolsNav = tools?.querySelector('.shift-tools-nav');

    expect(order).toEqual([
      'shift-sidebar-header',
      'shift-open-files',
      'shift-tools',
      'shift-sidebar-footer',
    ]);
    expect(doc.getElementById('shift-favorites')).toBeNull();
    expect(doc.getElementById('shift-favorites-heading')).toBeNull();
    expect(
      Array.from(doc.querySelectorAll('.shift-sidebar-section-title')).map(
        (heading) => heading.textContent?.trim()
      )
    ).not.toContain('Favorites');
    expect(toolsNav?.querySelector('[data-nav="home"]')).not.toBeNull();
    expect(doc.getElementById('shift-favorite-tools')).not.toBeNull();
    expect(tools?.contains(doc.getElementById('shift-favorite-tools')!)).toBe(
      true
    );
    expect(
      library?.querySelector('a.shift-nav-link[data-nav="my-pdfs"]')
    ).not.toBeNull();
    expect(library?.querySelector('.shift-primary-nav')).not.toBeNull();
    expect(library?.querySelector('#shift-open-files-list')).not.toBeNull();
    expect(
      library?.querySelector('#shift-open-files-heading')?.textContent?.trim()
    ).toBe('My PDFs');
    expect(library?.hasAttribute('hidden')).toBe(false);
  });

  it('does not hardcode former prepinned tools in the Tools markup', () => {
    const toolsNav = sidebar().querySelector('.shift-tools-nav');
    const hrefs = Array.from(toolsNav?.querySelectorAll('a[href]') ?? []).map(
      (link) => link.getAttribute('href') ?? ''
    );

    expect(hrefs.some((href) => href.includes('all-tools.html'))).toBe(true);
    expect(hrefs.some((href) => href.includes('compress-pdf.html'))).toBe(
      false
    );
    expect(hrefs.some((href) => href.includes('merge-pdf.html'))).toBe(false);
    expect(hrefs.some((href) => href.includes('pdf-converter.html'))).toBe(
      false
    );
    expect(hrefs.some((href) => href.includes('sign-pdf.html'))).toBe(false);
  });
});
