import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/** viewer.html loads this as a classic script, not an ES module. */
async function runThemeScript() {
  const source = await readText('public/pdfjs-viewer/shift-viewer-theme.js');
  new Function(source)();
}

describe('Shift theme for the PDF.js viewer', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.shiftViewer;
  });

  it('loads the theme before the viewer bundle so no dark chrome paints first', async () => {
    const viewer = await readText('public/pdfjs-viewer/viewer.html');

    expect(viewer).toContain('<script src="shift-viewer-theme.js"></script>');
    expect(viewer).toContain(
      '<link rel="stylesheet" href="shift-viewer-theme.css" />'
    );
    expect(viewer.indexOf('shift-viewer-theme.js')).toBeLessThan(
      viewer.indexOf('src="viewer.mjs"')
    );
  });

  it('scopes every themed rule to a Shift embed', async () => {
    const theme = await readText('public/pdfjs-viewer/shift-viewer-theme.css');
    const selectors = [
      ...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g),
    ].map(([, selector]) => selector.trim());

    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector).toContain('[data-shift-viewer]');
      // A bare `html` would lose the tokens back to `:root` in viewer.css.
      expect(selector).toMatch(/^html\[data-shift-viewer\]/);
    }
  });

  it('themes the signing embed', async () => {
    window.history.replaceState(
      {},
      '',
      '/pdfjs-viewer/viewer.html?bentoSign=1'
    );

    await runThemeScript();

    expect(document.documentElement.dataset.shiftViewer).toBe('sign');
  });

  it('themes every other embed the same way', async () => {
    window.history.replaceState({}, '', '/pdfjs-viewer/viewer.html?file=x.pdf');

    await runThemeScript();

    expect(document.documentElement.dataset.shiftViewer).toBe('embed');
  });
});
