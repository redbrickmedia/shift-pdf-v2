import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Bookmark markup is authored against the inverted grey ramp. Utilities that
 * sit outside that remap (gray-200, blue-800) wash out on light cards or stay
 * dark-on-dark on the retinted blue-900 banners.
 */
describe('bookmark inverted-ramp leftovers', () => {
  it('uses remapped ink on the picking banner, headings, and extract action', async () => {
    const html = await readText('src/pages/bookmark.html');

    expect(html).not.toContain('text-blue-800');
    expect(html).toContain('id="picking-mode-banner"');
    expect(html).toMatch(
      /id="picking-mode-banner"[\s\S]*?text-blue-300[\s\S]*?Click on the PDF to set bookmark destination/
    );
    expect(html).toContain(
      'class="text-lg font-bold text-gray-300 mb-4">Bookmarks</h3>'
    );
    expect(html).toMatch(
      /id="extract-existing-btn"[\s\S]*?text-gray-300[\s\S]*?Extract Existing Bookmarks/
    );
  });
});
