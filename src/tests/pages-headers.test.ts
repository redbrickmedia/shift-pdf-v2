import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Cloudflare Pages headers', () => {
  it('serves PDF.js modules as JavaScript', async () => {
    const headers = await readFile(
      resolve(process.cwd(), 'public/_headers'),
      'utf8'
    );
    expect(headers).toMatch(
      /\/\*\.mjs\s+Content-Type: application\/javascript/
    );
    expect(headers).toMatch(
      /\/pdfjs-viewer\/\*\.mjs\s+Content-Type: application\/javascript/
    );
  });
});
