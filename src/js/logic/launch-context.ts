import {
  getCatalogEntryById,
  getCatalogEntryI18nPrefix,
} from '../config/tools.js';
import i18next from '../i18n/i18n.js';
import { acceptForToolId } from './tool-input-accept.js';
import type { LaunchContext, ToolCardinality } from '@/types';

export type { LaunchContext } from '@/types';

export function parseSurfaceAndSearch(
  pathname: string,
  search?: string
): { surfaceId: string; effectiveSearch: string } {
  const qIndex = pathname.indexOf('?');
  const cleanPathname = qIndex >= 0 ? pathname.slice(0, qIndex) : pathname;
  const embeddedSearch = qIndex >= 0 ? pathname.slice(qIndex) : '';
  const effectiveSearch =
    search !== undefined
      ? search
      : embeddedSearch ||
        (typeof window !== 'undefined' && pathname === window.location.pathname
          ? (window.location.search ?? '')
          : '');

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
    search
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
    multiple: cardinality === 'dual' || cardinality === 'batch',
  };
}

export function resolveNavTarget(
  pathname: string,
  search?: string
): { surfaceId: string; entryId: string } {
  const { surfaceId: rawSurfaceId, effectiveSearch } = parseSurfaceAndSearch(
    pathname,
    search
  );
  const surfaceId = rawSurfaceId === '' ? 'index' : rawSurfaceId;
  const ctx = resolveLaunchContext(pathname, effectiveSearch);
  if (ctx.entry && ctx.entry.surface !== surfaceId && !effectiveSearch) {
    return { surfaceId: ctx.entry.surface, entryId: ctx.entry.id };
  }
  return {
    surfaceId,
    entryId: ctx.entry ? ctx.entryId : surfaceId,
  };
}

export function syncActiveToolNavLinks(
  root: Document = document,
  context: LaunchContext = resolveLaunchContext()
): void {
  const currentSurfaceId =
    context.surfaceId === '' ? 'index' : context.surfaceId;
  const currentEntryId = context.entry ? context.entryId : currentSurfaceId;
  const baseHref =
    typeof window !== 'undefined' ? window.location.href : 'http://localhost/';

  root
    .querySelectorAll<HTMLAnchorElement>('.shift-nav-link[href]')
    .forEach((link) => {
      if (
        link.classList.contains('shift-open-file-item') ||
        link.hasAttribute('data-nav')
      ) {
        return;
      }
      let url: URL;
      try {
        url = new URL(link.href, baseHref);
      } catch (error) {
        console.warn('Ignored invalid nav link URL.', error);
        return;
      }
      const target = resolveNavTarget(url.pathname, url.search);
      const isActive =
        target.surfaceId === currentSurfaceId &&
        target.entryId === currentEntryId;
      link.classList.toggle('is-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
}

function resolveLocalizedCopy(
  i18nKey: string | null,
  fallback: string
): string {
  if (i18nKey && i18next.isInitialized) {
    const translated = i18next.t(i18nKey);
    if (translated && translated !== i18nKey) {
      return translated;
    }
  }
  return fallback;
}

/**
 * Applies the resolved Launch Context to the document header, document title,
 * sidebar active links, and primary `#file-input` (`accept` and `multiple`).
 */
export function applyLaunchContextToDom(
  root: Document = document,
  context: LaunchContext = resolveLaunchContext()
): LaunchContext {
  syncActiveToolNavLinks(root, context);
  if (!context.entry) return context;

  root.documentElement.dataset.launchEntry = context.entryId;
  root.documentElement.dataset.launchSurface = context.surfaceId;

  root
    .querySelectorAll<HTMLInputElement>(
      'input#file-input, input#pdf-file-input'
    )
    .forEach((input) => {
      input.accept = context.accept;
      input.multiple = context.multiple;
    });

  const shouldUpdateCopy =
    context.isConsolidatedEntry ||
    root.documentElement.hasAttribute('data-launch-context-applied');

  if (shouldUpdateCopy) {
    const i18nPrefix = getCatalogEntryI18nPrefix(context.entryId);
    const nameI18nKey = i18nPrefix ? `${i18nPrefix}.name` : null;
    const subtitleI18nKey = i18nPrefix ? `${i18nPrefix}.subtitle` : null;
    const localizedName = resolveLocalizedCopy(nameI18nKey, context.name);
    const localizedSubtitle = resolveLocalizedCopy(
      subtitleI18nKey,
      context.subtitle
    );

    const heading =
      root.querySelector<HTMLElement>('.shift-pdf-viewer-header h1') ??
      root.querySelector<HTMLElement>('#tool-uploader h1');
    if (heading && localizedName) {
      if (nameI18nKey) {
        heading.setAttribute('data-i18n', nameI18nKey);
      } else {
        heading.removeAttribute('data-i18n');
      }
      heading.textContent = localizedName;
    }

    const subtitle =
      root.querySelector<HTMLElement>(
        '.shift-pdf-viewer-header [data-viewer-chrome="subtitle"]'
      ) ?? root.querySelector<HTMLElement>('#tool-uploader h1 + p');
    if (subtitle && localizedSubtitle) {
      if (subtitleI18nKey) {
        subtitle.setAttribute('data-i18n', subtitleI18nKey);
      } else {
        subtitle.removeAttribute('data-i18n');
      }
      subtitle.textContent = localizedSubtitle;
    }

    if (localizedName) {
      const brandSeparatorIndex = root.title.indexOf(' | ');
      const brandSuffix =
        brandSeparatorIndex >= 0
          ? root.title.slice(brandSeparatorIndex)
          : ' | Shift PDF';
      root.title = `${localizedName}${brandSuffix}`;
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
    typeof window !== 'undefined' ? (window.location.pathname ?? '/') : '/';
  const currentSearch =
    typeof window !== 'undefined' ? (window.location.search ?? '') : '';
  const currentHash =
    typeof window !== 'undefined' ? (window.location.hash ?? '') : '';

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
