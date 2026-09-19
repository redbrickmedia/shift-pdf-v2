export interface AsyncRenderQueueOptions {
  concurrency?: number;
  shouldCancel?: () => boolean;
  yieldBetweenTasks?: () => Promise<void>;
}

export async function runAsyncRenderQueue<T>(
  items: readonly T[],
  render: (item: T, index: number) => Promise<void>,
  options: AsyncRenderQueueOptions = {}
): Promise<void> {
  const concurrency = Math.max(
    1,
    Math.min(items.length || 1, options.concurrency ?? 2)
  );
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length && !options.shouldCancel?.()) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      await render(item, index);
      if (options.shouldCancel?.()) return;
      await (options.yieldBetweenTasks?.() ?? yieldToMainThread());
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

export function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 50 });
      return;
    }
    globalThis.setTimeout(resolve, 0);
  });
}
