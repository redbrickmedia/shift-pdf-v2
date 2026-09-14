import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initToolViewerLayout,
  isViewerActive,
  isViewerToolDocument,
  resetToolViewerLayout,
  syncToolViewerLayout,
  TOOL_VIEWER_ACTIONS_ATTR,
  TOOL_VIEWER_BAR_CLASS,
  TOOL_VIEWER_BODY_CLASS,
  TOOL_VIEWER_CAPABLE_CLASS,
  TOOL_VIEWER_SCROLL_HOST_CLASS,
  TOOL_VIEWER_SUPPRESS_CLASS,
} from '../js/logic/tool-viewer-layout';

/** Observable hide: attribute or the class syncToolViewerLayout applies. */
function isUploadChromeSuppressed(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.hasAttribute('hidden') ||
    el.classList.contains(TOOL_VIEWER_SUPPRESS_CLASS)
  );
}

function mountSignLikeShell() {
  document.body.innerHTML = `
    <div id="uploader" class="min-h-screen">
      <div id="tool-uploader">
        <h1>Sign PDF</h1>
        <p class="subtitle">Add a signature to your PDF.</p>
        <div id="drop-zone">
          <input id="file-input" type="file" accept="application/pdf" />
        </div>
        <div id="file-display-area"></div>
      </div>
      <div id="signature-editor" class="hidden">
        <div id="canvas-container-sign"></div>
        <button id="process-btn" type="button" class="btn-gradient w-full mt-4">
          Download Signed PDF
        </button>
      </div>
    </div>
  `;
}

function mountMergeLikeShell() {
  document.body.innerHTML = `
    <div id="uploader">
      <div id="tool-uploader">
        <h1>Merge PDF</h1>
        <div id="drop-zone">
          <input id="file-input" type="file" accept="application/pdf" multiple />
        </div>
        <div id="file-display-area"></div>
        <button id="process-btn" type="button">Merge</button>
      </div>
    </div>
  `;
}

afterEach(() => {
  resetToolViewerLayout();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('tool viewer layout', () => {
  it('recognizes viewer tools and ignores non-viewer tools', () => {
    mountSignLikeShell();
    expect(isViewerToolDocument()).toBe(true);
    expect(isViewerActive()).toBe(false);

    mountMergeLikeShell();
    expect(isViewerToolDocument()).toBe(false);
  });

  it('keeps the empty-state drop zone when no viewer is showing', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_CAPABLE_CLASS)).toBe(
      true
    );
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(document.getElementById('drop-zone')).not.toBeNull();
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );
    expect(
      isUploadChromeSuppressed(document.getElementById('file-display-area'))
    ).toBe(false);
    expect(
      document.getElementById('process-btn')?.closest('#signature-editor')
    ).not.toBeNull();
  });

  it('activates full-panel mode and moves Download into the heading bar', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    document.getElementById('file-display-area')!.textContent = 'file.pdf';
    syncToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(isViewerActive()).toBe(true);

    const bar = document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`);
    const actions = document.querySelector(`[${TOOL_VIEWER_ACTIONS_ATTR}]`);
    const download = document.getElementById('process-btn');

    expect(bar).not.toBeNull();
    expect(bar?.querySelector('h1')?.textContent).toBe('Sign PDF');
    expect(actions?.contains(download)).toBe(true);
    expect(download?.closest('#signature-editor')).toBeNull();
  });

  it('hides drop zone and file chips after the viewer is revealed the page way', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    // Pages reveal viewers by removing `.hidden` (sign-pdf, crop-pdf, etc.).
    document.getElementById('file-display-area')!.innerHTML =
      '<div class="file-chip">sample.pdf</div>';
    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();

    const drop = document.getElementById('drop-zone');
    const chips = document.getElementById('file-display-area');

    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);
    expect(isUploadChromeSuppressed(drop)).toBe(true);
    expect(isUploadChromeSuppressed(chips)).toBe(true);
  });

  it('restores upload chrome when the viewer is hidden again', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      true
    );

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
    expect(isUploadChromeSuppressed(document.getElementById('drop-zone'))).toBe(
      false
    );
    expect(
      isUploadChromeSuppressed(document.getElementById('file-display-area'))
    ).toBe(false);
  });

  it('clears viewer mode when the viewer is hidden again', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(true);

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(document.body.classList.contains(TOOL_VIEWER_BODY_CLASS)).toBe(
      false
    );
  });

  it('does nothing on non-viewer tool pages', () => {
    mountMergeLikeShell();
    initToolViewerLayout();

    expect(document.body.classList.contains(TOOL_VIEWER_CAPABLE_CLASS)).toBe(
      false
    );
    expect(document.querySelector(`.${TOOL_VIEWER_BAR_CLASS}`)).toBeNull();
    expect(
      document.getElementById('process-btn')?.closest('#tool-uploader')
    ).not.toBeNull();
  });

  it('scopes full-panel CSS to body.shift-tool-viewer', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );

    expect(css).toContain('body.shift-tool-viewer #drop-zone');
    expect(css).toContain('body.shift-tool-viewer #file-display-area');
    expect(css).toContain('.shift-tool-viewer-suppressed');
    expect(css).toContain('.shift-tool-viewer-actions');
    expect(css).toContain(
      'body.shift-tool-viewer:not(.simple-mode):has(#shift-sidebar)'
    );
    expect(css).toContain('> #uploader');
    expect(css).toMatch(/body\.shift-tool-viewer[\s\S]*flex:\s*1 1 auto/);
    expect(css).not.toMatch(
      /body\.shift-home:has\(#shift-my-pdfs\).*shift-tool-viewer/s
    );
  });

  it('marks scroll hosts and kills nested Sign/Form scrollports while viewing', () => {
    mountSignLikeShell();
    initToolViewerLayout();

    const host = document.getElementById('canvas-container-sign');
    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(false);

    document.getElementById('signature-editor')?.classList.remove('hidden');
    syncToolViewerLayout();

    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(true);
    expect(
      document
        .querySelector(`.${TOOL_VIEWER_BAR_CLASS}`)
        ?.closest('#tool-uploader')
    ).not.toBeNull();
    expect(host?.closest('#signature-editor')).not.toBeNull();

    document.getElementById('signature-editor')?.classList.add('hidden');
    syncToolViewerLayout();
    expect(host?.classList.contains(TOOL_VIEWER_SCROLL_HOST_CLASS)).toBe(false);
  });

  it('scopes scroll containment CSS for viewer hosts and shell panes', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-theme.css'),
      'utf8'
    );

    expect(css).toContain('.shift-viewer-scroll-host');
    expect(css).toMatch(
      /body\.shift-tool-viewer[\s\S]*#canvas-container-sign[\s\S]*overflow:\s*hidden\s*!important/
    );
    expect(css).toMatch(
      /body\.shift-tool-viewer[\s\S]*#canvas-container-sign[\s\S]*> iframe/
    );
    expect(css).toMatch(
      /body\.shift-tool-viewer:not\(\.simple-mode\):has\(#shift-sidebar\)\s*\{[^}]*overflow:\s*hidden/
    );
    expect(css).toContain('body.shift-tool-viewer .compare-panel');
    expect(css).toMatch(
      /\.shift-sidebar-content\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /body\.shift-home:has\(#tool-grid\) #grid-view\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /body\.shift-home:has\(#shift-my-pdfs\) \.shift-my-pdfs-scroll\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toMatch(
      /\.shift-library-picker-list\s*\{[^}]*overscroll-behavior:\s*contain/s
    );
    expect(css).toContain('#main-scroll-container');
    expect(css).toMatch(
      /#main-scroll-container\s*\{[^}]*overscroll-behavior:\s*contain|#main-scroll-container[\s\S]{0,80}overscroll-behavior:\s*contain/
    );
    // Modal / dialog scroll is left alone — no global dialog overflow lock.
    expect(css).not.toMatch(
      /\.dialog[^{]*\{[^}]*overflow:\s*hidden[^}]*overscroll-behavior:\s*none/s
    );
  });
});
