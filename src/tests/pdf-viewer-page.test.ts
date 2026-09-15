import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isPdf,
  launchViewerTool,
  loadViewerDocumentFromUrl,
  resetPdfViewerPageForTests,
  showPdfInViewer,
  VIEWER_TOOL_TARGETS,
  viewerDisplayName,
} from '../js/logic/pdf-viewer-page';
import {
  clearPersistedOpenFile,
  readPersistedOpenFiles,
  writePersistedOpenFiles,
} from '../js/logic/open-file-store';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  getWorkspaceFiles,
  persistWorkspaceOpenFile,
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
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
  await clearPdfLibrary();
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
    expect(getWorkspaceFiles()).toEqual([]);
  });

  it('loads the URL-targeted library PDF without changing selection', async () => {
    mountViewer();
    const first = new File(['first'], 'first.pdf', {
      type: 'application/pdf',
    });
    const second = new File(['second'], 'second.pdf', {
      type: 'application/pdf',
    });
    setWorkspaceFiles([first, second]);
    await persistWorkspaceOpenFile();
    const target = await addPdfToLibrary(
      new File(['target'], 'target.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await expect(
      loadViewerDocumentFromUrl(document, `?file=${target.id}`, {
        createObjectUrl: () => 'blob:target',
        revokeObjectUrl: vi.fn(),
      })
    ).resolves.toBe(true);

    expect(document.getElementById('shift-pdf-viewer-title')?.textContent).toBe(
      'target'
    );
    expect(getWorkspaceFiles().map((file) => file.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect((await readPersistedOpenFiles()).map((entry) => entry.name)).toEqual(
      ['first.pdf', 'second.pdf']
    );
  });

  it('shows the empty state for a missing or stale viewer target', async () => {
    mountViewer();

    await expect(
      loadViewerDocumentFromUrl(document, '?file=stale-id')
    ).resolves.toBe(false);

    expect(
      (document.getElementById('shift-pdf-viewer-frame') as HTMLIFrameElement)
        .hidden
    ).toBe(true);
    expect(
      document.getElementById('shift-pdf-viewer-empty')?.hasAttribute('hidden')
    ).toBe(false);
  });

  it('resolves a pending sidebar name from the persisted selection', async () => {
    mountViewer();
    const pending = new File(['pending'], 'pending report.pdf', {
      type: 'application/pdf',
    });
    await writePersistedOpenFiles([{ file: pending, source: 'upload' }]);

    await expect(
      loadViewerDocumentFromUrl(document, '?name=pending+report.pdf', {
        createObjectUrl: () => 'blob:pending',
        revokeObjectUrl: vi.fn(),
      })
    ).resolves.toBe(true);

    expect(document.getElementById('shift-pdf-viewer-title')?.textContent).toBe(
      'pending report'
    );
    expect(getWorkspaceFiles()).toEqual([]);
    expect((await readPersistedOpenFiles()).map((entry) => entry.name)).toEqual(
      ['pending report.pdf']
    );
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
