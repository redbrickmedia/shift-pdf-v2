import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

describe('Shift theme for the PDF.js viewer', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.shiftViewer;
    vi.resetModules();
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

  it('scopes every themed rule to the signing embed', async () => {
    const theme = await readText('public/pdfjs-viewer/shift-viewer-theme.css');
    const selectors = [
      ...theme.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g),
    ].map(([, selector]) => selector.trim());

    expect(selectors.length).toBeGreaterThan(5);
    for (const selector of selectors) {
      expect(selector).toContain("[data-shift-viewer='sign']");
    }
  });

  it('flags the viewer when the signing parameter is present', async () => {
    window.history.replaceState(
      {},
      '',
      '/pdfjs-viewer/viewer.html?bentoSign=1'
    );

    await import('../../public/pdfjs-viewer/shift-viewer-theme.js');

    expect(document.documentElement.dataset.shiftViewer).toBe('sign');
  });

  it('leaves other embeds of the viewer untouched', async () => {
    window.history.replaceState({}, '', '/pdfjs-viewer/viewer.html?file=x.pdf');

    await import('../../public/pdfjs-viewer/shift-viewer-theme.js?plain');

    expect(document.documentElement.dataset.shiftViewer).toBeUndefined();
  });
});
