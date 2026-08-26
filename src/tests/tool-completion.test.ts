import { describe, expect, it, vi } from 'vitest';
import {
  createToolCompletionPanel,
  ToolCompletionStore,
} from '../js/utils/tool-completion';

function result(blob: Blob, filename: string) {
  return {
    blob,
    filename,
    summary: 'The output is ready.',
    timing: { startedAt: 10, completedAt: 35, durationMs: 25 },
  };
}

describe('ToolCompletionStore', () => {
  it('retains the output details until it is explicitly cleared', () => {
    const createObjectURL = vi.fn(() => 'blob:output');
    const revokeObjectURL = vi.fn();
    const store = new ToolCompletionStore({
      createObjectURL,
      revokeObjectURL,
    });
    const blob = new Blob(['pdf'], { type: 'application/pdf' });

    expect(store.set(result(blob, 'output.pdf'))).toMatchObject({
      blob,
      filename: 'output.pdf',
      summary: 'The output is ready.',
      timing: { durationMs: 25 },
      objectUrl: 'blob:output',
    });
    expect(store.get()?.blob).toBe(blob);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    store.clear();
    expect(store.get()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:output');
  });

  it('revokes object URLs on replacement and teardown', () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revokeObjectURL = vi.fn();
    const store = new ToolCompletionStore({
      createObjectURL,
      revokeObjectURL,
    });

    store.set(result(new Blob(['first']), 'first.pdf'));
    store.set(result(new Blob(['second']), 'second.pdf'));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:first');

    store.teardown();
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:second');
    expect(store.get()).toBeNull();
  });
});

describe('ToolCompletionPanel', () => {
  it('keeps Download again available until Start over', async () => {
    const panel = document.createElement('section');
    panel.classList.add('hidden');
    const summary = document.createElement('p');
    const timing = document.createElement('p');
    const downloadButton = document.createElement('a');
    const startOverButton = document.createElement('button');
    const onDownloadAgain = vi.fn();
    const onStartOver = vi.fn();
    const revokeObjectURL = vi.fn();
    const completion = createToolCompletionPanel(
      {
        panel,
        summary,
        timing,
        downloadButton,
        startOverButton,
        onDownloadAgain,
        onStartOver,
      },
      new ToolCompletionStore({
        createObjectURL: () => 'blob:retained-output',
        revokeObjectURL,
      })
    );

    completion.show(result(new Blob(['pdf']), 'ready.pdf'));
    downloadButton.click();

    expect(onDownloadAgain).toHaveBeenCalledOnce();
    expect(completion.getResult()?.objectUrl).toBe('blob:retained-output');
    expect(panel.classList.contains('hidden')).toBe(false);

    startOverButton.click();
    await vi.waitFor(() => expect(onStartOver).toHaveBeenCalledOnce());
    expect(completion.getResult()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:retained-output');
    expect(panel.classList.contains('hidden')).toBe(true);
  });
});
