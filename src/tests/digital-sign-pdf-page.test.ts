import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMESTAMP_TSA_PRESETS } from '../js/config/timestamp-tsa';

const {
  loadPdfWithPasswordPromptMock,
  signPdfMock,
  timestampPdfMock,
  parseCombinedPemMock,
  getCertificateInfoMock,
  validatePdfSignaturesMock,
} = vi.hoisted(() => ({
  loadPdfWithPasswordPromptMock: vi.fn(),
  signPdfMock: vi.fn(
    async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
  ),
  timestampPdfMock: vi.fn(
    async () => new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
  ),
  parseCombinedPemMock: vi.fn(() => ({
    certificate: { subject: { getField: () => ({ value: 'Test Signer' }) } },
    privateKey: {},
    certChain: [],
  })),
  getCertificateInfoMock: vi.fn(() => ({
    subject: 'CN=Test Signer',
    issuer: 'CN=Test CA',
    validFrom: new Date('2025-01-01T00:00:00Z'),
    validTo: new Date('2027-01-01T00:00:00Z'),
    serialNumber: '01',
  })),
  validatePdfSignaturesMock: vi.fn(async () => [
    {
      signerName: 'Alice Example',
      signerOrg: 'Example Corp',
      signerEmail: 'alice@example.com',
      issuer: 'Example Root CA',
      issuerOrg: 'Example Trust',
      serialNumber: 'AABBCC',
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validTo: new Date('2027-01-01T00:00:00Z'),
      signatureDate: new Date('2026-01-15T12:00:00Z'),
      reason: 'Approved',
      location: 'Victoria, BC',
      isValid: true,
      isExpired: false,
      isSelfSigned: false,
      isTrusted: true,
      algorithms: { digest: 'SHA-256', signature: 'RSA' },
      coverageStatus: 'full' as const,
      cryptoVerified: true,
      cryptoVerificationStatus: 'verified' as const,
      usesInsecureDigest: false,
    },
  ]),
}));

vi.mock('../js/utils/password-prompt.js', () => ({
  loadPdfWithPasswordPrompt: loadPdfWithPasswordPromptMock,
}));

vi.mock('../js/logic/digital-sign-pdf.js', () => ({
  signPdf: signPdfMock,
  timestampPdf: timestampPdfMock,
  parsePfxFile: vi.fn(),
  parseCombinedPem: parseCombinedPemMock,
  getCertificateInfo: getCertificateInfoMock,
}));

vi.mock('../js/logic/validate-signature-pdf.js', () => ({
  validatePdfSignatures: validatePdfSignaturesMock,
}));

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

import {
  acceptNetworkDisclosure,
  resetNetworkDisclosureSessionForTests,
  revokeAllNetworkDisclosures,
} from '../js/logic/network-disclosure-guard';
import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_PRINT_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import {
  hasOpenWithSelection,
  readPersistedOpenFile,
  clearPersistedOpenFile,
} from '../js/logic/open-file-store';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

function loadDigitalSignBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/digital-sign-pdf.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

describe('digital-sign-pdf.html consolidated Tool Surface (digital-sign-pdf, validate-signature-pdf, timestamp-pdf)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    await clearPersistedOpenFile();
    resetNetworkDisclosureSessionForTests();
    revokeAllNetworkDisclosures();
    acceptNetworkDisclosure('digital-sign-chain-fetch');
    acceptNetworkDisclosure('timestamp-tsa');
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');

    loadPdfWithPasswordPromptMock.mockImplementation(async (file: File) => ({
      file,
      bytes: await file.arrayBuffer(),
      pdf: { numPages: 2, destroy: vi.fn() },
    }));
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('hosts Sign with Certificate, Validate Signatures (inspection-only hiding Save/Overwrite), and RFC 3161 Timestamp tabs, syncs ?entry= while keeping the loaded PDF, and offers 1-click Fill & Sign handoff to edit-pdf.html?entry=sign-pdf', async () => {
    window.history.replaceState(
      {},
      '',
      '/digital-sign-pdf.html?entry=validate-signature-pdf'
    );
    document.title = 'Digital Signature | Shift PDF';
    loadDigitalSignBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/digital-sign-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Validate Signature');

    const tabSign = document.getElementById('tab-sign') as HTMLButtonElement;
    const tabValidate = document.getElementById(
      'tab-validate'
    ) as HTMLButtonElement;
    const tabTimestamp = document.getElementById(
      'tab-timestamp'
    ) as HTMLButtonElement;

    expect(tabValidate.getAttribute('aria-pressed')).toBe('true');
    expect(tabSign.getAttribute('aria-pressed')).toBe('false');
    expect(tabTimestamp.getAttribute('aria-pressed')).toBe('false');

    // Upload a signed PDF on Validate Signatures tab -> auto-runs validatePdfSignatures and renders #results-container
    const pdfFile = new File(['%PDF-1.4 signed'], 'signed-agreement.pdf', {
      type: 'application/pdf',
    });
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);
    Object.defineProperty(fileInput, 'files', {
      value: [pdfFile],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(validatePdfSignaturesMock).toHaveBeenCalledTimes(1);
      expect(
        document.getElementById('results-container')?.textContent
      ).toContain('Alice Example');
    });

    // On Validate Signatures tab, outputKind is 'inspection-only': Save/Overwrite hidden, Download & Print visible and enabled
    const header = document.querySelector('.shift-pdf-viewer-header');
    expect(
      header
        ?.querySelector('[data-viewer-chrome="save"]')
        ?.hasAttribute('hidden')
    ).toBe(true);
    expect(
      header
        ?.querySelector('[data-viewer-chrome="print"]')
        ?.hasAttribute('hidden')
    ).toBe(false);
    expect(
      (document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    expect(
      (document.getElementById(TOOL_OUTPUT_PRINT_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    // Switch to RFC 3161 Timestamp tab -> syncs ?entry=timestamp-pdf, restores Save in header, and keeps loaded PDF
    tabTimestamp.click();
    expect(window.location.search).toBe('?entry=timestamp-pdf');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Timestamp PDF');
    expect(
      header
        ?.querySelector('[data-viewer-chrome="save"]')
        ?.hasAttribute('hidden')
    ).toBe(false);
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'signed-agreement.pdf'
    );

    const tsaSelect = document.getElementById(
      'tsa-preset'
    ) as HTMLSelectElement;
    expect(tsaSelect.options.length).toBeGreaterThanOrEqual(
      TIMESTAMP_TSA_PRESETS.length
    );

    // Commit on Timestamp tab via header Download -> calls timestampPdf and stages PDF
    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(timestampPdfMock).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        TIMESTAMP_TSA_PRESETS[0].url
      );
      expect(getLatestPdfOutput()?.filename).toBe('signed-agreement.pdf');
    });

    // Switch to Sign with Certificate tab -> syncs to bare /digital-sign-pdf.html
    clearLatestPdfOutput();
    tabSign.click();
    expect(window.location.search).toBe('');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Digital Signature');

    // Load unencrypted PEM certificate and commit -> calls signPdf and stages PDF
    const certInput = document.getElementById('cert-input') as HTMLInputElement;
    const pemFile = new File(
      [
        '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
      ],
      'signer.pem',
      { type: 'application/x-pem-file' }
    );
    Object.defineProperty(certInput, 'files', {
      value: [pemFile],
      configurable: true,
    });
    certInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(parseCombinedPemMock).toHaveBeenCalled();
    });

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(signPdfMock).toHaveBeenCalledTimes(1);
      expect(getLatestPdfOutput()?.filename).toBe('signed-agreement.pdf');
    });

    // 1-click Fill & Sign handoff banner (#sign-pdf-handoff) persists the loaded PDF and marks Open with selection
    const handoffBtn = document.getElementById('sign-pdf-handoff');
    expect(handoffBtn).not.toBeNull();
    handoffBtn?.click();

    await vi.waitFor(async () => {
      expect(hasOpenWithSelection()).toBe(true);
      const persisted = await readPersistedOpenFile();
      expect(persisted?.name).toBe('signed-agreement.pdf');
    });
  });
});
