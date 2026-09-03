import JSZip from 'jszip';
import { createIcons, icons } from 'lucide';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import {
  downloadFile,
  formatBytes,
  readFileAsArrayBuffer,
} from '../utils/helpers';
import { deduplicateFileName } from '../utils/deduplicate-filename.js';
import { initializeGlobalShortcuts } from '../utils/shortcuts-init.js';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import {
  showWasmRequiredDialog,
  WasmProvider,
} from '../utils/wasm-provider.js';
import { batchDecryptIfNeeded } from '../utils/password-prompt.js';
import { initI18n, t } from '../i18n/i18n';
import { state } from '../state.js';
import { markFileFromHandoff, setWorkspaceFiles } from './workspace-files.js';
import { onToolFilesSeeded } from './tool-file-seed.js';

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const fileDisplayArea = document.getElementById('file-display-area');
  const fileControls = document.getElementById('file-controls');
  const convertOptions = document.getElementById('convert-options');
  const processBtn = document.getElementById(
    'process-btn'
  ) as HTMLButtonElement | null;
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const statusMessage = document.getElementById('status-message');

  let worker: Worker | null = null;

  const showStatus = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.className = `mt-4 p-3 rounded-lg text-sm ${
      type === 'success'
        ? 'bg-green-900 text-green-200'
        : type === 'error'
          ? 'bg-red-900 text-red-200'
          : 'bg-blue-900 text-blue-200'
    }`;
    statusMessage.classList.remove('hidden');
  };

  const hideStatus = () => statusMessage?.classList.add('hidden');

  const updateUI = () => {
    if (!fileDisplayArea || !fileControls || !convertOptions || !processBtn) {
      return;
    }

    fileDisplayArea.innerHTML = '';

    if (state.files.length === 0) {
      fileControls.classList.add('hidden');
      convertOptions.classList.add('hidden');
      processBtn.disabled = true;
      setWorkspaceFiles([]);
      return;
    }

    state.files.forEach((file, index) => {
      const row = document.createElement('div');
      row.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';

      const name = document.createElement('span');
      name.className = 'truncate font-medium text-gray-200';
      name.textContent = file.name;

      const size = document.createElement('span');
      size.className = 'flex-shrink-0 ml-4 text-gray-400';
      size.textContent = formatBytes(file.size);

      const remove = document.createElement('button');
      remove.className = 'ml-4 text-red-400 hover:text-red-300 flex-shrink-0';
      remove.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
      remove.onclick = () => {
        state.files = state.files.filter((_: File, i: number) => i !== index);
        updateUI();
      };

      row.append(name, size, remove);
      fileDisplayArea.appendChild(row);
    });

    createIcons({ icons });
    fileControls.classList.remove('hidden');
    convertOptions.classList.remove('hidden');
    processBtn.disabled = false;
    setWorkspaceFiles(state.files);
  };

  const resetState = () => {
    state.files = [];
    if (fileInput) fileInput.value = '';
    updateUI();
  };

  const handleWorkerMessage = async (event: MessageEvent) => {
    if (processBtn) processBtn.disabled = false;

    if (event.data.status === 'error') {
      const message = event.data.message || t('common.unknownError');
      console.error('Worker Error:', message);
      showStatus(t('tools:pdfToJson.status.workerError', { message }), 'error');
      return;
    }

    if (event.data.status !== 'success') return;

    const jsonFiles = event.data.jsonFiles as Array<{
      name: string;
      data: ArrayBuffer;
    }>;

    try {
      showStatus(t('tools:pdfToJson.status.creatingZip'), 'info');

      const zip = new JSZip();
      const usedNames = new Set<string>();
      jsonFiles.forEach(({ name, data }) => {
        const jsonName = name.replace(/\.pdf$/i, '.json');
        zip.file(
          deduplicateFileName(jsonName, usedNames),
          new Uint8Array(data)
        );
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'pdfs-to-json.zip');

      showStatus(t('tools:pdfToJson.status.success'), 'success');
      resetState();
      setTimeout(hideStatus, 3000);
    } catch (error) {
      console.error('Error creating ZIP:', error);
      showStatus(
        t('tools:pdfToJson.status.zipError', {
          message:
            error instanceof Error ? error.message : t('common.unknownError'),
        }),
        'error'
      );
    }
  };

  const getWorker = () => {
    if (!worker) {
      worker = new Worker(
        import.meta.env.BASE_URL + 'workers/pdf-to-json.worker.js'
      );
      worker.onmessage = (event: MessageEvent) => {
        void handleWorkerMessage(event);
      };
    }
    return worker;
  };

  const convert = async () => {
    if (state.files.length === 0) {
      showStatus(t('tools:pdfToJson.status.selectAtLeastOne'), 'error');
      return;
    }

    if (!isCpdfAvailable()) {
      showWasmRequiredDialog('cpdf');
      return;
    }

    try {
      if (processBtn) processBtn.disabled = true;
      showStatus(t('tools:pdfToJson.status.checkingEncrypted'), 'info');
      state.files = await batchDecryptIfNeeded(state.files);

      showStatus(t('tools:pdfToJson.status.readingFiles'), 'info');
      const fileBuffers = await Promise.all(
        state.files.map((file: File) => readFileAsArrayBuffer(file))
      );

      showStatus(t('tools:pdfToJson.status.converting'), 'info');
      getWorker().postMessage(
        {
          command: 'convert',
          fileBuffers,
          fileNames: state.files.map((file: File) => file.name),
          cpdfUrl: WasmProvider.getUrl('cpdf')! + 'coherentpdf.browser.min.js',
        },
        fileBuffers
      );
    } catch (error) {
      console.error('Error reading files:', error);
      showStatus(
        t('tools:pdfToJson.status.readError', {
          message:
            error instanceof Error ? error.message : t('common.unknownError'),
        }),
        'error'
      );
      if (processBtn) processBtn.disabled = false;
    }
  };

  const handleFileSelect = (files: FileList | File[] | null): boolean => {
    const pdfFiles = Array.from(files ?? []).filter(
      (file) =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length === 0) return false;
    state.files = [...state.files, ...pdfFiles];
    updateUI();
    return true;
  };

  fileInput?.addEventListener('change', (event) => {
    handleFileSelect((event.target as HTMLInputElement).files);
  });

  fileInput?.addEventListener('click', () => {
    fileInput.value = '';
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('bg-gray-700');
  });

  dropZone?.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dropZone.classList.remove('bg-gray-700');
  });

  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('bg-gray-700');
    handleFileSelect(event.dataTransfer?.files ?? null);
  });

  addMoreBtn?.addEventListener('click', () => fileInput?.click());
  clearFilesBtn?.addEventListener('click', resetState);
  processBtn?.addEventListener('click', () => void convert());

  listenForShiftFileHandoff({
    onFile: (file) => {
      markFileFromHandoff(file);
      return handleFileSelect([file]);
    },
  });

  onToolFilesSeeded(updateUI);

  void (async () => {
    await initI18n();
    showStatus(t('tools:pdfToJson.status.getStarted'), 'info');
    initializeGlobalShortcuts();
  })();
});
