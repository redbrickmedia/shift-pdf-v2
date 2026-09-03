import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { primaryNavKeyFromPath } from '../js/logic/primary-nav';

const read = (path: string) => readFileSync(path, 'utf8');

describe('default starting page', () => {
  it('puts the My PDFs library on the root page', () => {
    const html = read('index.html');

    expect(html).toContain('id="shift-my-pdfs"');
    expect(html).toContain('id="shift-my-pdfs-heading"');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('shift-home');
  });

  it('keeps the All tools catalog reachable on its own page', () => {
    const html = read('all-tools.html');
    const nav = read('src/partials/navbar.html');

    expect(html).toContain('id="tool-grid"');
    expect(html).toContain('id="search-bar"');
    expect(html).not.toContain('id="shift-my-pdfs"');
    expect(nav).toMatch(/href="\{\{baseUrl\}\}all-tools\.html"/);
    expect(nav).toMatch(/data-nav="home"/);
    expect(nav).toMatch(/href="\{\{baseUrl\}\}my-pdfs\.html"/);
  });

  it('marks My PDFs active on the root and All tools active on the catalog page', () => {
    expect(primaryNavKeyFromPath('/')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/index.html')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/my-pdfs.html')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/all-tools.html')).toBe('home');
    expect(primaryNavKeyFromPath('/all-tools')).toBe('home');
    expect(primaryNavKeyFromPath('/compress-pdf.html')).toBe('compress');
  });
});
