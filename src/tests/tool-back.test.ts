import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_RETURN_STORAGE_KEY,
  readCatalogReturnHref,
  rememberCatalogReturnHref,
  resolveBackTarget,
} from '../js/logic/tool-back';

const origin = 'https://pdf.shift.com';
const toolPage = `${origin}/merge-pdf.html`;
const home = `${origin}/index.html`;

const context = (overrides: Partial<Parameters<typeof resolveBackTarget>[0]>) =>
  resolveBackTarget({
    origin,
    currentHref: toolPage,
    referrer: '',
    historyLength: 1,
    catalogReturnHref: null,
    homeHref: home,
    ...overrides,
  });

describe('tool back navigation target', () => {
  it('steps back through history when the previous page was this site', () => {
    expect(
      context({
        referrer: `${origin}/index.html#convert-to-pdf`,
        historyLength: 3,
      })
    ).toEqual({ kind: 'history' });

    expect(
      context({ referrer: `${origin}/split-pdf.html`, historyLength: 2 })
    ).toEqual({ kind: 'history' });
  });

  it('never sends a visitor back off-site', () => {
    expect(
      context({ referrer: 'https://www.google.com/search?q=merge+pdf' })
    ).toEqual({ kind: 'href', href: home });
  });

  it('falls back to the catalog page this tab last visited', () => {
    const catalog = `${origin}/index.html#secure-pdf`;

    expect(context({ catalogReturnHref: catalog })).toEqual({
      kind: 'href',
      href: catalog,
    });
  });

  it('ignores a remembered catalog page from another origin or this page', () => {
    expect(
      context({ catalogReturnHref: 'https://evil.example/index.html' })
    ).toEqual({ kind: 'href', href: home });

    expect(context({ catalogReturnHref: `${toolPage}#top` })).toEqual({
      kind: 'href',
      href: home,
    });
  });

  it('goes home on a direct load, a new tab, or a reload', () => {
    expect(context({ referrer: '', historyLength: 1 })).toEqual({
      kind: 'href',
      href: home,
    });

    // A single history entry means back would leave the tab where it started.
    expect(context({ referrer: home, historyLength: 1 })).toEqual({
      kind: 'href',
      href: home,
    });

    expect(context({ referrer: toolPage, historyLength: 4 })).toEqual({
      kind: 'href',
      href: home,
    });
  });
});

describe('remembered catalog page', () => {
  it('round-trips through the dedicated session storage key', () => {
    const storage = {
      getItem: vi.fn(() => home),
      setItem: vi.fn(),
    };

    expect(readCatalogReturnHref(storage)).toBe(home);
    expect(storage.getItem).toHaveBeenCalledWith(CATALOG_RETURN_STORAGE_KEY);

    expect(rememberCatalogReturnHref(home, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      CATALOG_RETURN_STORAGE_KEY,
      home
    );
  });

  it('rejects oversized values and tolerates unavailable storage', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blockedStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(rememberCatalogReturnHref(`${origin}/${'x'.repeat(2048)}`)).toBe(
      false
    );
    expect(readCatalogReturnHref(blockedStorage)).toBeNull();
    expect(rememberCatalogReturnHref(home, blockedStorage)).toBe(false);

    warning.mockRestore();
  });
});

describe('back control on a tool page', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = `
      <a class="shift-nav-link" data-nav="home" href="/index.html">All tools</a>
      <button id="back-to-tools"><span>Back</span></button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('takes over the page handler and steps back through history', async () => {
    const { initToolBackNavigation } = await import('../js/logic/tool-back');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const pageHandler = vi.fn();

    // What every tool page ships: its own handler, bound to the button itself.
    const control = document.getElementById('back-to-tools') as HTMLElement;
    control.addEventListener('click', pageHandler);

    Object.defineProperty(document, 'referrer', {
      value: `${window.location.origin}/index.html`,
      configurable: true,
    });
    window.history.pushState({}, '', '/merge-pdf.html');

    initToolBackNavigation();
    control.click();

    expect(back).toHaveBeenCalledTimes(1);
    expect(pageHandler).not.toHaveBeenCalled();
  });

  it('styles the control as a Shift control and keeps it a real button', async () => {
    const { initToolBackNavigation } = await import('../js/logic/tool-back');
    initToolBackNavigation();

    const control = document.getElementById(
      'back-to-tools'
    ) as HTMLButtonElement;

    expect(control.classList.contains('shift-tool-back')).toBe(true);
    expect(control.type).toBe('button');
    expect(control.title).not.toBe('');
    expect(control.textContent?.trim()).toBe('Back');
  });

  it('moves one control into the shared header and removes view duplicates', async () => {
    document.body.innerHTML = `
      <header class="shift-tool-header">
        <div data-tool-back-slot></div>
      </header>
      <main>
        <section><button id="back-to-tools-upload">Back</button></section>
        <section><button id="back-to-tools-creator">Back</button></section>
      </main>
    `;
    const { initToolBackNavigation } = await import('../js/logic/tool-back');

    initToolBackNavigation();

    const controls = document.querySelectorAll('[id^="back-to-tools"]');
    expect(controls).toHaveLength(1);
    expect(controls[0]?.closest('[data-tool-back-slot]')).not.toBeNull();
    expect(document.getElementById('back-to-tools-creator')).toBeNull();
  });
});
