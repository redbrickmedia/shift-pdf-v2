import { getHostAnalytics } from './bridge.js';

export const PDF_ENGINE_EVENTS = {
  experienceStarted: 'PdfEngine_ExperienceStarted',
  toolUsed: 'PdfEngine_ToolUsed',
} as const;

export type ToolResult = 'success' | 'error' | 'cancelled';

export const EXPERIENCE_SENT_STORAGE_KEY =
  'pdf-engine:analytics:experience-sent';

const PROCESS_BUTTON_SELECTOR = '#process-btn, #crop-button';

export function getToolIdFromPath(pathname = window.location.pathname): string {
  const segment = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const id = segment.replace(/\.html$/, '');
  if (!id || id === 'index') return 'home';
  return id;
}

/** Forward an event to the host `track` method. No-ops when no host is configured. */
export function track(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  try {
    getHostAnalytics()?.track(eventName, properties);
  } catch {
    // Host analytics must never block PDF work.
  }
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Analytics must never block a PDF operation.
  }
}

export function trackExperienceStarted(): void {
  if (storageGet(EXPERIENCE_SENT_STORAGE_KEY) === 'true') return;
  track(PDF_ENGINE_EVENTS.experienceStarted, {
    tool_id: getToolIdFromPath(),
  });
  storageSet(EXPERIENCE_SENT_STORAGE_KEY, 'true');
}

let inFlight = false;
let reported = false;
let processClickActive = false;
let listening = false;

export function beginToolUse(): void {
  inFlight = true;
  reported = false;
}

/** Drop an armed job without emitting (validation returns during a process click). */
export function abandonToolUse(): void {
  if (reported) return;
  inFlight = false;
}

export function endToolUse(result: ToolResult): void {
  if (reported) return;
  if (result !== 'success' && !inFlight) return;
  reported = true;
  inFlight = false;
  track(PDF_ENGINE_EVENTS.toolUsed, {
    tool_id: getToolIdFromPath(),
    result,
  });
}

export function noteProcessAlert(): void {
  if (processClickActive) abandonToolUse();
}

export function listenForToolJobs(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(PROCESS_BUTTON_SELECTOR)) return;
      processClickActive = true;
      beginToolUse();
    },
    true
  );
  document.addEventListener(
    'click',
    () => {
      processClickActive = false;
    },
    false
  );
  window.addEventListener('pagehide', () => {
    endToolUse('cancelled');
  });
}

export function resetToolUseForTests(): void {
  inFlight = false;
  reported = false;
  processClickActive = false;
}
