const FILE_HANDOFF_VERSION = 1;
const FILE_HANDOFF_MAX_BYTES = 16 * 1024 * 1024;
const HANDOFF_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHANNELS = {
  accepted: 'shift-file-handoff-accepted',
  offer: 'shift-file-handoff-offer',
  payload: 'shift-file-handoff-payload',
  ready: 'shift-file-handoff-ready',
  rejected: 'shift-file-handoff-rejected',
} as const;

export type ShiftFileHandoffListener = {
  onFile: (file: File) => boolean | void | Promise<boolean | void>;
};

function readHandoffId(): string | null {
  const handoffId = new URLSearchParams(window.location.search).get(
    'shiftHandoff'
  );
  return handoffId && HANDOFF_ID_PATTERN.test(handoffId) ? handoffId : null;
}

function isShiftWebUiOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

type HandoffMessageSource = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

function reply(
  source: HandoffMessageSource | null,
  origin: string,
  message: Record<string, unknown>
): void {
  if (!source || typeof source.postMessage !== 'function') return;
  source.postMessage(message, origin);
}

function sanitizeFilename(filename: string): string {
  const leaf = filename.replaceAll('\\', '/').split('/').pop()?.trim() ?? '';
  const sanitized = [...leaf]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || '\\/:*?"<>|'.includes(char) ? '-' : char;
    })
    .join('')
    .trim();
  return sanitized || 'document';
}

function buildFile(data: Record<string, unknown>): File {
  const bytes = data.bytes;
  if (!(bytes instanceof ArrayBuffer)) {
    throw new Error('The file payload is missing.');
  }
  if (bytes.byteLength === 0) {
    throw new Error('The file is empty.');
  }
  if (bytes.byteLength > FILE_HANDOFF_MAX_BYTES) {
    throw new Error('This file is larger than the 16 MB handoff limit.');
  }
  const mimeType =
    typeof data.mimeType === 'string' ? data.mimeType : 'application/pdf';
  if (mimeType !== 'application/pdf') {
    throw new Error('Only PDF files can be handed off.');
  }
  const filename =
    typeof data.filename === 'string'
      ? sanitizeFilename(data.filename)
      : 'document.pdf';
  return new File([bytes], filename, { type: mimeType });
}

/**
 * Listens for a Shift transferable file handoff. No `shiftHandoff` query param
 * means standalone use: this is a no-op.
 */
export function listenForShiftFileHandoff(
  options: ShiftFileHandoffListener
): void {
  const handoffId = readHandoffId();
  if (!handoffId) return;

  let receivedPayload = false;

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (!isShiftWebUiOrigin(event.origin)) return;
    if (!event.data || typeof event.data !== 'object') return;

    const data = event.data as Record<string, unknown>;
    if (data.version !== FILE_HANDOFF_VERSION || data.handoffId !== handoffId) {
      return;
    }

    if (data.channel === CHANNELS.offer) {
      reply(event.source as HandoffMessageSource | null, event.origin, {
        channel: CHANNELS.ready,
        handoffId,
        version: FILE_HANDOFF_VERSION,
      });
      return;
    }

    if (data.channel !== CHANNELS.payload || receivedPayload) return;
    receivedPayload = true;

    void (async () => {
      try {
        const file = buildFile(data);
        const loaded = await options.onFile(file);
        if (loaded === false) {
          throw new Error('Shift could not load this file.');
        }
        reply(event.source as HandoffMessageSource | null, event.origin, {
          channel: CHANNELS.accepted,
          handoffId,
          version: FILE_HANDOFF_VERSION,
        });
      } catch (error) {
        reply(event.source as HandoffMessageSource | null, event.origin, {
          channel: CHANNELS.rejected,
          handoffId,
          message:
            error instanceof Error
              ? error.message
              : 'Shift could not load this file.',
          version: FILE_HANDOFF_VERSION,
        });
      }
    })();
  });
}
