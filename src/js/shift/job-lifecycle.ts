import { trackToolUsed, type ToolUsedResult } from './analytics.js';

let jobInFlight = false;
let jobReported = false;

export function markJobStarted(): void {
  jobInFlight = true;
  jobReported = false;
}

/** Clears in-flight without emitting a result (non-job loaders, tests). */
export function markJobEnded(): void {
  jobInFlight = false;
}

export function isJobInFlight(): boolean {
  return jobInFlight;
}

export function reportJobResult(result: ToolUsedResult): void {
  if (jobReported) return;
  if (result === 'error' && !jobInFlight) return;
  if (result === 'cancelled' && !jobInFlight) return;
  jobReported = true;
  jobInFlight = false;
  trackToolUsed(result);
}

export function listenForJobCancel(): void {
  window.addEventListener('pagehide', () => {
    reportJobResult('cancelled');
  });
}

export function resetJobLifecycleForTests(): void {
  jobInFlight = false;
  jobReported = false;
}
