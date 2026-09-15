import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPdf,
  launchViewerTool,
  resetPdfViewerPageForTests,
  showPdfInViewer,
  VIEWER_TOOL_TARGETS,
  viewerDisplayName,
} from '../js/logic/pdf-viewer-page';
import { clearPersistedOpenFile } from '../js/logic/open-file-store';
import {
  getWorkspaceFiles,
  resetWorkspaceFileIndicator,
} from '../js/logic/workspace-files';

function mountViewer(): void {
  document.body.innerHTML = `
    <main id="shift-pdf-viewer">
      <h1 id="shift-pdf-viewer-title">PDF</h1>
      <iframe id="shift-pdf-viewer-frame"></iframe>
      <div id="shift-pdf-viewer-empty"></div>
    </main>
  `;
}

afterEach(async () => {
  resetPdfViewerPageForTests();
  resetWorkspaceFileIndicator();
  await clearPersistedOpenFile();
  document.body.innerHTML = '';
  document.title = '';
});

describe('PDF viewer page', () => {
  it('maps the six header tools to the existing PDF destinations', () => {
    expect(VIEWER_TOOL_TARGETS).toEqual({
      lock: 'encrypt-pdf.html',
      convert: 'pdf-converter.html',
      esign: 'sign-pdf.html',
      compress: 'compress-pdf.html',
    });
  });

  it('uses the PDF filename as the viewer heading without its extension', () => {
    expect(viewerDisplayName('Quarterly report.pdf')).toBe('Quarterly report');
    expect(viewerDisplayName('PDF')).toBe('PDF');
  });

  it('accepts PDF MIME types and PDF extensions only', () => {
    expect(
      isPdf(new File(['pdf'], 'document', { type: 'application/pdf' }))
    ).toBe(true);
    expect(isPdf(new File(['pdf'], 'document.PDF'))).toBe(true);
    expect(
      isPdf(new File(['text'], 'document.txt', { type: 'text/plain' }))
    ).toBe(false);
  });

  it('opens a local PDF in the launchpad-mode PDF.js viewer', async () => {
    mountViewer();
    const file = new File(['pdf'], 'Quarterly report.pdf', {
      type: 'application/pdf',
    });
    const revokeObjectUrl = vi.fn();

    await expect(
      showPdfInViewer(file, document, {
        createObjectUrl: () => 'blob:quarterly-report',
        revokeObjectUrl,
      })
    ).resolves.toBe(true);

    const frame = document.getElementById(
      'shift-pdf-viewer-frame'
    ) as HTMLIFrameElement;
    expect(frame.src).toContain('pdfjs-viewer/viewer.html?file=');
    expect(frame.src).toContain('shiftLaunchpad=1');
    expect(frame.title).toBe('Quarterly report.pdf PDF viewer');
    expect(document.getElementById('shift-pdf-viewer-title')?.textContent).toBe(
      'Quarterly report'
    );
    expect(getWorkspaceFiles()[0]?.blob).toBe(file);
  });

  it('persists the open PDF before routing to a header tool', async () => {
    mountViewer();
    const file = new File(['pdf'], 'locked.pdf', {
      type: 'application/pdf',
    });
    await showPdfInViewer(file, document, {
      createObjectUrl: () => 'blob:locked',
      revokeObjectUrl: vi.fn(),
    });
    const assignLocation = vi.fn();

    await expect(
      launchViewerTool(VIEWER_TOOL_TARGETS.lock, document, assignLocation)
    ).resolves.toBe(true);

    expect(assignLocation).toHaveBeenCalledOnce();
    expect(assignLocation.mock.calls[0]?.[0]).toMatch(/\/encrypt-pdf\.html$/);
    expect(getWorkspaceFiles()[0]?.blob).toBe(file);
  });
});
