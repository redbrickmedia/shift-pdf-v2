import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FAVORITE_TOOL_IDS,
  TOOL_FAVORITES_MIGRATED_KEY,
  TOOL_FAVORITES_STORAGE_KEY,
  loadFavoriteToolIds,
} from '../js/logic/tool-favorites';

const DEV_RESET_SCRIPT = readFileSync(
  resolve(__dirname, '../../public/dev-reset.js'),
  'utf8'
);

const BOOT_SCRIPT = readFileSync(
  resolve(__dirname, '../../public/sidebar-boot.js'),
  'utf8'
);

function loadDevReset(): typeof window & {
  shiftPdfDevReset: {
    KNOWN_IDB_NAMES: string[];
    isDevHost: (hostname: string) => boolean;
    resolveReturnPath: (search: string) => string;
    resetClientPersistence: () => Promise<{
      localKeys: Array<string | null>;
      sessionKeys: Array<string | null>;
      dbResults: Array<{ name: string; status: string }>;
      cacheKeys: string[];
      swCount: number;
    }>;
  };
} {
  new Function(DEV_RESET_SCRIPT)();
  return window as typeof window & {
    shiftPdfDevReset: {
      KNOWN_IDB_NAMES: string[];
      isDevHost: (hostname: string) => boolean;
      resolveReturnPath: (search: string) => string;
      resetClientPersistence: () => Promise<{
        localKeys: Array<string | null>;
        sessionKeys: Array<string | null>;
        dbResults: Array<{ name: string; status: string }>;
        cacheKeys: string[];
        swCount: number;
      }>;
    };
  };
}

describe('dev client reset', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-shift-dev-reset');
    localStorage.clear();
    sessionStorage.clear();
    delete (window as { shiftPdfDevReset?: unknown }).shiftPdfDevReset;
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-shift-dev-reset');
    localStorage.clear();
    sessionStorage.clear();
    delete (window as { shiftPdfDevReset?: unknown }).shiftPdfDevReset;
    vi.restoreAllMocks();
  });

  it('exposes known IndexedDB names used by the app', () => {
    const { shiftPdfDevReset } = loadDevReset();
    expect(shiftPdfDevReset.KNOWN_IDB_NAMES).toEqual([
      'SavedPdfDatabase',
      'shift-pdf-open-file',
      'bentopdf-fonts',
    ]);
  });

  it('only treats localhost and 127.0.0.1 as dev hosts', () => {
    const { shiftPdfDevReset } = loadDevReset();
    expect(shiftPdfDevReset.isDevHost('localhost')).toBe(true);
    expect(shiftPdfDevReset.isDevHost('127.0.0.1')).toBe(true);
    expect(shiftPdfDevReset.isDevHost('example.com')).toBe(false);
  });

  it('only allows same-origin return paths', () => {
    const { shiftPdfDevReset } = loadDevReset();
    expect(shiftPdfDevReset.resolveReturnPath('?return=/all-tools.html')).toBe(
      '/all-tools.html'
    );
    expect(
      shiftPdfDevReset.resolveReturnPath('?return=https://evil.example/')
    ).toBe('/');
    expect(shiftPdfDevReset.resolveReturnPath('?return=//evil.example')).toBe(
      '/'
    );
  });

  it('clears web storage used by the app', async () => {
    localStorage.setItem(TOOL_FAVORITES_STORAGE_KEY, '["crop-pdf"]');
    localStorage.setItem(TOOL_FAVORITES_MIGRATED_KEY, '1');
    localStorage.setItem('shiftPdfPromiseBannerDismissed', 'true');
    sessionStorage.setItem('shiftHasOpenFile', '1');

    const { shiftPdfDevReset } = loadDevReset();
    const report = await shiftPdfDevReset.resetClientPersistence();

    expect(report.localKeys).toContain(TOOL_FAVORITES_STORAGE_KEY);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('documents that empty favorites storage re-seeds defaults on next load', () => {
    const validToolIds = new Set([...DEFAULT_FAVORITE_TOOL_IDS, 'crop-pdf']);
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };

    expect(loadFavoriteToolIds(validToolIds, storage)).toEqual([
      ...DEFAULT_FAVORITE_TOOL_IDS,
    ]);
  });

  it('sidebar-boot redirects localhost ?dev-reset=1 to the wipe page', () => {
    const replace = vi.fn();
    const originalLocation = window.location;

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        hostname: 'localhost',
        pathname: '/',
        search: '?dev-reset=1',
        hash: '',
        replace,
      },
    });

    new Function(BOOT_SCRIPT)();

    expect(replace).toHaveBeenCalledWith('/dev-reset.html?return=%2F');

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
