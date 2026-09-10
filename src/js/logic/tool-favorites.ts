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

export interface FavoriteRailPin {
  name: string;
  href: string;
  icon: string;
}

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
  if (!storedValue || storedValue.length > MAX_STORED_LENGTH) return [];

  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return [];

    const favoriteIds: string[] = [];
    const seen = new Set<string>();

    for (const value of parsed) {
      if (
        typeof value !== 'string' ||
        !validToolIds.has(value) ||
        seen.has(value)
      ) {
        continue;
      }

      favoriteIds.push(value);
      seen.add(value);
      if (favoriteIds.length === MAX_FAVORITES) break;
    }

    return favoriteIds;
  } catch (error) {
    console.warn('Ignored invalid saved PDF tool favorites.', error);
    return [];
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

    const existing = parseFavoriteToolIds(raw, validToolIds);

    if (!migrated) {
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
        pins.slice(0, MAX_FAVORITES).map((pin) => ({
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
 * Move one card per favorited tool into the favorites category. Extra catalog
 * copies of that same ID stay in their original sections and are hidden, so a
 * tool listed in Popular and Organize still appears in Organize when it is not
 * a favorite.
 */
export function placeFavoriteToolCards(
  cardsByToolId: ReadonlyMap<string, readonly HTMLElement[]>,
  originalContainers: ReadonlyMap<HTMLElement, HTMLElement>,
  favoriteIds: readonly string[],
  favoritesContainer: HTMLElement
): void {
  const partition = partitionToolIdsByFavorites(
    [...cardsByToolId.keys()],
    favoriteIds
  );

  partition.favoriteIds.forEach((toolId) => {
    const cards = cardsByToolId.get(toolId) ?? [];
    cards.forEach((card, index) => {
      if (index === 0) {
        card.removeAttribute(FAVORITE_CATALOG_COPY_ATTR);
        card.hidden = false;
        favoritesContainer.appendChild(card);
        return;
      }

      card.setAttribute(FAVORITE_CATALOG_COPY_ATTR, 'hidden');
      card.hidden = true;
      originalContainers.get(card)?.appendChild(card);
    });
  });

  partition.catalogIds.forEach((toolId) => {
    for (const card of cardsByToolId.get(toolId) ?? []) {
      card.removeAttribute(FAVORITE_CATALOG_COPY_ATTR);
      card.hidden = false;
      originalContainers.get(card)?.appendChild(card);
    }
  });
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
