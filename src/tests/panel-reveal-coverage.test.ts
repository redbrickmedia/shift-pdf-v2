import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PANEL_REVEAL_PATTERN,
  PANEL_REVEAL_SKIP_PATTERN,
} from '../js/logic/open-file-store';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * The shell unhides tool option panels before paint so the card is not a
 * heading for the first few frames. Nothing declares that per page, so this
 * runs the shell's own rule over every page and fails if it stops covering the
 * fleet, or starts revealing a panel whose content the tool has to render.
 */
async function pageDocuments() {
  const paths = [...globSync('*.html'), ...globSync('src/pages/*.html')];
  const parser = new DOMParser();

  return Promise.all(
    paths.map(async (path) => ({
      path,
      doc: parser.parseFromString(await readText(path), 'text/html'),
    }))
  );
}

/** Mirrors revealPanels() in public/sidebar-boot.js. */
function revealedPanelIds(doc: Document): string[] {
  const card = doc.getElementById('tool-uploader');
  if (!card) return [];

  const match = new RegExp(PANEL_REVEAL_PATTERN);
  const skip = new RegExp(PANEL_REVEAL_SKIP_PATTERN);

  return Array.from(card.children)
    .filter(
      (panel) =>
        panel.id &&
        panel.classList.contains('hidden') &&
        match.test(panel.id) &&
        !skip.test(panel.id)
    )
    .map((panel) => panel.id);
}

describe('pre-paint panel reveal coverage', () => {
  it('reveals a panel on the bulk of the tool pages', async () => {
    const pages = await pageDocuments();
    const covered = pages.filter(({ doc }) => revealedPanelIds(doc).length > 0);

    expect(covered.length).toBeGreaterThan(90);
  });

  it('never reveals a panel the tool has to render first', async () => {
    const pages = await pageDocuments();
    const forbidden: string[] = [];

    for (const { path, doc } of pages) {
      for (const id of revealedPanelIds(doc)) {
        // Editors, previews and result panels have nothing to show until the
        // tool has read the blob or the user has run the job.
        if (
          /completion|result|preview|viewer|editor|canvas|container|-mode-panel$/.test(
            id
          )
        ) {
          forbidden.push(`${path} #${id}`);
        }
      }
    }

    expect(forbidden).toEqual([]);
  });

  it('leaves conditional sub-panels alone, because nesting excludes them', async () => {
    const pages = await pageDocuments();
    const revealed = new Set(pages.flatMap(({ doc }) => revealedPanelIds(doc)));

    // These are toggled by a radio or checkbox inside the main panel. Showing
    // them all at once would read as every mode being active.
    for (const id of [
      'page-mode-panel',
      'custom-settings-panel',
      'visible-sig-options',
      'sig-text-options',
      'range-panel',
      'even-odd-panel',
      'txt-text-panel',
    ]) {
      expect(revealed.has(id)).toBe(false);
    }
  });

  it('keeps the shell rule and the store in sync', async () => {
    const boot = await readText('public/sidebar-boot.js');

    expect(boot).toContain(`'${PANEL_REVEAL_PATTERN}'`);
    expect(boot).toContain(`'${PANEL_REVEAL_SKIP_PATTERN}'`);
    expect(boot).toContain("'data-shift-revealed'");
  });
});
