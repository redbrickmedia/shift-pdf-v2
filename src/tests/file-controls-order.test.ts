import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Add More / Clear All sit above the file list in the markup, and the card
 * reorders them with flex `order` instead of an edit to every tool page. That
 * keeps those pages byte-identical to upstream, so this checks the resulting
 * visual order rather than the source order.
 */
const ORDER_TIERS: Array<(child: Element) => boolean> = [
  // Anything the page puts ahead of the controls belongs at the top.
  (child) => Boolean(child.matches(':has(~ #file-controls)')),
  (child) =>
    child.id === 'file-display-area' ||
    child.id === 'file-list' ||
    child.hasAttribute('data-shift-skeleton'),
];

function tierOf(child: Element): number {
  const tier = ORDER_TIERS.findIndex((matches) => matches(child));
  return tier === -1 ? ORDER_TIERS.length : tier;
}

/** The order the browser paints the card's children in. */
function paintedOrder(card: Element): string[] {
  return Array.from(card.children)
    .map((child, index) => ({ child, index, tier: tierOf(child) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ child }) => child.id || child.tagName.toLowerCase());
}

async function toolCards() {
  const parser = new DOMParser();
  const cards: Array<{ path: string; card: Element }> = [];

  for (const path of [...globSync('*.html'), ...globSync('src/pages/*.html')]) {
    const doc = parser.parseFromString(await readText(path), 'text/html');
    const card = doc.getElementById('tool-uploader');
    if (card?.querySelector(':scope > #file-controls')) {
      cards.push({ path, card });
    }
  }

  return cards;
}

describe('file controls order', () => {
  it('paints Add More / Clear All below the uploaded file list', async () => {
    const cards = await toolCards();
    const mismatches: string[] = [];

    for (const { path, card } of cards) {
      const order = paintedOrder(card);
      const list = Math.max(
        order.indexOf('file-display-area'),
        order.indexOf('file-list')
      );
      const controls = order.indexOf('file-controls');
      if (list < 0) continue;
      if (controls < list) mismatches.push(path);
    }

    expect(mismatches).toEqual([]);
    expect(cards.length).toBeGreaterThan(40);
  });

  it('keeps the picker above the file list', async () => {
    const cards = await toolCards();
    const mismatches: string[] = [];

    for (const { path, card } of cards) {
      const order = paintedOrder(card);
      const drop = order.indexOf('drop-zone');
      const list = Math.max(
        order.indexOf('file-display-area'),
        order.indexOf('file-list')
      );
      if (drop < 0 || list < 0) continue;
      if (drop > list) mismatches.push(path);
    }

    expect(mismatches).toEqual([]);
  });

  it('declares the tiers in the theme rather than the markup', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(css.indexOf('/* ---- Card order ----'));

    expect(section).toContain(
      '#tool-uploader:has(> #file-controls):has(> #file-display-area)'
    );
    expect(section).toMatch(/flex-direction:\s*column/);
    expect(section).toMatch(/#tool-uploader > \*\s*\{\s*order:\s*2;/);
    expect(section).toMatch(
      /#tool-uploader > :has\(~ #file-controls\)\s*\{\s*order:\s*0;/
    );
    expect(section).toMatch(/\[data-shift-skeleton\]\s*\{\s*order:\s*1;/);
  });
});
