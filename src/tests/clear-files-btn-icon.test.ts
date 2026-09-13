import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

describe('Clear All button icon', () => {
  it('uses lucide x (not trash) on tool Clear All controls', async () => {
    const mismatches: string[] = [];
    let found = 0;

    for (const path of [...globSync('src/pages/*.html'), 'src/js/ui.ts']) {
      const text = await readText(path);
      if (!text.includes('id="clear-files-btn"')) continue;

      const parser = new DOMParser();
      // ui.ts embeds the button in a template string — extract the button HTML.
      const html = path.endsWith('.ts')
        ? text.match(
            /<button[^>]*id="clear-files-btn"[^>]*>[\s\S]*?<\/button>/
          )?.[0]
        : text;
      if (!html) {
        mismatches.push(`${path}: missing clear-files-btn markup`);
        continue;
      }

      const doc = parser.parseFromString(
        path.endsWith('.ts') ? html : text,
        'text/html'
      );
      const btn = doc.getElementById('clear-files-btn');
      if (!btn) {
        mismatches.push(`${path}: button not parseable`);
        continue;
      }

      found += 1;
      const hasX = Boolean(btn.querySelector('[data-lucide="x"]'));
      const hasTrash = Boolean(
        btn.querySelector('[data-lucide="trash-2"], [data-lucide="trash"]')
      );
      if (!hasX || hasTrash) {
        mismatches.push(path);
      }
    }

    expect(mismatches).toEqual([]);
    expect(found).toBeGreaterThan(40);
  });
});
