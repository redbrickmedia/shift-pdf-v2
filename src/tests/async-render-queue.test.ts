import { describe, expect, it, vi } from 'vitest';
import { runAsyncRenderQueue } from '../js/utils/async-render-queue';

describe('runAsyncRenderQueue', () => {
  it('caps concurrent rendering and processes every item', async () => {
    let active = 0;
    let peak = 0;
    const rendered: number[] = [];

    await runAsyncRenderQueue(
      [1, 2, 3, 4, 5],
      async (item) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => window.setTimeout(resolve, 1));
        rendered.push(item);
        active -= 1;
      },
      { concurrency: 2, yieldBetweenTasks: async () => undefined }
    );

    expect(peak).toBe(2);
    expect(rendered.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('stops scheduling work when the render is cancelled', async () => {
    let cancelled = false;
    const render = vi.fn(async () => {
      cancelled = true;
    });

    await runAsyncRenderQueue([1, 2, 3], render, {
      concurrency: 1,
      shouldCancel: () => cancelled,
      yieldBetweenTasks: async () => undefined,
    });

    expect(render).toHaveBeenCalledOnce();
  });
});
