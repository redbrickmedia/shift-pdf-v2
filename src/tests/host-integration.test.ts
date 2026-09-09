import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapHostIntegration,
  resetBootstrapForTests,
} from '../js/host/bootstrap';
import {
  beginToolUse,
  endToolUse,
  EXPERIENCE_SENT_STORAGE_KEY,
  getToolIdFromPath,
  listenForToolJobs,
  PDF_ENGINE_EVENTS,
  resetToolUseForTests,
  track,
  trackExperienceStarted,
} from '../js/host/analytics';
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
    expect(trackFn).toHaveBeenCalledWith(PDF_ENGINE_EVENTS.experienceStarted, {
      tool_id: 'merge-pdf',
    });
  });

  it('does not throw when the host is absent', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    expect(() => bootstrapHostIntegration()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
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

  it('forwards track calls to the host', () => {
    track('custom_event', { foo: 1 });
    expect(trackFn).toHaveBeenCalledWith('custom_event', { foo: 1 });
  });

  it('emits ExperienceStarted once per session', () => {
    trackExperienceStarted();
    trackExperienceStarted();
    expect(trackFn).toHaveBeenCalledTimes(1);
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

    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(PDF_ENGINE_EVENTS.toolUsed, {
      tool_id: 'merge-pdf',
      result: 'success',
    });
    expect(JSON.stringify(trackFn.mock.calls[0][1])).not.toContain(
      'invoice-secret'
    );
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('reports error and cancelled once per begun job', () => {
    beginToolUse();
    endToolUse('error');
    endToolUse('error');
    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(PDF_ENGINE_EVENTS.toolUsed, {
      tool_id: 'merge-pdf',
      result: 'error',
    });

    trackFn.mockClear();
    resetToolUseForTests();
    listenForToolJobs();
    beginToolUse();
    window.dispatchEvent(new Event('pagehide'));
    endToolUse('cancelled');
    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn).toHaveBeenCalledWith(PDF_ENGINE_EVENTS.toolUsed, {
      tool_id: 'merge-pdf',
      result: 'cancelled',
    });
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
});
