import { showResultLoader } from './tool-success.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import { hideLoader, showAlert } from '../ui.js';

import { downloadFile, formatBytes } from '../utils/helpers.js';
import { icons, createIcons } from 'lucide';
import { SanitizePdfState } from '@/types';
import { sanitizePdf } from '../utils/sanitize.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
} from './launch-context.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.ts';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

const SANITIZE_CHECKBOX_IDS = [
  'flatten-forms',
  'remove-metadata',
  'remove-annotations',
  'remove-javascript',
  'remove-embedded-files',
  'remove-layers',
  'remove-links',
  'remove-structure-tree',
  'remove-markinfo',
  'remove-fonts',
] as const;

const pageState: SanitizePdfState = {
  file: null,
  pdfDoc: null,
};

function applyLaunchContextCheckboxDefaults() {
  const ctx = resolveLaunchContext();
  for (const id of SANITIZE_CHECKBOX_IDS) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) continue;
    input.disabled = false;
    if (ctx.entryId === 'remove-annotations') {
      input.checked = id === 'remove-annotations';
    } else if (ctx.entryId === 'remove-metadata') {
      input.checked = id === 'remove-metadata';
    } else {
      input.checked = id !== 'remove-fonts';
    }
  }
}

function getSelectedOptions() {
  return {
    flattenForms: Boolean(
      (document.getElementById('flatten-forms') as HTMLInputElement | null)
        ?.checked
    ),
    removeMetadata: Boolean(
      (document.getElementById('remove-metadata') as HTMLInputElement | null)
        ?.checked
    ),
    removeAnnotations: Boolean(
      (document.getElementById('remove-annotations') as HTMLInputElement | null)
        ?.checked
    ),
    removeJavascript: Boolean(
      (document.getElementById('remove-javascript') as HTMLInputElement | null)
        ?.checked
    ),
    removeEmbeddedFiles: Boolean(
      (
        document.getElementById(
          'remove-embedded-files'
        ) as HTMLInputElement | null
      )?.checked
    ),
    removeLayers: Boolean(
      (document.getElementById('remove-layers') as HTMLInputElement | null)
        ?.checked
    ),
    removeLinks: Boolean(
      (document.getElementById('remove-links') as HTMLInputElement | null)
        ?.checked
    ),
    removeStructureTree: Boolean(
      (
        document.getElementById(
          'remove-structure-tree'
        ) as HTMLInputElement | null
      )?.checked
    ),
    removeMarkInfo: Boolean(
      (document.getElementById('remove-markinfo') as HTMLInputElement | null)
        ?.checked
    ),
    removeFonts: Boolean(
      (document.getElementById('remove-fonts') as HTMLInputElement | null)
        ?.checked
    ),
  };
}

function hasAnyOptionSelected(): boolean {
  return Object.values(getSelectedOptions()).some(Boolean);
}

function resetState() {
  pageState.file = null;
  pageState.pdfDoc = null;

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  applyLaunchContextCheckboxDefaults();
  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.file) {
    const fileDiv = document.createElement('div');
    fileDiv.className =
      'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';
    mountToolInputPreview(fileDiv, pageState.file);

    const infoContainer = document.createElement('div');
    infoContainer.className = 'flex flex-col overflow-hidden';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
    nameSpan.textContent = pageState.file.name;

    const metaSpan = document.createElement('div');
    metaSpan.className = 'text-xs text-gray-400';
    metaSpan.textContent = formatBytes(pageState.file.size);

    infoContainer.append(nameSpan, metaSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${pageState.file.name}`);
    removeBtn.title = `Remove ${pageState.file.name}`;
    removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
    removeBtn.onclick = function () {
      resetState();
    };

    fileDiv.append(infoContainer, removeBtn);
    fileDisplayArea.appendChild(fileDiv);
    createIcons({ icons });

    if (toolOptions) toolOptions.classList.remove('hidden');
    setWorkspaceFiles([pageState.file]);
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
  }
  syncToolOutputToolbar();
}

async function handleFileSelect(files: FileList | null) {
  if (files && files.length > 0) {
    const file = files[0];
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      pageState.file = file;
      await updateUI();
    }
  }
}

async function runSanitize() {
  if (!pageState.file) {
    showAlert('Error', 'No PDF document loaded.');
    return;
  }
  showResultLoader('Sanitizing PDF...');

  try {
    const options = getSelectedOptions();
    const hasAnyOption = Object.values(options).some(Boolean);
    if (!hasAnyOption) {
      showAlert(
        'No Changes',
        'No items were selected for removal or none were found in the PDF.'
      );
      hideLoader();
      return;
    }

    hideLoader();
    const loaded = await loadPdfWithPasswordPrompt(pageState.file);
    if (!loaded) {
      hideLoader();
      return;
    }
    showResultLoader('Sanitizing PDF...');
    loaded.pdf.destroy();
    pageState.file = loaded.file;
    const result = await sanitizePdf(new Uint8Array(loaded.bytes), options);

    downloadFile(
      new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
      pageState.file?.name || 'document.pdf'
    );
  } catch (e: unknown) {
    console.error('Sanitization Error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    showAlert('Error', `An error occurred during sanitization: ${msg}`);
  } finally {
    hideLoader();
  }
}

document.addEventListener('DOMContentLoaded', function () {
  applyLaunchContextToDom(document);
  applyLaunchContextCheckboxDefaults();

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');

  for (const id of SANITIZE_CHECKBOX_IDS) {
    document
      .getElementById(id)
      ?.addEventListener('change', () => syncToolOutputToolbar());
  }

  registerToolOutputSession({
    apply: () => runSanitize(),
    reset: () => resetState(),
    canSave: () => Boolean(pageState.file) && hasAnyOptionSelected(),
    canReset: () => Boolean(pageState.file),
  });

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      void handleFileSelect((e.target as HTMLInputElement).files);
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
      void handleFileSelect(e.dataTransfer?.files ?? null);
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', runSanitize);
  }

  onToolFilesSeeded(() => {
    if (fileInput?.files && fileInput.files.length > 0 && !pageState.file) {
      void handleFileSelect(fileInput.files);
    }
  });
});
