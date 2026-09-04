import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The production CSP in public/_headers ships `script-src 'self' ...` with no
// 'unsafe-inline', nonce, or hash. Cloudflare Pages serves that header, so any
// inline <script> in a static HTML file is silently blocked in production while
// still working locally — neither `vite dev` nor `vite preview` sends a CSP.
//
// That divergence broke the visual Sign PDF viewer once already, so keep the
// static HTML under public/ free of inline scripts.

const repoRoot = resolve(__dirname, '../..');
const publicDir = join(repoRoot, 'public');
const headersPath = join(publicDir, '_headers');

async function htmlFilesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await htmlFilesUnder(full)));
    } else if (entry.name.endsWith('.html')) {
      found.push(full);
    }
  }
  return found;
}

/** Strips HTML comments so commented-out examples do not trip the scan. */
function withoutComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/** Matches a <script> with no src attribute, i.e. one with an inline body. */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

describe('production CSP and static HTML', () => {
  it('keeps script-src free of inline escape hatches', async () => {
    const headers = await readFile(headersPath, 'utf8');
    const scriptSrc = headers.match(/script-src ([^;]*)/)?.[1] ?? '';

    expect(scriptSrc).not.toBe('');
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain('nonce-');
    expect(scriptSrc).not.toContain("'sha256-");
  });

  it('has no inline scripts in any public HTML file', async () => {
    const files = await htmlFilesUnder(publicDir);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const html = withoutComments(await readFile(file, 'utf8'));
      for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
        if (body.trim()) {
          offenders.push(relative(repoRoot, file));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('loads the sign viewer directly, without an inline redirect shim', async () => {
    const page = await readFile(
      join(repoRoot, 'src/js/logic/sign-pdf-page.ts'),
      'utf8'
    );

    expect(page).toContain('pdfjs-viewer/viewer.html');
    expect(page).not.toContain('sign-viewer.html');
    // viewer.mjs needs this flag to open the signature editor; the deleted shim
    // used to add it, so the caller must now supply it itself.
    expect(page).toContain("bentoSign: '1'");
  });
});
