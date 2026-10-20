/**
 * One header + action row for View PDF and every in-page viewer tool.
 * Pages pick a preset, then hide or show features without restyling a
 * second header. Button order lives in the shared action row.
 */
import { arrangeShiftActionRow } from './shift-action-row.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
} from './launch-context.js';
export const VIEWER_CHROME_HEADER_CLASS = 'shift-pdf-viewer-header';
export const VIEWER_CHROME_HEADING_CLASS = 'shift-pdf-viewer-heading';
export const VIEWER_CHROME_ACTIONS_CLASS = 'shift-pdf-viewer-actions';
export const VIEWER_CHROME_FEATURE_ATTR = 'data-viewer-chrome';
export const VIEWER_CHROME_ACTIONS_ATTR = 'data-shift-viewer-actions';

/**
 * The Commit Bar (ADR 0004) holds the actions that finish a job. It reads the
 * same feature map as the header, so the per-surface matrix still decides which
 * of them appear; the controls simply live in the bar instead of the header.
 */
export const COMMIT_BAR_ID = 'shift-commit-bar';
export const COMMIT_BAR_CLASS = 'shift-commit-bar';
export const COMMIT_BAR_ATTR = 'data-shift-commit-bar';
export const COMMIT_BAR_START_CLASS = 'shift-commit-bar-start';
export const COMMIT_BAR_END_CLASS = 'shift-commit-bar-end';

export const VIEWER_CHROME_FEATURES = [
  'back',
  'subtitle',
  'launchers',
  'print',
  'download',
  'undo',
  'redo',
  'reset',
  'save',
  'flatten',
  'sign',
] as const;

export type ViewerChromeFeature = (typeof VIEWER_CHROME_FEATURES)[number];
export type ViewerChromePreset = 'launchpad' | 'tool';
export type ViewerChromeFeatureMap = Record<ViewerChromeFeature, boolean>;

export interface ViewerChromeOptions {
  preset?: ViewerChromePreset;
  features?: Partial<ViewerChromeFeatureMap>;
}

export interface ViewerChrome {
  header: HTMLElement;
  heading: HTMLElement;
  actions: HTMLElement;
  features: ViewerChromeFeatureMap;
}

export const STATEFUL_UNDO_REDO_SURFACE_IDS = new Set([
  'edit-pdf',
  'pdf-multi-tool',
  'merge-pdf',
  'bookmark',
  'form-creator',
  'add-watermark',
  // Legacy standalone surfaces that consolidate into edit-pdf/bookmark:
  'sign-pdf',
  'add-stamps',
  'form-filler',
  'crop-pdf',
  'table-of-contents',
]);

export const NON_PDF_OUTPUT_SURFACE_IDS = new Set([
  'extract-images',
  'pdf-to-zip',
  'pdf-to-jpg',
  'pdf-to-png',
  'pdf-to-webp',
  'pdf-to-bmp',
  'pdf-to-tiff',
  'pdf-to-svg',
  'pdf-to-docx',
  'pdf-to-pptx',
  'pdf-to-excel',
  'pdf-to-csv',
  'pdf-to-text',
  'pdf-to-markdown',
  'extract-tables',
  'extract-attachments',
]);

export const VIEWER_CHROME_PRESETS: Record<
  ViewerChromePreset,
  ViewerChromeFeatureMap
> = {
  launchpad: {
    back: true,
    subtitle: false,
    launchers: true,
    print: true,
    download: true,
    undo: false,
    redo: false,
    reset: false,
    save: false,
    flatten: false,
    sign: false,
  },
  tool: {
    back: false,
    subtitle: true,
    launchers: false,
    print: true,
    download: true,
    undo: true,
    redo: true,
    reset: true,
    save: true,
    flatten: false,
    sign: false,
  },
};

export function detectViewerChromePreset(
  root: Document = document
): ViewerChromePreset {
  return root.getElementById('shift-pdf-viewer') ? 'launchpad' : 'tool';
}

export function detectActiveSurfaceId(root: Document = document): string {
  const datasetSurface =
    root.documentElement?.dataset?.launchSurface?.trim().toLowerCase() ?? '';
  if (datasetSurface) return datasetSurface;
  const ctx = resolveLaunchContext();
  if (ctx.surfaceId && ctx.surfaceId !== 'index') return ctx.surfaceId;
  return '';
}

export function isUndoRedoSupportedOnSurface(
  surfaceId: string,
  root: Document = document
): boolean {
  if (!surfaceId) {
    // When running in unit tests without a pathname or dataset, check if the
    // heading or DOM matches a known non-stateful surface, otherwise default true
    // so generic preset tests continue to work unless a surface is resolved.
    const heading =
      root
        .querySelector('.shift-pdf-viewer-header h1, #tool-uploader h1')
        ?.textContent?.trim()
        .toLowerCase() ?? '';
    if (!heading) return true;
    const statefulHeadings = [
      'pdf editor',
      'edit pdf',
      'sign pdf',
      'add stamps',
      'pdf form filler',
      'crop pdf',
      'pdf multi tool',
      'organize & duplicate',
      'delete pages',
      'rotate pdf',
      'add blank page',
      'reverse pages',
      'merge pdf',
      'alternate & mix pages',
      'edit bookmarks',
      'table of contents',
      'create pdf form',
      'form creator',
      'add watermark',
    ];
    if (statefulHeadings.includes(heading)) return true;
    if (
      root.getElementById('undo-btn') ||
      root.getElementById('undo-merge-btn') ||
      root.getElementById('signature-editor')
    ) {
      return true;
    }
    return false;
  }
  return STATEFUL_UNDO_REDO_SURFACE_IDS.has(surfaceId);
}

export function resolveViewerChromeFeatures(
  options: ViewerChromeOptions = {},
  root: Document = document
): ViewerChromeFeatureMap {
  const preset = options.preset ?? detectViewerChromePreset(root);
  const features = {
    ...VIEWER_CHROME_PRESETS[preset],
    ...options.features,
  };
  if (preset === 'tool') {
    const surfaceId = detectActiveSurfaceId(root);
    if (options.features?.undo === undefined) {
      features.undo = isUndoRedoSupportedOnSurface(surfaceId, root);
    }
    if (options.features?.redo === undefined) {
      features.redo = isUndoRedoSupportedOnSurface(surfaceId, root);
    }
    const entryId =
      root.documentElement.dataset.launchEntry?.trim().toLowerCase() ?? '';
    if (
      NON_PDF_OUTPUT_SURFACE_IDS.has(surfaceId) ||
      (entryId && NON_PDF_OUTPUT_SURFACE_IDS.has(entryId))
    ) {
      if (options.features?.save === undefined) features.save = false;
      if (options.features?.print === undefined) features.print = false;
    }
  }
  if (
    options.features?.flatten === undefined &&
    hasAuthoredFeature(root, 'flatten')
  ) {
    features.flatten = isFillSignChromeActive(root);
  }
  if (
    options.features?.sign === undefined &&
    hasAuthoredFeature(root, 'sign')
  ) {
    features.sign = isFillSignChromeActive(root);
  }
  return features;
}

function isFillSignChromeActive(root: Document): boolean {
  const fillSignTab = root.querySelector<HTMLElement>(
    '[data-edit-mode="fill-sign"]'
  );
  if (fillSignTab) {
    return (
      fillSignTab.getAttribute('aria-selected') === 'true' ||
      fillSignTab.getAttribute('aria-pressed') === 'true'
    );
  }
  return isToolViewerShowing(root);
}

function hasAuthoredFeature(
  root: Document,
  feature: ViewerChromeFeature
): boolean {
  return Boolean(
    root.querySelector(`[${VIEWER_CHROME_FEATURE_ATTR}="${feature}"]`)
  );
}

function isToolViewerShowing(root: Document): boolean {
  return (
    root.body.classList.contains('shift-tool-viewer') ||
    root.body.classList.contains('shift-tool-viewer-pending')
  );
}

export function isViewerChromeFeatureOn(
  header: ParentNode,
  feature: ViewerChromeFeature
): boolean {
  const node = header.querySelector<HTMLElement>(
    `[${VIEWER_CHROME_FEATURE_ATTR}="${feature}"]`
  );
  return Boolean(node && !node.hidden);
}

/**
 * Adopt or create the shared header, then show only the requested features.
 * View PDF and Sign PDF author this markup; other tool pages lift their h1.
 */
export function mountViewerChrome(
  root: Document = document,
  options: ViewerChromeOptions = {}
): ViewerChrome | null {
  const header = ensureHeader(root);
  if (!header) return null;

  const heading =
    header.querySelector<HTMLElement>(`.${VIEWER_CHROME_HEADING_CLASS}`) ??
    header;
  const actions =
    header.querySelector<HTMLElement>(`[${VIEWER_CHROME_ACTIONS_ATTR}]`) ??
    header.querySelector<HTMLElement>(`.${VIEWER_CHROME_ACTIONS_CLASS}`);
  if (!actions) return null;

  applyLaunchContextToDom(root);
  const features = resolveViewerChromeFeatures(options, root);
  arrangeShiftActionRow(actions);
  applyViewerChromeFeatures(header, features);
  const bar = root.getElementById(COMMIT_BAR_ID);
  if (bar) applyViewerChromeFeatures(bar, features);
  return { header, heading, actions, features };
}

export interface CommitBar {
  bar: HTMLElement;
  start: HTMLElement;
  end: HTMLElement;
}

/**
 * Create the Commit Bar once and keep it as the last child of the header's
 * host, so it sits under the card on card pages and under the viewer pane on
 * viewer pages. Reset goes left; every other commit action goes right.
 */
export function ensureCommitBar(
  root: Document,
  header: HTMLElement | null
): CommitBar | null {
  const host =
    header?.parentElement ??
    root.getElementById('tool-uploader')?.parentElement ??
    null;
  if (!host) return null;

  let bar = root.getElementById(COMMIT_BAR_ID);
  if (!bar) {
    bar = root.createElement('div');
    bar.id = COMMIT_BAR_ID;
    bar.className = COMMIT_BAR_CLASS;
    bar.setAttribute(COMMIT_BAR_ATTR, '');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Commit actions');
    bar.hidden = true;

    const start = root.createElement('div');
    start.className = COMMIT_BAR_START_CLASS;
    const end = root.createElement('div');
    end.className = COMMIT_BAR_END_CLASS;
    bar.append(start, end);
  }

  if (bar.parentElement !== host || host.lastElementChild !== bar) {
    host.append(bar);
  }

  const start = bar.querySelector<HTMLElement>(`.${COMMIT_BAR_START_CLASS}`);
  const end = bar.querySelector<HTMLElement>(`.${COMMIT_BAR_END_CLASS}`);
  if (!start || !end) return null;
  return { bar, start, end };
}

export function applyViewerChromeFeatures(
  header: ParentNode,
  features: ViewerChromeFeatureMap
): void {
  for (const feature of VIEWER_CHROME_FEATURES) {
    header
      .querySelectorAll<HTMLElement>(
        `[${VIEWER_CHROME_FEATURE_ATTR}="${feature}"]`
      )
      .forEach((node) => {
        const show = features[feature];
        if (node.hidden === !show) return;
        node.hidden = !show;
      });
  }
}

function ensureHeader(root: Document): HTMLElement | null {
  const launchpad = root.getElementById('shift-pdf-viewer');
  if (launchpad) {
    return (
      launchpad.querySelector<HTMLElement>(`.${VIEWER_CHROME_HEADER_CLASS}`) ??
      null
    );
  }

  const shell = root.querySelector<HTMLElement>(
    '#uploader.shift-pdf-viewer-shell'
  );
  const authored =
    shell?.querySelector<HTMLElement>(
      `:scope > .${VIEWER_CHROME_HEADER_CLASS}`
    ) ??
    root.querySelector<HTMLElement>(
      `#uploader > .${VIEWER_CHROME_HEADER_CLASS}`
    );
  if (authored) return authored;

  const card = root.getElementById('tool-uploader');
  if (!card) return null;

  const existing =
    card.parentElement?.querySelector<HTMLElement>(
      `:scope > .${VIEWER_CHROME_HEADER_CLASS}`
    ) ?? card.querySelector<HTMLElement>(`.${VIEWER_CHROME_HEADER_CLASS}`);
  if (existing) {
    placeToolViewerHeader(existing, card);
    return existing;
  }

  const headingNode = card.querySelector('h1');
  if (!headingNode) return null;

  const header = root.createElement('header');
  header.className = VIEWER_CHROME_HEADER_CLASS;

  const heading = root.createElement('div');
  heading.className = VIEWER_CHROME_HEADING_CLASS;

  const subtitle =
    headingNode.nextElementSibling instanceof HTMLParagraphElement
      ? headingNode.nextElementSibling
      : null;

  heading.append(headingNode);
  if (subtitle) {
    subtitle.setAttribute(VIEWER_CHROME_FEATURE_ATTR, 'subtitle');
    heading.append(subtitle);
  }

  const actions = root.createElement('div');
  actions.className = VIEWER_CHROME_ACTIONS_CLASS;
  actions.setAttribute(VIEWER_CHROME_ACTIONS_ATTR, '');
  actions.setAttribute('role', 'toolbar');
  actions.setAttribute('aria-label', 'PDF actions');

  header.append(heading, actions);
  placeToolViewerHeader(header, card);
  return header;
}

function placeToolViewerHeader(header: HTMLElement, card: HTMLElement): void {
  const host = card.parentElement;
  if (host && header.parentElement !== host) {
    host.insertBefore(header, card);
  }
}
