export const SHIFT_TOOLTIP_SHOW_DELAY_MS = 400;
export const SHIFT_TOOLTIP_OFFSET_PX = 8;

const TOOLTIP_ID = 'shift-tooltip';

export type ShiftTooltipPlacement = 'right' | 'bottom';

type TooltipDocument = Document & {
  __shiftTooltipBound?: boolean;
};

let showTimer: ReturnType<typeof setTimeout> | null = null;
let activeTrigger: HTMLElement | null = null;

export function attachShiftTooltip(
  trigger: HTMLElement,
  options: { placement?: ShiftTooltipPlacement; text: string }
): void {
  const text = options.text.trim();
  if (!text) {
    trigger.removeAttribute('data-shift-tooltip');
    trigger.removeAttribute('title');
    return;
  }

  trigger.dataset.shiftTooltip = text;
  trigger.dataset.shiftTooltipPlacement = options.placement ?? 'right';
  trigger.removeAttribute('title');
  bindTrigger(trigger);
  bindDocument(trigger.ownerDocument);
}

export function hideShiftTooltip(root: Document = document): void {
  clearShowTimer();
  activeTrigger = null;
  const tooltip = root.getElementById(TOOLTIP_ID);
  if (!tooltip) return;
  tooltip.classList.remove('is-open');
  tooltip.textContent = '';
}

function bindTrigger(trigger: HTMLElement): void {
  if (trigger.dataset.shiftTooltipBound === 'true') return;
  trigger.dataset.shiftTooltipBound = 'true';
  trigger.addEventListener('pointerenter', () => scheduleShow(trigger));
  trigger.addEventListener('pointerleave', () => {
    if (activeTrigger === trigger || showTimer !== null) {
      hideShiftTooltip(trigger.ownerDocument);
    }
  });
  trigger.addEventListener('focus', () => scheduleShow(trigger));
  trigger.addEventListener('blur', () =>
    hideShiftTooltip(trigger.ownerDocument)
  );
}

function bindDocument(root: Document): void {
  const doc = root as TooltipDocument;
  if (doc.__shiftTooltipBound) return;
  doc.__shiftTooltipBound = true;

  doc.addEventListener('pointerdown', () => hideShiftTooltip(doc), true);
  doc.defaultView?.addEventListener(
    'scroll',
    () => hideShiftTooltip(doc),
    true
  );
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideShiftTooltip(doc);
  });
}

function scheduleShow(trigger: HTMLElement): void {
  if (!trigger.isConnected) return;
  const text = trigger.dataset.shiftTooltip?.trim();
  if (!text) return;

  clearShowTimer();
  showTimer = globalThis.setTimeout(() => {
    showTimer = null;
    showTooltip(trigger, text);
  }, SHIFT_TOOLTIP_SHOW_DELAY_MS);
}

function showTooltip(trigger: HTMLElement, text: string): void {
  if (!trigger.isConnected) return;
  const root = trigger.ownerDocument;
  const tooltip = ensureTooltip(root);
  tooltip.textContent = text;
  activeTrigger = trigger;
  positionTooltip(
    tooltip,
    trigger.getBoundingClientRect(),
    readPlacement(trigger)
  );
  tooltip.classList.add('is-open');
}

function ensureTooltip(root: Document): HTMLElement {
  const existing = root.getElementById(TOOLTIP_ID);
  if (existing) return existing;

  const tooltip = root.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'shift-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  root.body.append(tooltip);
  return tooltip;
}

function readPlacement(trigger: HTMLElement): ShiftTooltipPlacement {
  return trigger.dataset.shiftTooltipPlacement === 'bottom'
    ? 'bottom'
    : 'right';
}

function positionTooltip(
  tooltip: HTMLElement,
  triggerRect: DOMRect,
  placement: ShiftTooltipPlacement
): void {
  const tooltipRect = tooltip.getBoundingClientRect();
  const view = tooltip.ownerDocument.defaultView;
  const viewportWidth =
    view?.innerWidth || tooltip.ownerDocument.documentElement.clientWidth;
  const viewportHeight =
    view?.innerHeight || tooltip.ownerDocument.documentElement.clientHeight;

  let left =
    placement === 'bottom'
      ? triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
      : triggerRect.right + SHIFT_TOOLTIP_OFFSET_PX;
  let top =
    placement === 'bottom'
      ? triggerRect.bottom + SHIFT_TOOLTIP_OFFSET_PX
      : triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;

  if (viewportWidth > 0) {
    const maxLeft = Math.max(
      SHIFT_TOOLTIP_OFFSET_PX,
      viewportWidth - tooltipRect.width - SHIFT_TOOLTIP_OFFSET_PX
    );
    left = Math.min(Math.max(left, SHIFT_TOOLTIP_OFFSET_PX), maxLeft);
  }
  if (viewportHeight > 0) {
    const maxTop = Math.max(
      SHIFT_TOOLTIP_OFFSET_PX,
      viewportHeight - tooltipRect.height - SHIFT_TOOLTIP_OFFSET_PX
    );
    top = Math.min(Math.max(top, SHIFT_TOOLTIP_OFFSET_PX), maxTop);
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function clearShowTimer(): void {
  if (showTimer === null) return;
  globalThis.clearTimeout(showTimer);
  showTimer = null;
}
