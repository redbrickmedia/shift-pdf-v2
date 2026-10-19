import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { initDownloadedPdfLibrary } from '../js/logic/downloaded-pdf-library';
import {
  addPdfToLibrary,
  clearPdfLibrary,
  readPdfLibrary,
} from '../js/logic/pdf-library-store';
import {
  getLatestPdfOutput,
  initShiftPdfSave,
  clearLatestPdfOutput,
} from '../js/logic/shift-pdf-save';
import { TOOL_SUCCESS_ID, showResultLoader } from '../js/logic/tool-success';
import { downloadFile, PDF_OUTPUT_READY_EVENT } from '../js/utils/helpers';
import {
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

function mockHandle(options: {
  granted?: boolean;
  writable?: {
    write: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}) {
  const writable = options.writable ?? {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return {
    writable,
    handle: {
      createWritable: vi.fn().mockResolvedValue(writable),
      queryPermission: vi
        .fn()
        .mockResolvedValue(options.granted === false ? 'prompt' : 'granted'),
      requestPermission: vi
        .fn()
        .mockResolvedValue(options.granted === false ? 'denied' : 'granted'),
      kind: 'file',
      getFile: vi.fn(),
    } as unknown as FileSystemFileHandle,
  };
}

afterEach(async () => {
  resetWorkspaceFileIndicator();
  clearLatestPdfOutput();
  document.getElementById(TOOL_SUCCESS_ID)?.remove();
  document.body.innerHTML = '';
  await clearPdfLibrary();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pure Output Session staging in downloadFile', () => {
  it('stages { blob, filename, summary } on the active Output Session without auto-saving to My PDFs or opening #shift-tool-success', async () => {
    initDownloadedPdfLibrary();
    initShiftPdfSave();

    const readyEvents: Array<{
      blob: Blob;
      filename: string;
      summary?: string;
    }> = [];
    const onReady = (event: Event) => {
      readyEvents.push((event as CustomEvent).detail);
    };
    document.addEventListener(PDF_OUTPUT_READY_EVENT, onReady);

    downloadFile(
      new Blob(['generated'], { type: 'application/pdf' }),
      'merged.pdf',
      'Combined 2 files.'
    );

    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]?.filename).toBe('merged.pdf');
    expect(readyEvents[0]?.summary).toBe('Combined 2 files.');
    expect(getLatestPdfOutput()?.filename).toBe('merged.pdf');
    expect(getLatestPdfOutput()?.summary).toBe('Combined 2 files.');
    expect(document.getElementById(TOOL_SUCCESS_ID)).toBeNull();
    await expect(readPdfLibrary()).resolves.toHaveLength(0);

    document.removeEventListener(PDF_OUTPUT_READY_EVENT, onReady);
  });

  it('does not auto-unpack a multi-PDF zip into My PDFs during downloadFile staging', async () => {
    initDownloadedPdfLibrary();
    initShiftPdfSave();

    const zip = new JSZip();
    zip.file('Invoice (Compressed).pdf', 'small-pdf');
    zip.file('notes.txt', 'ignore me');
    const blob = await zip.generateAsync({ type: 'blob' });

    downloadFile(blob, 'compressed-pdfs.zip', 'Saved 40%.');

    expect(getLatestPdfOutput()?.filename).toBe('compressed-pdfs.zip');
    expect(getLatestPdfOutput()?.summary).toBe('Saved 40%.');
    expect(document.getElementById(TOOL_SUCCESS_ID)).toBeNull();
    await expect(readPdfLibrary()).resolves.toHaveLength(0);
  });

  it('does not prompt or write through a FileSystemFileHandle when downloadFile stages output', async () => {
    const { handle, writable } = mockHandle({});
    const original = new File(['before'], 'report.pdf', {
      type: 'application/pdf',
    });
    const saved = await addPdfToLibrary(original, 'handoff', { handle });
    setWorkspaceFiles([
      {
        id: saved.id,
        name: saved.name,
        size: saved.size,
        source: saved.source,
        blob: saved.file,
        handle,
      },
    ]);
    initDownloadedPdfLibrary();
    initShiftPdfSave();

    downloadFile(
      new Blob(['after'], { type: 'application/pdf' }),
      'report.pdf'
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('.shift-confirm-accept')).toBeNull();
    expect(document.getElementById(TOOL_SUCCESS_ID)).toBeNull();
    expect(writable.write).not.toHaveBeenCalled();

    const entries = await readPdfLibrary();
    expect(entries).toHaveLength(1);
    await expect(entries[0]?.file.text()).resolves.toBe('before');
  });

  it('keeps showResultLoader working via the shared in-card loader without creating #shift-tool-success', () => {
    document.body.innerHTML = '<div id="tool-uploader"></div>';
    showResultLoader('Processing page 1 of 3...', 33);

    expect(document.getElementById(TOOL_SUCCESS_ID)).toBeNull();
    const card = document.getElementById('tool-uploader');
    expect(card?.querySelector('.shift-loader-text')?.textContent).toBe(
      'Processing page 1 of 3...'
    );
  });
});
