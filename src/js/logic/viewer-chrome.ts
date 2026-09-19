/**
 * One header + action row for View PDF and every in-page viewer tool.
 * Pages pick a preset, then hide or show features without restyling a
 * second header.
 */
export const VIEWER_CHROME_HEADER_CLASS = 'shift-pdf-viewer-header';
export const VIEWER_CHROME_HEADING_CLASS = 'shift-pdf-viewer-heading';
export const VIEWER_CHROME_ACTIONS_CLASS = 'shift-pdf-viewer-actions';
export const VIEWER_CHROME_FEATURE_ATTR = 'data-viewer-chrome';
export const VIEWER_CHROME_ACTIONS_ATTR = 'data-shift-viewer-actions';

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
  },
  tool: {
    back: false,
    subtitle: true,
    launchers: false,
    print: false,
    download: false,
    undo: true,
    redo: true,
    reset: true,
    save: true,
  },
};

export function detectViewerChromePreset(
  root: Document = document
): ViewerChromePreset {
  return root.getElementById('shift-pdf-viewer') ? 'launchpad' : 'tool';
}

export function resolveViewerChromeFeatures(
  options: ViewerChromeOptions = {},
  root: Document = document
): ViewerChromeFeatureMap {
  const preset = options.preset ?? detectViewerChromePreset(root);
  return {
    ...VIEWER_CHROME_PRESETS[preset],
    ...options.features,
  };
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
 * View PDF already authors this markup; tool pages lift their h1 into it.
 */
export function mountViewerChrome(
  root: Document = document,
  options: ViewerChromeOptions = {}
): ViewerChrome | null {
  const features = resolveViewerChromeFeatures(options, root);
  const header = ensureHeader(root);
  if (!header) return null;

  const heading =
    header.querySelector<HTMLElement>(`.${VIEWER_CHROME_HEADING_CLASS}`) ??
    header;
  const actions =
    header.querySelector<HTMLElement>(`[${VIEWER_CHROME_ACTIONS_ATTR}]`) ??
    header.querySelector<HTMLElement>(`.${VIEWER_CHROME_ACTIONS_CLASS}`);
  if (!actions) return null;

  applyViewerChromeFeatures(header, features);
  return { header, heading, actions, features };
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
