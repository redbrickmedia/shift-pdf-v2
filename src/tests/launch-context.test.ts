import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
  setLaunchContext,
} from '../js/logic/launch-context';
import { mountViewerChrome } from '../js/logic/viewer-chrome';
import { getToolIdFromPath } from '../js/host/telemetry';

describe('Launch Context resolution and DOM synchronization', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');
    document.title = 'PDF Multi Tool | Shift PDF';
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/pdf-multi-tool.html');
  });

  it('resolves canonical surface metadata when ?entry is omitted', () => {
    const ctx = resolveLaunchContext('/pdf-multi-tool.html', '');
    expect(ctx.surfaceId).toBe('pdf-multi-tool');
    expect(ctx.entryId).toBe('pdf-multi-tool');
    expect(ctx.isConsolidatedEntry).toBe(false);
    expect(ctx.name).toBe('PDF Multi Tool');
    expect(ctx.cardinality).toBe('batch');
    expect(ctx.multiple).toBe(true);
  });

  it('resolves consolidated entry metadata when ?entry belongs to the surface', () => {
    const ctx = resolveLaunchContext(
      '/pdf-multi-tool.html',
      '?entry=rotate-pdf'
    );
    expect(ctx.surfaceId).toBe('pdf-multi-tool');
    expect(ctx.entryId).toBe('rotate-pdf');
    expect(ctx.isConsolidatedEntry).toBe(true);
    expect(ctx.name).toBe('Rotate PDF');
    expect(ctx.subtitle).toBe('Turn pages in 90-degree increments.');
    expect(ctx.accept).toBe('application/pdf');
    expect(ctx.cardinality).toBe('batch');
    expect(ctx.multiple).toBe(true);
  });

  it('narrows file input accept for format-specific converter entries', () => {
    const jpgCtx = resolveLaunchContext(
      '/pdf-converter.html',
      '?entry=jpg-to-pdf'
    );
    expect(jpgCtx.surfaceId).toBe('pdf-converter');
    expect(jpgCtx.entryId).toBe('jpg-to-pdf');
    expect(jpgCtx.name).toBe('JPG to PDF');
    expect(jpgCtx.accept).toContain('image/jpeg');
    expect(jpgCtx.cardinality).toBe('batch');
    expect(jpgCtx.multiple).toBe(true);
  });

  it('falls back to canonical surface when ?entry is unknown, pruned, or belongs to another surface', () => {
    const unknownCtx = resolveLaunchContext(
      '/pdf-multi-tool.html',
      '?entry=does-not-exist'
    );
    expect(unknownCtx.entryId).toBe('pdf-multi-tool');
    expect(unknownCtx.isConsolidatedEntry).toBe(false);

    const prunedCtx = resolveLaunchContext(
      '/pdf-multi-tool.html',
      '?entry=rotate-custom'
    );
    expect(prunedCtx.entryId).toBe('pdf-multi-tool');
    expect(prunedCtx.isConsolidatedEntry).toBe(false);

    const wrongSurfaceCtx = resolveLaunchContext(
      '/pdf-multi-tool.html',
      '?entry=sign-pdf'
    );
    expect(wrongSurfaceCtx.entryId).toBe('pdf-multi-tool');
    expect(wrongSurfaceCtx.isConsolidatedEntry).toBe(false);
  });

  it('updates header h1, subtitle, document.title, and #file-input when mounted on a consolidated entry', () => {
    window.history.replaceState({}, '', '/edit-pdf.html?entry=sign-pdf');
    document.title = 'PDF Editor | Shift PDF';
    document.body.innerHTML = `
      <div id="tool-uploader">
        <h1>PDF Editor</h1>
        <p>Annotate, highlight, redact, comment, add shapes/images, search, and view PDFs.</p>
        <input id="file-input" type="file" multiple accept="*/*" />
      </div>
    `;

    mountViewerChrome(document);

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Sign PDF');
    expect(
      document.querySelector('[data-viewer-chrome="subtitle"]')?.textContent
    ).toBe('Draw, type, or upload your signature.');
    expect(document.title).toBe('Sign PDF | Shift PDF');

    const fileInput = document.querySelector<HTMLInputElement>('#file-input');
    expect(fileInput?.accept).toBe('application/pdf');
    expect(fileInput?.multiple).toBe(false);
  });

  it('syncs URL, header copy, file input, and telemetry attribution on in-surface mode changes via setLaunchContext', () => {
    window.history.replaceState(
      {},
      '',
      '/pdf-converter.html?entry=jpg-to-pdf&foo=1#step'
    );
    document.title = 'Convert | Shift PDF';
    document.body.innerHTML = `
      <div id="tool-uploader">
        <h1>Convert</h1>
        <p>Convert PDFs to Word, Excel, images, and more.</p>
        <input id="file-input" type="file" />
      </div>
    `;

    applyLaunchContextToDom(document);
    expect(document.querySelector('h1')?.textContent).toBe('JPG to PDF');
    expect(
      document.querySelector<HTMLInputElement>('#file-input')?.accept
    ).toContain('image/jpeg');
    expect(getToolIdFromPath()).toBe('jpg-to-pdf');

    setLaunchContext('pdf-to-docx', document);
    expect(window.location.search).toBe('?entry=pdf-to-docx&foo=1');
    expect(window.location.hash).toBe('#step');
    expect(document.querySelector('h1')?.textContent).toBe('PDF to Word');
    expect(document.title).toBe('PDF to Word | Shift PDF');
    expect(
      document.querySelector<HTMLInputElement>('#file-input')?.accept
    ).toBe('application/pdf');
    expect(getToolIdFromPath()).toBe('pdf-to-docx');

    setLaunchContext('pdf-converter', document);
    expect(window.location.search).toBe('?foo=1');
    expect(document.querySelector('h1')?.textContent).toBe('Convert');
    expect(getToolIdFromPath()).toBe('pdf-converter');
  });
});
