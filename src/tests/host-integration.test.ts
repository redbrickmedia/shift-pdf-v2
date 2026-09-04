import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapHostIntegration,
  resetBootstrapForTests,
} from '../js/host/bootstrap';
import {
  EXPERIENCE_SENT_STORAGE_KEY,
  getToolIdFromPath,
  PDF_ENGINE_EVENTS,
  trackPdfEngineExperience,
} from '../js/host/analytics';
import {
  applyColorMode,
  applyDataTheme,
  startThemeSync,
} from '../js/host/theme';
import {
  listenForJobCancel,
  markJobStarted,
  reportJobResult,
  resetJobLifecycleForTests,
  setJobDetails,
} from '../js/host/job-lifecycle';
import { downloadFile } from '../js/utils/helpers';
import { dom, hideLoader, showAlert, showLoader } from '../js/ui';

type HostOptions = {
  track?: ReturnType<typeof vi.fn>;
};

function installHost(options: HostOptions = {}) {
  vi.stubEnv('VITE_HOST_API_ROOT', 'testHost.api');
  const track = options.track ?? vi.fn();
  vi.stubGlobal('testHost', { api: { analytics: { track } } });
  return { track };
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
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    uninstallHost();
  });

  afterEach(uninstallHost);

  it('bootstraps once when the generic host is present', () => {
    const { track } = installHost();
    bootstrapHostIntegration();
    bootstrapHostIntegration();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.experienceStarted,
      expect.objectContaining({
        event_type: 'state-change',
        trigger: 'tool-route',
        tool_id: 'merge-pdf',
      })
    );
  });

  it('does not throw when the host is absent', () => {
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
    const media = stubPrefersDark(false);
    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    media.emit(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('host analytics through the bridge', () => {
  let track: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobLifecycleForTests();
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    uninstallHost();
    track = installHost().track;
  });

  afterEach(uninstallHost);

  it('emits ExperienceStarted once per session', () => {
    trackPdfEngineExperience();
    trackPdfEngineExperience();
    expect(track).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(EXPERIENCE_SENT_STORAGE_KEY)).toBe('true');
  });

  it('no-ops when the host root is unset', () => {
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    trackPdfEngineExperience();
    expect(track).not.toHaveBeenCalled();
  });

  it('maps tool pages to stable route identifiers', () => {
    expect(getToolIdFromPath('/en/compress-pdf.html')).toBe('compress-pdf');
    expect(getToolIdFromPath('/')).toBe('home');
  });
});

describe('host job lifecycle', () => {
  let track: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetJobLifecycleForTests();
    sessionStorage.clear();
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

  afterEach(uninstallHost);

  it('reports one success carrying counts but no filename', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    showLoader('Merging PDFs...');
    setJobDetails({ inputCount: 3, outputCount: 1 });
    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');
    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.toolUsed,
      expect.objectContaining({
        result: 'success',
        tool_id: 'merge-pdf',
        input_count: 3,
        output_count: 1,
      })
    );
    expect(JSON.stringify(track.mock.calls[0][1])).not.toContain(
      'invoice-secret'
    );
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('does not report validation alerts or non-job loaders', () => {
    showAlert('No File', 'Please upload a PDF file first.');
    showLoader('Loading PDF documents...', { job: false });
    hideLoader();
    showLoader('Rendering page previews...', { job: false });
    hideLoader();
    showLoader('Restoring merge state...', { job: false });
    hideLoader();
    window.dispatchEvent(new Event('pagehide'));
    expect(track).not.toHaveBeenCalled();
  });

  it('reports one error with its category for an in-flight job', () => {
    showLoader('Working');
    reportJobResult('error', { inputCount: 2, errorCategory: 'processing' });
    showAlert('Error', 'Failed to merge.');

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.toolUsed,
      expect.objectContaining({
        result: 'error',
        tool_id: 'merge-pdf',
        error_category: 'processing',
      })
    );
  });

  it('reports error once when the alert is the only signal', () => {
    showLoader('Merging PDFs...');
    hideLoader();
    showAlert('Error', 'Failed to merge PDFs.');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.toolUsed,
      expect.objectContaining({ result: 'error' })
    );
  });

  it('reports cancellation once on pagehide', () => {
    listenForJobCancel();
    markJobStarted();
    window.dispatchEvent(new Event('pagehide'));
    reportJobResult('cancelled');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.toolUsed,
      expect.objectContaining({ result: 'cancelled' })
    );
  });
});
