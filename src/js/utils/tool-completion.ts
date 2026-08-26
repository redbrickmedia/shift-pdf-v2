export interface ToolCompletionTiming {
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

export interface ToolCompletionResult {
  blob: Blob;
  filename: string;
  summary: string;
  timing: ToolCompletionTiming;
}

export interface ToolCompletionSnapshot extends ToolCompletionResult {
  objectUrl: string;
}

interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export class ToolCompletionStore {
  private snapshot: ToolCompletionSnapshot | null = null;

  constructor(private readonly objectUrlApi: ObjectUrlApi = URL) {}

  set(result: ToolCompletionResult): ToolCompletionSnapshot {
    this.clear();
    const objectUrl = this.objectUrlApi.createObjectURL(result.blob);
    this.snapshot = { ...result, objectUrl };
    return this.snapshot;
  }

  get(): ToolCompletionSnapshot | null {
    return this.snapshot;
  }

  clear(): void {
    if (this.snapshot) {
      this.objectUrlApi.revokeObjectURL(this.snapshot.objectUrl);
      this.snapshot = null;
    }
  }

  teardown(): void {
    this.clear();
  }
}

export interface ToolCompletionPanelOptions {
  panel: HTMLElement;
  summary: HTMLElement;
  timing: HTMLElement;
  downloadButton: HTMLAnchorElement;
  startOverButton: HTMLButtonElement;
  onStartOver: () => void | Promise<void>;
  onDownloadAgain?: () => void;
}

export interface ToolCompletionPanel {
  show(result: ToolCompletionResult): ToolCompletionSnapshot;
  clear(): void;
  teardown(): void;
  getResult(): ToolCompletionSnapshot | null;
}

export function createDefaultToolCompletionPanel(
  onStartOver: () => void | Promise<void>,
  onDownloadAgain?: () => void
): ToolCompletionPanel {
  const panel = document.getElementById('completion-panel');
  const summary = document.getElementById('completion-summary');
  const timing = document.getElementById('completion-timing');
  const downloadButton = document.getElementById('completion-download');
  const startOverButton = document.getElementById('completion-start-over');
  if (
    !panel ||
    !summary ||
    !timing ||
    !(downloadButton instanceof HTMLAnchorElement) ||
    !(startOverButton instanceof HTMLButtonElement)
  ) {
    throw new Error('Tool completion panel is incomplete');
  }
  return createToolCompletionPanel({
    panel,
    summary,
    timing,
    downloadButton,
    startOverButton,
    onStartOver,
    onDownloadAgain,
  });
}

export function createToolCompletionPanel(
  options: ToolCompletionPanelOptions,
  store = new ToolCompletionStore()
): ToolCompletionPanel {
  const handleDownload = () => options.onDownloadAgain?.();
  const handleStartOver = async () => {
    store.clear();
    options.panel.classList.add('hidden');
    await options.onStartOver();
  };
  const handlePageHide = () => store.teardown();

  options.downloadButton.addEventListener('click', handleDownload);
  options.startOverButton.addEventListener('click', handleStartOver);
  window.addEventListener('pagehide', handlePageHide);

  return {
    show(result) {
      const snapshot = store.set(result);
      options.summary.textContent = result.summary;
      options.timing.textContent = `${(result.timing.durationMs / 1000).toFixed(1)}s`;
      options.downloadButton.href = snapshot.objectUrl;
      options.downloadButton.download = result.filename;
      options.panel.classList.remove('hidden');
      return snapshot;
    },
    clear() {
      store.clear();
      options.panel.classList.add('hidden');
      options.downloadButton.removeAttribute('href');
      options.downloadButton.removeAttribute('download');
    },
    teardown() {
      store.teardown();
      options.downloadButton.removeEventListener('click', handleDownload);
      options.startOverButton.removeEventListener('click', handleStartOver);
      window.removeEventListener('pagehide', handlePageHide);
    },
    getResult() {
      return store.get();
    },
  };
}

export function completionTiming(
  startedAt: number,
  completedAt = performance.now()
) {
  return {
    startedAt,
    completedAt,
    durationMs: Math.max(0, Math.round(completedAt - startedAt)),
  };
}
