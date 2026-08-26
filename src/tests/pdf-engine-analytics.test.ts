import { describe, expect, it, vi } from 'vitest';
import {
  PDF_ENGINE_EVENTS,
  PdfEngineAnalytics,
  type AnalyticsTransport,
} from '../js/analytics';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

function setup() {
  let now = 1_000;
  const transport = vi.fn<AnalyticsTransport>();
  const sessionStorage = memoryStorage();
  const localStorage = memoryStorage();
  const analytics = new PdfEngineAnalytics({
    sessionStorage,
    localStorage,
    transport,
    now: () => now,
    createId: () => 'session-1',
  });
  return {
    analytics,
    transport,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe('PDF engine analytics', () => {
  it('emits the experience event once per browser session', () => {
    const { analytics, transport } = setup();

    expect(
      analytics.trackExperienceStarted({
        trigger: 'tool-route',
        entrySurface: 'direct-tool-route',
        toolId: 'compress-pdf',
      })
    ).toBe(true);
    expect(
      analytics.trackExperienceStarted({
        trigger: 'tool-route',
        entrySurface: 'direct-tool-route',
        toolId: 'merge-pdf',
      })
    ).toBe(false);

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      PDF_ENGINE_EVENTS.experienceStarted,
      {
        event_type: 'state-change',
        trigger: 'tool-route',
        engine: 'bento',
        entry_surface: 'direct-tool-route',
        tool_id: 'compress-pdf',
        session_id: 'session-1',
        is_returning: false,
      }
    );
  });

  it('allowlists terminal properties and emits only once per operation', () => {
    const { analytics, transport, advance } = setup();
    const operation = analytics.startToolOperation('pdf-to-jpg');
    advance(42.4);

    expect(
      operation.finish({
        result: 'error',
        inputCount: 1,
        outputCount: 0,
        errorCategory: 'processing',
        filename: 'private.pdf',
        message: 'Document title and signature contents',
      } as never)
    ).toBe(true);
    expect(
      operation.finish({
        result: 'success',
        inputCount: 1,
        outputCount: 4,
      })
    ).toBe(false);

    expect(transport).toHaveBeenCalledTimes(1);
    const [, payload] = transport.mock.calls[0];
    expect(payload).toEqual({
      event_type: 'state-change',
      trigger: 'job-failed',
      engine: 'bento',
      tool_id: 'pdf-to-jpg',
      result: 'error',
      session_id: 'session-1',
      duration_ms: 42,
      input_count: 1,
      output_count: 0,
      error_category: 'processing',
    });
    expect(payload).not.toHaveProperty('filename');
    expect(payload).not.toHaveProperty('message');
  });

  it('rejects unsafe identifiers and uncategorized freeform errors', () => {
    const { analytics, transport } = setup();
    expect(
      analytics
        .startToolOperation('/Users/person/private.pdf')
        .finish({ result: 'success' })
    ).toBe(false);

    analytics.startToolOperation('sign-pdf').finish({
      result: 'error',
      errorCategory: 'private document title' as never,
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).not.toHaveProperty('error_category');
  });
});
