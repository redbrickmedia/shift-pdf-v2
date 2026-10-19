import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_SOURCE, PACKAGE_VERSIONS } from '../js/const/engine-source';

function readRepo(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('AGPL source offer', () => {
  it('names the deployed revision and pinned engine source on licensing.html', () => {
    const page = readRepo('licensing.html');
    expect(page).toContain('{{sourceRevision}}');
    expect(page).toContain('{{sourceRevisionUrl}}');
    expect(page).toContain('{{engineSource.pymupdf.source}}');
    expect(page).toContain('{{engineSource.ghostscript.source}}');
    expect(page).toContain('{{engineSource.cpdf.source}}');
    expect(page).toContain('href="/NOTICE"');
    expect(page).not.toContain('github.com/redbrickmedia/shift-pdf-v2"');
  });

  it('pins engine versions to the npm packages copied onto this origin', () => {
    expect(PACKAGE_VERSIONS.pymupdf).toBe('0.11.16');
    expect(PACKAGE_VERSIONS.ghostscript).toBe('0.1.1');
    expect(PACKAGE_VERSIONS.cpdf).toBe('2.5.5');
    expect(ENGINE_SOURCE.pymupdf.localPath).toBe('wasm/pymupdf/');
    expect(ENGINE_SOURCE.ghostscript.localPath).toBe('wasm/gs/');
    expect(ENGINE_SOURCE.cpdf.localPath).toBe('wasm/cpdf/');
  });

  it('does not ship the modified CoherentPDF binary from public/', () => {
    expect(
      existsSync(resolve(process.cwd(), 'public/coherentpdf.browser.min.js'))
    ).toBe(false);
  });

  it('does not sell an AGPL waiver', () => {
    const terms = readRepo('terms.html');
    const readme = readRepo('README.md');
    const docs = readRepo('docs/licensing.md');
    expect(terms).not.toContain('without the obligations of the AGPL');
    expect(terms).not.toContain('Commercial License Terms');
    expect(readme).not.toContain('No AGPL obligations');
    expect(docs).not.toContain('Commercial License');
    expect(docs).toContain('AGPL-3.0-only');
  });

  it('lists LibreOffice, qpdf, PDFium, and PDF.js in NOTICE', () => {
    const notice = readRepo('NOTICE');
    expect(notice).toContain('Mozilla Public License 2.0');
    expect(notice).toContain('public/libreoffice-wasm/');
    expect(notice).toContain('qpdf.wasm');
    expect(notice).toContain('pdfium.wasm');
    expect(notice).toContain('public/pdfjs-viewer/');
    expect(notice).not.toContain('public/pdfjs-annotation-viewer/');
  });

  it('keeps host identifiers out of compiled source', () => {
    const bridge = readRepo('src/js/host/bridge.ts');
    const handoff = readRepo('src/js/embedder/shift-file-handoff.ts');
    const boot = readRepo('public/sidebar-boot.js');
    expect(bridge).not.toContain('chrome.shift');
    expect(bridge).not.toContain('tryshift.com');
    expect(handoff).not.toContain('mofjdkplmlofiadhjjcacadmghmaglna');
    expect(handoff).toContain("protocol === 'chrome-extension:'");
    expect(boot).not.toContain('tryshift.com');
    expect(boot).not.toContain('chrome.shift');
  });
});
