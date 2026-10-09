import { describe, expect, it, vi } from 'vitest';
import { createControllerChangeHandler } from '../js/sw-register';

describe('service worker controller changes', () => {
  it('does not reload when the first install claims the page', () => {
    const reload = vi.fn();
    const onChange = createControllerChangeHandler(reload, false);

    onChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when a later worker replaces one that is already in control', () => {
    const reload = vi.fn();
    const onChange = createControllerChangeHandler(reload, false);

    onChange();
    onChange();

    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads an update when the page was already controlled', () => {
    const reload = vi.fn();
    const onChange = createControllerChangeHandler(reload, true);

    onChange();

    expect(reload).toHaveBeenCalledOnce();
  });
});
