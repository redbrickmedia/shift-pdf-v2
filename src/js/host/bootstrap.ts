import { trackPdfEngineExperience } from './analytics.js';
import { listenForJobCancel } from './job-lifecycle.js';
import { startThemeSync } from './theme.js';

let bootstrapped = false;

export function bootstrapHostIntegration(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  startThemeSync();
  trackPdfEngineExperience();
  listenForJobCancel();
}

export function resetBootstrapForTests(): void {
  bootstrapped = false;
}
