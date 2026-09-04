import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bootstrapShiftHost,
  resetBootstrapForTests,
} from '../js/shift/bootstrap';
import {
  EXPERIENCE_STARTED_EVENT,
  EXPERIENCE_STARTED_STORAGE_KEY,
  getToolIdFromPath,
  trackExperienceStarted,
  trackPdfEngine,
  TOOL_USED_EVENT,
} from '../js/shift/analytics';
import {
  applyColorMode,
  applyDataTheme,
  startThemeSync,
} from '../js/shift/theme';
import {
  listenForJobCancel,
  markJobStarted,
  reportJobResult,
  resetJobLifecycleForTests,
} from '../js/shift/job-lifecycle';
import { downloadFile } from '../js/utils/helpers';
import { dom, hideLoader, showAlert, showLoader } from '../js/ui';

type HostOptions = {
  track?: ReturnType<typeof vi.fn>;
};

/** Stub the analytics host used in production; theme is driven by matchMedia. */
function installHost(options: HostOptions = {}) {
  vi.stubEnv('VITE_SHIFT_API_ROOT', 'chrome.shift');
  const track = options.track ?? vi.fn();

  Object.defineProperty(window, 'chrome', {
    configurable: true,
    writable: true,
    value: {
      shift: {
        analytics: { track },
      },
    },
  });

  return { track };
}

function uninstallHost() {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'chrome');
}

/** Stands in for the preferred colour scheme Shift pushes to the renderer. */
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
      ) => {
        listeners.push(listener);
      },
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

describe('shift host bootstrap', () => {
  beforeEach(() => {
    resetBootstrapForTests();
    sessionStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    uninstallHost();
  });

  afterEach(() => {
    uninstallHost();
  });

  it('bootstraps once', () => {
    const { track } = installHost();
    bootstrapShiftHost();
    bootstrapShiftHost();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(EXPERIENCE_STARTED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
    });
  });

  it('does not throw when the host is missing', () => {
    expect(() => bootstrapShiftHost()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('shift theme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    uninstallHost();
  });

  afterEach(() => {
    uninstallHost();
  });

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

  it('follows prefers-color-scheme in a Shift build', () => {
    const media = stubPrefersDark(false);
    installHost();
    startThemeSync();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    media.emit(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('ignores the OS preference when the API root is unset', () => {
    const media = stubPrefersDark(false);
    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    media.emit(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('starts no timer in either build', () => {
    const setSpy = vi.spyOn(window, 'setInterval');

    startThemeSync();
    installHost();
    stubPrefersDark(true);
    startThemeSync();

    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });
});

describe('shift analytics', () => {
  let track: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobLifecycleForTests();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    uninstallHost();
    track = installHost().track;
  });

  afterEach(() => {
    uninstallHost();
  });

  it('emits ExperienceStarted once per session', () => {
    trackExperienceStarted();
    trackExperienceStarted();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(EXPERIENCE_STARTED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
    });
    expect(sessionStorage.getItem(EXPERIENCE_STARTED_STORAGE_KEY)).toBe('1');
  });

  it('does not send document-derived strings on ToolUsed', () => {
    markJobStarted();
    reportJobResult('success');
    expect(track).toHaveBeenCalledWith(TOOL_USED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
      tool_id: 'merge-pdf',
      result: 'success',
    });
    const payload = track.mock.calls[0][1] as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toMatch(/\.pdf|\/tmp|document/i);
  });

  it('strips unknown properties', () => {
    trackPdfEngine(TOOL_USED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
      tool_id: 'merge-pdf',
      result: 'success',
      filename: 'secret.pdf',
      path: '/Users/me/file.pdf',
    });
    expect(track).toHaveBeenCalledWith(TOOL_USED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
      tool_id: 'merge-pdf',
      result: 'success',
    });
  });

  it('no-ops when the API root is unset', () => {
    vi.stubEnv('VITE_SHIFT_API_ROOT', '');
    track.mockClear();
    trackExperienceStarted();
    expect(track).not.toHaveBeenCalled();
  });

  it('maps tool pages to tool_id', () => {
    expect(getToolIdFromPath('/en/compress-pdf.html')).toBe('compress-pdf');
    expect(getToolIdFromPath('/')).toBe('home');
  });
});

describe('shift job lifecycle', () => {
  let track: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobLifecycleForTests();
    window.history.replaceState({}, '', '/merge-pdf.html');
    uninstallHost();
    track = installHost().track;

    document.body.innerHTML = `
      <div id="loader-modal" class="hidden"></div>
      <p id="loader-text"></p>
      <div id="alert-modal" class="hidden"><div><h3 id="alert-title"></h3><p id="alert-message"></p><button id="alert-ok"></button></div></div>
    `;
    Object.assign(dom, {
      loaderModal: document.getElementById('loader-modal'),
      loaderText: document.getElementById('loader-text'),
      alertModal: document.getElementById('alert-modal'),
      alertTitle: document.getElementById('alert-title'),
      alertMessage: document.getElementById('alert-message'),
      alertOkBtn: document.getElementById('alert-ok'),
    });
  });

  afterEach(() => {
    uninstallHost();
  });

  it('fires ToolUsed success from downloadFile without the filename', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');

    expect(track).toHaveBeenCalledTimes(1);
    const payload = track.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.result).toBe('success');
    expect(JSON.stringify(payload)).not.toContain('invoice-secret');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('does not fire ToolUsed for validation alerts without a loader', () => {
    showAlert('No File', 'Please upload a PDF file first.');
    expect(track).not.toHaveBeenCalled();
  });

  it('does not treat file load or render loaders as in-flight jobs after hideLoader', () => {
    listenForJobCancel();
    showLoader('Loading PDF...', { job: false });
    hideLoader();
    showAlert('No File', 'Please upload a PDF file first.');
    expect(track).not.toHaveBeenCalled();

    showLoader('Rendering page previews: 1/3', { job: false });
    hideLoader();
    window.dispatchEvent(new Event('pagehide'));
    expect(track).not.toHaveBeenCalled();
  });

  it('fires ToolUsed error after a loader plus error alert', () => {
    showLoader('Working');
    showAlert('Error', 'Failed to merge.');
    expect(track).toHaveBeenCalledWith(
      TOOL_USED_EVENT,
      expect.objectContaining({ result: 'error', tool_id: 'merge-pdf' })
    );
  });

  it('fires ToolUsed error when hideLoader runs before the error alert', () => {
    showLoader('Merging PDFs...');
    hideLoader();
    showAlert('Error', 'Failed to merge PDFs.');
    expect(track).toHaveBeenCalledWith(
      TOOL_USED_EVENT,
      expect.objectContaining({ result: 'error', tool_id: 'merge-pdf' })
    );
  });

  it('fires ToolUsed cancelled on pagehide while a job is in flight', () => {
    listenForJobCancel();
    markJobStarted();
    window.dispatchEvent(new Event('pagehide'));
    expect(track).toHaveBeenCalledWith(
      TOOL_USED_EVENT,
      expect.objectContaining({ result: 'cancelled' })
    );
  });
});
