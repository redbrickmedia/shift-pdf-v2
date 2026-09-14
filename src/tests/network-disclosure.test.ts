import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  NETWORK_CALL_INVENTORY,
  NETWORK_TOUCHPOINTS,
  REMOTE_SERVICE_TOUCHPOINTS,
  getNetworkTouchpoint,
} from '@/js/config/network-touchpoints';
import {
  NETWORK_DISCLOSURE_DIALOG_ID,
  acceptNetworkDisclosure,
  ensureNetworkDisclosure,
  hasAcceptedNetworkDisclosure,
  listAcceptedNetworkDisclosures,
  requireNetworkDisclosure,
  resetNetworkDisclosureSessionForTests,
  revokeAllNetworkDisclosures,
  revokeNetworkDisclosure,
  NetworkDisclosureBlockedError,
} from '@/js/logic/network-disclosure-guard';

const REPO_ROOT = path.resolve(__dirname, '../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('About remote-service copy', () => {
  it('uses the exact “will say so” wording', () => {
    const about = readRepoFile('about.html');
    const normalized = about.replace(/\s+/g, ' ');
    expect(normalized).toContain(
      'A feature that requires a remote service will say so before you use it.'
    );
    expect(normalized).not.toContain(
      'A feature that requires a remote service may say so'
    );
  });
});

describe('network touchpoint registry', () => {
  it('declares action, provider, data leaving device, purpose, and policy URL', () => {
    for (const tp of REMOTE_SERVICE_TOUCHPOINTS) {
      expect(tp.action.length).toBeGreaterThan(0);
      expect(tp.provider.length).toBeGreaterThan(0);
      expect(tp.dataLeavingDevice.length).toBeGreaterThan(0);
      expect(tp.purpose.length).toBeGreaterThan(0);
      expect(tp.policyUrl).toBeTruthy();
      expect(tp.toolIds.length).toBeGreaterThan(0);
      expect(tp.guardEntryPoints.length).toBeGreaterThan(0);
    }
  });

  it('registers every inventory remote-service row', () => {
    const remoteRows = NETWORK_CALL_INVENTORY.filter(
      (row) => row.kind === 'remote-service'
    );
    expect(remoteRows.length).toBeGreaterThan(0);

    for (const row of remoteRows) {
      expect(row.touchpointId).toBeTruthy();
      expect(NETWORK_TOUCHPOINTS[row.touchpointId!]).toBeDefined();
      expect(row.touchpointId).toBe(row.id);
    }
  });

  it('keeps remote-asset / host / metadata rows out of the guarded registry', () => {
    const nonRemote = NETWORK_CALL_INVENTORY.filter(
      (row) => row.kind !== 'remote-service'
    );
    expect(nonRemote.length).toBeGreaterThan(0);
    for (const row of nonRemote) {
      expect(row.touchpointId).toBeUndefined();
      expect(
        NETWORK_TOUCHPOINTS[row.id as keyof typeof NETWORK_TOUCHPOINTS]
      ).toBeUndefined();
    }
  });

  it('marks static page disclosures for page-based remote tools', () => {
    for (const tp of REMOTE_SERVICE_TOUCHPOINTS) {
      if (!tp.staticPagePaths?.length) continue;
      for (const pagePath of tp.staticPagePaths) {
        const html = readRepoFile(pagePath);
        expect(html).toContain(`data-network-touchpoint="${tp.id}"`);
      }
    }
  });

  it('requires guard hooks at registered entry points', () => {
    const digitalSignSource = readRepoFile('src/js/logic/digital-sign-pdf.ts');

    for (const tp of REMOTE_SERVICE_TOUCHPOINTS) {
      for (const entry of tp.guardEntryPoints) {
        expect(digitalSignSource).toContain(`export async function ${entry}`);
        expect(digitalSignSource).toContain(
          `requireNetworkDisclosure('${tp.id}')`
        );
      }
    }

    // Ordering: disclosure must appear before createCorsAwareFetch usage in
    // each guarded function body.
    for (const entry of ['timestampPdf', 'signPdf'] as const) {
      const fnStart = digitalSignSource.indexOf(
        `export async function ${entry}`
      );
      expect(fnStart).toBeGreaterThan(-1);
      const nextExport = digitalSignSource.indexOf(
        'export async function',
        fnStart + 1
      );
      const body = digitalSignSource.slice(
        fnStart,
        nextExport === -1 ? undefined : nextExport
      );
      const disclosureAt = body.indexOf('requireNetworkDisclosure');
      const corsAt = body.indexOf('createCorsAwareFetch');
      expect(disclosureAt).toBeGreaterThan(-1);
      expect(corsAt).toBeGreaterThan(disclosureAt);
    }
  });

  it('inventories known network source paths that exist on disk', () => {
    for (const row of NETWORK_CALL_INVENTORY) {
      for (const sourcePath of row.sourcePaths) {
        expect(
          fs.existsSync(path.join(REPO_ROOT, sourcePath)),
          `missing inventory path: ${sourcePath}`
        ).toBe(true);
      }
    }
  });
});

describe('network disclosure guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    resetNetworkDisclosureSessionForTests();
    revokeAllNetworkDisclosures();
    resetNetworkDisclosureSessionForTests();
  });

  afterEach(() => {
    document.getElementById(NETWORK_DISCLOSURE_DIALOG_ID)?.remove();
    resetNetworkDisclosureSessionForTests();
    revokeAllNetworkDisclosures();
  });

  it('fails closed when the dialog cannot render', async () => {
    const root = document.implementation.createHTMLDocument('empty');
    // no body append target
    Object.defineProperty(root, 'body', { value: null, configurable: true });

    await expect(
      ensureNetworkDisclosure('timestamp-tsa', { root })
    ).resolves.toBe(false);
    await expect(
      requireNetworkDisclosure('timestamp-tsa', { root })
    ).rejects.toBeInstanceOf(NetworkDisclosureBlockedError);
  });

  it('shows Continue/Cancel before resolving and blocks Cancel', async () => {
    const pending = ensureNetworkDisclosure('timestamp-tsa');
    // Microtask: dialog should exist before acceptance
    await Promise.resolve();

    const dialog = document.getElementById(NETWORK_DISCLOSURE_DIALOG_ID);
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('role')).toBe('alertdialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.textContent).toContain(
      getNetworkTouchpoint('timestamp-tsa').provider
    );

    const cancel = dialog?.querySelector(
      '.shift-network-disclosure-cancel'
    ) as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);

    cancel.click();
    await expect(pending).resolves.toBe(false);
    expect(hasAcceptedNetworkDisclosure('timestamp-tsa')).toBe(false);
    expect(document.getElementById(NETWORK_DISCLOSURE_DIALOG_ID)).toBeNull();
  });

  it('Continue remembers acceptance and skips the next prompt', async () => {
    const first = ensureNetworkDisclosure('digital-sign-chain-fetch');
    await Promise.resolve();
    document
      .querySelector<HTMLButtonElement>('.shift-network-disclosure-continue')
      ?.click();
    await expect(first).resolves.toBe(true);
    expect(hasAcceptedNetworkDisclosure('digital-sign-chain-fetch')).toBe(true);
    expect(listAcceptedNetworkDisclosures()).toContain(
      'digital-sign-chain-fetch'
    );

    // Second call must not open another dialog.
    await expect(
      ensureNetworkDisclosure('digital-sign-chain-fetch')
    ).resolves.toBe(true);
    expect(document.getElementById(NETWORK_DISCLOSURE_DIALOG_ID)).toBeNull();
  });

  it('revokes remembered acceptance so the dialog returns', async () => {
    acceptNetworkDisclosure('timestamp-tsa');
    expect(hasAcceptedNetworkDisclosure('timestamp-tsa')).toBe(true);
    revokeNetworkDisclosure('timestamp-tsa');
    expect(hasAcceptedNetworkDisclosure('timestamp-tsa')).toBe(false);

    const pending = ensureNetworkDisclosure('timestamp-tsa');
    await Promise.resolve();
    expect(
      document.getElementById(NETWORK_DISCLOSURE_DIALOG_ID)
    ).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>('.shift-network-disclosure-cancel')
      ?.click();
    await pending;
  });

  it('Cancel prevents requireNetworkDisclosure from succeeding', async () => {
    const pending = requireNetworkDisclosure('timestamp-tsa');
    await Promise.resolve();
    document
      .querySelector<HTMLButtonElement>('.shift-network-disclosure-cancel')
      ?.click();
    await expect(pending).rejects.toBeInstanceOf(NetworkDisclosureBlockedError);
  });
});
