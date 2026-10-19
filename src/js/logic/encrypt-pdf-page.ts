import { showResultLoader } from './tool-success.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import { hideLoader, showAlert, showLoader } from '../ui.js';
import {
  downloadFile,
  formatBytes,
  initializeQpdf,
  readFileAsArrayBuffer,
} from '../utils/helpers.js';
import { icons, createIcons } from 'lucide';
import JSZip from 'jszip';
import { QpdfInstanceExtended } from '@/types';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
  setLaunchContext,
} from './launch-context.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
  type ToolOutputKind,
} from './tool-output-toolbar.ts';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

type SecurityMode = 'protect' | 'unlock';

const PERMISSION_CHECKBOX_IDS = [
  'allow-printing',
  'allow-copying',
  'allow-modifying',
  'allow-annotating',
  'allow-filling-forms',
  'allow-document-assembly',
  'allow-page-extraction',
] as const;

const pageState: {
  files: File[];
  activeMode: SecurityMode;
} = {
  files: [],
  activeMode: 'protect',
};

function getInitialModeFromContext(): SecurityMode {
  const entryId = resolveLaunchContext().entryId;
  if (entryId === 'decrypt-pdf' || entryId === 'remove-restrictions') {
    return 'unlock';
  }
  return 'protect';
}

function syncModeUI() {
  const protectBtn = document.getElementById(
    'mode-protect'
  ) as HTMLButtonElement | null;
  const unlockBtn = document.getElementById(
    'mode-unlock'
  ) as HTMLButtonElement | null;
  const protectOptions = document.getElementById('protect-options');
  const unlockOptions = document.getElementById('unlock-options');
  const permissionsSection = document.getElementById('permissions-section');
  const unlockPasswordLabel = document.getElementById('unlock-password-label');

  const isProtect = pageState.activeMode === 'protect';
  if (protectBtn) {
    protectBtn.setAttribute('aria-pressed', String(isProtect));
    protectBtn.classList.toggle('bg-indigo-600', isProtect);
    protectBtn.classList.toggle('text-white', isProtect);
    protectBtn.classList.toggle('text-gray-300', !isProtect);
  }
  if (unlockBtn) {
    unlockBtn.setAttribute('aria-pressed', String(!isProtect));
    unlockBtn.classList.toggle('bg-indigo-600', !isProtect);
    unlockBtn.classList.toggle('text-white', !isProtect);
    unlockBtn.classList.toggle('text-gray-300', isProtect);
  }

  protectOptions?.classList.toggle('hidden', !isProtect);
  unlockOptions?.classList.toggle('hidden', isProtect);

  const entryId = resolveLaunchContext().entryId;
  if (permissionsSection) {
    permissionsSection.classList.toggle(
      'border-indigo-500',
      entryId === 'change-permissions'
    );
  }
  if (unlockPasswordLabel) {
    unlockPasswordLabel.textContent =
      entryId === 'remove-restrictions'
        ? 'Owner / Open Password (Optional)'
        : 'PDF Password';
  }

  syncToolOutputToolbar();
}

function setMode(mode: SecurityMode, entryOverride?: string) {
  pageState.activeMode = mode;
  const nextEntry =
    entryOverride ?? (mode === 'protect' ? 'encrypt-pdf' : 'decrypt-pdf');
  setLaunchContext(nextEntry);
  syncModeUI();
}

function resetState() {
  pageState.files = [];

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileControls = document.getElementById('file-controls');
  if (fileControls) fileControls.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  for (const id of [
    'user-password-input',
    'owner-password-input',
    'current-password',
    'unlock-password',
  ]) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.value = '';
  }

  for (const id of PERMISSION_CHECKBOX_IDS) {
    const box = document.getElementById(id) as HTMLInputElement | null;
    if (box) box.checked = true;
  }

  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');
  const fileControls = document.getElementById('file-controls');

  if (!fileDisplayArea) return;
  fileDisplayArea.innerHTML = '';

  if (pageState.files.length > 0) {
    pageState.files.forEach((file, index) => {
      const fileDiv = document.createElement('div');
      fileDiv.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';
      mountToolInputPreview(fileDiv, file);

      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex flex-col overflow-hidden';

      const nameSpan = document.createElement('div');
      nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      nameSpan.textContent = file.name;

      const metaSpan = document.createElement('div');
      metaSpan.className = 'text-xs text-gray-400';
      metaSpan.textContent = formatBytes(file.size);

      infoContainer.append(nameSpan, metaSpan);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
      removeBtn.title = `Remove ${file.name}`;
      removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
      removeBtn.onclick = function () {
        pageState.files.splice(index, 1);
        if (pageState.files.length === 0) {
          resetState();
        } else {
          void updateUI();
        }
      };

      fileDiv.append(infoContainer, removeBtn);
      fileDisplayArea.appendChild(fileDiv);
    });

    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
    if (fileControls) fileControls.classList.remove('hidden');
    setWorkspaceFiles(pageState.files);
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
    if (fileControls) fileControls.classList.add('hidden');
  }
  syncToolOutputToolbar();
}

function handleFileSelect(files: FileList | File[] | null) {
  if (files && files.length > 0) {
    const pdfFiles = Array.from(files).filter(
      (f) =>
        f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length > 0) {
      pageState.files.push(...pdfFiles);
      void updateUI();
    }
  }
}

function getPermissionCheckboxStates() {
  return {
    allowPrinting: Boolean(
      (document.getElementById('allow-printing') as HTMLInputElement | null)
        ?.checked
    ),
    allowCopying: Boolean(
      (document.getElementById('allow-copying') as HTMLInputElement | null)
        ?.checked
    ),
    allowModifying: Boolean(
      (document.getElementById('allow-modifying') as HTMLInputElement | null)
        ?.checked
    ),
    allowAnnotating: Boolean(
      (document.getElementById('allow-annotating') as HTMLInputElement | null)
        ?.checked
    ),
    allowFillingForms: Boolean(
      (
        document.getElementById(
          'allow-filling-forms'
        ) as HTMLInputElement | null
      )?.checked
    ),
    allowDocumentAssembly: Boolean(
      (
        document.getElementById(
          'allow-document-assembly'
        ) as HTMLInputElement | null
      )?.checked
    ),
    allowPageExtraction: Boolean(
      (
        document.getElementById(
          'allow-page-extraction'
        ) as HTMLInputElement | null
      )?.checked
    ),
  };
}

function buildProtectArgs(inputPath: string, outputPath: string): string[] {
  const userPassword =
    (document.getElementById('user-password-input') as HTMLInputElement | null)
      ?.value || '';
  const ownerPasswordInput =
    (document.getElementById('owner-password-input') as HTMLInputElement | null)
      ?.value || '';
  const currentPassword =
    (document.getElementById('current-password') as HTMLInputElement | null)
      ?.value || '';

  const args = [inputPath];
  if (currentPassword) {
    args.push(`--password=${currentPassword}`);
  }

  const finalUserPassword = userPassword;
  const finalOwnerPassword = ownerPasswordInput || userPassword;
  args.push('--encrypt', finalUserPassword, finalOwnerPassword, '256');

  const perms = getPermissionCheckboxStates();
  const anyUnchecked = Object.values(perms).some((v) => !v);

  if (finalOwnerPassword) {
    if (
      !anyUnchecked &&
      ownerPasswordInput &&
      resolveLaunchContext().entryId === 'encrypt-pdf'
    ) {
      args.push(
        '--modify=none',
        '--extract=n',
        '--print=none',
        '--accessibility=n',
        '--annotate=n',
        '--assemble=n',
        '--form=n',
        '--modify-other=n'
      );
    } else if (anyUnchecked) {
      if (!perms.allowModifying) {
        args.push('--modify=none', '--modify-other=n');
      }
      if (!perms.allowCopying || !perms.allowPageExtraction) {
        args.push('--extract=n');
      }
      if (!perms.allowPrinting) {
        args.push('--print=none');
      }
      if (!perms.allowAnnotating) {
        args.push('--annotate=n');
      }
      if (!perms.allowDocumentAssembly) {
        args.push('--assemble=n');
      }
      if (!perms.allowFillingForms) {
        args.push('--form=n');
      }
    } else if (!ownerPasswordInput && finalUserPassword) {
      args.push('--allow-insecure');
    }
  }

  args.push('--', outputPath);
  return args;
}

function buildUnlockArgs(inputPath: string, outputPath: string): string[] {
  const password =
    (document.getElementById('unlock-password') as HTMLInputElement | null)
      ?.value || '';
  const args = [inputPath];
  if (password) {
    args.push(`--password=${password}`);
  }
  args.push('--decrypt', '--remove-restrictions', '--', outputPath);
  return args;
}

async function processFilesWithQpdf() {
  if (pageState.files.length === 0) {
    showAlert('No File', 'Please upload at least one PDF file.');
    return;
  }

  const entryId = resolveLaunchContext().entryId;
  const userPassword =
    (document.getElementById('user-password-input') as HTMLInputElement | null)
      ?.value || '';
  const ownerPassword =
    (document.getElementById('owner-password-input') as HTMLInputElement | null)
      ?.value || '';
  const unlockPassword =
    (document.getElementById('unlock-password') as HTMLInputElement | null)
      ?.value || '';

  if (pageState.activeMode === 'protect') {
    if (entryId === 'encrypt-pdf' && !userPassword && !ownerPassword) {
      showAlert('Input Required', 'Please enter a user or owner password.');
      return;
    }
  } else if (entryId === 'decrypt-pdf' && !unlockPassword) {
    showAlert('Input Required', 'Please enter the PDF password.');
    return;
  }

  try {
    showLoader('Initializing QPDF...');
    const qpdf: QpdfInstanceExtended = await initializeQpdf();

    const outputs: Array<{ name: string; bytes: Uint8Array }> = [];

    for (let i = 0; i < pageState.files.length; i++) {
      const file = pageState.files[i];
      const inputPath = `/input_${i}.pdf`;
      const outputPath = `/output_${i}.pdf`;

      showResultLoader(
        pageState.activeMode === 'protect'
          ? `Processing ${file.name}...`
          : `Unlocking ${file.name}...`
      );

      const fileBuffer = await readFileAsArrayBuffer(file);
      const uint8Array = new Uint8Array(fileBuffer as ArrayBuffer);
      qpdf.FS.writeFile(inputPath, uint8Array);

      const args =
        pageState.activeMode === 'protect'
          ? buildProtectArgs(inputPath, outputPath)
          : buildUnlockArgs(inputPath, outputPath);

      try {
        qpdf.callMain(args);
        const outputFile = qpdf.FS.readFile(outputPath, {
          encoding: 'binary',
        });
        if (!outputFile || outputFile.length === 0) {
          throw new Error('Operation resulted in an empty file.');
        }
        outputs.push({
          name: file.name,
          bytes: new Uint8Array(outputFile),
        });
      } finally {
        try {
          qpdf.FS.unlink(inputPath);
        } catch {
          // ignore cleanup failure
        }
        try {
          qpdf.FS.unlink(outputPath);
        } catch {
          // ignore cleanup failure
        }
      }
    }

    if (outputs.length === 1) {
      const blob = new Blob([new Uint8Array(outputs[0].bytes)], {
        type: 'application/pdf',
      });
      downloadFile(blob, outputs[0].name);
    } else if (outputs.length > 1) {
      const zip = new JSZip();
      for (const item of outputs) {
        zip.file(item.name, item.bytes, { binary: true });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipFilename =
        pageState.activeMode === 'protect'
          ? 'protected-pdfs.zip'
          : 'unlocked-pdfs.zip';
      downloadFile(zipBlob, zipFilename);
    }
  } catch (error: unknown) {
    console.error('Error during PDF security operation:', error);
    const msg = error instanceof Error ? error.message : String(error);
    showAlert('Operation Failed', `An error occurred: ${msg}`);
  } finally {
    hideLoader();
  }
}

function canCommitSecurityOutput(): boolean {
  if (pageState.files.length === 0) return false;
  const entryId = resolveLaunchContext().entryId;
  if (pageState.activeMode === 'protect') {
    const userPw =
      (
        document.getElementById(
          'user-password-input'
        ) as HTMLInputElement | null
      )?.value || '';
    const ownerPw =
      (
        document.getElementById(
          'owner-password-input'
        ) as HTMLInputElement | null
      )?.value || '';
    return Boolean(userPw || ownerPw);
  }

  // Unlock & Remove Restrictions mode
  if (entryId === 'remove-restrictions') {
    return true;
  }
  const unlockPw =
    (document.getElementById('unlock-password') as HTMLInputElement | null)
      ?.value || '';
  return Boolean(unlockPw);
}

function resolveOutputKind(): ToolOutputKind {
  return pageState.files.length > 1 ? 'multi-pdf-zip' : 'pdf';
}

document.addEventListener('DOMContentLoaded', function () {
  pageState.files = [];
  applyLaunchContextToDom(document);
  pageState.activeMode = getInitialModeFromContext();
  syncModeUI();

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');

  document
    .getElementById('mode-protect')
    ?.addEventListener('click', () => setMode('protect'));
  document
    .getElementById('mode-unlock')
    ?.addEventListener('click', () => setMode('unlock'));

  for (const id of [
    'user-password-input',
    'owner-password-input',
    'current-password',
    'unlock-password',
  ]) {
    document
      .getElementById(id)
      ?.addEventListener('input', () => syncToolOutputToolbar());
  }

  for (const id of PERMISSION_CHECKBOX_IDS) {
    document.getElementById(id)?.addEventListener('change', () => {
      syncToolOutputToolbar();
    });
  }

  registerToolOutputSession({
    apply: () => processFilesWithQpdf(),
    reset: () => resetState(),
    canSave: () => canCommitSecurityOutput(),
    canReset: () => pageState.files.length > 0,
    outputKind: resolveOutputKind,
  });

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      handleFileSelect((e.target as HTMLInputElement).files);
    });

    dropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFileSelect(files);
      }
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (addMoreBtn && fileInput) {
    addMoreBtn.addEventListener('click', function () {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', function () {
      resetState();
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void processFilesWithQpdf();
    });
  }

  onToolFilesSeeded(() => {
    if (
      fileInput?.files &&
      fileInput.files.length > 0 &&
      pageState.files.length === 0
    ) {
      handleFileSelect(fileInput.files);
    }
  });
});
