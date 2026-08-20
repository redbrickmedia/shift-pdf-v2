import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const catalogHref = '/index.html';

const loadMenu = async () => {
  const { initToolBackMenu } = await import('../js/logic/tool-back-menu');
  initToolBackMenu();
  return {
    caret: document.querySelector<HTMLButtonElement>('.shift-tool-back-more'),
    menu: document.querySelector<HTMLElement>('.shift-tool-back-menu'),
  };
};

const click = (element: Element) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('back control menu', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <a class="shift-nav-link" data-nav="home" href="${catalogHref}">All Tools</a>
      <button id="back-to-tools" class="shift-tool-back"><span>Back</span></button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('adds a caret and a closed menu beside the control', async () => {
    const { caret, menu } = await loadMenu();
    const control = document.getElementById('back-to-tools');

    expect(control?.closest('.shift-tool-back-group')).not.toBeNull();
    expect(caret?.getAttribute('aria-expanded')).toBe('false');
    expect(menu?.hidden).toBe(true);

    const item = menu?.querySelector<HTMLAnchorElement>(
      '.shift-tool-back-menu-item'
    );
    // Resolved from the rail's own link, so a translated build keeps its
    // language prefix.
    expect(item?.href).toBe(
      document.querySelector<HTMLAnchorElement>('[data-nav="home"]')?.href
    );
    expect(item?.textContent?.trim()).toBe('All Tools');
  });

  it('leaves the control itself alone so Back still goes back', async () => {
    const { caret } = await loadMenu();
    const control = document.getElementById('back-to-tools') as HTMLElement;

    // The shared back handler matches on the control, so the caret must sit
    // outside it rather than inside.
    expect(control.contains(caret as Node)).toBe(false);
    expect(control.textContent?.trim()).toBe('Back');
  });

  it('moves the page\u2019s own bottom margin onto the group', async () => {
    document.body.innerHTML = `
      <a class="shift-nav-link" data-nav="home" href="${catalogHref}">All Tools</a>
      <button id="back-to-tools" class="shift-tool-back" style="margin-bottom: 24px"><span>Back</span></button>
    `;

    await loadMenu();
    const control = document.getElementById('back-to-tools') as HTMLElement;
    const group = control.closest<HTMLElement>('.shift-tool-back-group');

    // Left on the button, `mb-6` would sit inside the wrapper and leave the
    // group 24px taller than the control it wraps.
    expect(group?.style.marginBottom).toBe('24px');
    expect(control.style.marginBottom).toBe('0px');
  });

  it('gives no margin to a control the page did not space', async () => {
    await loadMenu();
    const control = document.getElementById('back-to-tools') as HTMLElement;
    const group = control.closest<HTMLElement>('.shift-tool-back-group');

    // The pdf-workflow toolbar and the pdf-multi-tool nav bar space the control
    // themselves; a margin here would break their rows.
    expect(group?.style.marginBottom).toBe('');
    expect(control.style.marginBottom).toBe('');
  });

  it('does not carry page spacing into the shared header', async () => {
    document.body.innerHTML = `
      <a class="shift-nav-link" data-nav="home" href="${catalogHref}">All Tools</a>
      <header class="shift-tool-header">
        <div data-tool-back-slot>
          <button id="back-to-tools" class="shift-tool-back" style="margin-bottom: 24px"><span>Back</span></button>
        </div>
      </header>
    `;

    await loadMenu();
    const control = document.getElementById('back-to-tools') as HTMLElement;
    const group = control.closest<HTMLElement>('.shift-tool-back-group');

    expect(group?.style.marginBottom).toBe('');
  });

  it('opens and closes from the caret', async () => {
    const { caret, menu } = await loadMenu();

    click(caret as Element);
    expect(menu?.hidden).toBe(false);
    expect(caret?.getAttribute('aria-expanded')).toBe('true');

    click(caret as Element);
    expect(menu?.hidden).toBe(true);
    expect(caret?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on a right-click of the control instead of the browser menu', async () => {
    const { menu } = await loadMenu();
    const control = document.getElementById('back-to-tools') as HTMLElement;

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    control.dispatchEvent(event);

    expect(menu?.hidden).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes on Escape and on a press outside, and hands focus back', async () => {
    const { caret, menu } = await loadMenu();

    click(caret as Element);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(menu?.hidden).toBe(true);
    expect(document.activeElement).toBe(caret);

    click(caret as Element);
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true })
    );
    expect(menu?.hidden).toBe(true);
  });

  it('ignores pages the shared back handler did not upgrade', async () => {
    document.body.innerHTML = `<button id="back-to-tools">Back</button>`;

    const { caret } = await loadMenu();

    expect(caret).toBeNull();
  });
});
