import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPdfLibrary, readPdfLibrary } from '../logic/pdf-library-store';
import { listenForShiftFileHandoff } from './shift-file-handoff';

const SHIFT_ORIGIN = 'chrome-extension://mofjdkplmlofiadhjjcacadmghmaglna';
const HANDOFF_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function dispatchMessage({
  data,
  origin = SHIFT_ORIGIN,
  source,
}: {
  data: unknown;
  origin?: string;
  source?: { postMessage: ReturnType<typeof vi.fn> };
}) {
  const event = new MessageEvent('message', {
    data,
    origin,
    source: (source ?? window) as Window,
  });
  window.dispatchEvent(event);
}

describe('listenForShiftFileHandoff', () => {
  const originalSearch = window.location.search;

  afterEach(async () => {
    window.history.replaceState({}, '', `/${originalSearch}`);
    await clearPdfLibrary();
    vi.restoreAllMocks();
  });

  it('no-ops when shiftHandoff is missing', () => {
    window.history.replaceState({}, '', '/compress-pdf.html');
    const onFile = vi.fn();
    const addEventListener = vi.spyOn(window, 'addEventListener');

    listenForShiftFileHandoff({ onFile });

    expect(addEventListener).not.toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    );
    dispatchMessage({
      data: {
        channel: 'shift-file-handoff-offer',
        handoffId: HANDOFF_ID,
        version: 1,
      },
    });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('replies ready to a valid offer and accepts a PDF payload', async () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn().mockResolvedValue(undefined);
    const source = {
      postMessage: vi.fn(),
    };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        channel: 'shift-file-handoff-offer',
        handoffId: HANDOFF_ID,
        metadata: { action: 'merge' },
        version: 1,
      },
      source,
    });

    expect(source.postMessage).toHaveBeenCalledWith(
      {
        channel: 'shift-file-handoff-ready',
        handoffId: HANDOFF_ID,
        version: 1,
      },
      SHIFT_ORIGIN
    );

    const bytes = new Uint8Array([37, 80, 68, 70]).buffer;
    dispatchMessage({
      data: {
        bytes,
        channel: 'shift-file-handoff-payload',
        filename: 'Report.pdf',
        handoffId: HANDOFF_ID,
        mimeType: 'application/pdf',
        version: 1,
      },
      source,
    });

    await vi.waitFor(() => expect(onFile).toHaveBeenCalledOnce());
    const file = onFile.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('Report.pdf');
    expect(file.type).toBe('application/pdf');
    await vi.waitFor(async () => {
      await expect(readPdfLibrary()).resolves.toEqual([
        expect.objectContaining({
          name: 'Report.pdf',
          source: 'handoff',
        }),
      ]);
    });
    expect(source.postMessage).toHaveBeenLastCalledWith(
      {
        channel: 'shift-file-handoff-accepted',
        handoffId: HANDOFF_ID,
        version: 1,
      },
      SHIFT_ORIGIN
    );
  });

  it('rejects the handoff when onFile returns false', async () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn().mockResolvedValue(false);
    const source = { postMessage: vi.fn() };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        bytes: new Uint8Array([37, 80, 68, 70]).buffer,
        channel: 'shift-file-handoff-payload',
        filename: 'Report.pdf',
        handoffId: HANDOFF_ID,
        mimeType: 'application/pdf',
        version: 1,
      },
      source,
    });

    await vi.waitFor(() =>
      expect(source.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'shift-file-handoff-rejected',
          message: 'Shift could not load this file.',
        }),
        SHIFT_ORIGIN
      )
    );
  });

  it('rejects the handoff when onFile throws', async () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn().mockRejectedValue(new Error('PDF failed to parse.'));
    const source = { postMessage: vi.fn() };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        bytes: new Uint8Array([37, 80, 68, 70]).buffer,
        channel: 'shift-file-handoff-payload',
        filename: 'Report.pdf',
        handoffId: HANDOFF_ID,
        mimeType: 'application/pdf',
        version: 1,
      },
      source,
    });

    await vi.waitFor(() =>
      expect(source.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'shift-file-handoff-rejected',
          message: 'PDF failed to parse.',
        }),
        SHIFT_ORIGIN
      )
    );
  });

  it('ignores foreign-origin offers', () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn();
    const source = { postMessage: vi.fn() };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        channel: 'shift-file-handoff-offer',
        handoffId: HANDOFF_ID,
        version: 1,
      },
      origin: 'https://example.com',
      source,
    });

    expect(source.postMessage).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized payloads', async () => {
    window.history.replaceState(
      {},
      '',
      `/compress-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn();
    const source = { postMessage: vi.fn() };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        bytes: new ArrayBuffer(0),
        channel: 'shift-file-handoff-payload',
        filename: 'empty.pdf',
        handoffId: HANDOFF_ID,
        mimeType: 'application/pdf',
        version: 1,
      },
      source,
    });

    await vi.waitFor(() =>
      expect(source.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'shift-file-handoff-rejected',
          message: 'The file is empty.',
        }),
        SHIFT_ORIGIN
      )
    );
    expect(onFile).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload', async () => {
    window.history.replaceState(
      {},
      '',
      `/compress-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const onFile = vi.fn();
    const source = { postMessage: vi.fn() };

    listenForShiftFileHandoff({ onFile });
    dispatchMessage({
      data: {
        bytes: new ArrayBuffer(16 * 1024 * 1024 + 1),
        channel: 'shift-file-handoff-payload',
        filename: 'huge.pdf',
        handoffId: HANDOFF_ID,
        mimeType: 'application/pdf',
        version: 1,
      },
      source,
    });

    await vi.waitFor(() =>
      expect(source.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'shift-file-handoff-rejected',
          message: 'This file is larger than the 16 MB handoff limit.',
        }),
        SHIFT_ORIGIN
      )
    );
    expect(onFile).not.toHaveBeenCalled();
  });
});
