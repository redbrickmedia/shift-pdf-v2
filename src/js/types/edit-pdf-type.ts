export interface DocManagerPlugin {
  onDocumentClosed: (
    callback: (data: { id?: string } | string) => void
  ) => void;
  onDocumentOpened: (
    callback: (data: { id?: string; name?: string }) => void
  ) => void;
  openDocumentBuffer: (opts: {
    buffer: ArrayBuffer;
    name?: string;
    autoActivate?: boolean;
  }) => void;
  closeDocument: (id: string) => void;
  saveAsCopy: (id: string) => Promise<Uint8Array>;
}

export interface HistoryPlugin {
  undo: (topic?: string) => void;
  redo: (topic?: string) => void;
  canUndo: (topic?: string) => boolean;
  canRedo: (topic?: string) => boolean;
  getHistoryState: () => {
    global: { canUndo: boolean; canRedo: boolean };
  };
  onHistoryChange: (callback: (event: unknown) => void) => () => void;
}

export interface PrintPlugin {
  print: (options?: unknown) => EmbedPdfTask | void;
}

export interface EmbedPdfTask {
  wait?: (
    resolve: (value: unknown) => void,
    reject: (error: unknown) => void
  ) => void;
}

export interface EmbedPdfPluginRegistry {
  getPlugin: (id: string) => { provides: () => unknown };
}
