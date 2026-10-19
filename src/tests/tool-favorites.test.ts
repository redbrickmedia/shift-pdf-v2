import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PRUNED_TOOL_IDS, SURFACE_BY_ENTRY_ID } from '../js/config/tools';
import {
  DEFAULT_FAVORITE_TOOL_IDS,
  SIDEBAR_FAVORITE_LIMIT,
  bindSidebarGlobalLauncherGuard,
  getDefaultFavoriteToolIds,
  loadFavoriteRailSnapshot,
  loadFavoriteToolIds,
  parseFavoriteRailSnapshot,
  parseFavoriteToolIds,
  partitionToolIdsByFavorites,
  placeFavoriteToolCards,
  reorderFavoriteToolIds,
  saveFavoriteRailSnapshot,
  saveFavoriteToolIds,
  toggleFavoriteToolId,
  TOOL_FAVORITES_MIGRATED_KEY,
  TOOL_FAVORITES_RAIL_KEY,
  TOOL_FAVORITES_STORAGE_KEY,
} from '../js/logic/tool-favorites';
import {
  applyAllToolsOpenWithGuards,
  buildOpenWithMenuEntries,
} from '../js/logic/open-with-menu';

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

  it('does not re-seed defaults after Clear all writes an empty list', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) return '[]';
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return null;
        return null;
      }),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([]);
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_MIGRATED_KEY,
      '1'
    );
  });

  it('reorders a favorite without dropping the rest', () => {
    expect(
      reorderFavoriteToolIds(
        ['compress-pdf', 'merge-pdf', 'pdf-converter'],
        0,
        2
      )
    ).toEqual(['merge-pdf', 'pdf-converter', 'compress-pdf']);
    expect(reorderFavoriteToolIds(['compress-pdf', 'merge-pdf'], 1, 1)).toEqual(
      ['compress-pdf', 'merge-pdf']
    );
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

  it('clones favorited cards into Favorites while keeping every Catalog Entry visible in its home domain category', () => {
    const favorites = document.createElement('div');
    const organize = document.createElement('div');
    const optimize = document.createElement('div');
    const organizeMerge = document.createElement('div');
    organizeMerge.className = 'tool-card';
    organizeMerge.dataset.toolId = 'merge-pdf';
    const compress = document.createElement('div');
    compress.className = 'tool-card';
    compress.dataset.toolId = 'compress-pdf';
    organize.append(organizeMerge);
    optimize.append(compress);

    const cardsByToolId = new Map<string, HTMLElement[]>([
      ['merge-pdf', [organizeMerge]],
      ['compress-pdf', [compress]],
    ]);
    const originalContainers = new Map<HTMLElement, HTMLElement>([
      [organizeMerge, organize],
      [compress, optimize],
    ]);

    placeFavoriteToolCards(cardsByToolId, originalContainers, [], favorites);

    expect(organize.contains(organizeMerge)).toBe(true);
    expect(organizeMerge.hidden).toBe(false);
    expect(favorites.querySelectorAll('.tool-card')).toHaveLength(0);

    placeFavoriteToolCards(
      cardsByToolId,
      originalContainers,
      ['merge-pdf'],
      favorites
    );

    // Home domain card stays visible in its home category
    expect(organize.contains(organizeMerge)).toBe(true);
    expect(organizeMerge.hidden).toBe(false);
    expect(optimize.contains(compress)).toBe(true);
    expect(compress.hidden).toBe(false);

    // Favorites container renders an independent card for merge-pdf
    const favCards = favorites.querySelectorAll('[data-tool-id="merge-pdf"]');
    expect(favCards).toHaveLength(1);
    expect(favCards[0]).not.toBe(organizeMerge);
  });

  it('keeps sidebar Tools pins and catalog favorites in the same id list', () => {
    const favorites = document.createElement('div');
    const organize = document.createElement('div');
    const compress = document.createElement('div');
    compress.className = 'tool-card';
    compress.dataset.toolId = 'compress-pdf';
    const merge = document.createElement('div');
    merge.className = 'tool-card';
    merge.dataset.toolId = 'merge-pdf';
    organize.append(compress, merge);

    const cardsByToolId = new Map<string, HTMLElement[]>([
      ['compress-pdf', [compress]],
      ['merge-pdf', [merge]],
    ]);
    const originalContainers = new Map<HTMLElement, HTMLElement>([
      [compress, organize],
      [merge, organize],
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
    expect(
      favorites.querySelector('[data-tool-id="compress-pdf"]')
    ).not.toBeNull();
    expect(organize.contains(compress)).toBe(true);
    expect(compress.hidden).toBe(false);

    favoriteIds = toggleFavoriteToolId(favoriteIds, 'compress-pdf');
    placeFavoriteToolCards(
      cardsByToolId,
      originalContainers,
      favoriteIds,
      favorites
    );
    expect(favorites.querySelector('[data-tool-id="compress-pdf"]')).toBeNull();
    expect(organize.contains(compress)).toBe(true);
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
    expect(cached).toHaveLength(SIDEBAR_FAVORITE_LIMIT);

    expect(
      saveFavoriteRailSnapshot(pins, {
        setItem: vi.fn(() => {
          throw new Error('blocked');
        }),
      })
    ).toBe(false);

    warning.mockRestore();
  });

  it('caps the sidebar rail snapshot and sidebar-boot MAX_PINS at 6', () => {
    const bootSource = readFileSync('public/sidebar-boot.js', 'utf8');
    expect(bootSource).toContain('var MAX_PINS = 6;');
  });

  it('clears shiftOpenWithSelection when clicking a Left Sidebar tool pin or All tools link', () => {
    document.body.innerHTML = `
      <aside id="shift-sidebar">
        <div id="shift-favorite-tools">
          <a href="/compress-pdf.html" class="shift-nav-link shift-favorite-link">Compress PDF</a>
        </div>
        <a href="/all-tools.html" class="shift-nav-link" data-nav="home">All tools</a>
      </aside>
    `;
    bindSidebarGlobalLauncherGuard(document);

    sessionStorage.setItem('shiftOpenWithSelection', '1');
    document
      .querySelector<HTMLAnchorElement>('#shift-favorite-tools a')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    expect(sessionStorage.getItem('shiftOpenWithSelection')).toBeNull();

    sessionStorage.setItem('shiftOpenWithSelection', '1');
    document
      .querySelector<HTMLAnchorElement>('[data-nav="home"]')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
    expect(sessionStorage.getItem('shiftOpenWithSelection')).toBeNull();
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

  it('strips pruned tool IDs and normalizes legacy .html entries in saved favorites', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === TOOL_FAVORITES_STORAGE_KEY) {
          return JSON.stringify([
            'pdf-workflow',
            '/merge-pdf.html',
            'scanner-effect',
            '/edit-pdf.html?entry=sign-pdf',
            'split-pdf.html',
          ]);
        }
        if (key === TOOL_FAVORITES_MIGRATED_KEY) return '1';
        return null;
      }),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([
      'merge-pdf',
      'sign-pdf',
      'split-pdf',
    ]);
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_STORAGE_KEY,
      JSON.stringify(['merge-pdf', 'sign-pdf', 'split-pdf'])
    );
  });

  it('keeps sidebar-boot.js pruned IDs and consolidated surface map in sync with tools.ts', () => {
    const bootSource = readFileSync('public/sidebar-boot.js', 'utf8');
    const prunedBlock =
      /var PRUNED_TOOL_IDS = \{([\s\S]*?)\};/.exec(bootSource)?.[1] ?? '';
    const bootPrunedIds = Array.from(
      prunedBlock.matchAll(/'([^']+)':\s*1/g),
      (m) => m[1]
    );
    expect(bootPrunedIds.sort()).toEqual([...PRUNED_TOOL_IDS].sort());

    const surfaceBlock =
      /var CONSOLIDATED_SURFACE_BY_ENTRY = \{([\s\S]*?)\};/.exec(
        bootSource
      )?.[1] ?? '';
    const bootEntries = Object.fromEntries(
      Array.from(
        surfaceBlock.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'([a-z0-9-]+)'/gm),
        (m) => [m[1], m[2]]
      )
    );
    const expectedEntries = Object.fromEntries(
      Object.entries(SURFACE_BY_ENTRY_ID).filter(
        ([entryId, surfaceId]) => entryId !== surfaceId
      )
    );
    expect(bootEntries).toEqual(expectedEntries);
  });

  it('prunes retired pins and rewrites consolidated pin hrefs in shiftPdfFavoriteRail', () => {
    const rawPins = JSON.stringify([
      {
        name: 'PDF Workflow Builder',
        href: '/pdf-workflow.html',
        icon: 'ph-tree-structure',
      },
      {
        name: 'Sign PDF',
        href: '/sign-pdf.html',
        icon: 'ph-pen-nib',
      },
      {
        name: 'Rotate PDF',
        href: 'rotate-pdf.html',
        icon: 'ph-arrow-clockwise',
      },
      {
        name: 'Merge PDF',
        href: '/merge-pdf.html',
        icon: 'ph-browsers',
      },
    ]);

    expect(parseFavoriteRailSnapshot(rawPins)).toEqual([
      {
        name: 'Sign PDF',
        href: '/edit-pdf.html?entry=sign-pdf',
        icon: 'ph-pen-nib',
      },
      {
        name: 'Rotate PDF',
        href: 'pdf-multi-tool.html?entry=rotate-pdf',
        icon: 'ph-arrow-clockwise',
      },
      {
        name: 'Merge PDF',
        href: '/merge-pdf.html',
        icon: 'ph-browsers',
      },
    ]);

    const storage = {
      getItem: vi.fn(() => rawPins),
      setItem: vi.fn(),
    };
    const migrated = loadFavoriteRailSnapshot(storage);
    expect(migrated).toHaveLength(3);
    expect(storage.setItem).toHaveBeenCalledWith(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify(migrated)
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

  it('keeps All tools as the only catalog link and omits Add tool', () => {
    const toolsNav = sidebar().querySelector('.shift-tools-nav');
    const links = Array.from(
      toolsNav?.querySelectorAll('a.shift-nav-link') ?? []
    );
    const allTools = toolsNav?.querySelector('a[data-nav="home"]');

    expect(toolsNav?.querySelector('a.shift-add-tool-link')).toBeNull();
    expect(toolsNav?.textContent).not.toMatch(/Add tool/);
    expect(links).toHaveLength(1);
    expect(links[0]).toBe(allTools);
    expect(allTools?.getAttribute('href')).toContain('all-tools.html');
    expect(allTools?.textContent).toMatch(/All tools/);
    expect(toolsNav?.lastElementChild).toBe(allTools);
    expect(toolsNav?.firstElementChild?.id).toBe('shift-favorite-tools');
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

describe('Open with favorite shortcuts', () => {
  it.each(['my-pdfs.html', 'index.html'])(
    'renders a single Open with dropdown control in %s without inline favorite links',
    (page) => {
      const html = readFileSync(page, 'utf8');
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tools = doc.getElementById('shift-open-file-tools');
      expect(tools).not.toBeNull();
      expect(
        doc.querySelectorAll(
          '#shift-open-file-tools a.shift-open-file-tool-btn'
        )
      ).toHaveLength(0);
    }
  );

  it('orders Open with entries as all Favorites, deduped Popular Tools, and Browse all tools… with compatibility and cardinality guards', () => {
    const entries = buildOpenWithMenuEntries({
      favoriteIds: [
        'rotate-pdf',
        'jpg-to-pdf',
        'compare-pdfs',
        'split-pdf',
        'merge-pdf',
        'compress-pdf',
        'pdf-converter',
        'sign-pdf',
      ],
      selectedPdfCount: 1,
    });

    // All 8 favorites appear first in saved order (not capped to 6)
    expect(entries.slice(0, 8).map((e) => e.id)).toEqual([
      'rotate-pdf',
      'jpg-to-pdf',
      'compare-pdfs',
      'split-pdf',
      'merge-pdf',
      'compress-pdf',
      'pdf-converter',
      'sign-pdf',
    ]);

    // Followed by Popular Tools deduped against those favorites
    const remainingIds = entries.slice(8).map((e) => e.id);
    expect(remainingIds).not.toContain('merge-pdf');
    expect(remainingIds).not.toContain('split-pdf');
    expect(remainingIds).not.toContain('compress-pdf');
    expect(remainingIds).not.toContain('pdf-converter');
    expect(remainingIds).not.toContain('jpg-to-pdf');
    expect(remainingIds).not.toContain('sign-pdf');
    expect(remainingIds).toContain('pdf-multi-tool');
    expect(remainingIds).toContain('edit-pdf');
    expect(remainingIds).toContain('crop-pdf');
    expect(remainingIds).toContain('extract-pages');
    expect(remainingIds).toContain('organize-pdf');
    expect(remainingIds).toContain('delete-pages');

    // Non-PDF entry (jpg-to-pdf) is visible in position but disabled with tooltip
    const jpgEntry = entries.find((e) => e.id === 'jpg-to-pdf');
    expect(jpgEntry?.disabled).toBe(true);
    expect(jpgEntry?.tooltip).toBe("This tool doesn't accept PDF files.");

    // Single-file entry with 1 PDF selected is enabled
    const splitSingle = entries.find((e) => e.id === 'split-pdf');
    expect(splitSingle?.disabled).toBe(false);
    expect(splitSingle?.tooltip).toBe('');

    // With 2 PDFs selected: single-file disabled, dual-file (compare-pdfs) enabled, batch enabled
    const entriesTwoPdfs = buildOpenWithMenuEntries({
      favoriteIds: ['split-pdf', 'compare-pdfs', 'merge-pdf'],
      selectedPdfCount: 2,
    });
    expect(entriesTwoPdfs.find((e) => e.id === 'split-pdf')).toMatchObject({
      disabled: true,
      tooltip: 'Select a single PDF to use this tool.',
    });
    expect(entriesTwoPdfs.find((e) => e.id === 'compare-pdfs')).toMatchObject({
      disabled: false,
      tooltip: '',
    });
    expect(entriesTwoPdfs.find((e) => e.id === 'merge-pdf')).toMatchObject({
      disabled: false,
      tooltip: '',
    });

    // With 3 PDFs selected: compare-pdfs is disabled with dual tooltip
    const entriesThreePdfs = buildOpenWithMenuEntries({
      favoriteIds: ['compare-pdfs', 'merge-pdf'],
      selectedPdfCount: 3,
    });
    expect(entriesThreePdfs.find((e) => e.id === 'compare-pdfs')).toMatchObject(
      {
        disabled: true,
        tooltip: 'Select 1 or 2 PDFs to compare.',
      }
    );
    expect(entriesThreePdfs.find((e) => e.id === 'merge-pdf')).toMatchObject({
      disabled: false,
      tooltip: '',
    });
  });

  it('applies compatibility and cardinality guards to All tools cards when shiftOpenWithSelection is armed', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="tool-card" data-tool-id="jpg-to-pdf">
        <a href="/pdf-converter.html?entry=jpg-to-pdf" class="shift-tool-card-link"><h3>JPG to PDF</h3></a>
      </div>
      <div class="tool-card" data-tool-id="split-pdf">
        <a href="/split-pdf.html" class="shift-tool-card-link"><h3>Split PDF</h3></a>
      </div>
      <div class="tool-card" data-tool-id="compare-pdfs">
        <a href="/compare-pdfs.html" class="shift-tool-card-link"><h3>Compare PDFs</h3></a>
      </div>
      <div class="tool-card" data-tool-id="merge-pdf">
        <a href="/merge-pdf.html" class="shift-tool-card-link"><h3>Merge PDF</h3></a>
      </div>
    `;

    // With 2 PDFs selected and Open with armed:
    applyAllToolsOpenWithGuards(root, { armed: true, selectedPdfCount: 2 });

    const jpgLink = root.querySelector<HTMLAnchorElement>(
      '[data-tool-id="jpg-to-pdf"] a'
    );
    const splitLink = root.querySelector<HTMLAnchorElement>(
      '[data-tool-id="split-pdf"] a'
    );
    const compareLink = root.querySelector<HTMLAnchorElement>(
      '[data-tool-id="compare-pdfs"] a'
    );
    const mergeLink = root.querySelector<HTMLAnchorElement>(
      '[data-tool-id="merge-pdf"] a'
    );

    expect(jpgLink?.getAttribute('aria-disabled')).toBe('true');
    expect(jpgLink?.getAttribute('data-shift-tooltip')).toBe(
      "This tool doesn't accept PDF files."
    );
    expect(splitLink?.getAttribute('aria-disabled')).toBe('true');
    expect(splitLink?.getAttribute('data-shift-tooltip')).toBe(
      'Select a single PDF to use this tool.'
    );
    expect(compareLink?.getAttribute('aria-disabled')).toBeNull();
    expect(mergeLink?.getAttribute('aria-disabled')).toBeNull();

    // With 3 PDFs selected and Open with armed:
    applyAllToolsOpenWithGuards(root, { armed: true, selectedPdfCount: 3 });
    expect(compareLink?.getAttribute('aria-disabled')).toBe('true');
    expect(compareLink?.getAttribute('data-shift-tooltip')).toBe(
      'Select 1 or 2 PDFs to compare.'
    );

    // When not armed, all cards are enabled:
    applyAllToolsOpenWithGuards(root, { armed: false, selectedPdfCount: 3 });
    expect(jpgLink?.getAttribute('aria-disabled')).toBeNull();
    expect(splitLink?.getAttribute('aria-disabled')).toBeNull();
    expect(compareLink?.getAttribute('aria-disabled')).toBeNull();
  });

  it('paints Open with buttons as primary blue', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    // Read each rule's own body rather than a fixed-length window from a
    // nearby comment: any rule added in between used to push the hover
    // declarations out of the slice and fail this on unrelated work.
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Anchored to a line that starts its own rule: the shared
      // `.shift-open-file-view-btn, .shift-open-file-tool-btn` rule also puts
      // this selector at a line start, and carries none of these declarations.
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    const base = ruleBody('.shift-open-file-tool-btn');
    const hover = ruleBody('.shift-open-file-tool-btn:hover');

    expect(base).toContain(
      'background: var(--action-button-surface-primary-default)'
    );
    expect(base).toContain('color: var(--text-white)');
    expect(hover).toContain(
      'background: var(--action-button-surface-primary-hover)'
    );
  });

  /**
   * The More tools menu once rendered under the file grid, and raising the
   * menu's own z-index did nothing about it: `shift-rise-in` runs with
   * `animation-fill-mode: both`, so every surface it animates — the Open-with
   * row included — stays a stacking context permanently, and a z-index set
   * inside one only ranks against its siblings. The fix has to live on the
   * row, so that is what this asserts, along with the grid cards still being
   * animated. Drop either half and the menu goes back under the thumbnails.
   */
  it('keeps the More tools menu clear of the animated file grid', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    // Both surfaces animate, which is what makes them stacking contexts.
    const animated = css.slice(
      css.indexOf('.shift-enter,'),
      css.indexOf('animation: shift-rise-in')
    );
    expect(animated).toContain('.shift-open-file-thumb');

    const row = ruleBody('.shift-open-file-tools');
    expect(row).toContain('position: relative');
    expect(row).toContain('z-index: var(--shift-z-raised)');

    const menu = ruleBody('.shift-my-pdfs-more-tools-menu');
    expect(menu).toContain('z-index: var(--shift-z-popout)');

    // The menu's level is resolved inside the row, so it only has to beat the
    // row's own children — but the scale still has to order the two that way
    // for the nesting to read correctly.
    const level = (token: string): number => {
      const match = new RegExp(`--shift-z-${token}: (\\d+);`).exec(css);
      if (!match) throw new Error(`No --shift-z-${token} token`);
      return Number(match[1]);
    };
    expect(level('popout')).toBeLessThan(level('raised'));
    // And the row must not climb over the shell chrome or the dialogs.
    expect(level('raised')).toBeLessThan(level('sidebar'));
    expect(level('sidebar')).toBeLessThan(level('dialog'));
  });

  /**
   * The menu caps its height and scrolls the catalog, which makes the rows
   * flex children of a bounded column. `overflow` on a flex child drops its
   * automatic minimum size from min-content to 0, so without `flex: none`
   * the rows shrink to 16px and clip their own text — and the list still
   * reports itself as scrollable while doing it, so only the rendered row
   * height catches this. The two declarations have to stay together.
   */
  it('keeps the More tools rows from shrinking inside the capped list', () => {
    const css = readFileSync('src/css/shift-theme.css', 'utf8');
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`(?<=\\n)(?<!,\\n)${escaped} \\{`).exec(css);
      if (!match) throw new Error(`No rule found for ${selector}`);
      return css.slice(match.index, css.indexOf('\n}', match.index));
    };

    const list = ruleBody('.shift-my-pdfs-more-tools-list');
    expect(list).toContain('flex-direction: column');
    expect(list).toContain('max-height');
    expect(list).toContain('overflow-y: auto');

    const item = ruleBody('.shift-my-pdfs-more-tools-item');
    expect(item).toContain('overflow: hidden');
    expect(item).toContain('flex: none');

    // Browse all tools is outside the scroll area but shares the column, so
    // it has to hold its height for the same reason.
    expect(ruleBody('.shift-my-pdfs-more-tools-browse')).toContain(
      'flex: none'
    );
  });
});
