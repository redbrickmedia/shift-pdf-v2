import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SHIFT_TOOLTIP_SHOW_DELAY_MS,
  attachShiftTooltip,
  hideShiftTooltip,
} from '../js/logic/shift-tooltip';

function mountTrigger(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'File';
  document.body.append(button);
  Object.defineProperty(button, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 16,
      y: 80,
      width: 180,
      height: 40,
      top: 80,
      left: 16,
      right: 196,
      bottom: 120,
      toJSON() {
        return {};
      },
    }),
  });
  return button;
}

function tooltipIsOpen(): boolean {
  return Boolean(
    document.getElementById('shift-tooltip')?.classList.contains('is-open')
  );
}

afterEach(() => {
  vi.useRealTimers();
  hideShiftTooltip();
  document.body.replaceChildren();
});

describe('shift tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not use a native title and waits before showing', () => {
    const button = mountTrigger();
    attachShiftTooltip(button, {
      placement: 'right',
      text: 'This PDF is open from a Shift tab. Click to show that tab.',
    });

    expect(button.hasAttribute('title')).toBe(false);
    button.dispatchEvent(new PointerEvent('pointerenter'));
    expect(tooltipIsOpen()).toBe(false);

    vi.advanceTimersByTime(SHIFT_TOOLTIP_SHOW_DELAY_MS - 1);
    expect(tooltipIsOpen()).toBe(false);

    vi.advanceTimersByTime(1);
    const tooltip = document.getElementById('shift-tooltip');
    expect(tooltip?.classList.contains('is-open')).toBe(true);
    expect(tooltip?.textContent).toBe(
      'This PDF is open from a Shift tab. Click to show that tab.'
    );
    expect(tooltip?.style.left).toBe('204px');
  });

  it('hides immediately when the pointer leaves before the delay', () => {
    const button = mountTrigger();
    attachShiftTooltip(button, { text: 'From a Shift tab' });

    button.dispatchEvent(new PointerEvent('pointerenter'));
    button.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(SHIFT_TOOLTIP_SHOW_DELAY_MS);

    expect(tooltipIsOpen()).toBe(false);
  });

  it('closes on press so the native browser tooltip never takes over', () => {
    const button = mountTrigger();
    attachShiftTooltip(button, { text: 'From a Shift tab' });
    button.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHIFT_TOOLTIP_SHOW_DELAY_MS);

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(tooltipIsOpen()).toBe(false);
  });
});
