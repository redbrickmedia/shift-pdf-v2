/**
 * One tool action row. Pages show or hide buttons; they do not invent
 * another order or a second button style.
 *
 * Groups, left to right: Navigate, History, Output, Tool extras.
 */

export const SHIFT_ACTION_ROW_CLASS = 'shift-action-row';
export const SHIFT_ACTION_BUTTON_CLASS = 'shift-action-button';
export const SHIFT_ACTION_GROUP_ATTR = 'data-shift-action-group';
export const SHIFT_ACTION_ATTR = 'data-shift-action';

export const SHIFT_ACTION_GROUPS = [
  'navigate',
  'history',
  'output',
  'extras',
] as const;

export type ShiftActionGroup = (typeof SHIFT_ACTION_GROUPS)[number];

/** Canonical order inside the row. Unknown actions stay in Tool extras. */
export const SHIFT_ACTION_ORDER = [
  'back',
  'undo',
  'redo',
  'reset',
  'save',
  'overwrite',
  'download',
  'print',
  'flatten',
  'sign',
  'launchers',
] as const;

export type ShiftActionName = (typeof SHIFT_ACTION_ORDER)[number];

const ACTION_GROUP: Record<ShiftActionName, ShiftActionGroup> = {
  back: 'navigate',
  undo: 'history',
  redo: 'history',
  reset: 'history',
  save: 'output',
  overwrite: 'output',
  download: 'output',
  print: 'output',
  flatten: 'extras',
  sign: 'extras',
  launchers: 'extras',
};

export interface ShiftActionButtonOptions {
  id?: string;
  label: string;
  /** Phosphor icon class without the `ph` prefix, e.g. `ph-printer`. */
  iconClass: string;
  action: string;
  /** Viewer-chrome feature name, when this control is shown or hidden by a preset. */
  feature?: string;
}

export function createShiftActionButton(
  doc: Document,
  options: ShiftActionButtonOptions
): HTMLButtonElement {
  const button = doc.createElement('button');
  if (options.id) button.id = options.id;
  button.type = 'button';
  button.className = `shift-pdf-viewer-action ${SHIFT_ACTION_BUTTON_CLASS}`;
  button.setAttribute('aria-label', options.label);
  button.setAttribute(SHIFT_ACTION_ATTR, options.action);
  if (options.feature) {
    button.setAttribute('data-viewer-chrome', options.feature);
  }

  const icon = doc.createElement('i');
  icon.className = `ph ${options.iconClass}`;
  icon.setAttribute('aria-hidden', 'true');
  const text = doc.createElement('span');
  text.textContent = options.label;
  button.append(icon, text);
  return button;
}

/**
 * Put existing controls into Navigate / History / Output / Tool extras
 * without rebuilding them, so authored ids and handlers stay put.
 */
export function arrangeShiftActionRow(toolbar: HTMLElement): void {
  toolbar.classList.add(SHIFT_ACTION_ROW_CLASS);
  if (!toolbar.hasAttribute('role')) {
    toolbar.setAttribute('role', 'toolbar');
  }
  if (
    !toolbar.hasAttribute('aria-label') &&
    !toolbar.hasAttribute('aria-labelledby')
  ) {
    toolbar.setAttribute('aria-label', 'PDF actions');
  }

  const controls = collectControls(toolbar).map((node, index) => ({
    node,
    index,
  }));
  controls.sort(
    (a, b) => actionRank(a.node) - actionRank(b.node) || a.index - b.index
  );

  const groups = SHIFT_ACTION_GROUPS.map((name) => ensureGroup(toolbar, name));
  for (const { node } of controls) {
    groupFor(toolbar, node).append(node);
  }
  for (const group of groups) {
    toolbar.append(group);
  }
}

function collectControls(toolbar: HTMLElement): HTMLElement[] {
  const controls: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const child of [...parent.children]) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasAttribute(SHIFT_ACTION_GROUP_ATTR)) {
        walk(child);
        continue;
      }
      controls.push(child);
    }
  };
  walk(toolbar);
  return controls;
}

function ensureGroup(
  toolbar: HTMLElement,
  name: ShiftActionGroup
): HTMLElement {
  const existing = toolbar.querySelector<HTMLElement>(
    `:scope > [${SHIFT_ACTION_GROUP_ATTR}="${name}"]`
  );
  if (existing) return existing;
  const group = toolbar.ownerDocument.createElement('div');
  group.className = 'shift-action-group';
  group.setAttribute(SHIFT_ACTION_GROUP_ATTR, name);
  toolbar.append(group);
  return group;
}

function groupFor(toolbar: HTMLElement, node: HTMLElement): HTMLElement {
  return ensureGroup(toolbar, groupName(actionName(node)));
}

function actionName(node: HTMLElement): string {
  return (
    node.getAttribute('data-viewer-chrome') ||
    node.getAttribute(SHIFT_ACTION_ATTR) ||
    ''
  );
}

function groupName(action: string): ShiftActionGroup {
  if ((SHIFT_ACTION_ORDER as readonly string[]).includes(action)) {
    return ACTION_GROUP[action as ShiftActionName];
  }
  return 'extras';
}

function actionRank(node: HTMLElement): number {
  const index = (SHIFT_ACTION_ORDER as readonly string[]).indexOf(
    actionName(node)
  );
  return index === -1 ? SHIFT_ACTION_ORDER.length : index;
}
