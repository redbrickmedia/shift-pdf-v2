import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readJson = async (path: string) =>
  JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

describe('vendored PDF.js alignment', () => {
  it('pins package, lockfile, installed package, and full viewer together', async () => {
    const [manifest, lockfile, installed, viewerCore, viewerWorker] =
      await Promise.all([
        readJson('package.json'),
        readJson('package-lock.json'),
        readJson('node_modules/pdfjs-dist/package.json'),
        readText('public/pdfjs-viewer/pdf.mjs'),
        readText('public/pdfjs-viewer/pdf.worker.mjs'),
      ]);
    const locked = lockfile.packages['node_modules/pdfjs-dist'].version;

    expect(manifest.dependencies['pdfjs-dist']).toBe(locked);
    expect(installed.version).toBe(locked);
    expect(viewerCore).toContain(`pdfjsVersion = ${locked}`);
    expect(viewerWorker).toContain(`pdfjsVersion = ${locked}`);
  });

  it('retires the legacy pdfjs-annotation-viewer bundle', () => {
    expect(
      existsSync(resolve(process.cwd(), 'public/pdfjs-annotation-viewer'))
    ).toBe(false);
  });
});
