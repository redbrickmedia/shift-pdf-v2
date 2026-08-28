import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  configureToolkit,
  getToolkitConfig,
  trackEvent,
} from '@redbrickmedia/shift-browser-toolkit';
import {
  bootstrapShiftToolkit,
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
  CONNECTION_POLL_MAX_ATTEMPTS,
  startThemeSync,
} from '../js/shift/theme';
import {
  listenForJobCancel,
  markJobStarted,
  reportJobResult,
  resetJobLifecycleForTests,
} from '../js/shift/job-lifecycle';
import { downloadFile } from '../js/utils/helpers';
import { dom, showAlert, showLoader } from '../js/ui';

const configureToolkitMock = vi.mocked(configureToolkit);
const getToolkitConfigMock = vi.mocked(getToolkitConfig);
const trackEventMock = vi.mocked(trackEvent);

type ToolkitConfig = ReturnType<typeof getToolkitConfig>;

function toolkitConfig(options?: {
  isOutsideShiftBrowser?: boolean;
  isConnected?: boolean;
  hasError?: boolean;
  observeStoreValue?: ReturnType<typeof vi.fn>;
}): ToolkitConfig {
  return {
    isOutsideShiftBrowser: options?.isOutsideShiftBrowser ?? true,
    webUiProxyService: {
      init: vi.fn(),
      isConnected: options?.isConnected ?? false,
      hasError: options?.hasError ?? false,
      observeStoreValue: options?.observeStoreValue ?? vi.fn(),
    },
  } as unknown as ToolkitConfig;
}

type MediaChangeListener = (event: MediaQueryListEvent) => void;

const originalMatchMedia = window.matchMedia;

function mockPrefersColorScheme(prefersDark: boolean): MediaChangeListener[] {
  const listeners: MediaChangeListener[] = [];
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_type: string, listener: MediaChangeListener) => {
      listeners.push(listener);
    },
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return listeners;
}

function connectedConfig(observeStoreValue = vi.fn()) {
  return toolkitConfig({
    isOutsideShiftBrowser: false,
    isConnected: true,
    observeStoreValue,
  });
}

describe('shift toolkit bootstrap', () => {
  beforeEach(() => {
    resetBootstrapForTests();
    configureToolkitMock.mockReset();
    getToolkitConfigMock.mockReset();
    getToolkitConfigMock.mockReturnValue(toolkitConfig());
    trackEventMock.mockReset();
    sessionStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('calls configureToolkit once', () => {
    bootstrapShiftToolkit();
    bootstrapShiftToolkit();
    expect(configureToolkitMock).toHaveBeenCalledTimes(1);
    expect(configureToolkitMock).toHaveBeenCalledWith({
      buildMode: expect.any(String),
      name: 'shift-pdf-v2',
      version: expect.any(String),
    });
  });

  it('does not throw when the host is missing', () => {
    configureToolkitMock.mockImplementation(() => {
      throw new Error('no host');
    });
    expect(() => bootstrapShiftToolkit()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('shift theme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    getToolkitConfigMock.mockReset();
    window.matchMedia = originalMatchMedia;
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

  it('keeps the dark standalone default when no proxy is present', () => {
    getToolkitConfigMock.mockReturnValue(toolkitConfig());
    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('observes /appearance/theme active for the named theme', () => {
    const observeStoreValue = vi.fn();
    getToolkitConfigMock.mockReturnValue(connectedConfig(observeStoreValue));
    startThemeSync();
    expect(observeStoreValue).toHaveBeenCalledWith(
      '/appearance/theme',
      'active',
      expect.any(Function)
    );

    const handler = observeStoreValue.mock.calls[0][2] as (
      value: unknown
    ) => void;
    handler('amber');
    expect(document.documentElement.getAttribute('data-theme')).toBe('amber');

    handler({ detail: 'custom' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
  });

  it('follows the host color mode through prefers-color-scheme', () => {
    const listeners = mockPrefersColorScheme(true);
    getToolkitConfigMock.mockReturnValue(connectedConfig());

    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    listeners.forEach((listener) =>
      listener({ matches: false } as MediaQueryListEvent)
    );
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('ignores the OS color scheme until the proxy connects', () => {
    mockPrefersColorScheme(false);
    getToolkitConfigMock.mockReturnValue(toolkitConfig());

    startThemeSync();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('syncs theme on a dev host where chrome.shift is unavailable', () => {
    mockPrefersColorScheme(false);
    const observeStoreValue = vi.fn();
    getToolkitConfigMock.mockReturnValue(
      toolkitConfig({
        isOutsideShiftBrowser: true,
        isConnected: true,
        observeStoreValue,
      })
    );

    startThemeSync();
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(observeStoreValue).toHaveBeenCalledWith(
      '/appearance/theme',
      'active',
      expect.any(Function)
    );
  });

  it('stops polling when the proxy never connects', () => {
    const callbacks: Array<() => void> = [];
    const setSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((handler: TimerHandler) => {
        if (typeof handler === 'function') callbacks.push(handler as () => void);
        return 1 as unknown as number;
      });
    const clearSpy = vi.spyOn(window, 'clearInterval');
    getToolkitConfigMock.mockReturnValue(
      toolkitConfig({ isConnected: false, hasError: false })
    );

    startThemeSync();
    expect(callbacks.length).toBe(1);
    for (let i = 0; i < CONNECTION_POLL_MAX_ATTEMPTS; i++) {
      callbacks[0]();
    }

    expect(clearSpy).toHaveBeenCalled();
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});

describe('shift analytics', () => {
  beforeEach(() => {
    resetJobLifecycleForTests();
    trackEventMock.mockReset();
    getToolkitConfigMock.mockReset();
    getToolkitConfigMock.mockReturnValue(connectedConfig());
    sessionStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
  });

  it('emits ExperienceStarted once per session', () => {
    trackExperienceStarted();
    trackExperienceStarted();
    expect(trackEventMock).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith(EXPERIENCE_STARTED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
    });
    expect(sessionStorage.getItem(EXPERIENCE_STARTED_STORAGE_KEY)).toBe('1');
  });

  it('does not send document-derived strings on ToolUsed', () => {
    markJobStarted();
    reportJobResult('success');
    expect(trackEventMock).toHaveBeenCalledWith(TOOL_USED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
      tool_id: 'merge-pdf',
      result: 'success',
    });
    const payload = trackEventMock.mock.calls[0][1] as Record<string, unknown>;
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
    expect(trackEventMock).toHaveBeenCalledWith(TOOL_USED_EVENT, {
      event_type: 'state-change',
      trigger: 'system',
      tool_id: 'merge-pdf',
      result: 'success',
    });
  });

  it('no-ops outside Shift', () => {
    getToolkitConfigMock.mockReturnValue(toolkitConfig());
    trackExperienceStarted();
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('maps tool pages to tool_id', () => {
    expect(getToolIdFromPath('/en/compress-pdf.html')).toBe('compress-pdf');
    expect(getToolIdFromPath('/')).toBe('home');
  });
});

describe('shift job lifecycle', () => {
  beforeEach(() => {
    resetJobLifecycleForTests();
    trackEventMock.mockReset();
    getToolkitConfigMock.mockReturnValue(connectedConfig());
    window.history.replaceState({}, '', '/merge-pdf.html');

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

  it('fires ToolUsed success from downloadFile without the filename', () => {
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:test');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);

    downloadFile(new Blob(['pdf']), 'invoice-secret.pdf');

    expect(trackEventMock).toHaveBeenCalledTimes(1);
    const payload = trackEventMock.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.result).toBe('success');
    expect(JSON.stringify(payload)).not.toContain('invoice-secret');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('does not fire ToolUsed for validation alerts without a loader', () => {
    showAlert('No File', 'Please upload a PDF file first.');
    expect(trackEventMock).not.toHaveBeenCalled();
  });

  it('fires ToolUsed error after a loader plus error alert', () => {
    showLoader('Working');
    showAlert('Error', 'Failed to merge.');
    expect(trackEventMock).toHaveBeenCalledWith(
      TOOL_USED_EVENT,
      expect.objectContaining({ result: 'error', tool_id: 'merge-pdf' })
    );
  });

  it('fires ToolUsed cancelled on pagehide while a job is in flight', () => {
    listenForJobCancel();
    markJobStarted();
    window.dispatchEvent(new Event('pagehide'));
    expect(trackEventMock).toHaveBeenCalledWith(
      TOOL_USED_EVENT,
      expect.objectContaining({ result: 'cancelled' })
    );
  });
});
