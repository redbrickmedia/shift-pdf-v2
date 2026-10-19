import { beforeEach, describe, expect, it } from 'vitest';
import { buildConvertSourceAccept } from '../js/config/convert-destinations';
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

  it('sets multiple=true for dual cardinality surfaces and preserves convert hub accept on canonical pdf-converter', () => {
    const compareCtx = resolveLaunchContext('/compare-pdfs.html', '');
    expect(compareCtx.cardinality).toBe('dual');
    expect(compareCtx.multiple).toBe(true);

    const convertCtx = resolveLaunchContext('/pdf-converter.html', '');
    expect(convertCtx.accept).toBe(buildConvertSourceAccept());
    expect(convertCtx.accept).toContain('.pdf');
    expect(convertCtx.accept).toContain('.docx');
    expect(convertCtx.multiple).toBe(true);
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
    expect(
      document.querySelector<HTMLInputElement>('#file-input')?.accept
    ).toBe(buildConvertSourceAccept());
    expect(getToolIdFromPath()).toBe('pdf-converter');
  });

  it('highlights only the active sidebar pin for shared surfaces and updates on setLaunchContext', () => {
    window.history.replaceState(
      {},
      '',
      '/pdf-multi-tool.html?entry=rotate-pdf'
    );
    document.body.innerHTML = `
      <nav id="shift-favorite-tools">
        <a id="pin-canonical" class="shift-nav-link" href="/pdf-multi-tool.html">PDF Multi Tool</a>
        <a id="pin-rotate" class="shift-nav-link" href="/pdf-multi-tool.html?entry=rotate-pdf">Rotate PDF</a>
        <a id="pin-delete" class="shift-nav-link" href="/pdf-multi-tool.html?entry=delete-pages">Delete Pages</a>
        <a id="pin-sign" class="shift-nav-link" href="/edit-pdf.html?entry=sign-pdf">Sign PDF</a>
      </nav>
      <div id="tool-uploader">
        <h1>PDF Multi Tool</h1>
        <p>Subtitle</p>
        <input id="file-input" type="file" />
      </div>
    `;

    applyLaunchContextToDom(document);
    expect(
      document.getElementById('pin-rotate')?.classList.contains('is-active')
    ).toBe(true);
    expect(
      document.getElementById('pin-rotate')?.getAttribute('aria-current')
    ).toBe('page');
    expect(
      document.getElementById('pin-canonical')?.classList.contains('is-active')
    ).toBe(false);
    expect(
      document.getElementById('pin-delete')?.classList.contains('is-active')
    ).toBe(false);
    expect(
      document.getElementById('pin-sign')?.classList.contains('is-active')
    ).toBe(false);

    // Switching in-place to another consolidated entry updates the active pin
    setLaunchContext('delete-pages', document);
    expect(
      document.getElementById('pin-rotate')?.classList.contains('is-active')
    ).toBe(false);
    expect(
      document.getElementById('pin-rotate')?.hasAttribute('aria-current')
    ).toBe(false);
    expect(
      document.getElementById('pin-delete')?.classList.contains('is-active')
    ).toBe(true);
    expect(
      document.getElementById('pin-delete')?.getAttribute('aria-current')
    ).toBe('page');

    // Mismatched surface entry falls back to canonical surface pin, not sign-pdf
    window.history.replaceState({}, '', '/pdf-multi-tool.html?entry=sign-pdf');
    applyLaunchContextToDom(document);
    expect(
      document.getElementById('pin-sign')?.classList.contains('is-active')
    ).toBe(false);
    expect(
      document.getElementById('pin-canonical')?.classList.contains('is-active')
    ).toBe(true);
  });

  it('rebinds header data-i18n keys to the active Catalog Entry so applyTranslations preserves and translates consolidated entry copy', async () => {
    const i18next = (await import('../js/i18n/i18n')).default;
    const { applyTranslations } = await import('../js/i18n/i18n');

    await i18next.init({
      lng: 'fr',
      fallbackLng: 'en',
      ns: ['common', 'tools'],
      defaultNS: 'common',
      resources: {
        en: {
          tools: {
            pdfEditor: {
              name: 'PDF Editor',
              subtitle:
                'Annotate, highlight, redact, comment, add shapes/images, search, and view PDFs.',
            },
            signPdf: {
              name: 'Sign PDF',
              subtitle: 'Draw, type, or upload your signature.',
            },
          },
        },
        fr: {
          tools: {
            pdfEditor: {
              name: 'Éditeur PDF',
              subtitle: 'Annotez et modifiez vos PDF.',
            },
            signPdf: {
              name: 'Signer un PDF',
              subtitle: 'Dessinez, tapez ou importez votre signature.',
            },
          },
        },
      },
    });

    window.history.replaceState({}, '', '/edit-pdf.html?entry=sign-pdf');
    document.title = 'PDF Editor | Shift PDF';
    document.body.innerHTML = `
      <div id="tool-uploader">
        <h1 data-i18n="tools:pdfEditor.name">PDF Editor</h1>
        <p data-i18n="tools:pdfEditor.subtitle">Annotate, highlight, redact, comment, add shapes/images, search, and view PDFs.</p>
        <input id="file-input" type="file" />
      </div>
    `;

    applyLaunchContextToDom(document);

    const h1 = document.querySelector('h1');
    const p = document.querySelector('p');
    expect(h1?.getAttribute('data-i18n')).toBe('tools:signPdf.name');
    expect(p?.getAttribute('data-i18n')).toBe('tools:signPdf.subtitle');
    expect(h1?.textContent).toBe('Signer un PDF');
    expect(p?.textContent).toBe('Dessinez, tapez ou importez votre signature.');
    expect(document.title).toBe('Signer un PDF | Shift PDF');

    // A subsequent applyTranslations() pass must NOT revert the header back to pdfEditor
    applyTranslations();
    expect(h1?.textContent).toBe('Signer un PDF');
    expect(p?.textContent).toBe('Dessinez, tapez ou importez votre signature.');

    // Switching back to canonical surface restores canonical data-i18n keys
    setLaunchContext('edit-pdf', document);
    expect(h1?.getAttribute('data-i18n')).toBe('tools:pdfEditor.name');
    expect(p?.getAttribute('data-i18n')).toBe('tools:pdfEditor.subtitle');
    expect(h1?.textContent).toBe('Éditeur PDF');
    expect(p?.textContent).toBe('Annotez et modifiez vos PDF.');

    // Switching to an entry without a dedicated tools:* i18n key removes data-i18n so applyTranslations will not overwrite it
    window.history.replaceState(
      {},
      '',
      '/pdf-converter.html?entry=pdf-to-docx'
    );
    document.body.innerHTML = `
      <div id="tool-uploader">
        <h1 data-i18n="tools:pdfConverter.name">Convert</h1>
        <p data-i18n="tools:pdfConverter.subtitle">Convert PDFs to Word, Excel, images, and more.</p>
        <input id="file-input" type="file" />
      </div>
    `;
    setLaunchContext('pdf-converter', document);
    const convH1 = document.querySelector('h1');
    const convP = document.querySelector('p');
    expect(convH1?.hasAttribute('data-i18n')).toBe(false);
    expect(convP?.hasAttribute('data-i18n')).toBe(false);
    expect(convH1?.textContent).toBe('Convert');

    await i18next.changeLanguage('en');
  });
});
