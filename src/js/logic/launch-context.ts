import {
  getCatalogEntryById,
  type CatalogEntry,
  type ToolCardinality,
} from '../config/tools.js';
import { acceptForToolId } from './tool-input-accept.js';

export interface LaunchContext {
  surfaceId: string;
  entryId: string;
  entry: CatalogEntry | null;
  canonicalEntry: CatalogEntry | null;
  isConsolidatedEntry: boolean;
  name: string;
  subtitle: string;
  icon: string;
  accept: string;
  cardinality: ToolCardinality;
  multiple: boolean;
}

function parseSurfaceAndSearch(
  pathname: string,
  search?: string
): { surfaceId: string; effectiveSearch: string } {
  const qIndex = pathname.indexOf('?');
  const cleanPathname = qIndex >= 0 ? pathname.slice(0, qIndex) : pathname;
  const embeddedSearch = qIndex >= 0 ? pathname.slice(qIndex) : '';
  const effectiveSearch = search !== undefined ? search : embeddedSearch;

  const segment = cleanPathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const surfaceId = segment.replace(/\.html$/i, '').toLowerCase();
  return { surfaceId, effectiveSearch };
}

/**
 * Resolves the active Launch Context from a pathname and optional query string.
 * Validates `?entry=<id>` against the Catalog Entry registry for the current
 * surface, falling back to the surface's canonical entry if `?entry=` is
 * omitted, unknown, or belongs to a different surface.
 */
export function resolveLaunchContext(
  pathname: string = typeof window !== 'undefined'
    ? window.location.pathname
    : '/',
  search?: string
): LaunchContext {
  const { surfaceId, effectiveSearch } = parseSurfaceAndSearch(
    pathname,
    search !== undefined
      ? search
      : typeof window !== 'undefined' && pathname === window.location.pathname
        ? window.location.search
        : ''
  );

  const params = new URLSearchParams(
    effectiveSearch.startsWith('?') ? effectiveSearch.slice(1) : effectiveSearch
  );
  const requestedEntryId = params.get('entry')?.trim().toLowerCase() ?? '';

  const canonicalEntry = getCatalogEntryById(surfaceId) ?? null;
  const requestedEntry = requestedEntryId
    ? (getCatalogEntryById(requestedEntryId) ?? null)
    : null;

  const validConsolidatedEntry =
    requestedEntry && requestedEntry.surface === surfaceId
      ? requestedEntry
      : null;

  const activeEntry = validConsolidatedEntry ?? canonicalEntry;
  const entryId = activeEntry?.id ?? surfaceId;
  const cardinality: ToolCardinality = activeEntry?.cardinality ?? 'single';

  return {
    surfaceId,
    entryId,
    entry: activeEntry,
    canonicalEntry,
    isConsolidatedEntry: Boolean(
      activeEntry && activeEntry.id !== activeEntry.surface
    ),
    name: activeEntry?.name ?? '',
    subtitle: activeEntry?.subtitle ?? '',
    icon: activeEntry?.icon ?? '',
    accept: acceptForToolId(entryId),
    cardinality,
    multiple: cardinality === 'batch',
  };
}

/**
 * Applies the resolved Launch Context to the document header, document title,
 * and primary `#file-input` (`accept` and `multiple` attributes).
 */
export function applyLaunchContextToDom(
  root: Document = document,
  context: LaunchContext = resolveLaunchContext()
): LaunchContext {
  if (!context.entry) return context;

  root.documentElement.dataset.launchEntry = context.entryId;
  root.documentElement.dataset.launchSurface = context.surfaceId;

  const input = root.querySelector<HTMLInputElement>('input#file-input');
  if (input) {
    input.accept = context.accept;
    input.multiple = context.multiple;
  }

  const shouldUpdateCopy =
    context.isConsolidatedEntry ||
    root.documentElement.hasAttribute('data-launch-context-applied');

  if (shouldUpdateCopy) {
    const heading =
      root.querySelector<HTMLElement>('.shift-pdf-viewer-header h1') ??
      root.querySelector<HTMLElement>('#tool-uploader h1');
    if (heading && context.name) {
      heading.textContent = context.name;
    }

    const subtitle =
      root.querySelector<HTMLElement>(
        '.shift-pdf-viewer-header [data-viewer-chrome="subtitle"]'
      ) ?? root.querySelector<HTMLElement>('#tool-uploader h1 + p');
    if (subtitle && context.subtitle) {
      subtitle.textContent = context.subtitle;
    }

    if (context.name) {
      const brandSeparatorIndex = root.title.indexOf(' | ');
      const brandSuffix =
        brandSeparatorIndex >= 0
          ? root.title.slice(brandSeparatorIndex)
          : ' | Shift PDF';
      root.title = `${context.name}${brandSuffix}`;
    }

    root.documentElement.setAttribute('data-launch-context-applied', 'true');
  }

  return context;
}

/**
 * Updates the active Launch Context in-place when a user switches modes inside
 * a consolidated surface, syncing `?entry=<id>` via `history.replaceState` and
 * updating the header, document title, file input, and telemetry attribution
 * without a full page reload.
 */
export function setLaunchContext(
  entryId: string,
  root: Document = document
): LaunchContext {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '/';
  const currentSearch =
    typeof window !== 'undefined' ? window.location.search : '';
  const currentHash = typeof window !== 'undefined' ? window.location.hash : '';

  const { surfaceId } = parseSurfaceAndSearch(pathname, currentSearch);
  const candidate = getCatalogEntryById(entryId.trim().toLowerCase());
  const resolvedEntryId =
    candidate && candidate.surface === surfaceId ? candidate.id : surfaceId;

  const params = new URLSearchParams(
    currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch
  );
  if (resolvedEntryId === surfaceId) {
    params.delete('entry');
  } else {
    params.set('entry', resolvedEntryId);
  }

  const nextQuery = params.toString();
  const nextSearch = nextQuery ? `?${nextQuery}` : '';
  if (typeof window !== 'undefined' && window.history?.replaceState) {
    window.history.replaceState(
      window.history.state,
      '',
      `${pathname}${nextSearch}${currentHash}`
    );
  }

  const nextContext = resolveLaunchContext(pathname, nextSearch);
  return applyLaunchContextToDom(root, nextContext);
}
