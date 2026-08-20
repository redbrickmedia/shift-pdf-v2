import { describe, expect, it } from 'vitest';
import {
  PROMISE_BANNER_TTL_MS,
  dismissPromiseBanner,
  markPromiseBannerSeen,
  parseAbsoluteExpiry,
  parseStoredTimestamp,
  readPromiseBannerState,
  shouldShowPromiseBanner,
} from '../js/logic/promise-banner';

const DAY = 24 * 60 * 60 * 1000;

describe('promise banner', () => {
  it('parses stored timestamps and rejects junk', () => {
    expect(parseStoredTimestamp('1710000000000')).toBe(1710000000000);
    expect(parseStoredTimestamp(null)).toBeNull();
    expect(parseStoredTimestamp('nope')).toBeNull();
    expect(parseStoredTimestamp('-1')).toBeNull();
  });

  it('hides a dismissed banner even inside the first week', () => {
    expect(
      shouldShowPromiseBanner(1_000, { dismissed: true, firstSeenAt: 1_000 })
    ).toBe(false);
  });

  it('hides after seven days from first sighting', () => {
    const firstSeenAt = 10_000;
    expect(
      shouldShowPromiseBanner(firstSeenAt + PROMISE_BANNER_TTL_MS - 1, {
        dismissed: false,
        firstSeenAt,
      })
    ).toBe(true);
    expect(
      shouldShowPromiseBanner(firstSeenAt + PROMISE_BANNER_TTL_MS, {
        dismissed: false,
        firstSeenAt,
      })
    ).toBe(false);
  });

  it('hides after an absolute launch-week cutoff', () => {
    const until = '2026-08-26T00:00:00.000Z';
    const expiry = parseAbsoluteExpiry(until);
    expect(expiry).toBe(Date.parse(until));
    expect(
      shouldShowPromiseBanner(
        expiry! - DAY,
        { dismissed: false, firstSeenAt: null },
        until
      )
    ).toBe(true);
    expect(
      shouldShowPromiseBanner(
        expiry!,
        { dismissed: false, firstSeenAt: null },
        until
      )
    ).toBe(false);
  });

  it('records first seen once and persists dismiss', () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    };

    const first = markPromiseBannerSeen(storage, 50, null);
    expect(first).toBe(50);
    expect(markPromiseBannerSeen(storage, 99, 50)).toBe(50);

    dismissPromiseBanner(storage);
    expect(readPromiseBannerState(storage)).toEqual({
      dismissed: true,
      firstSeenAt: 50,
    });
  });
});
