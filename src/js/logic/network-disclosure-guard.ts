import {
  getNetworkTouchpoint,
  type NetworkTouchpointId,
} from '../config/network-touchpoints.js';

export const NETWORK_DISCLOSURE_STORAGE_KEY =
  'shiftPdfNetworkDisclosuresAccepted';

export const NETWORK_DISCLOSURE_DIALOG_ID = 'shift-network-disclosure-dialog';

export class NetworkDisclosureBlockedError extends Error {
  readonly touchpointId: NetworkTouchpointId;

  constructor(touchpointId: NetworkTouchpointId, message?: string) {
    super(
      message ??
        `Remote service disclosure was cancelled or could not be shown (${touchpointId}).`
    );
    this.name = 'NetworkDisclosureBlockedError';
    this.touchpointId = touchpointId;
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readAcceptedIds(
  storage: StorageLike | null
): Set<NetworkTouchpointId> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(NETWORK_DISCLOSURE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (id): id is NetworkTouchpointId =>
          id === 'timestamp-tsa' || id === 'digital-sign-chain-fetch'
      )
    );
  } catch {
    return new Set();
  }
}

function writeAcceptedIds(
  storage: StorageLike | null,
  ids: Set<NetworkTouchpointId>
): void {
  if (!storage) return;
  try {
    storage.setItem(
      NETWORK_DISCLOSURE_STORAGE_KEY,
      JSON.stringify([...ids].sort())
    );
  } catch {
    // private mode — session-only acceptance still works via in-memory set
  }
}

/** Session fallback when localStorage is unavailable */
const sessionAccepted = new Set<NetworkTouchpointId>();

export function hasAcceptedNetworkDisclosure(
  id: NetworkTouchpointId,
  storage: StorageLike | null = getStorage()
): boolean {
  if (sessionAccepted.has(id)) return true;
  return readAcceptedIds(storage).has(id);
}

export function acceptNetworkDisclosure(
  id: NetworkTouchpointId,
  storage: StorageLike | null = getStorage()
): void {
  sessionAccepted.add(id);
  const ids = readAcceptedIds(storage);
  ids.add(id);
  writeAcceptedIds(storage, ids);
}

export function revokeNetworkDisclosure(
  id: NetworkTouchpointId,
  storage: StorageLike | null = getStorage()
): void {
  sessionAccepted.delete(id);
  const ids = readAcceptedIds(storage);
  ids.delete(id);
  writeAcceptedIds(storage, ids);
}

export function revokeAllNetworkDisclosures(
  storage: StorageLike | null = getStorage()
): void {
  sessionAccepted.clear();
  if (!storage) return;
  try {
    storage.removeItem(NETWORK_DISCLOSURE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function listAcceptedNetworkDisclosures(
  storage: StorageLike | null = getStorage()
): NetworkTouchpointId[] {
  const ids = new Set([...sessionAccepted, ...readAcceptedIds(storage)]);
  return [...ids].sort();
}

/** Test helper — clears in-memory acceptance without touching storage unless asked. */
export function resetNetworkDisclosureSessionForTests(): void {
  sessionAccepted.clear();
}

export function closeNetworkDisclosureDialog(root: Document = document): void {
  root.getElementById(NETWORK_DISCLOSURE_DIALOG_ID)?.remove();
}

function canRenderDisclosure(root: Document): boolean {
  return Boolean(root?.body?.appendChild);
}

function buildMessage(id: NetworkTouchpointId): {
  title: string;
  bodyHtml: string;
} {
  const tp = getNetworkTouchpoint(id);
  const policy = tp.policyUrl
    ? `<p class="shift-network-disclosure-policy"><a href="${tp.policyUrl}" target="_blank" rel="noopener noreferrer">Privacy policy</a>${
        tp.helpUrl
          ? ` · <a href="${tp.helpUrl}" target="_blank" rel="noopener noreferrer">About local processing</a>`
          : ''
      }</p>`
    : '';

  return {
    title: 'Remote service required',
    bodyHtml: `
      <p class="shift-network-disclosure-lead">
        <strong>${escapeHtml(tp.action)}</strong> contacts a remote service before it can finish.
      </p>
      <dl class="shift-network-disclosure-dl">
        <dt>Service</dt>
        <dd>${escapeHtml(tp.provider)}</dd>
        <dt>What leaves this device</dt>
        <dd>${escapeHtml(tp.dataLeavingDevice)}</dd>
        <dt>Purpose</dt>
        <dd>${escapeHtml(tp.purpose)}</dd>
      </dl>
      ${policy}
      <p class="shift-network-disclosure-remember">
        Choosing Continue remembers this for <strong>${escapeHtml(tp.action)}</strong>.
        Clear remembered choices anytime in Settings → Preferences.
      </p>
    `,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Shows the pre-use disclosure when needed. Returns true only after Continue
 * (or a prior acceptance). Fail-closed: returns false if the dialog cannot
 * render. Never contacts the network itself.
 */
export async function ensureNetworkDisclosure(
  id: NetworkTouchpointId,
  options: { root?: Document; remember?: boolean } = {}
): Promise<boolean> {
  const root = options.root ?? document;
  const remember = options.remember !== false;

  if (hasAcceptedNetworkDisclosure(id)) {
    return true;
  }

  if (!canRenderDisclosure(root)) {
    return false;
  }

  closeNetworkDisclosureDialog(root);

  const { title, bodyHtml } = buildMessage(id);

  return new Promise((resolve) => {
    const previouslyFocused = root.activeElement as HTMLElement | null;
    let settled = false;

    const overlay = root.createElement('div');
    overlay.id = NETWORK_DISCLOSURE_DIALOG_ID;
    overlay.className =
      'shift-confirm-overlay shift-network-disclosure-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'shift-network-disclosure-title');
    overlay.setAttribute(
      'aria-describedby',
      'shift-network-disclosure-message'
    );
    overlay.dataset.networkTouchpoint = id;

    const panel = root.createElement('div');
    panel.className = 'shift-confirm-panel shift-network-disclosure-panel';

    const heading = root.createElement('h2');
    heading.id = 'shift-network-disclosure-title';
    heading.className = 'shift-confirm-title';
    heading.textContent = title;

    const body = root.createElement('div');
    body.id = 'shift-network-disclosure-message';
    body.className = 'shift-confirm-message shift-network-disclosure-message';
    body.innerHTML = bodyHtml;

    const actions = root.createElement('div');
    actions.className = 'shift-confirm-actions';

    const cancel = root.createElement('button');
    cancel.type = 'button';
    cancel.className =
      'shift-button shift-button-secondary shift-network-disclosure-cancel';
    cancel.textContent = 'Cancel';

    const cont = root.createElement('button');
    cont.type = 'button';
    cont.className = 'shift-button shift-network-disclosure-continue';
    cont.textContent = 'Continue';

    const focusables = [cancel, cont];

    const settle = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      root.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      previouslyFocused?.focus?.();
      if (accepted && remember) {
        acceptNetworkDisclosure(id);
      }
      resolve(accepted);
    };

    function onKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const active = root.activeElement;
      const index = focusables.indexOf(active as HTMLButtonElement);
      if (index === -1) {
        event.preventDefault();
        (event.shiftKey ? cancel : cont).focus();
        return;
      }
      event.preventDefault();
      const next = event.shiftKey
        ? focusables[(index - 1 + focusables.length) % focusables.length]
        : focusables[(index + 1) % focusables.length];
      next.focus();
    }

    cancel.addEventListener('click', () => settle(false));
    cont.addEventListener('click', () => settle(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) settle(false);
    });
    root.addEventListener('keydown', onKeydown, true);

    actions.append(cancel, cont);
    panel.append(heading, body, actions);
    overlay.append(panel);

    try {
      root.body.appendChild(overlay);
    } catch {
      settled = true;
      resolve(false);
      return;
    }

    // Prefer Cancel as initial focus so Enter cannot accidentally approve a
    // remote transfer. Users explicitly activate Continue.
    cancel.focus();
  });
}

/**
 * Fail-closed gate used by remote-service entry points before any network I/O.
 */
export async function requireNetworkDisclosure(
  id: NetworkTouchpointId,
  options?: { root?: Document; remember?: boolean }
): Promise<void> {
  const ok = await ensureNetworkDisclosure(id, options);
  if (!ok) {
    throw new NetworkDisclosureBlockedError(id);
  }
}
