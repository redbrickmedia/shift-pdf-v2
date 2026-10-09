import { describe, expect, it, vi } from 'vitest';
import {
  renamePdfHandle,
  sanitizeLibraryFilename,
  writePdfThroughHandle,
} from '../js/logic/pdf-file-handle';

describe('pdf file handle helpers', () => {
  it('keeps a pdf extension on renamed files', () => {
    expect(sanitizeLibraryFilename('Invoice:2024')).toBe('Invoice-2024.pdf');
    expect(sanitizeLibraryFilename('report.pdf')).toBe('report.pdf');
  });

  it('writes bytes after permission is granted', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue(writable),
    } as unknown as FileSystemFileHandle;

    await writePdfThroughHandle(
      handle,
      new Blob(['pdf'], { type: 'application/pdf' })
    );

    expect(writable.write).toHaveBeenCalledOnce();
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it('renames through the file handle move API', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      move: vi.fn().mockResolvedValue(undefined),
    } as unknown as FileSystemFileHandle;

    await expect(renamePdfHandle(handle, 'Quarterly')).resolves.toBe(
      'Quarterly.pdf'
    );
    expect(
      (handle as FileSystemFileHandle & { move: ReturnType<typeof vi.fn> }).move
    ).toHaveBeenCalledWith('Quarterly.pdf');
  });
});
