import { configureToolkit } from '@redbrickmedia/shift-browser-toolkit';
import { trackExperienceStarted } from './analytics.js';
import { listenForJobCancel } from './job-lifecycle.js';
import { startThemeSync } from './theme.js';

let bootstrapped = false;

export function bootstrapShiftToolkit(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  try {
    configureToolkit({
      buildMode: import.meta.env.MODE,
      name: 'shift-pdf-v2',
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    });
  } catch (error) {
    const alreadyConfigured =
      error instanceof Error &&
      error.message.includes('already been configured');
    if (!alreadyConfigured) {
      startThemeSync();
      listenForJobCancel();
      return;
    }
  }

  startThemeSync();
  trackExperienceStarted();
  listenForJobCancel();
}

export function resetBootstrapForTests(): void {
  bootstrapped = false;
}
