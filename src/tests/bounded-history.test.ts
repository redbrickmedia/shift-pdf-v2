import { describe, expect, it } from 'vitest';
import { BoundedHistory } from '../js/utils/bounded-history';

describe('BoundedHistory', () => {
  const createHistory = (limit = 20) =>
    new BoundedHistory<{ values: number[] }>(
      (state) => ({ values: [...state.values] }),
      limit
    );

  it('undoes and redoes cloned snapshots', () => {
    const history = createHistory();
    const state = { values: [1] };
    history.snapshot(state);
    state.values.push(2);

    const previous = history.undo(state);
    expect(previous).toEqual({ values: [1] });
    previous?.values.push(99);
    expect(history.redo(previous!)).toEqual({ values: [1, 2] });
  });

  it('clears redo states after a new snapshot', () => {
    const history = createHistory();
    history.snapshot({ values: [1] });
    history.undo({ values: [2] });
    history.snapshot({ values: [3] });

    expect(history.status).toEqual({ canUndo: true, canRedo: false });
  });

  it('retains no more than the configured number of undo states', () => {
    const history = createHistory(3);
    for (let value = 0; value < 5; value++) {
      history.snapshot({ values: [value] });
    }

    expect(history.undo({ values: [5] })).toEqual({ values: [4] });
    expect(history.undo({ values: [4] })).toEqual({ values: [3] });
    expect(history.undo({ values: [3] })).toEqual({ values: [2] });
    expect(history.undo({ values: [2] })).toBeNull();
  });

  it('clears both stacks', () => {
    const history = createHistory();
    history.snapshot({ values: [1] });
    history.undo({ values: [2] });
    history.clear();

    expect(history.status).toEqual({ canUndo: false, canRedo: false });
  });

  it('restores an exact merge-style canonical state with stable IDs', () => {
    type MergeState = {
      files: Array<{ id: string; range: string }>;
      pageOrder: Array<{ fileId: string; pageIndex: number }>;
      mode: 'file' | 'page';
    };
    const clone = (state: MergeState): MergeState => ({
      files: state.files.map((file) => ({ ...file })),
      pageOrder: state.pageOrder.map((page) => ({ ...page })),
      mode: state.mode,
    });
    const mergeHistory = new BoundedHistory(clone, 20);
    const before: MergeState = {
      files: [
        { id: 'stable-a', range: '1-2' },
        { id: 'stable-b', range: '' },
      ],
      pageOrder: [
        { fileId: 'stable-a', pageIndex: 0 },
        { fileId: 'stable-b', pageIndex: 0 },
      ],
      mode: 'file',
    };
    const after: MergeState = {
      files: [before.files[1], before.files[0]],
      pageOrder: [...before.pageOrder].reverse(),
      mode: 'page',
    };

    mergeHistory.snapshot(before);
    const restored = mergeHistory.undo(after);
    expect(restored).toEqual(before);
    expect(mergeHistory.redo(restored!)).toEqual(after);
  });
});
