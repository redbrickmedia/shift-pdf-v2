function isBlobLike(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).size === 'number' &&
    typeof (value as Blob).arrayBuffer === 'function'
  );
}

function tryCaptureAnchor(
  anchor: HTMLAnchorElement,
  blobs: Map<string, Blob>
): { blob: Blob; filename: string } | null {
  if (!anchor.download || !anchor.href) return null;
  const blob = blobs.get(anchor.href);
  if (!blob) return null;
  return { blob, filename: anchor.download };
}

function wrapAnchor(
  anchor: HTMLAnchorElement,
  blobs: Map<string, Blob>,
  onCapture: (next: { blob: Blob; filename: string }) => void
): void {
  const origDispatch = anchor.dispatchEvent.bind(anchor);
  const origClick = anchor.click.bind(anchor);
  const capture = () => {
    const next = tryCaptureAnchor(anchor, blobs);
    if (next) onCapture(next);
    return Boolean(next);
  };
  anchor.dispatchEvent = (event: Event) => {
    if (event.type === 'click' && capture()) return true;
    return origDispatch(event);
  };
  anchor.click = () => {
    if (!capture()) origClick();
  };
}

/**
 * Intercept the next FileSaver / `<a download>` write inside a same-origin
 * iframe so tool apply handlers can publish the blob instead of downloading.
 */
export async function captureIframeFileSave(
  iframe: HTMLIFrameElement,
  startSave: () => void | Promise<void>,
  timeoutMs = 15_000
): Promise<{ blob: Blob; filename: string }> {
  const win = iframe.contentWindow as (Window & typeof globalThis) | null;
  const doc = iframe.contentDocument;
  if (!win || !doc) {
    throw new Error('The viewer is not same-origin.');
  }

  const blobs = new Map<string, Blob>();
  let captured: { blob: Blob; filename: string } | null = null;
  const origCreateObjectURL = win.URL.createObjectURL.bind(win.URL);
  const origCreateElement = doc.createElement.bind(doc);

  win.URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = origCreateObjectURL(obj);
    if (isBlobLike(obj)) blobs.set(url, obj);
    return url;
  };
  doc.createElement = ((
    tagName: string,
    options?: ElementCreationOptions
  ) => {
    const element = origCreateElement(tagName, options);
    if (String(tagName).toLowerCase() === 'a') {
      wrapAnchor(element as HTMLAnchorElement, blobs, (next) => {
        captured = next;
      });
    }
    return element;
  }) as typeof doc.createElement;

  try {
    await startSave();
    const started = Date.now();
    while (!captured && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    if (!captured) {
      throw new Error('The viewer did not produce a downloadable PDF.');
    }
    return captured;
  } finally {
    win.URL.createObjectURL = origCreateObjectURL;
    doc.createElement = origCreateElement;
  }
}
