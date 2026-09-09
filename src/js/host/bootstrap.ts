import { listenForToolJobs, trackExperienceStarted } from './analytics.js';
import { startThemeSync } from './theme.js';

let bootstrapped = false;

export function bootstrapHostIntegration(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  startThemeSync();
  trackExperienceStarted();
  listenForToolJobs();
}

export function resetBootstrapForTests(): void {
  bootstrapped = false;
}
