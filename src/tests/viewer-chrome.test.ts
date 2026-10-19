import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  STATEFUL_UNDO_REDO_SURFACE_IDS,
  VIEWER_CHROME_ACTIONS_ATTR,
  VIEWER_CHROME_ACTIONS_CLASS,
  VIEWER_CHROME_FEATURE_ATTR,
  VIEWER_CHROME_HEADER_CLASS,
  VIEWER_CHROME_HEADING_CLASS,
  VIEWER_CHROME_PRESETS,
  applyViewerChromeFeatures,
  detectViewerChromePreset,
  isViewerChromeFeatureOn,
  mountViewerChrome,
  resolveViewerChromeFeatures,
} from '../js/logic/viewer-chrome';
import {
  initPdfViewerPage,
  resetPdfViewerPageForTests,
} from '../js/logic/pdf-viewer-page';
import { initToolOutputToolbar } from '../js/logic/tool-output-toolbar';

function readPage(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/pages', name), 'utf8');
}

describe('viewer chrome', () => {
  beforeEach(() => {
    resetPdfViewerPageForTests();
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-context-applied');
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = '';
  });

  it('uses launchpad features on View PDF and tool features on tool pages', () => {
    document.body.innerHTML = '<main id="shift-pdf-viewer"></main>';
    expect(detectViewerChromePreset()).toBe('launchpad');
    expect(resolveViewerChromeFeatures()).toEqual(
      VIEWER_CHROME_PRESETS.launchpad
    );

    document.body.innerHTML = '<div id="tool-uploader"><h1>Sign PDF</h1></div>';
    expect(detectViewerChromePreset()).toBe('tool');
    expect(resolveViewerChromeFeatures({ preset: 'tool' })).toEqual(
      VIEWER_CHROME_PRESETS.tool
    );
  });

  it('shows Undo and Redo only on the 6 stateful interactive Tool Surfaces and hides them on option/batch Tool Surfaces', () => {
    const statefulSurfaces = [
      'edit-pdf',
      'pdf-multi-tool',
      'merge-pdf',
      'bookmark',
      'form-creator',
      'add-watermark',
    ];
    for (const surface of statefulSurfaces) {
      expect(STATEFUL_UNDO_REDO_SURFACE_IDS.has(surface)).toBe(true);
      document.documentElement.dataset.launchSurface = surface;
      const features = resolveViewerChromeFeatures({ preset: 'tool' });
      expect(features.undo).toBe(true);
      expect(features.redo).toBe(true);
    }

    const nonStatefulSurfaces = [
      'compress-pdf',
      'split-pdf',
      'pdf-converter',
      'markdown-to-pdf',
      'txt-to-pdf',
      'repair-pdf',
      'pdf-to-pdfa',
      'deskew-pdf',
      'ocr-pdf',
      'flatten-pdf',
      'encrypt-pdf',
      'digital-sign-pdf',
      'sanitize-pdf',
      'edit-metadata',
      'edit-attachments',
      'adjust-colors',
      'page-numbers',
      'fix-page-size',
      'remove-blank-pages',
      'divide-pages',
      'n-up-pdf',
      'combine-single-page',
      'compare-pdfs',
      'extract-images',
      'pdf-to-zip',
    ];
    for (const surface of nonStatefulSurfaces) {
      document.documentElement.dataset.launchSurface = surface;
      const features = resolveViewerChromeFeatures({ preset: 'tool' });
      expect(features.undo).toBe(false);
      expect(features.redo).toBe(false);
      expect(features.reset).toBe(true);
    }
  });

  it('hides Save and Print on non-PDF output surfaces (extract-images and pdf-to-zip)', () => {
    for (const surface of ['extract-images', 'pdf-to-zip']) {
      document.documentElement.dataset.launchSurface = surface;
      const features = resolveViewerChromeFeatures({ preset: 'tool' });
      expect(features.save).toBe(false);
      expect(features.print).toBe(false);
      expect(features.download).toBe(true);
      expect(features.reset).toBe(true);
      expect(features.undo).toBe(false);
      expect(features.redo).toBe(false);
    }
  });

  it('lets a page hide or show a feature without changing the preset', () => {
    const features = resolveViewerChromeFeatures({
      preset: 'launchpad',
      features: { launchers: false, print: true },
    });
    expect(features.back).toBe(true);
    expect(features.launchers).toBe(false);
    expect(features.print).toBe(true);
    expect(features.save).toBe(false);
  });

  it('lifts a tool title into the same header View PDF uses', () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>Sign PDF</h1>
          <p>Draw a signature.</p>
        </div>
      </div>
    `;

    const chrome = mountViewerChrome(document, { preset: 'tool' });
    const card = document.getElementById('tool-uploader');

    expect(chrome?.header.className).toBe(VIEWER_CHROME_HEADER_CLASS);
    expect(chrome?.heading.className).toBe(VIEWER_CHROME_HEADING_CLASS);
    expect(chrome?.actions.getAttribute(VIEWER_CHROME_ACTIONS_ATTR)).toBe('');
    expect(chrome?.header.nextElementSibling).toBe(card);
    expect(chrome?.header.querySelector('h1')?.textContent).toBe('Sign PDF');
    expect(
      chrome?.header.querySelector(`[${VIEWER_CHROME_FEATURE_ATTR}="subtitle"]`)
        ?.textContent
    ).toBe('Draw a signature.');
    expect(card?.contains(chrome!.header)).toBe(false);
  });

  it('hides launchpad-only actions on a tool page and tool-only actions on View PDF', () => {
    document.body.innerHTML = `
      <main id="shift-pdf-viewer" class="shift-pdf-viewer-shell">
        <header class="shift-pdf-viewer-header">
          <div class="shift-pdf-viewer-heading">
            <a data-viewer-chrome="back" href="/my-pdfs.html">Go Back</a>
            <h1 id="shift-pdf-viewer-title">PDF</h1>
          </div>
          <div class="shift-pdf-viewer-actions" data-shift-viewer-actions>
            <span data-viewer-chrome="launchers">
              <button type="button" data-viewer-tool="sign-pdf.html">eSign</button>
            </span>
            <button type="button" data-viewer-chrome="print">Print</button>
            <button type="button" data-viewer-chrome="download">Download</button>
            <button type="button" data-viewer-chrome="save">Save</button>
          </div>
        </header>
      </main>
    `;

    const launchpad = mountViewerChrome(document, { preset: 'launchpad' });
    expect(isViewerChromeFeatureOn(launchpad!.header, 'back')).toBe(true);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'launchers')).toBe(true);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'print')).toBe(true);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'download')).toBe(true);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'save')).toBe(false);

    applyViewerChromeFeatures(
      launchpad!.header,
      resolveViewerChromeFeatures({ preset: 'tool' })
    );
    expect(isViewerChromeFeatureOn(launchpad!.header, 'back')).toBe(false);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'launchers')).toBe(false);
    expect(isViewerChromeFeatureOn(launchpad!.header, 'save')).toBe(true);
  });

  it('tags tool Save actions so a launchpad preset can hide them', () => {
    document.body.innerHTML = `
      <div id="uploader">
        <div id="tool-uploader">
          <h1>Sign PDF</h1>
        </div>
      </div>
    `;
    initToolOutputToolbar();

    const header = document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`);
    expect(header).toBeTruthy();
    expect(isViewerChromeFeatureOn(header!, 'undo')).toBe(true);
    expect(isViewerChromeFeatureOn(header!, 'save')).toBe(true);

    applyViewerChromeFeatures(
      header!,
      resolveViewerChromeFeatures({ preset: 'launchpad' })
    );
    expect(isViewerChromeFeatureOn(header!, 'undo')).toBe(false);
    expect(isViewerChromeFeatureOn(header!, 'save')).toBe(false);
  });

  it('applies the launchpad preset on View PDF without building a second header', () => {
    document.body.innerHTML = `
      <main id="shift-pdf-viewer" class="shift-pdf-viewer-shell">
        <header class="shift-pdf-viewer-header">
          <div class="shift-pdf-viewer-heading">
            <a id="shift-pdf-viewer-back" data-viewer-chrome="back" href="/my-pdfs.html">Go Back</a>
            <h1 id="shift-pdf-viewer-title">PDF</h1>
          </div>
          <div class="shift-pdf-viewer-actions" data-shift-viewer-actions>
            <span data-viewer-chrome="launchers"></span>
            <button id="shift-pdf-viewer-print" type="button" data-viewer-chrome="print">Print</button>
            <button id="shift-pdf-viewer-download" type="button" data-viewer-chrome="download">Download</button>
          </div>
        </header>
        <iframe id="shift-pdf-viewer-frame"></iframe>
        <div id="shift-pdf-viewer-empty" hidden></div>
      </main>
    `;
    const existing = document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`);
    initPdfViewerPage();

    expect(
      document.querySelectorAll(`.${VIEWER_CHROME_HEADER_CLASS}`)
    ).toHaveLength(1);
    expect(document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`)).toBe(
      existing
    );
    expect(isViewerChromeFeatureOn(existing!, 'back')).toBe(true);
    expect(isViewerChromeFeatureOn(existing!, 'print')).toBe(true);
    expect(
      [
        ...existing!.querySelectorAll(
          '[data-shift-action-group] > [data-viewer-chrome]'
        ),
      ].map((node) => node.getAttribute('data-viewer-chrome'))
    ).toEqual(['download', 'print', 'launchers']);
  });

  it('adopts the Sign PDF header View PDF already uses, without building a second one', () => {
    document.body.innerHTML = `
      <div id="uploader" class="shift-pdf-viewer-shell">
        <header class="shift-pdf-viewer-header">
          <div class="shift-pdf-viewer-heading">
            <h1>Sign PDF</h1>
            <p data-viewer-chrome="subtitle">Draw, type, or upload your signature.</p>
          </div>
          <div class="shift-pdf-viewer-actions" data-shift-viewer-actions role="group">
            <label data-viewer-chrome="flatten" hidden>
              <input id="flatten-signature-toggle" type="checkbox" />
              <span>Flatten signatures into page content</span>
            </label>
          </div>
        </header>
        <div id="tool-uploader">
          <div id="drop-zone"></div>
        </div>
        <div id="signature-editor" class="shift-pdf-viewer-stage hidden"></div>
      </div>
    `;
    const existing = document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`);

    const chrome = mountViewerChrome(document, { preset: 'tool' });

    expect(
      document.querySelectorAll(`.${VIEWER_CHROME_HEADER_CLASS}`)
    ).toHaveLength(1);
    expect(chrome?.header).toBe(existing);
    expect(chrome?.header.parentElement?.id).toBe('uploader');
    expect(chrome?.header.nextElementSibling?.id).toBe('tool-uploader');
    expect(isViewerChromeFeatureOn(chrome!.header, 'subtitle')).toBe(true);
    expect(isViewerChromeFeatureOn(chrome!.header, 'flatten')).toBe(false);
    expect(isViewerChromeFeatureOn(chrome!.header, 'back')).toBe(false);
    expect(isViewerChromeFeatureOn(chrome!.header, 'launchers')).toBe(false);

    document.body.classList.add('shift-tool-viewer');
    mountViewerChrome(document, { preset: 'tool' });
    expect(isViewerChromeFeatureOn(existing!, 'flatten')).toBe(true);
    expect(isViewerChromeFeatureOn(existing!, 'subtitle')).toBe(true);
  });

  it('authors Edit PDF with the same header component as View PDF', () => {
    const viewPdf = readPage('view-pdf.html');
    const editPdf = readPage('edit-pdf.html');

    expect(viewPdf).toContain('class="shift-pdf-viewer-shell"');
    expect(viewPdf).toContain(`class="${VIEWER_CHROME_HEADER_CLASS}"`);
    expect(viewPdf).toContain(`class="${VIEWER_CHROME_HEADING_CLASS}"`);
    expect(viewPdf).toContain(VIEWER_CHROME_ACTIONS_CLASS);
    expect(viewPdf).toContain('shift-action-row');
    expect(viewPdf).toContain(VIEWER_CHROME_ACTIONS_ATTR);

    expect(editPdf).toContain('id="uploader"');
    expect(editPdf).not.toContain(
      'id="uploader" class="shift-pdf-viewer-shell"'
    );
    expect(editPdf).toContain(`<header class="${VIEWER_CHROME_HEADER_CLASS}">`);
    expect(editPdf).toContain(`class="${VIEWER_CHROME_HEADING_CLASS}"`);
    expect(editPdf).toContain(VIEWER_CHROME_ACTIONS_CLASS);
    expect(editPdf).toContain('shift-action-row');
    expect(editPdf).toContain(VIEWER_CHROME_ACTIONS_ATTR);
    expect(editPdf).toContain(`${VIEWER_CHROME_FEATURE_ATTR}="subtitle"`);
    expect(editPdf).toContain(`${VIEWER_CHROME_FEATURE_ATTR}="flatten"`);
    expect(editPdf).toContain('id="flatten-signature-toggle"');
    expect(editPdf).toContain('id="fill-sign-stage"');
    expect(editPdf).toContain('id="tool-uploader"');
    expect(editPdf).toContain('border-dashed');
    expect(editPdf).toContain('data-lucide="circle-arrow-up"');
    expect(editPdf).not.toContain('shift-pdf-viewer-empty');
    expect(editPdf).not.toContain('shift-pdf-viewer-page');
    expect(editPdf).toContain('bg-gray-800 rounded-xl');
    expect(editPdf).not.toMatch(/id="tool-uploader"[\s\S]*<h1/);
    expect(editPdf).toContain(`${VIEWER_CHROME_FEATURE_ATTR}="sign"`);
    expect(editPdf).not.toContain('id="shift-pdf-viewer"');
    expect(editPdf).toContain('{{> footer }}');

    const editPage = readFileSync(
      resolve(process.cwd(), 'src/js/logic/edit-pdf-page.ts'),
      'utf8'
    );
    expect(editPage).toContain("bentoSign: '1'");
    expect(editPage).toContain("shiftLaunchpad: '1'");
  });

  it('gives the Sign shell a real pane height so the PDF.js iframe can paint', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );
    const shell = css.slice(
      css.indexOf('\n.shift-pdf-viewer-shell {'),
      css.indexOf('\n.shift-pdf-viewer-header {')
    );

    expect(shell).toMatch(/height:\s*100dvh/);
    expect(css).not.toMatch(
      /#uploader\.shift-pdf-viewer-shell\s*\{\s*height:\s*auto/
    );
    expect(css).toMatch(
      /body\.shift-tool-viewer\s+#uploader\.shift-pdf-viewer-shell\s+#canvas-container-sign\s*\{[^}]*height:\s*100%\s*!important/s
    );
  });
});
