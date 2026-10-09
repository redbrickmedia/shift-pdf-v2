import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHostAnalytics, INTEGRATED_APP_ORIGIN } from '../js/host/bridge';
import {
  bootstrapHostIntegration,
  resetBootstrapForTests,
} from '../js/host/bootstrap';
import {
  APP_VERSION,
  beginToolUse,
  endToolUse,
  EXPERIENCE_SENT_STORAGE_KEY,
  getToolIdFromPath,
  listenForToolJobs,
  PDF_ENGINE_EVENTS,
  resetToolUseForTests,
  SCHEMA_VERSION,
  track,
  trackExperienceStarted,
} from '../js/host/analytics';

function withSchema(
  properties: Record<string, unknown> = {},
  eventType: 'state-change' | 'user-interaction' = 'state-change'
): Record<string, unknown> {
  return {
    app_version: APP_VERSION,
    event_type: eventType,
    schema_version: SCHEMA_VERSION,
    tool_id: 'merge-pdf',
    ...properties,
  };
}
import {
  applyColorMode,
  applyDataTheme,
  startThemeSync,
} from '../js/host/theme';
import { downloadFile } from '../js/utils/helpers';
import { dom, showAlert } from '../js/ui';

function installHost(options: { track?: ReturnType<typeof vi.fn> } = {}) {
  vi.stubEnv('VITE_HOST_API_ROOT', 'testHost.api');
  const trackFn = options.track ?? vi.fn();
  vi.stubGlobal('testHost', { api: { analytics: { track: trackFn } } });
  return { track: trackFn };
}

function uninstallHost() {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'testHost');
}

function stubPrefersDark(matches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('dark') ? matches : false,
      media: query,
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void
      ) => listeners.push(listener),
      removeEventListener: (): void => undefined,
    }))
  );

  return {
    emit(next: boolean) {
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

describe('host bootstrap', () => {
  beforeEach(() => {
    resetBootstrapForTests();
    resetToolUseForTests();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    uninstallHost();
  });

  afterEach(uninstallHost);

  it('bootstraps once when the generic host is present', () => {
    const { track: trackFn } = installHost();
    bootstrapHostIntegration();
    bootstrapHostIntegration();

    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.experienceStarted,
      withSchema()
    );
  });

  it('does not throw when the host is absent', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    expect(() => bootstrapHostIntegration()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('resolves chrome.shift on the production origin when the env root is empty', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    const trackFn = vi.fn();
    vi.stubGlobal('location', { origin: INTEGRATED_APP_ORIGIN });
    vi.stubGlobal('chrome', { shift: { analytics: { track: trackFn } } });

    getHostAnalytics()?.track('PdfEngine_ExperienceStarted', {});

    expect(trackFn).toHaveBeenCalledTimes(1);
  });

  it('stays dark on pages.dev when the env root is empty', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    const trackFn = vi.fn();
    vi.stubGlobal('location', {
      origin: 'https://shift-pdf-neo.pages.dev',
    });
    vi.stubGlobal('chrome', { shift: { analytics: { track: trackFn } } });

    expect(getHostAnalytics()).toBeUndefined();
    expect(trackFn).not.toHaveBeenCalled();
  });

  it('keeps the production origin in the first-paint boot script', () => {
    const boot = readFileSync(
      resolve(process.cwd(), 'public/sidebar-boot.js'),
      'utf8'
    );
    expect(boot).toContain(INTEGRATED_APP_ORIGIN);
  });
});

describe('host theme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    uninstallHost();
  });

  afterEach(uninstallHost);

  it('applies light and dark classes plus data-theme', () => {
    applyColorMode('light');
    applyDataTheme('default');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applyColorMode('dark');
    applyDataTheme('custom');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('follows prefers-color-scheme when a host is configured', () => {
    const media = stubPrefersDark(false);
    installHost();
    startThemeSync();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    media.emit(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('retains the default when the host root is unset', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    const media = stubPrefersDark(false);
    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    media.emit(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('host analytics', () => {
  let trackFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetToolUseForTests();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    uninstallHost();
    trackFn = installHost().track;
    document.body.innerHTML = `
      <button id="process-btn">Process</button>
      <div id="alert-modal" class="hidden"><div><h3 id="alert-title"></h3><p id="alert-message"></p><button id="alert-ok"></button></div></div>
    `;
    Object.assign(dom, {
      alertModal: document.getElementById('alert-modal'),
      alertTitle: document.getElementById('alert-title'),
      alertMessage: document.getElementById('alert-message'),
      alertOkBtn: document.getElementById('alert-ok'),
    });
  });

  afterEach(uninstallHost);

  it('drops unknown events and counts a rejection', () => {
    track('custom_event', { foo: 1 });
    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.telemetryRejected,
      withSchema({
        rejected_event: 'custom_event',
        rejection_reason: 'unknown_event',
        step: 'telemetry',
      })
    );
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('foo');
  });

  it('emits ExperienceStarted once per session', () => {
    trackExperienceStarted();
    trackExperienceStarted();
    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.experienceStarted,
      withSchema()
    );
    expect(sessionStorage.getItem(EXPERIENCE_SENT_STORAGE_KEY)).toBe('true');
  });

  it('no-ops when the host root is unset', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    trackExperienceStarted();
    beginToolUse();
    endToolUse('success');
    expect(trackFn).not.toHaveBeenCalled();
  });

  it('maps tool pages to stable route identifiers', () => {
    expect(getToolIdFromPath('/en/compress-pdf.html')).toBe('compress-pdf');
    expect(getToolIdFromPath('/')).toBe('home');
  });

  it('reports one ToolUsed success without the filename', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    beginToolUse();
    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');
    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');

    const toolCalls = trackFn.mock.calls.filter(
      (call) => call[0] === PDF_ENGINE_EVENTS.toolUsed
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0][1]).toEqual(
      expect.objectContaining(
        withSchema({
          duration_ms: expect.any(Number),
          result: 'success',
          step: 'process',
        })
      )
    );
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('invoice-secret');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('reports error and cancelled once per begun job', () => {
    beginToolUse();
    endToolUse('error');
    endToolUse('error');
    const errorCalls = trackFn.mock.calls.filter(
      (call) => call[0] === PDF_ENGINE_EVENTS.toolUsed
    );
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][1]).toEqual(
      expect.objectContaining(
        withSchema({
          error_type: 'process_failed',
          result: 'error',
          step: 'process',
        })
      )
    );

    trackFn.mockClear();
    resetToolUseForTests();
    listenForToolJobs();
    beginToolUse();
    window.dispatchEvent(new Event('pagehide'));
    endToolUse('cancelled');
    const cancelledCalls = trackFn.mock.calls.filter(
      (call) => call[0] === PDF_ENGINE_EVENTS.toolUsed
    );
    expect(cancelledCalls).toHaveLength(1);
    expect(cancelledCalls[0][1]).toEqual(
      expect.objectContaining(
        withSchema({
          result: 'cancelled',
          step: 'process',
        })
      )
    );
  });

  it('does not treat validation alerts as jobs', () => {
    listenForToolJobs();
    document.getElementById('process-btn')?.addEventListener('click', () => {
      showAlert('No File', 'Please upload a PDF file first.');
    });
    document.getElementById('process-btn')?.click();
    window.dispatchEvent(new Event('pagehide'));
    expect(trackFn).not.toHaveBeenCalled();
  });

  it('reports error for an in-flight job that fails after the process click', () => {
    listenForToolJobs();
    document.getElementById('process-btn')?.click();
    showAlert('Error', 'Could not add blank page.');
    const toolCalls = trackFn.mock.calls.filter(
      (call) => call[0] === PDF_ENGINE_EVENTS.toolUsed
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0][1]).toEqual(
      expect.objectContaining(
        withSchema({
          error_type: 'process_failed',
          result: 'error',
          step: 'process',
        })
      )
    );

    trackFn.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    expect(trackFn).not.toHaveBeenCalled();
  });

  it('does not treat success alerts as job errors', async () => {
    listenForToolJobs();
    document.getElementById('process-btn')?.click();
    showAlert('Success', 'Metadata removed successfully!', 'success');
    await Promise.resolve();
    const toolCalls = trackFn.mock.calls.filter(
      (call) => call[0] === PDF_ENGINE_EVENTS.toolUsed
    );
    expect(toolCalls).toHaveLength(0);
    expect(
      document.getElementById('alert-modal')?.classList.contains('hidden')
    ).toBe(true);
  });
});
