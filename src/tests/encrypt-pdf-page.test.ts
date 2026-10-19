import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const { initializeQpdfMock, qpdfCallMainCalls } = vi.hoisted(() => {
  const calls: string[][] = [];
  const files = new Map<string, Uint8Array>();
  const mockInstance = {
    FS: {
      writeFile: vi.fn((path: string, data: Uint8Array) => {
        files.set(path, new Uint8Array(data));
      }),
      readFile: vi.fn((path: string) => {
        return (
          files.get(path) ?? new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])
        );
      }),
      unlink: vi.fn((path: string) => {
        files.delete(path);
      }),
    },
    callMain: vi.fn((args: string[]) => {
      calls.push(args);
      const outPath = args[args.length - 1] ?? '/output.pdf';
      files.set(outPath, new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]));
    }),
  };
  return {
    initializeQpdfMock: vi.fn(async () => mockInstance),
    qpdfCallMainCalls: calls,
  };
});

vi.mock('../js/utils/helpers.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../js/utils/helpers.js')>();
  return {
    ...actual,
    initializeQpdf: initializeQpdfMock,
  };
});

vi.mock('lucide', () => ({
  createIcons: vi.fn(),
  icons: {},
}));

import {
  clearLatestPdfOutput,
  getLatestPdfOutput,
  initShiftPdfSave,
} from '../js/logic/shift-pdf-save';
import {
  TOOL_OUTPUT_DOWNLOAD_ID,
  TOOL_OUTPUT_SAVE_ID,
  initToolOutputToolbar,
} from '../js/logic/tool-output-toolbar';
import { resetWorkspaceFileIndicator } from '../js/logic/workspace-files';
import { resetToolFilesSeededState } from '../js/logic/tool-file-seed';

const PERMISSION_CHECKBOX_IDS = [
  'allow-printing',
  'allow-copying',
  'allow-modifying',
  'allow-annotating',
  'allow-filling-forms',
  'allow-document-assembly',
  'allow-page-extraction',
] as const;

function loadEncryptPdfBodyFromHtml(): void {
  const rawHtml = readFileSync(
    resolve(process.cwd(), 'src/pages/encrypt-pdf.html'),
    'utf8'
  );
  const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : rawHtml)
    .replace(/\{\{>\s*navbar\s*\}\}/g, '')
    .replace(/\{\{>\s*footer\s*\}\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

describe('encrypt-pdf.html consolidated Tool Surface (encrypt-pdf, change-permissions, decrypt-pdf, remove-restrictions)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qpdfCallMainCalls.length = 0;
    clearLatestPdfOutput();
    resetToolFilesSeededState();
    resetWorkspaceFileIndicator();
    document.documentElement.removeAttribute('data-launch-entry');
    document.documentElement.removeAttribute('data-launch-surface');
    document.documentElement.removeAttribute('data-launch-context-applied');
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.resetModules();
  });

  it('opens in Protect & Permissions on ?entry=change-permissions with all 7 permission checkboxes expanded, accepts 1+ PDFs across mode tabs without dropping files, syncs ?entry= on tab switch, and unlocks in 1 click without a password on ?entry=remove-restrictions', async () => {
    window.history.replaceState(
      {},
      '',
      '/encrypt-pdf.html?entry=change-permissions'
    );
    document.title = 'Encrypt PDF | Shift PDF';
    loadEncryptPdfBodyFromHtml();

    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/encrypt-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Change Permissions');
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);

    const protectTab = document.getElementById(
      'mode-protect'
    ) as HTMLButtonElement;
    const unlockTab = document.getElementById(
      'mode-unlock'
    ) as HTMLButtonElement;
    expect(protectTab.getAttribute('aria-pressed')).toBe('true');
    expect(unlockTab.getAttribute('aria-pressed')).toBe('false');

    for (const id of PERMISSION_CHECKBOX_IDS) {
      const box = document.getElementById(id) as HTMLInputElement;
      expect(box).not.toBeNull();
      expect(box.checked).toBe(true);
    }

    // Upload 2 PDFs
    const pdf1 = new File(['%PDF-1.4 1'], 'contract-a.pdf', {
      type: 'application/pdf',
    });
    const pdf2 = new File(['%PDF-1.4 2'], 'contract-b.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', {
      value: [pdf1, pdf2],
      configurable: true,
    });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Uncheck allow-printing and allow-copying, set owner password, and commit 2 PDFs -> stages multi-PDF zip
    (document.getElementById('allow-printing') as HTMLInputElement).checked =
      false;
    (document.getElementById('allow-copying') as HTMLInputElement).checked =
      false;
    const ownerPw = document.getElementById(
      'owner-password-input'
    ) as HTMLInputElement;
    ownerPw.value = 'owner-secret';
    ownerPw.dispatchEvent(new Event('input', { bubbles: true }));

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();

    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toMatch(/\.zip$/);
    expect(qpdfCallMainCalls).toHaveLength(2);
    expect(qpdfCallMainCalls[0]).toEqual(
      expect.arrayContaining(['--encrypt', '', 'owner-secret', '256'])
    );
    expect(qpdfCallMainCalls[0]).toEqual(
      expect.arrayContaining(['--print=none', '--extract=n'])
    );

    const zip = await JSZip.loadAsync(
      await getLatestPdfOutput()!.blob.arrayBuffer()
    );
    expect(Object.keys(zip.files).sort()).toEqual([
      'contract-a.pdf',
      'contract-b.pdf',
    ]);

    // Switch to Unlock & Remove Restrictions tab -> syncs ?entry=decrypt-pdf and keeps both files loaded
    clearLatestPdfOutput();
    qpdfCallMainCalls.length = 0;
    unlockTab.click();

    expect(window.location.search).toBe('?entry=decrypt-pdf');
    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Decrypt PDF');
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'contract-a.pdf'
    );
    expect(document.getElementById('file-display-area')?.textContent).toContain(
      'contract-b.pdf'
    );

    // Now test ?entry=remove-restrictions with a single PDF and NO password entered (1-click unlock)
    vi.resetModules();
    clearLatestPdfOutput();
    qpdfCallMainCalls.length = 0;
    window.history.replaceState(
      {},
      '',
      '/encrypt-pdf.html?entry=remove-restrictions'
    );
    document.documentElement.removeAttribute('data-launch-context-applied');
    loadEncryptPdfBodyFromHtml();
    initShiftPdfSave();
    initToolOutputToolbar();
    await import('../js/logic/encrypt-pdf-page.ts');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    expect(
      document.querySelector('.shift-pdf-viewer-header h1')?.textContent
    ).toBe('Remove Restrictions');
    expect(
      document.getElementById('mode-unlock')?.getAttribute('aria-pressed')
    ).toBe('true');

    const singleInput = document.getElementById(
      'file-input'
    ) as HTMLInputElement;
    Object.defineProperty(singleInput, 'files', {
      value: [pdf1],
      configurable: true,
    });
    singleInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      expect(
        document.getElementById('tool-options')?.classList.contains('hidden')
      ).toBe(false);
    });

    // Without typing any password, Save and Download are enabled on ?entry=remove-restrictions
    const unlockPassword = document.getElementById(
      'unlock-password'
    ) as HTMLInputElement;
    expect(unlockPassword.value).toBe('');
    expect(
      (document.getElementById(TOOL_OUTPUT_SAVE_ID) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    document.getElementById(TOOL_OUTPUT_DOWNLOAD_ID)?.click();
    await vi.waitFor(() => {
      expect(getLatestPdfOutput()).not.toBeNull();
    });
    expect(getLatestPdfOutput()?.filename).toBe('contract-a.pdf');
    expect(qpdfCallMainCalls[0]).toEqual(
      expect.arrayContaining(['--decrypt', '--remove-restrictions'])
    );
  });
});
