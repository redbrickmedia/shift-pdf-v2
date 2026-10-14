import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForShiftFileHandoff } from '../js/embedder/shift-file-handoff';
import { clearPdfLibrary } from '../js/logic/pdf-library-store';
import {
  APP_VERSION,
  beginToolUse,
  endToolUse,
  getTelemetryRejectedCount,
  getToolIdFromPath,
  listenForFeatureUse,
  listenForToolJobs,
  noteProcessAlert,
  PDF_ENGINE_EVENTS,
  resetToolUseForTests,
  SCHEMA_VERSION,
  track,
  trackOnboardingAction,
} from '../js/host/analytics';
import {
  inspectPdfBytes,
  memoryBucket,
  sizeBucket,
} from '../js/host/pdf-signals';
import {
  EVENT_CATALOG,
  PDF_ONBOARDING_EVENTS,
} from '../js/host/telemetry-schema';
import {
  recordDocumentLoad,
  recordPerformance,
  reportHandoff,
} from '../js/host/telemetry';
import { downloadFile } from '../js/utils/helpers';

const SHIFT_ORIGIN = 'chrome-extension://mofjdkplmlofiadhjjcacadmghmaglna';
const HANDOFF_ID = 'c56a4180-65aa-42ec-a945-5fd21dec0538';

function installHost() {
  vi.stubEnv('VITE_HOST_API_ROOT', 'testHost.api');
  const trackFn = vi.fn();
  vi.stubGlobal('testHost', { api: { analytics: { track: trackFn } } });
  return trackFn;
}

function uninstallHost() {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'testHost');
}

function eventsNamed(trackFn: ReturnType<typeof vi.fn>, name: string) {
  return trackFn.mock.calls.filter((call) => call[0] === name);
}

describe('pdf telemetry', () => {
  let trackFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetToolUseForTests();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/merge-pdf.html');
    uninstallHost();
    trackFn = installHost();
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    uninstallHost();
    resetToolUseForTests();
    await clearPdfLibrary();
  });

  it('emits a started flow and one completed tool use', async () => {
    beginToolUse();
    await Promise.resolve();
    endToolUse('success');

    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.flowStarted)).toHaveLength(1);
    expect(
      eventsNamed(trackFn, PDF_ENGINE_EVENTS.flowStarted)[0][1]
    ).toMatchObject({
      app_version: APP_VERSION,
      event_type: 'state-change',
      schema_version: SCHEMA_VERSION,
      step: 'process',
      tool_id: 'merge-pdf',
    });

    const completed = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
    expect(completed).toHaveLength(1);
    expect(completed[0][1]).toMatchObject({
      result: 'success',
      schema_version: SCHEMA_VERSION,
      step: 'process',
    });
    expect(completed[0][1].duration_ms).toEqual(expect.any(Number));

    const performance = eventsNamed(
      trackFn,
      PDF_ENGINE_EVENTS.performanceRecorded
    );
    expect(performance).toHaveLength(1);
    expect(performance[0][1]).toMatchObject({
      phase: 'process',
      step: 'process',
    });
    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.flowStarted)).toHaveLength(1);
  });

  it('records abandoned jobs as cancelled tool use', () => {
    beginToolUse();
    endToolUse('cancelled');

    expect(
      eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed)[0][1]
    ).toMatchObject({
      result: 'cancelled',
    });
    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.error)).toHaveLength(0);
  });

  it('classifies process errors without sending alert text', () => {
    beginToolUse();
    noteProcessAlert('error', 'Password for secret.pdf failed');

    const error = eventsNamed(trackFn, PDF_ENGINE_EVENTS.error)[0][1];
    expect(error).toMatchObject({
      error_type: 'encrypted',
      step: 'process',
    });
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('secret.pdf');
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('Password');
  });

  it('redacts filenames, paths, and passwords from an otherwise valid event', () => {
    track(PDF_ENGINE_EVENTS.toolUsed, {
      filename: 'invoice-secret.pdf',
      password: 'hunter2',
      path: 'C:\\Users\\a\\secret.pdf',
      result: 'success',
    });

    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn.mock.calls[0][0]).toBe(PDF_ENGINE_EVENTS.toolUsed);
    const payload = JSON.stringify(trackFn.mock.calls);
    expect(payload).not.toContain('invoice-secret');
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('Users');
    expect(trackFn.mock.calls[0][1]).toMatchObject({
      result: 'success',
      schema_version: SCHEMA_VERSION,
      tool_id: 'merge-pdf',
    });
  });

  it('drops invalid events and emits PdfEngine_TelemetryRejected', () => {
    expect(() =>
      track(PDF_ENGINE_EVENTS.featureUsed, {
        feature_id: 'save',
        tool_id: 'secret.pdf',
      })
    ).not.toThrow();

    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn.mock.calls[0][0]).toBe(PDF_ENGINE_EVENTS.telemetryRejected);
    expect(trackFn.mock.calls[0][1]).toMatchObject({
      rejected_event: PDF_ENGINE_EVENTS.featureUsed,
      rejection_reason: 'forbidden_value',
      schema_version: SCHEMA_VERSION,
    });
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('secret.pdf');
    expect(getTelemetryRejectedCount()).toBe(1);
  });

  it('does not post anywhere when the host track function is missing', () => {
    uninstallHost();
    vi.stubEnv('VITE_HOST_API_ROOT', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    track(PDF_ENGINE_EVENTS.experienceStarted);
    beginToolUse();
    endToolUse('success');
    track('not-an-event', { filename: 'secret.pdf' });
    reportHandoff({
      byteLength: 2_000_000,
      channel: 'accepted',
      reason: 'accepted',
      result: 'success',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getTelemetryRejectedCount()).toBe(1);
  });

  it('buckets handoff size and keeps the payload off the event', async () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const source = { postMessage: vi.fn() };
    listenForShiftFileHandoff({ onFile: vi.fn().mockResolvedValue(undefined) });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          channel: 'shift-file-handoff-offer',
          handoffId: HANDOFF_ID,
          version: 1,
        },
        origin: SHIFT_ORIGIN,
        source: source as unknown as MessageEventSource,
      })
    );

    const bytes = new Uint8Array([
      37, 80, 68, 70, 45, 49, 46, 55, 10, 47, 69, 110, 99, 114, 121, 112, 116,
    ]).buffer;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          bytes,
          channel: 'shift-file-handoff-payload',
          filename: 'Quarterly Report.pdf',
          handoffId: HANDOFF_ID,
          mimeType: 'application/pdf',
          version: 1,
        },
        origin: SHIFT_ORIGIN,
        source: source as unknown as MessageEventSource,
      })
    );

    await vi.waitFor(() =>
      expect(
        eventsNamed(trackFn, PDF_ENGINE_EVENTS.handoffFinished).length
      ).toBe(2)
    );

    const handoffs = eventsNamed(trackFn, PDF_ENGINE_EVENTS.handoffFinished);
    expect(handoffs[0][1]).toMatchObject({
      channel: 'offer',
      reason: 'offer_accepted',
      result: 'success',
    });
    expect(handoffs[1][1]).toMatchObject({
      channel: 'accepted',
      pdf_kind: 'encrypted',
      reason: 'accepted',
      result: 'success',
      size_bucket: 'lt_1mb',
    });
    expect(handoffs[1][1]).not.toHaveProperty('byteLength');
    expect(handoffs[1][1]).not.toHaveProperty('bytes');
    expect(JSON.stringify(handoffs)).not.toContain('Quarterly');
    expect(JSON.stringify(handoffs[1][1])).not.toMatch(/\d{5,}/);
  });

  it('reports a failed handoff reason without the error text', async () => {
    window.history.replaceState(
      {},
      '',
      `/merge-pdf.html?shiftHandoff=${HANDOFF_ID}`
    );
    const source = { postMessage: vi.fn() };
    listenForShiftFileHandoff({
      onFile: vi.fn().mockRejectedValue(new Error('failed on secret.pdf')),
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          bytes: new Uint8Array(2_000_000).buffer,
          channel: 'shift-file-handoff-payload',
          filename: 'secret.pdf',
          handoffId: HANDOFF_ID,
          mimeType: 'application/pdf',
          version: 1,
        },
        origin: SHIFT_ORIGIN,
        source: source as unknown as MessageEventSource,
      })
    );

    await vi.waitFor(() =>
      expect(
        eventsNamed(trackFn, PDF_ENGINE_EVENTS.handoffFinished)
      ).toHaveLength(1)
    );
    expect(
      eventsNamed(trackFn, PDF_ENGINE_EVENTS.handoffFinished)[0][1]
    ).toMatchObject({
      channel: 'rejected',
      reason: 'load_failed',
      result: 'fail',
      size_bucket: '1_8mb',
    });
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('secret.pdf');
  });

  it('records feature usage from stable controls', () => {
    document.body.innerHTML = `
      <button id="shift-tool-output-save">Save secret.pdf</button>
      <button data-viewer-tool="compress-pdf.html">Compress</button>
      <button class="shift-tool-favorite">Favorite</button>
    `;
    listenForFeatureUse();
    document.getElementById('shift-tool-output-save')?.click();
    document.querySelector<HTMLButtonElement>('[data-viewer-tool]')?.click();
    document.querySelector<HTMLButtonElement>('.shift-tool-favorite')?.click();

    const features = eventsNamed(trackFn, PDF_ENGINE_EVENTS.featureUsed).map(
      (call) => call[1].feature_id
    );
    expect(features).toEqual(['save', 'compress', 'favorite']);
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain('secret.pdf');
    for (const call of eventsNamed(trackFn, PDF_ENGINE_EVENTS.featureUsed)) {
      expect(call[1].event_type).toBe('user-interaction');
    }
  });

  it('records one load timing and includes a memory bucket when the host exposes it', () => {
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 60 * 1024 * 1024 },
    });

    recordDocumentLoad({
      byteLength: 9 * 1024 * 1024,
      durationMs: 40.2,
      failed: true,
      errorType: 'malformed',
      pageCount: 3,
    });
    recordDocumentLoad({ durationMs: 10, pageCount: 3 });

    const loads = eventsNamed(
      trackFn,
      PDF_ENGINE_EVENTS.performanceRecorded
    ).filter((call) => call[1].phase === 'load');
    expect(loads).toHaveLength(1);
    expect(loads[0][1]).toMatchObject({
      duration_ms: 40,
      memory_bucket: '50_200mb',
      page_count: 3,
      phase: 'load',
      size_bucket: 'gt_8mb',
      step: 'load',
    });
    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.error)[0][1]).toMatchObject({
      error_type: 'malformed',
      step: 'load',
    });
  });

  it('omits memory when performance.memory is absent', () => {
    Reflect.deleteProperty(performance, 'memory');
    recordPerformance('render', 15, { step: 'render' });
    const payload = eventsNamed(
      trackFn,
      PDF_ENGINE_EVENTS.performanceRecorded
    )[0][1];
    expect(payload).toMatchObject({ duration_ms: 15, phase: 'render' });
    expect(payload).not.toHaveProperty('memory_bucket');
  });

  it('maps routes and file-like paths to safe tool ids', () => {
    expect(getToolIdFromPath('/en/compress-pdf.html')).toBe('compress-pdf');
    expect(getToolIdFromPath('/')).toBe('home');
    expect(getToolIdFromPath('/tmp/invoice-secret.pdf')).toBe('unknown');
  });

  it('buckets sizes and classifies pdf bytes without returning page text', () => {
    expect(sizeBucket(1024)).toBe('lt_1mb');
    expect(sizeBucket(1024 * 1024)).toBe('1_8mb');
    expect(sizeBucket(8 * 1024 * 1024)).toBe('1_8mb');
    expect(sizeBucket(8 * 1024 * 1024 + 1)).toBe('gt_8mb');
    expect(memoryBucket(10 * 1024 * 1024)).toBe('lt_50mb');
    expect(memoryBucket(200 * 1024 * 1024)).toBe('50_200mb');
    expect(memoryBucket(200 * 1024 * 1024 + 1)).toBe('gt_200mb');

    const secret = 'secret password and the page text hello';
    const textPdf = new TextEncoder().encode(
      `%PDF-1.7\n/Type /Page\n/Font <<>>\n${secret}`
    );
    const textResult = inspectPdfBytes(textPdf);
    expect(textResult).toMatchObject({ page_count: 1, pdf_kind: 'text' });
    expect(JSON.stringify(textResult)).not.toContain('secret');
    expect(JSON.stringify(textResult)).not.toContain('hello');

    expect(
      inspectPdfBytes(new TextEncoder().encode('%PDF\n/Encrypt')).pdf_kind
    ).toBe('encrypted');
    expect(
      inspectPdfBytes(new TextEncoder().encode('%PDF\n/AcroForm')).pdf_kind
    ).toBe('form');
    expect(
      inspectPdfBytes(new TextEncoder().encode('%PDF\n/Subtype /Image'))
        .pdf_kind
    ).toBe('image');
    expect(inspectPdfBytes(new TextEncoder().encode('%PDF-1.7')).pdf_kind).toBe(
      'unknown'
    );
  });

  it('emits one success from downloadFile and ignores a later pagehide', () => {
    document.body.innerHTML =
      '<button id="process-btn" type="button"></button>';
    listenForToolJobs();
    document.getElementById('process-btn')?.click();
    downloadFile(new Blob(['pdf']), 'out.pdf');
    window.dispatchEvent(new Event('pagehide'));
    downloadFile(new Blob(['pdf']), 'out.pdf');

    const terminal = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
    expect(terminal).toHaveLength(1);
    expect(terminal[0][1]).toMatchObject({
      result: 'success',
      tool_id: 'merge-pdf',
    });
    expect(terminal[0][1].duration_ms).toEqual(expect.any(Number));
    expect(terminal.map((call) => call[1].result)).not.toContain('cancelled');

    document.getElementById('process-btn')?.click();
    downloadFile(new Blob(['pdf']), 'out.pdf');
    const reset = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
    expect(reset).toHaveLength(2);
    expect(reset[1][1]).toMatchObject({
      result: 'success',
      tool_id: 'merge-pdf',
    });
  });

  it.each(['compress-pdf', 'pdf-to-docx', 'sign-pdf'])(
    'emits one terminal ToolUsed for %s',
    (toolId) => {
      resetToolUseForTests();
      trackFn.mockClear();
      window.history.replaceState({}, '', `/${toolId}.html`);
      document.body.innerHTML =
        '<button id="process-btn" type="button"></button>';
      listenForToolJobs();
      document.getElementById('process-btn')?.click();
      downloadFile(new Blob(['pdf']), 'out.pdf');
      window.dispatchEvent(new Event('pagehide'));
      downloadFile(new Blob(['pdf']), 'out.pdf');

      const terminal = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
      expect(terminal).toHaveLength(1);
      expect(terminal[0][1]).toMatchObject({
        result: 'success',
        tool_id: toolId,
      });
      expect(terminal[0][1].duration_ms).toEqual(expect.any(Number));
      expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.error)).toHaveLength(0);

      document.getElementById('process-btn')?.click();
      downloadFile(new Blob(['pdf']), 'out.pdf');
      const reset = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
      expect(reset).toHaveLength(2);
      expect(reset[1][1]).toMatchObject({
        result: 'success',
        tool_id: toolId,
      });
    }
  );

  it.each([
    ['pdf-to-excel', 'src/js/logic/pdf-to-excel-page.ts', '!pwResult'],
    ['pdf-to-png', 'src/js/logic/pdf-to-png-page.ts', '!result'],
  ])(
    'emits one cancelled when the %s password prompt returns early',
    (toolId, pagePath, guard) => {
      const page = readFileSync(resolve(process.cwd(), pagePath), 'utf8');
      expect(page).toContain(
        `if (${guard}) {\n      endToolUse('cancelled');\n      return;\n    }`
      );

      resetToolUseForTests();
      trackFn.mockClear();
      window.history.replaceState({}, '', `/${toolId}.html`);
      document.body.innerHTML =
        '<button id="process-btn" type="button"></button>';
      listenForToolJobs();
      document.getElementById('process-btn')?.click();
      endToolUse('cancelled');
      window.dispatchEvent(new Event('pagehide'));

      const terminal = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
      expect(terminal).toHaveLength(1);
      expect(terminal[0][1]).toMatchObject({
        result: 'cancelled',
        tool_id: toolId,
      });
      expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.error)).toHaveLength(0);
      expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.featureUsed)).toHaveLength(
        0
      );
    }
  );

  it('keeps a download click separate from ToolUsed success', () => {
    document.body.innerHTML =
      '<button id="process-btn" type="button"></button><button id="shift-tool-output-download" type="button"></button>';
    listenForToolJobs();
    listenForFeatureUse();
    document.getElementById('process-btn')?.click();
    downloadFile(new Blob(['pdf']), 'out.pdf');

    const beforeClick = eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed);
    expect(beforeClick).toHaveLength(1);
    expect(beforeClick[0][1]).toMatchObject({
      result: 'success',
      tool_id: 'merge-pdf',
    });
    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.featureUsed)).toHaveLength(0);

    document.getElementById('shift-tool-output-download')?.click();

    const features = eventsNamed(trackFn, PDF_ENGINE_EVENTS.featureUsed);
    expect(features).toHaveLength(1);
    expect(features[0][1]).toMatchObject({
      feature_id: 'download',
      step: 'feature',
    });
    expect(eventsNamed(trackFn, PDF_ENGINE_EVENTS.toolUsed)).toHaveLength(1);
  });

  it('rejects experiment_variant on ExperienceStarted', () => {
    track(PDF_ENGINE_EVENTS.experienceStarted, {
      experiment_variant: 'variation',
    });

    expect(trackFn).toHaveBeenCalledTimes(1);
    expect(trackFn.mock.calls[0][0]).toBe(PDF_ENGINE_EVENTS.telemetryRejected);
    expect(trackFn.mock.calls[0][1]).toMatchObject({
      rejected_event: PDF_ENGINE_EVENTS.experienceStarted,
      rejection_reason: 'unknown_property',
    });
    expect(JSON.stringify(trackFn.mock.calls)).not.toContain(
      'experiment_variant'
    );
  });

  it('records walkthrough actions and drops unsafe values', () => {
    window.history.replaceState({}, '', '/');
    trackOnboardingAction('shown');
    window.history.replaceState({}, '', '/my-pdfs.html');
    trackOnboardingAction('upload-selected');
    trackOnboardingAction('dismissed');
    track(PDF_ONBOARDING_EVENTS.action, {
      action: 'shown',
      event_type: 'user-interaction',
      route: 'home',
      surface_id: 'my-pdfs-walkthrough',
      trigger: 'system',
    });

    const actions = eventsNamed(trackFn, PDF_ONBOARDING_EVENTS.action);
    expect(actions.map((call) => [call[1].action, call[1].event_type])).toEqual(
      [
        ['shown', 'state-change'],
        ['upload-selected', 'user-interaction'],
        ['dismissed', 'user-interaction'],
        ['shown', 'state-change'],
      ]
    );
    expect(actions[0][1]).toMatchObject({
      route: 'home',
      surface_id: 'my-pdfs-walkthrough',
      tool_id: 'home',
      trigger: 'system',
    });
    expect(actions[1][1]).toMatchObject({
      route: 'my-pdfs',
      tool_id: 'my-pdfs',
      trigger: 'upload-button-pressed',
    });
    expect(actions[2][1]).toMatchObject({
      trigger: 'dismiss-button-pressed',
    });

    const unsafeCases = [
      { route: 'secret.pdf' },
      { trigger: 'C:\\Users\\a\\secret.pdf' },
      { action: 'user@example.com' },
    ];
    for (const unsafe of unsafeCases) {
      trackFn.mockClear();
      track(PDF_ONBOARDING_EVENTS.action, {
        action: 'shown',
        route: 'home',
        surface_id: 'my-pdfs-walkthrough',
        trigger: 'system',
        ...unsafe,
      });
      expect(trackFn).toHaveBeenCalledTimes(1);
      expect(trackFn.mock.calls[0][0]).toBe(
        PDF_ENGINE_EVENTS.telemetryRejected
      );
      expect(trackFn.mock.calls[0][1]).toMatchObject({
        rejected_event: PDF_ONBOARDING_EVENTS.action,
        rejection_reason: 'forbidden_value',
      });
      const payload = JSON.stringify(trackFn.mock.calls);
      expect(payload).not.toContain('secret.pdf');
      expect(payload).not.toContain('Users');
      expect(payload).not.toContain('user@example.com');
    }
  });

  it('keeps the markdown catalog aligned with the runtime schema', () => {
    const doc = readFileSync(
      resolve(process.cwd(), 'docs/telemetry.md'),
      'utf8'
    );
    expect(doc.toLowerCase()).toContain('consent');
    expect(doc).toContain('VITE_HOST_API_ROOT');
    expect(doc).toContain('chrome.shift');
    for (const event of EVENT_CATALOG) {
      expect(doc).toContain(`\`${event.name}\``);
      for (const property of event.properties) {
        expect(doc).toContain(`\`${property}\``);
      }
    }
  });
});
