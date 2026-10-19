import {
  categories,
  extractCatalogEntryIdFromHref,
  getCatalogEntryById,
} from '../config/tools.js';
import type { CatalogEntry } from '@/types';
import {
  hasOpenWithSelection,
  markOpenWithSelection,
  readOpenFileSnapshot,
} from './open-file-store.js';
import { attachShiftTooltip, hideShiftTooltip } from './shift-tooltip.js';
import {
  loadFavoriteRailSnapshot,
  loadFavoriteToolIds,
} from './tool-favorites.js';
import { acceptForToolId } from './tool-input-accept.js';

export const OPEN_WITH_NON_PDF_TOOLTIP = "This tool doesn't accept PDF files.";
export const OPEN_WITH_SINGLE_PDF_TOOLTIP =
  'Select a single PDF to use this tool.';
export const OPEN_WITH_DUAL_PDF_TOOLTIP = 'Select 1 or 2 PDFs to compare.';
export const OPEN_WITH_BROWSE_LABEL = 'Browse all tools…';

export interface OpenWithMenuEntry {
  id: string;
  name: string;
  href: string;
  icon: string;
  section: 'favorites' | 'popular';
  acceptsPdf: boolean;
  disabled: boolean;
  tooltip: string;
}

export interface OpenWithCompatResult {
  acceptsPdf: boolean;
  disabled: boolean;
  tooltip: string;
}

const MORE_TOOLS_CARET_PATH = 'm6 9.5 6 6 6-6';

const allCatalogToolIds = new Set<string>(
  categories.flatMap((category) => category.tools.map((tool) => tool.id))
);

export function doesCatalogEntryAcceptPdf(entryId: string): boolean {
  const accept = acceptForToolId(entryId).toLowerCase();
  if (!accept.trim()) return true;
  return accept.split(',').some((token) => {
    const trimmed = token.trim();
    return (
      trimmed === '*' ||
      trimmed === '*/*' ||
      trimmed === 'application/pdf' ||
      trimmed === '.pdf'
    );
  });
}

export function evaluateOpenWithCompatibility(
  entryOrId: CatalogEntry | string,
  selectedPdfCount: number
): OpenWithCompatResult {
  const entry =
    typeof entryOrId === 'string' ? getCatalogEntryById(entryOrId) : entryOrId;
  const entryId = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  const acceptsPdf = doesCatalogEntryAcceptPdf(entryId);

  if (!acceptsPdf) {
    return {
      acceptsPdf: false,
      disabled: true,
      tooltip: OPEN_WITH_NON_PDF_TOOLTIP,
    };
  }

  const cardinality = entry?.cardinality ?? 'single';
  if (cardinality === 'single' && selectedPdfCount > 1) {
    return {
      acceptsPdf: true,
      disabled: true,
      tooltip: OPEN_WITH_SINGLE_PDF_TOOLTIP,
    };
  }

  if (cardinality === 'dual' && selectedPdfCount > 2) {
    return {
      acceptsPdf: true,
      disabled: true,
      tooltip: OPEN_WITH_DUAL_PDF_TOOLTIP,
    };
  }

  return {
    acceptsPdf: true,
    disabled: false,
    tooltip: '',
  };
}

function resolveFavoriteSourceIds(explicitFavoriteIds?: readonly string[]): {
  ids: string[];
  namesById: Map<string, string>;
  hrefsById: Map<string, string>;
} {
  const namesById = new Map<string, string>();
  const hrefsById = new Map<string, string>();

  if (explicitFavoriteIds) {
    return {
      ids: [...explicitFavoriteIds],
      namesById,
      hrefsById,
    };
  }

  const hasSavedFavoriteIds = (() => {
    try {
      return localStorage.getItem('shiftPdfFavoriteToolIds') !== null;
    } catch {
      return false;
    }
  })();

  if (hasSavedFavoriteIds) {
    return {
      ids: loadFavoriteToolIds(allCatalogToolIds),
      namesById,
      hrefsById,
    };
  }

  const railPins = loadFavoriteRailSnapshot();
  if (railPins.length > 0) {
    const pinIds: string[] = [];
    for (const pin of railPins) {
      const id = extractCatalogEntryIdFromHref(pin.href) || pin.href;
      if (!id || pinIds.includes(id)) continue;
      pinIds.push(id);
      namesById.set(id, pin.name);
      hrefsById.set(id, pin.href);
    }
    return { ids: pinIds, namesById, hrefsById };
  }

  return {
    ids: loadFavoriteToolIds(allCatalogToolIds),
    namesById,
    hrefsById,
  };
}

export function buildOpenWithMenuEntries(options?: {
  favoriteIds?: readonly string[];
  selectedPdfCount?: number;
}): OpenWithMenuEntry[] {
  const selectedPdfCount = options?.selectedPdfCount ?? 1;
  const {
    ids: favoriteIds,
    namesById,
    hrefsById,
  } = resolveFavoriteSourceIds(options?.favoriteIds);

  const entries: OpenWithMenuEntry[] = [];
  const listedIds = new Set<string>();

  const pushEntry = (
    id: string,
    section: 'favorites' | 'popular',
    fallbackName?: string,
    fallbackHref?: string
  ): void => {
    if (!id || listedIds.has(id)) return;
    const catalogEntry = getCatalogEntryById(id);
    const name = catalogEntry?.name ?? fallbackName ?? id;
    const href = catalogEntry?.href ?? fallbackHref ?? `${id}.html`;
    const icon = catalogEntry?.icon ?? '';
    if (!catalogEntry && !fallbackName) return;

    listedIds.add(id);
    const compat = evaluateOpenWithCompatibility(
      catalogEntry ?? id,
      selectedPdfCount
    );
    entries.push({
      id,
      name,
      href,
      icon,
      section,
      acceptsPdf: compat.acceptsPdf,
      disabled: compat.disabled,
      tooltip: compat.tooltip,
    });
  };

  for (const favId of favoriteIds) {
    pushEntry(favId, 'favorites', namesById.get(favId), hrefsById.get(favId));
  }

  const popular =
    categories.find((category) => category.name === 'Popular Tools') ??
    categories[0];
  for (const tool of popular?.tools ?? []) {
    pushEntry(tool.id, 'popular', tool.name, tool.href);
  }

  return entries;
}

export function createOpenWithCaret(root: Document): SVGSVGElement {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = root.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'shift-my-pdfs-more-tools-caret');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = root.createElementNS(svgNs, 'path');
  path.setAttribute('d', MORE_TOOLS_CARET_PATH);
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

export function renderOpenWithMenuContents(
  root: Document,
  menu: HTMLElement,
  options?: {
    favoriteIds?: readonly string[];
    selectedPdfCount?: number;
  }
): void {
  menu.replaceChildren();

  const list = root.createElement('div');
  list.className = 'shift-my-pdfs-more-tools-list';
  list.setAttribute('role', 'none');

  const entries = buildOpenWithMenuEntries(options);
  for (const entry of entries) {
    const link = root.createElement('a');
    link.className = 'shift-my-pdfs-more-tools-item';
    link.href = entry.href;
    link.dataset.tool = entry.id;
    link.dataset.openWithSection = entry.section;
    link.setAttribute('role', 'menuitem');
    link.textContent = entry.name;

    if (entry.disabled) {
      link.classList.add('is-disabled');
      link.setAttribute('aria-disabled', 'true');
      link.tabIndex = -1;
      const wrap = root.createElement('span');
      wrap.className = 'shift-open-file-tool-wrap';
      wrap.append(link);
      if (entry.tooltip) {
        attachShiftTooltip(wrap, {
          placement: 'bottom',
          text: entry.tooltip,
        });
      }
      list.appendChild(wrap);
    } else {
      list.appendChild(link);
    }
  }

  menu.appendChild(list);

  const browse = root.createElement('a');
  browse.className =
    'shift-my-pdfs-more-tools-item shift-my-pdfs-more-tools-browse';
  browse.href = `${import.meta.env.BASE_URL}all-tools.html`;
  browse.dataset.openWithBrowse = 'true';
  browse.setAttribute('role', 'menuitem');
  browse.textContent = OPEN_WITH_BROWSE_LABEL;
  menu.appendChild(browse);
}

export interface MountOpenWithDropdownOptions {
  buttonId: string;
  menuId: string;
  wrapClassName?: string;
  buttonClassName?: string;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  getSelectedPdfCount: () => number;
  onSelectTool?: (href: string, event: MouseEvent) => void;
}

const openWithDismissBoundDocs = new WeakSet<Document>();

export function setOpenWithDropdownExpanded(
  root: Document,
  buttonId: string,
  menuId: string,
  expanded: boolean
): void {
  const button = root.getElementById(buttonId) as HTMLButtonElement | null;
  const menu = root.getElementById(menuId);
  if (!button || !menu) return;

  const open = expanded && !button.disabled;
  if (open) {
    // Close any other open dropdown first
    root
      .querySelectorAll<HTMLElement>('.shift-my-pdfs-more-tools-menu')
      .forEach((otherMenu) => {
        if (otherMenu.id !== menuId) {
          otherMenu.hidden = true;
          const otherBtnId = otherMenu.getAttribute('aria-labelledby');
          if (otherBtnId) {
            root
              .getElementById(otherBtnId)
              ?.setAttribute('aria-expanded', 'false');
          }
        }
      });
  }
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

export function bindOpenWithDismissListeners(root: Document): void {
  if (openWithDismissBoundDocs.has(root)) return;
  openWithDismissBoundDocs.add(root);

  root.addEventListener('click', (event) => {
    const openMenus = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.shift-my-pdfs-more-tools-menu:not([hidden])'
      )
    );
    if (openMenus.length === 0) return;
    const inside = (event.target as HTMLElement | null)?.closest(
      '.shift-my-pdfs-more-tools-wrap'
    );
    if (inside) return;
    for (const menu of openMenus) {
      const btnId = menu.getAttribute('aria-labelledby') ?? '';
      setOpenWithDropdownExpanded(root, btnId, menu.id, false);
    }
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openMenus = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.shift-my-pdfs-more-tools-menu:not([hidden])'
      )
    );
    if (openMenus.length === 0) return;
    for (const menu of openMenus) {
      const btnId = menu.getAttribute('aria-labelledby') ?? '';
      setOpenWithDropdownExpanded(root, btnId, menu.id, false);
      if (btnId) root.getElementById(btnId)?.focus();
    }
  });
}

export function createOpenWithDropdown(
  root: Document,
  options: MountOpenWithDropdownOptions
): {
  wrap: HTMLDivElement;
  button: HTMLButtonElement;
  menu: HTMLDivElement;
  refresh: () => void;
} {
  const wrap = root.createElement('div');
  wrap.className = options.wrapClassName ?? 'shift-my-pdfs-more-tools-wrap';

  const button = root.createElement('button');
  button.type = 'button';
  button.id = options.buttonId;
  button.className =
    options.buttonClassName ??
    'shift-button shift-open-file-tool-btn shift-my-pdfs-more-tools shift-open-with-btn';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', options.menuId);
  button.setAttribute('aria-label', options.ariaLabel ?? 'Open with');
  button.disabled = Boolean(options.disabled);
  button.append(
    root.createTextNode(options.label ?? 'Open with'),
    createOpenWithCaret(root)
  );

  const menu = root.createElement('div');
  menu.id = options.menuId;
  menu.className = 'shift-my-pdfs-more-tools-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-labelledby', options.buttonId);
  menu.hidden = true;

  const refresh = () => {
    renderOpenWithMenuContents(root, menu, {
      selectedPdfCount: options.getSelectedPdfCount(),
    });
  };

  wrap.append(button, menu);
  refresh();

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    hideShiftTooltip(root);
    refresh();
    setOpenWithDropdownExpanded(
      root,
      options.buttonId,
      options.menuId,
      menu.hidden
    );
  });

  menu.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest<HTMLAnchorElement>(
      'a.shift-my-pdfs-more-tools-item'
    );
    const disabledWrap = target
      ?.closest('.shift-open-file-tool-wrap')
      ?.querySelector('a[aria-disabled="true"]');
    if (item?.getAttribute('aria-disabled') === 'true' || disabledWrap) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (item) {
      markOpenWithSelection();
      if (options.onSelectTool) {
        options.onSelectTool(item.href, event);
      }
    }
    setOpenWithDropdownExpanded(root, options.buttonId, options.menuId, false);
  });

  bindOpenWithDismissListeners(root);

  return { wrap, button, menu, refresh };
}

const allToolsOpenWithGuardBoundRoots = new WeakSet<Document | HTMLElement>();

export function applyAllToolsOpenWithGuards(
  root: Document | HTMLElement = document,
  options?: {
    armed?: boolean;
    selectedPdfCount?: number;
  }
): void {
  const armed = options?.armed ?? hasOpenWithSelection();
  const snapshotCount = readOpenFileSnapshot().length;
  const selectedPdfCount =
    options?.selectedPdfCount ?? (snapshotCount > 0 ? snapshotCount : 1);

  root.querySelectorAll<HTMLElement>('.tool-card').forEach((card) => {
    const toolId =
      card.dataset.toolId ||
      extractCatalogEntryIdFromHref(
        card
          .querySelector<HTMLAnchorElement>('a[href]')
          ?.getAttribute('href') ?? ''
      );
    const link = card.querySelector<HTMLElement>(
      'a.shift-tool-card-link, a[href]'
    );
    if (!toolId || !link) return;

    const defaultTooltip = card.querySelector('h3')?.textContent?.trim() ?? '';

    if (!armed) {
      card.classList.remove('is-disabled');
      card.removeAttribute('aria-disabled');
      link.classList.remove('is-disabled');
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
      if (defaultTooltip) {
        attachShiftTooltip(link, { placement: 'bottom', text: defaultTooltip });
      } else {
        link.removeAttribute('data-shift-tooltip');
      }
      return;
    }

    const compat = evaluateOpenWithCompatibility(toolId, selectedPdfCount);
    if (compat.disabled) {
      card.classList.add('is-disabled');
      card.setAttribute('aria-disabled', 'true');
      link.classList.add('is-disabled');
      link.setAttribute('aria-disabled', 'true');
      link.tabIndex = -1;
      attachShiftTooltip(link, {
        placement: 'bottom',
        text: compat.tooltip,
      });
    } else {
      card.classList.remove('is-disabled');
      card.removeAttribute('aria-disabled');
      link.classList.remove('is-disabled');
      link.removeAttribute('aria-disabled');
      link.removeAttribute('tabindex');
      if (defaultTooltip) {
        attachShiftTooltip(link, { placement: 'bottom', text: defaultTooltip });
      }
    }
  });

  if (!allToolsOpenWithGuardBoundRoots.has(root)) {
    allToolsOpenWithGuardBoundRoots.add(root);
    root.addEventListener(
      'click',
      (event) => {
        const target = (event as MouseEvent).target as HTMLElement | null;
        const link = target?.closest<HTMLAnchorElement>(
          '.tool-card a.shift-tool-card-link, .tool-card a[href]'
        );
        if (!link) return;
        const card = link.closest<HTMLElement>('.tool-card');
        if (
          link.getAttribute('aria-disabled') === 'true' ||
          card?.getAttribute('aria-disabled') === 'true'
        ) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (hasOpenWithSelection()) {
          markOpenWithSelection();
        }
      },
      true
    );
  }
}
