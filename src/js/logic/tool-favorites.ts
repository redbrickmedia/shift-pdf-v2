export const TOOL_FAVORITES_STORAGE_KEY = 'shiftPdfFavoriteToolIds';

/**
 * Snapshot of the rendered rail pins, read by public/sidebar-boot.js before the
 * sidebar is parsed. The IDs above are not enough for that: turning one into a
 * pin needs the tool's name, link and glyph, and the catalog that holds those
 * only arrives with the deferred main.ts bundle — after first paint, which is
 * why the pins used to appear a frame or two late.
 */
export const TOOL_FAVORITES_RAIL_KEY = 'shiftPdfFavoriteRail';

export interface FavoriteRailPin {
  name: string;
  href: string;
  icon: string;
}

const MAX_FAVORITES = 40;
const MAX_STORED_LENGTH = 4096;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

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

export function loadFavoriteToolIds(
  validToolIds: ReadonlySet<string>,
  storage: StorageReader | undefined = getLocalStorage()
): string[] {
  if (!storage) return [];

  try {
    return parseFavoriteToolIds(
      storage.getItem(TOOL_FAVORITES_STORAGE_KEY),
      validToolIds
    );
  } catch (error) {
    console.warn('PDF tool favorites storage is unavailable.', error);
    return [];
  }
}

export function saveFavoriteToolIds(
  favoriteIds: readonly string[],
  storage: StorageWriter | undefined = getLocalStorage()
): boolean {
  if (!storage) return false;

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

export function titleForFavoritePin(options: {
  name: string;
  collapsed: boolean;
  overflowing: boolean;
}): string {
  if (!options.name) return '';
  if (options.collapsed || options.overflowing) return options.name;
  return '';
}

export function applyFavoritePinTitles(
  root: ParentNode,
  collapsed: boolean
): void {
  root
    .querySelectorAll<HTMLAnchorElement>('.shift-favorite-link')
    .forEach((link) => {
      const label = link.querySelector<HTMLElement>('.shift-nav-label');
      const name = label?.textContent?.trim() ?? '';
      const overflowing = Boolean(
        label && label.scrollWidth - label.clientWidth > 0.5
      );
      const title = titleForFavoritePin({ name, collapsed, overflowing });
      if (title) {
        link.title = title;
      } else {
        link.removeAttribute('title');
      }
    });
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

function getLocalStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch (error) {
    console.warn('PDF tool favorites storage is unavailable.', error);
    return undefined;
  }
}
