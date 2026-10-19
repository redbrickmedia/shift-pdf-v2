import {
  extractCatalogEntryIdFromHref,
  getCatalogEntryById,
  PRUNED_TOOL_ID_SET,
} from '../config/tools.js';
import { clearOpenWithSelection } from './open-file-store.js';
import type { FavoriteRailPin } from '@/types';

export type { FavoriteRailPin } from '@/types';

export const TOOL_FAVORITES_STORAGE_KEY = 'shiftPdfFavoriteToolIds';

/**
 * Snapshot of the rendered rail pins, read by public/sidebar-boot.js before the
 * sidebar is parsed. The IDs above are not enough for that: turning one into a
 * pin needs the tool's name, link and glyph, and the catalog that holds those
 * only arrives with the deferred main.ts bundle — after first paint, which is
 * why the pins used to appear a frame or two late.
 */
export const TOOL_FAVORITES_RAIL_KEY = 'shiftPdfFavoriteRail';

/**
 * One-time flag: former prepinned Tools (Compress / Merge / Convert / E-sign)
 * used to live outside favorites storage. On first load after the unify, merge
 * those defaults into whatever list is already saved, then never force them
 * back if the user unpins one.
 */
export const TOOL_FAVORITES_MIGRATED_KEY = 'shiftPdfFavoritesMigratedV1';

/** Former prepinned Tools rail — seed / migrate into the single favorites list. */
export const DEFAULT_FAVORITE_TOOL_IDS = [
  'compress-pdf',
  'merge-pdf',
  'pdf-converter',
  'sign-pdf',
] as const;

export const SIDEBAR_FAVORITE_LIMIT = 6;
const MAX_FAVORITES = 40;
const MAX_STORED_LENGTH = 4096;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;
type StorageLike = StorageReader & Partial<StorageWriter>;

export function getDefaultFavoriteToolIds(
  validToolIds: ReadonlySet<string>
): string[] {
  return DEFAULT_FAVORITE_TOOL_IDS.filter((toolId) => validToolIds.has(toolId));
}

export function parseFavoriteToolIds(
  storedValue: string | null,
  validToolIds: ReadonlySet<string>
): string[] {
  return parseFavoriteToolIdsInternal(storedValue, validToolIds).favoriteIds;
}

function parseFavoriteToolIdsInternal(
  storedValue: string | null,
  validToolIds: ReadonlySet<string>
): { favoriteIds: string[]; mutated: boolean } {
  if (!storedValue || storedValue.length > MAX_STORED_LENGTH) {
    return { favoriteIds: [], mutated: false };
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return { favoriteIds: [], mutated: false };

    const favoriteIds: string[] = [];
    const seen = new Set<string>();
    let mutated = false;

    for (const value of parsed) {
      if (typeof value !== 'string') {
        mutated = true;
        continue;
      }
      const normalized = extractCatalogEntryIdFromHref(value) || value.trim();
      if (normalized !== value) {
        mutated = true;
      }
      if (
        PRUNED_TOOL_ID_SET.has(normalized) ||
        !validToolIds.has(normalized) ||
        seen.has(normalized)
      ) {
        mutated = true;
        continue;
      }

      favoriteIds.push(normalized);
      seen.add(normalized);
      if (favoriteIds.length === MAX_FAVORITES) break;
    }

    return { favoriteIds, mutated };
  } catch (error) {
    console.warn('Ignored invalid saved PDF tool favorites.', error);
    return { favoriteIds: [], mutated: false };
  }
}

function writeFavoriteToolIds(
  favoriteIds: readonly string[],
  storage: StorageWriter
): boolean {
  try {
    storage.setItem(
      TOOL_FAVORITES_STORAGE_KEY,
      JSON.stringify(favoriteIds.slice(0, MAX_FAVORITES))
    );
    return true;
  } catch (error) {
    console.warn('Could not save PDF tool favorites.', error);
    return false;
  }
}

function markFavoritesMigrated(storage: StorageWriter): void {
  try {
    storage.setItem(TOOL_FAVORITES_MIGRATED_KEY, '1');
  } catch (error) {
    console.warn('Could not mark PDF tool favorites as migrated.', error);
  }
}

/**
 * Load favorites from localStorage. Missing storage seeds the former prepinned
 * set (and persists it when writable). A one-time migration merges those
 * defaults into older saved lists that pre-date removable prepins.
 */
export function loadFavoriteToolIds(
  validToolIds: ReadonlySet<string>,
  storage: StorageLike | undefined = getLocalStorage()
): string[] {
  const defaults = getDefaultFavoriteToolIds(validToolIds);
  if (!storage) return defaults;

  try {
    const raw = storage.getItem(TOOL_FAVORITES_STORAGE_KEY);
    const migrated = storage.getItem(TOOL_FAVORITES_MIGRATED_KEY) === '1';
    const canWrite = typeof storage.setItem === 'function';

    if (raw === null) {
      if (canWrite) {
        writeFavoriteToolIds(defaults, storage as StorageWriter);
        markFavoritesMigrated(storage as StorageWriter);
      }
      return defaults;
    }

    const { favoriteIds: existing, mutated } = parseFavoriteToolIdsInternal(
      raw,
      validToolIds
    );
    const clearedAll = raw.trim() === '[]';

    // An explicit empty list is "Clear all". Do not merge the former
    // prepinned tools back — that is the re-seed the smoke pass caught.
    if (!migrated && !clearedAll) {
      const existingSet = new Set(existing);
      const merged = [
        ...defaults.filter((toolId) => !existingSet.has(toolId)),
        ...existing,
      ].slice(0, MAX_FAVORITES);
      if (canWrite) {
        writeFavoriteToolIds(merged, storage as StorageWriter);
        markFavoritesMigrated(storage as StorageWriter);
      }
      return merged;
    }

    if (clearedAll && !migrated && canWrite) {
      markFavoritesMigrated(storage as StorageWriter);
    }

    if (migrated && canWrite && mutated) {
      writeFavoriteToolIds(existing, storage as StorageWriter);
    }

    return existing;
  } catch (error) {
    console.warn('PDF tool favorites storage is unavailable.', error);
    return defaults;
  }
}

export function saveFavoriteToolIds(
  favoriteIds: readonly string[],
  storage: StorageWriter | undefined = getLocalStorage()
): boolean {
  if (!storage) return false;

  const saved = writeFavoriteToolIds(favoriteIds, storage);
  if (saved) markFavoritesMigrated(storage);
  return saved;
}

export function saveFavoriteRailSnapshot(
  pins: readonly FavoriteRailPin[],
  storage: StorageWriter | undefined = getLocalStorage()
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(
      TOOL_FAVORITES_RAIL_KEY,
      JSON.stringify(
        pins.slice(0, SIDEBAR_FAVORITE_LIMIT).map((pin) => ({
          name: pin.name,
          href: pin.href,
          icon: pin.icon,
        }))
      )
    );
    return true;
  } catch (error) {
    console.warn('Could not cache the PDF favorites rail.', error);
    return false;
  }
}

function migratePinHref(href: string): {
  pruned: boolean;
  href: string;
  changed: boolean;
} {
  const toolId = extractCatalogEntryIdFromHref(href);
  if (toolId && PRUNED_TOOL_ID_SET.has(toolId)) {
    return { pruned: true, href, changed: true };
  }
  const entry = toolId ? getCatalogEntryById(toolId) : undefined;
  if (entry && entry.id !== entry.surface) {
    const rewritten = href.replace(
      new RegExp(`(^|/)${entry.id}\\.html(?:\\?[^#]*)?`, 'i'),
      `$1${entry.surface}.html?entry=${entry.id}`
    );
    if (rewritten !== href) {
      return { pruned: false, href: rewritten, changed: true };
    }
  }
  return { pruned: false, href, changed: false };
}

/**
 * Read the rail snapshot written by the sidebar. The Open-with row needs a
 * favorite's name and link, and only the deferred catalog knows those, so it
 * reads the same cache `public/sidebar-boot.js` uses for its first paint.
 */
export function parseFavoriteRailSnapshot(
  storedValue: string | null
): FavoriteRailPin[] {
  return parseFavoriteRailSnapshotInternal(storedValue).pins;
}

function parseFavoriteRailSnapshotInternal(storedValue: string | null): {
  pins: FavoriteRailPin[];
  mutated: boolean;
} {
  if (!storedValue || storedValue.length > MAX_STORED_LENGTH * 4) {
    return { pins: [], mutated: false };
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return { pins: [], mutated: false };

    const pins: FavoriteRailPin[] = [];
    let mutated = false;

    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue;
      const { name, href, icon } = value as Partial<FavoriteRailPin>;
      if (typeof name !== 'string' || typeof href !== 'string') continue;
      if (!name.trim() || !href.trim()) continue;

      const migration = migratePinHref(href);
      if (migration.changed) mutated = true;
      if (migration.pruned) continue;

      pins.push({
        name,
        href: migration.href,
        icon: typeof icon === 'string' ? icon : '',
      });
      if (pins.length === SIDEBAR_FAVORITE_LIMIT) break;
    }

    return { pins, mutated };
  } catch (error) {
    console.warn('Ignored an invalid PDF favorites rail cache.', error);
    return { pins: [], mutated: false };
  }
}

export function loadFavoriteRailSnapshot(
  storage: StorageLike | undefined = getLocalStorage()
): FavoriteRailPin[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(TOOL_FAVORITES_RAIL_KEY);
    const { pins, mutated } = parseFavoriteRailSnapshotInternal(raw);
    if (mutated && typeof storage.setItem === 'function') {
      saveFavoriteRailSnapshot(pins, storage as StorageWriter);
    }
    return pins;
  } catch (error) {
    console.warn('PDF favorites rail cache is unavailable.', error);
    return [];
  }
}

export function reorderFavoriteToolIds(
  favoriteIds: readonly string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= favoriteIds.length ||
    toIndex >= favoriteIds.length
  ) {
    return [...favoriteIds];
  }

  const next = [...favoriteIds];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return [...favoriteIds];
  next.splice(toIndex, 0, moved);
  return next;
}

export function toggleFavoriteToolId(
  favoriteIds: readonly string[],
  toolId: string
): string[] {
  if (favoriteIds.includes(toolId)) {
    return favoriteIds.filter((favoriteId) => favoriteId !== toolId);
  }

  return [
    ...favoriteIds.filter((favoriteId) => favoriteId !== toolId),
    toolId,
  ].slice(-MAX_FAVORITES);
}

export function partitionToolIdsByFavorites(
  toolIds: readonly string[],
  favoriteIds: readonly string[]
): { favoriteIds: string[]; catalogIds: string[] } {
  const available = new Set(toolIds);
  const favorites = favoriteIds.filter((toolId) => available.has(toolId));
  const favoriteSet = new Set(favorites);

  return {
    favoriteIds: favorites,
    catalogIds: toolIds.filter((toolId) => !favoriteSet.has(toolId)),
  };
}

/** Marks extra catalog copies of a favorited tool so search does not unhide them. */
export const FAVORITE_CATALOG_COPY_ATTR = 'data-favorite-catalog-copy';

/**
 * Render an independent clone of one card per favorited Catalog Entry inside
 * the `Favorites` spotlight container while keeping every original card
 * visible in its home domain category below.
 */
export function placeFavoriteToolCards(
  cardsByToolId: ReadonlyMap<string, readonly HTMLElement[]>,
  originalContainers: ReadonlyMap<HTMLElement, HTMLElement>,
  favoriteIds: readonly string[],
  favoritesContainer: HTMLElement,
  options?: {
    onToggleFavorite?: (toolId: string) => void;
  }
): void {
  const partition = partitionToolIdsByFavorites(
    [...cardsByToolId.keys()],
    favoriteIds
  );

  // Remove any previously cloned favorite cards from favoritesContainer while
  // keeping non-card children (such as `.shift-favorites-empty`).
  Array.from(favoritesContainer.children).forEach((child) => {
    if (
      child instanceof HTMLElement &&
      (child.classList.contains('tool-card') || child.dataset.toolId)
    ) {
      child.remove();
    }
  });

  // Ensure every domain card stays visible in its original home container.
  for (const cards of cardsByToolId.values()) {
    for (const card of cards) {
      card.removeAttribute(FAVORITE_CATALOG_COPY_ATTR);
      card.hidden = false;
      const original = originalContainers.get(card);
      if (original && card.parentElement !== original) {
        original.appendChild(card);
      }
    }
  }

  partition.favoriteIds.forEach((toolId) => {
    const sourceCard = cardsByToolId.get(toolId)?.[0];
    if (!sourceCard) return;

    const clone = sourceCard.cloneNode(true) as HTMLElement;
    clone.removeAttribute(FAVORITE_CATALOG_COPY_ATTR);
    clone.hidden = false;

    const favButton = clone.querySelector<HTMLButtonElement>(
      '.shift-tool-favorite'
    );
    if (favButton && options?.onToggleFavorite) {
      favButton.addEventListener('click', () =>
        options.onToggleFavorite?.(toolId)
      );
    }

    favoritesContainer.appendChild(clone);
  });
}

const sidebarGuardBoundDocs = new WeakSet<Document>();

/**
 * Global navigation in the Left Sidebar (`#shift-favorite-tools a` or
 * `[data-nav="home"]` / `[data-nav="all-tools"]`) always opens a fresh, empty
 * Tool Surface by clearing `shiftOpenWithSelection`.
 */
export function bindSidebarGlobalLauncherGuard(
  root: Document = document
): void {
  if (sidebarGuardBoundDocs.has(root)) return;
  sidebarGuardBoundDocs.add(root);

  root.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      const link = target?.closest<HTMLAnchorElement>(
        '#shift-favorite-tools a, a[data-nav="home"], a[data-nav="all-tools"]'
      );
      if (link) {
        clearOpenWithSelection();
      }
    },
    true
  );
}

function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch (error) {
    console.warn('PDF tool favorites storage is unavailable.', error);
    return undefined;
  }
}
