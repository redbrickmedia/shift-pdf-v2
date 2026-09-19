import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
import { initPdfViewerPage, resetPdfViewerPageForTests } from '../js/logic/pdf-viewer-page';
import { initToolOutputToolbar } from '../js/logic/tool-output-toolbar';

function readPage(name: string): string {
  return readFileSync(resolve(process.cwd(), 'src/pages', name), 'utf8');
}

describe('viewer chrome', () => {
  beforeEach(() => {
    resetPdfViewerPageForTests();
    document.body.innerHTML = '';
  });

  it('uses launchpad features on View PDF and tool features on tool pages', () => {
    document.body.innerHTML = '<main id="shift-pdf-viewer"></main>';
    expect(detectViewerChromePreset()).toBe('launchpad');
    expect(resolveViewerChromeFeatures()).toEqual(VIEWER_CHROME_PRESETS.launchpad);

    document.body.innerHTML = '<div id="tool-uploader"><h1>Sign PDF</h1></div>';
    expect(detectViewerChromePreset()).toBe('tool');
    expect(resolveViewerChromeFeatures({ preset: 'tool' })).toEqual(
      VIEWER_CHROME_PRESETS.tool
    );
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
      chrome?.header
        .querySelector(`[${VIEWER_CHROME_FEATURE_ATTR}="subtitle"]`)
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

    expect(document.querySelectorAll(`.${VIEWER_CHROME_HEADER_CLASS}`)).toHaveLength(
      1
    );
    expect(document.querySelector(`.${VIEWER_CHROME_HEADER_CLASS}`)).toBe(
      existing
    );
    expect(isViewerChromeFeatureOn(existing!, 'back')).toBe(true);
    expect(isViewerChromeFeatureOn(existing!, 'print')).toBe(true);
  });

  it('adopts the Sign PDF header View PDF already uses, without building a second one', () => {
    document.body.innerHTML = `
      <div id="uploader" class="shift-pdf-viewer-shell">
        <header class="shift-pdf-viewer-header">
          <div class="shift-pdf-viewer-heading">
            <h1>Sign PDF</h1>
            <p data-viewer-chrome="subtitle">Draw, type, or upload your signature.</p>
          </div>
          <div class="shift-pdf-viewer-actions" data-shift-viewer-actions role="toolbar">
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

    expect(document.querySelectorAll(`.${VIEWER_CHROME_HEADER_CLASS}`)).toHaveLength(
      1
    );
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

  it('authors Sign PDF with the same header component as View PDF', () => {
    const viewPdf = readPage('view-pdf.html');
    const signPdf = readPage('sign-pdf.html');

    expect(viewPdf).toContain('class="shift-pdf-viewer-shell"');
    expect(viewPdf).toContain(`class="${VIEWER_CHROME_HEADER_CLASS}"`);
    expect(viewPdf).toContain(`class="${VIEWER_CHROME_HEADING_CLASS}"`);
    expect(viewPdf).toContain(`class="${VIEWER_CHROME_ACTIONS_CLASS}"`);
    expect(viewPdf).toContain(VIEWER_CHROME_ACTIONS_ATTR);

    expect(signPdf).toContain('id="uploader" class="shift-pdf-viewer-shell"');
    expect(signPdf).toContain(`<header class="${VIEWER_CHROME_HEADER_CLASS}">`);
    expect(signPdf).toContain(`class="${VIEWER_CHROME_HEADING_CLASS}"`);
    expect(signPdf).toContain(`class="${VIEWER_CHROME_ACTIONS_CLASS}"`);
    expect(signPdf).toContain(VIEWER_CHROME_ACTIONS_ATTR);
    expect(signPdf).toContain(`${VIEWER_CHROME_FEATURE_ATTR}="subtitle"`);
    expect(signPdf).toContain(`${VIEWER_CHROME_FEATURE_ATTR}="flatten"`);
    expect(signPdf).toContain('id="flatten-signature-toggle"');
    expect(signPdf).toContain('id="signature-editor"');
    expect(signPdf).toContain('class="shift-pdf-viewer-stage hidden"');
    expect(signPdf).not.toMatch(
      /id="tool-uploader"[\s\S]*<h1[\s\S]*Sign PDF/
    );
    expect(signPdf).not.toContain('shiftLaunchpad');
    expect(signPdf).not.toContain('id="shift-pdf-viewer"');

    const signPage = readFileSync(
      resolve(process.cwd(), 'src/js/logic/sign-pdf-page.ts'),
      'utf8'
    );
    expect(signPage).toContain("bentoSign: '1'");
    expect(signPage).not.toContain('shiftLaunchpad');
  });
});
