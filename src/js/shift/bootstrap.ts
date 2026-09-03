import { trackExperienceStarted } from './analytics.js';
import { listenForJobCancel } from './job-lifecycle.js';
import { startThemeSync } from './theme.js';

let bootstrapped = false;

export function bootstrapShiftHost(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  startThemeSync();
  trackExperienceStarted();
  listenForJobCancel();
}

export function resetBootstrapForTests(): void {
  bootstrapped = false;
}
