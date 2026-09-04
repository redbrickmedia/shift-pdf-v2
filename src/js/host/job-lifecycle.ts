import {
  getToolIdFromPath,
  pdfEngineAnalytics,
  type ToolOperation,
  type ToolOperationResult,
  type ToolResult,
} from './analytics.js';

/** Everything a terminal event carries apart from the result itself. */
export type JobDetails = Omit<ToolOperationResult, 'result'>;

let operation: ToolOperation | null = null;
let details: JobDetails = {};
let jobInFlight = false;
let jobReported = false;

export function markJobStarted(toolId: string = getToolIdFromPath()): void {
  jobInFlight = true;
  jobReported = false;
  details = {};
  operation = pdfEngineAnalytics?.startToolOperation(toolId) ?? null;
}

/** Clears in-flight without emitting a result (non-job loaders, tests). */
export function markJobEnded(): void {
  jobInFlight = false;
}

export function isJobInFlight(): boolean {
  return jobInFlight;
}

/**
 * Records counts or an error category for the job already running, so the
 * terminal event carries them even when it is emitted from shared UI code.
 */
export function setJobDetails(next: JobDetails): void {
  details = { ...details, ...next };
}

export function reportJobResult(
  result: ToolResult,
  next: JobDetails = {}
): void {
  if (jobReported) return;
  if (result !== 'success' && !jobInFlight) return;
  jobReported = true;
  jobInFlight = false;

  const active =
    operation ??
    pdfEngineAnalytics?.startToolOperation(getToolIdFromPath()) ??
    null;
  const payload = { ...details, ...next, result };
  operation = null;
  details = {};
  active?.finish(payload);
}

export function listenForJobCancel(): void {
  window.addEventListener('pagehide', () => {
    reportJobResult('cancelled');
  });
}

export function resetJobLifecycleForTests(): void {
  operation = null;
  details = {};
  jobInFlight = false;
  jobReported = false;
}
