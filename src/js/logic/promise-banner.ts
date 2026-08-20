export const PROMISE_BANNER_DISMISSED_KEY = 'shiftPdfPromiseBannerDismissed';
export const PROMISE_BANNER_FIRST_SEEN_KEY = 'shiftPdfPromiseBannerFirstSeen';
export const PROMISE_BANNER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

export type PromiseBannerState = {
  dismissed: boolean;
  firstSeenAt: number | null;
};

export function parseStoredTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function readPromiseBannerState(
  storage: StorageReader
): PromiseBannerState {
  try {
    return {
      dismissed: storage.getItem(PROMISE_BANNER_DISMISSED_KEY) === 'true',
      firstSeenAt: parseStoredTimestamp(
        storage.getItem(PROMISE_BANNER_FIRST_SEEN_KEY)
      ),
    };
  } catch {
    return { dismissed: false, firstSeenAt: null };
  }
}

export function parseAbsoluteExpiry(
  untilIso: string | undefined
): number | null {
  if (!untilIso) return null;
  const parsed = Date.parse(untilIso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Visible until the visitor dismisses it, until seven days after they first
 * saw it, or until an optional absolute launch-week cutoff — whichever is
 * earliest. Returning visitors should not keep seeing the pitch once they
 * know About and Source live in the footer.
 */
export function shouldShowPromiseBanner(
  now: number,
  state: PromiseBannerState,
  untilIso?: string
): boolean {
  if (state.dismissed) return false;

  const absoluteExpiry = parseAbsoluteExpiry(untilIso);
  if (absoluteExpiry !== null && now >= absoluteExpiry) return false;

  if (
    state.firstSeenAt !== null &&
    now - state.firstSeenAt >= PROMISE_BANNER_TTL_MS
  ) {
    return false;
  }

  return true;
}

export function markPromiseBannerSeen(
  storage: StorageWriter,
  now: number,
  firstSeenAt: number | null
): number {
  if (firstSeenAt !== null) return firstSeenAt;
  try {
    storage.setItem(PROMISE_BANNER_FIRST_SEEN_KEY, String(now));
  } catch {
    // private mode — the card can still show for this session
  }
  return now;
}

export function dismissPromiseBanner(storage: StorageWriter): void {
  try {
    storage.setItem(PROMISE_BANNER_DISMISSED_KEY, 'true');
  } catch {
    // private mode — hide for this session only
  }
}
