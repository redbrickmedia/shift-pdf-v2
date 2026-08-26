import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fileFromShiftReadResult,
  getHandoffSourceTabId,
  getSourceTabIdFromLocation,
  isShiftFilesBridgeReady,
  readOpenShiftFile,
  sanitizeIncomingPdfFilename,
} from '../js/embedder/shift-file-access';
import { rememberSourceTabId } from '../js/logic/open-file-store';
import {
  resetWorkspaceFileIndicator,
  setWorkspaceFiles,
} from '../js/logic/workspace-files';

afterEach(() => {
  resetWorkspaceFileIndicator();
  Reflect.deleteProperty(window, 'shift');
  document.documentElement.removeAttribute('data-shift-files');
});

describe('shift-file-access', () => {
  it('reads the source tab id from the query string', () => {
    expect(getSourceTabIdFromLocation('?sourceTab=12')).toBe(12);
    expect(getSourceTabIdFromLocation('?action=merge')).toBeUndefined();
    expect(getSourceTabIdFromLocation('?sourceTab=nope')).toBeUndefined();
  });

  it('uses a remembered source tab when the query string is gone', () => {
    rememberSourceTabId(12);
    expect(getHandoffSourceTabId('')).toBe(12);
    expect(getHandoffSourceTabId('?sourceTab=4')).toBe(4);
  });

  it('sanitizes incoming filenames', () => {
    expect(sanitizeIncomingPdfFilename('C:\\tmp\\q*uote.pdf')).toBe(
      'q-uote.pdf'
    );
    expect(sanitizeIncomingPdfFilename('')).toBe('document.pdf');
  });

  it('turns a Shift payload into a File', () => {
    const file = fileFromShiftReadResult({
      bytesBase64: btoa('hello-pdf'),
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    });

    expect(file.name).toBe('report.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe('hello-pdf'.length);
  });

  it('rejects empty payloads', () => {
    expect(() =>
      fileFromShiftReadResult({
        bytesBase64: '',
        filename: 'empty.pdf',
        mimeType: 'application/pdf',
      })
    ).toThrow('This PDF is empty or could not be read.');
  });

  it('marks files loaded from Shift as coming from the viewer tab', async () => {
    Object.assign(window, {
      shift: {
        files: {
          read: vi.fn().mockResolvedValue({
            bytesBase64: btoa('hello-pdf'),
            filename: 'report.pdf',
            mimeType: 'application/pdf',
          }),
        },
      },
    });

    const file = await readOpenShiftFile();
    expect(file).not.toBeNull();

    document.body.innerHTML = `
      <section id="shift-open-files" hidden>
        <h2 id="shift-open-files-heading">Open file</h2>
        <div id="shift-open-files-list"></div>
      </section>
    `;
    setWorkspaceFiles([file as File]);

    expect(
      document
        .querySelector('.shift-open-file-item')
        ?.getAttribute('data-source')
    ).toBe('extension');
  });

  it('retries a grant miss then returns the file', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('This PDF app tab does not have access to an open file.')
      )
      .mockResolvedValueOnce({
        bytesBase64: btoa('hello-pdf'),
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      });
    Object.assign(window, {
      shift: { files: { read } },
    });

    const file = await readOpenShiftFile();

    expect(file?.name).toBe('report.pdf');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('treats the isolated-world marker as a ready bridge', () => {
    expect(isShiftFilesBridgeReady()).toBe(false);
    document.documentElement.setAttribute('data-shift-files', 'ready');
    expect(isShiftFilesBridgeReady()).toBe(true);
  });

  it('reads via custom events when window.shift.files is missing', async () => {
    document.documentElement.setAttribute('data-shift-files', 'ready');
    const onRead = (event: Event) => {
      const requestId = (event as CustomEvent<{ requestId?: string }>).detail
        ?.requestId;
      window.dispatchEvent(
        new CustomEvent('shift-files:result', {
          detail: {
            requestId,
            bytesBase64: btoa('hello-pdf'),
            filename: 'report.pdf',
            mimeType: 'application/pdf',
          },
        })
      );
    };
    window.addEventListener('shift-files:read', onRead);

    try {
      const file = await readOpenShiftFile();
      expect(file?.name).toBe('report.pdf');
    } finally {
      window.removeEventListener('shift-files:read', onRead);
    }
  });
});
