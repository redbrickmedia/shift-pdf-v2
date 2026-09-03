import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistedOpenFile,
  readPersistedOpenFile,
  readPersistedOpenFiles,
  writePersistedOpenFile,
  writePersistedOpenFiles,
} from '../js/logic/open-file-store';

afterEach(async () => {
  await clearPersistedOpenFile();
  vi.restoreAllMocks();
});

describe('open file persist ordering', () => {
  it('persists every selected file in selection order', async () => {
    await writePersistedOpenFiles([
      {
        file: new File(['first'], 'first.pdf', { type: 'application/pdf' }),
        source: 'upload',
      },
      {
        file: new File(['second'], 'second.pdf', {
          type: 'application/pdf',
        }),
        source: 'handoff',
      },
    ]);

    const stored = await readPersistedOpenFiles();
    expect(stored.map((entry) => entry.name)).toEqual([
      'first.pdf',
      'second.pdf',
    ]);
    expect(stored.map((entry) => entry.source)).toEqual(['upload', 'handoff']);
  });

  it('does not let a slower write overwrite a later clear', async () => {
    const slow = new File(['slow-bytes'], 'slow.pdf', {
      type: 'application/pdf',
    });
    const originalArrayBuffer = slow.arrayBuffer.bind(slow);
    vi.spyOn(slow, 'arrayBuffer').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return originalArrayBuffer();
    });

    const writePromise = writePersistedOpenFile(slow, { source: 'upload' });
    await clearPersistedOpenFile();
    await writePromise;

    await expect(readPersistedOpenFile()).resolves.toBeNull();
  });

  it('keeps the newer write when an older persist finishes last', async () => {
    const older = new File(['old'], 'old.pdf', { type: 'application/pdf' });
    const newer = new File(['new'], 'new.pdf', { type: 'application/pdf' });
    const originalArrayBuffer = older.arrayBuffer.bind(older);
    vi.spyOn(older, 'arrayBuffer').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return originalArrayBuffer();
    });

    const olderWrite = writePersistedOpenFile(older, { source: 'upload' });
    await writePersistedOpenFile(newer, { source: 'handoff' });
    await olderWrite;

    const stored = await readPersistedOpenFile();
    expect(stored?.name).toBe('new.pdf');
    expect(stored?.source).toBe('handoff');
  });
});
