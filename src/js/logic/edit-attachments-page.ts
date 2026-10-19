import { showResultLoader } from './tool-success.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import { AttachmentInfo } from '@/types';
import { hideLoader, showAlert, showLoader } from '../ui.js';
import { downloadBlob, downloadFile, formatBytes } from '../utils/helpers.js';
import { createIcons, icons } from 'lucide';
import JSZip from 'jszip';
import { isCpdfAvailable } from '../utils/cpdf-helper.js';
import {
  showWasmRequiredDialog,
  WasmProvider,
} from '../utils/wasm-provider.js';
import {
  batchDecryptIfNeeded,
  loadPdfWithPasswordPrompt,
} from '../utils/password-prompt.js';
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

type AttachmentMode = 'edit' | 'add' | 'extract';

interface IndexedAttachment extends AttachmentInfo {
  key: string;
  fileIndex: number;
  fileName: string;
  data: Uint8Array;
}

const worker = new Worker(
  import.meta.env.BASE_URL + 'workers/edit-attachments.worker.js'
);

const pageState: {
  files: File[];
  allAttachments: IndexedAttachment[];
  attachmentsToRemove: Set<string>;
  attachmentsToAdd: File[];
  activeMode: AttachmentMode;
  totalPages: number;
} = {
  files: [],
  allAttachments: [],
  attachmentsToRemove: new Set(),
  attachmentsToAdd: [],
  activeMode: 'edit',
  totalPages: 0,
};

let pendingWorkerResolver: ((data: Record<string, unknown>) => void) | null =
  null;

worker.onmessage = function (e: MessageEvent) {
  const data = e.data as Record<string, unknown>;
  if (pendingWorkerResolver) {
    const resolve = pendingWorkerResolver;
    pendingWorkerResolver = null;
    resolve(data);
    return;
  }

  if (data.status === 'error') {
    hideLoader();
    showAlert('Error', String(data.message || 'Unknown error occurred.'));
  }
};

worker.onerror = function (error) {
  hideLoader();
  console.error('Worker error:', error);
  if (pendingWorkerResolver) {
    const resolve = pendingWorkerResolver;
    pendingWorkerResolver = null;
    resolve({
      status: 'error',
      message: 'Worker error occurred. Check console for details.',
    });
    return;
  }
  showAlert('Error', 'Worker error occurred. Check console for details.');
};

function callWorker(
  message: Record<string, unknown>,
  transfer: ArrayBuffer[] = []
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    pendingWorkerResolver = resolve;
    worker.postMessage(message, transfer);
  });
}

function getInitialModeFromContext(): AttachmentMode {
  const entryId = resolveLaunchContext().entryId;
  if (entryId === 'add-attachments') return 'add';
  if (entryId === 'extract-attachments') return 'extract';
  return 'edit';
}

function entryIdForMode(mode: AttachmentMode): string {
  if (mode === 'add') return 'add-attachments';
  if (mode === 'extract') return 'extract-attachments';
  return 'edit-attachments';
}

function syncModeButtonsAndPanels() {
  const modeButtons: Array<[AttachmentMode, string]> = [
    ['edit', 'mode-edit'],
    ['add', 'mode-add'],
    ['extract', 'mode-extract'],
  ];

  for (const [mode, btnId] of modeButtons) {
    const btn = document.getElementById(btnId) as HTMLButtonElement | null;
    if (!btn) continue;
    const isActive = pageState.activeMode === mode;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.classList.toggle('bg-indigo-600', isActive);
    btn.classList.toggle('text-white', isActive);
    btn.classList.toggle('text-gray-300', !isActive);
  }

  const addSection = document.getElementById('add-attachments-section');
  const existingSection = document.getElementById(
    'existing-attachments-section'
  );
  if (addSection) {
    addSection.classList.toggle('hidden', pageState.activeMode === 'extract');
  }
  if (existingSection && addSection && addSection.parentElement) {
    const parent = addSection.parentElement;
    if (pageState.activeMode === 'add') {
      parent.insertBefore(addSection, existingSection);
    } else {
      parent.insertBefore(existingSection, addSection);
    }
  }

  renderAttachmentsList();
  syncToolOutputToolbar();
}

function setMode(mode: AttachmentMode, updateUrl: boolean = true) {
  pageState.activeMode = mode;
  if (updateUrl) {
    setLaunchContext(entryIdForMode(mode));
  }
  syncModeButtonsAndPanels();
}

function resetState() {
  pageState.files = [];
  pageState.allAttachments = [];
  pageState.attachmentsToRemove.clear();
  pageState.attachmentsToAdd = [];
  pageState.totalPages = 0;

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileControls = document.getElementById('file-controls');
  if (fileControls) fileControls.classList.add('hidden');

  const attachmentsList = document.getElementById('attachments-list');
  if (attachmentsList) attachmentsList.innerHTML = '';

  const attachmentFileList = document.getElementById('attachment-file-list');
  if (attachmentFileList) attachmentFileList.innerHTML = '';

  const attachmentInput = document.getElementById(
    'attachment-files-input'
  ) as HTMLInputElement | null;
  if (attachmentInput) attachmentInput.value = '';

  const attachmentLevelOptions = document.getElementById(
    'attachment-level-options'
  );
  if (attachmentLevelOptions) attachmentLevelOptions.classList.add('hidden');

  const pageRangeWrapper = document.getElementById('page-range-wrapper');
  if (pageRangeWrapper) pageRangeWrapper.classList.add('hidden');

  const statusMessage = document.getElementById('status-message');
  if (statusMessage) statusMessage.classList.add('hidden');

  const processBtn = document.getElementById('process-btn');
  if (processBtn) processBtn.classList.add('hidden');

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  const documentRadio = document.querySelector(
    'input[name="attachment-level"][value="document"]'
  ) as HTMLInputElement | null;
  if (documentRadio) documentRadio.checked = true;

  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

async function downloadAllAttachmentsZip() {
  if (pageState.allAttachments.length === 0) return;
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const att of pageState.allAttachments) {
    const base =
      (att.name || 'attachment')
        .split(/[/\\]/)
        .pop()
        ?.replace(/^\.+/, '')
        .replace(/\p{Cc}/gu, '')
        .trim() || 'attachment';
    let safeName =
      pageState.files.length > 1
        ? `${att.fileName.replace(/\.pdf$/i, '')}_${base}`
        : base;
    let counter = 1;
    while (usedNames.has(safeName)) {
      const dot = safeName.lastIndexOf('.');
      safeName =
        dot > 0
          ? `${safeName.slice(0, dot)}_${counter}${safeName.slice(dot)}`
          : `${safeName}_${counter}`;
      counter++;
    }
    usedNames.add(safeName);
    zip.file(safeName, new Uint8Array(att.data));
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, 'extracted-attachments.zip');
}

function renderAttachmentsList() {
  const attachmentsList = document.getElementById('attachments-list');
  const processBtn = document.getElementById('process-btn');

  if (!attachmentsList) return;
  attachmentsList.innerHTML = '';

  if (pageState.allAttachments.length === 0) {
    const noAttachments = document.createElement('p');
    noAttachments.className = 'text-gray-400 text-center py-4';
    noAttachments.textContent = 'No attachments found in this PDF.';
    attachmentsList.appendChild(noAttachments);
    return;
  }

  const controlsContainer = document.createElement('div');
  controlsContainer.className =
    'attachments-controls mb-4 flex justify-end gap-2';

  const downloadAllBtn = document.createElement('button');
  downloadAllBtn.id = 'download-all-attachments-btn';
  downloadAllBtn.type = 'button';
  downloadAllBtn.className =
    'btn bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm';
  downloadAllBtn.textContent = 'Download All (.zip)';
  downloadAllBtn.onclick = () => {
    void downloadAllAttachmentsZip();
  };
  controlsContainer.appendChild(downloadAllBtn);

  const removeAllBtn = document.createElement('button');
  removeAllBtn.id = 'remove-all-attachments-btn';
  removeAllBtn.type = 'button';
  removeAllBtn.className =
    'btn bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-sm';
  const allSelected = pageState.allAttachments.every((att) =>
    pageState.attachmentsToRemove.has(att.key)
  );
  removeAllBtn.textContent = allSelected
    ? 'Deselect All'
    : 'Remove All Attachments';
  removeAllBtn.onclick = function () {
    if (pageState.allAttachments.length === 0) return;
    const currentlyAllSelected = pageState.allAttachments.every((att) =>
      pageState.attachmentsToRemove.has(att.key)
    );
    if (currentlyAllSelected) {
      pageState.attachmentsToRemove.clear();
    } else {
      pageState.allAttachments.forEach((att) =>
        pageState.attachmentsToRemove.add(att.key)
      );
    }
    renderAttachmentsList();
    syncToolOutputToolbar();
  };

  if (pageState.activeMode !== 'extract') {
    controlsContainer.appendChild(removeAllBtn);
  }
  attachmentsList.appendChild(controlsContainer);

  for (const attachment of pageState.allAttachments) {
    const isMarkedRemove =
      pageState.activeMode !== 'extract' &&
      pageState.attachmentsToRemove.has(attachment.key);

    const attachmentDiv = document.createElement('div');
    attachmentDiv.className = `flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700 ${
      isMarkedRemove ? 'opacity-50 line-through' : ''
    }`;
    attachmentDiv.dataset.attachmentIndex = attachment.index.toString();
    attachmentDiv.dataset.attachmentKey = attachment.key;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'flex-1';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-white font-medium block';
    nameSpan.textContent = attachment.name;

    const levelSpan = document.createElement('span');
    levelSpan.className = 'text-gray-400 text-sm block';
    const levelLabel =
      attachment.page === 0
        ? 'Document-level attachment'
        : `Page ${attachment.page} attachment`;
    levelSpan.textContent =
      pageState.files.length > 1
        ? `${attachment.fileName} • ${levelLabel}`
        : levelLabel;

    infoDiv.append(nameSpan, levelSpan);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'flex items-center gap-2';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.setAttribute('data-attachment-download', attachment.key);
    downloadBtn.className =
      'btn bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded text-sm';
    downloadBtn.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i>';
    downloadBtn.title = `Download ${attachment.name}`;
    downloadBtn.setAttribute('aria-label', `Download ${attachment.name}`);
    downloadBtn.onclick = function () {
      downloadBlob(
        new Blob([new Uint8Array(attachment.data)]),
        attachment.name
      );
    };
    actionsDiv.appendChild(downloadBtn);

    if (pageState.activeMode !== 'extract') {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.setAttribute('data-attachment-remove', attachment.key);
      removeBtn.className = `${
        isMarkedRemove ? 'bg-gray-600' : 'bg-red-600'
      } hover:bg-red-700 text-white px-3 py-1 rounded text-sm`;
      removeBtn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i>';
      removeBtn.title = 'Remove attachment';
      removeBtn.setAttribute('aria-label', `Remove ${attachment.name}`);
      removeBtn.onclick = function () {
        if (pageState.attachmentsToRemove.has(attachment.key)) {
          pageState.attachmentsToRemove.delete(attachment.key);
        } else {
          pageState.attachmentsToRemove.add(attachment.key);
        }
        renderAttachmentsList();
        syncToolOutputToolbar();
      };
      actionsDiv.appendChild(removeBtn);
    }

    attachmentDiv.append(infoDiv, actionsDiv);
    attachmentsList.appendChild(attachmentDiv);
  }

  createIcons({ icons });
  if (processBtn) processBtn.classList.remove('hidden');
}

function updateAttachmentToAddList() {
  const attachmentFileList = document.getElementById('attachment-file-list');
  const attachmentLevelOptions = document.getElementById(
    'attachment-level-options'
  );
  const processBtn = document.getElementById('process-btn');

  if (!attachmentFileList) return;
  attachmentFileList.innerHTML = '';

  pageState.attachmentsToAdd.forEach(function (file, idx) {
    const div = document.createElement('div');
    div.className =
      'flex justify-between items-center p-2 bg-gray-800 rounded-md text-white';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'truncate text-sm';
    nameSpan.textContent = file.name;

    const rightDiv = document.createElement('div');
    rightDiv.className = 'flex items-center gap-2';

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'text-xs text-gray-400';
    sizeSpan.textContent = formatBytes(file.size);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'shift-tool-file-remove';
    removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
    removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
    removeBtn.onclick = () => {
      pageState.attachmentsToAdd.splice(idx, 1);
      updateAttachmentToAddList();
      syncToolOutputToolbar();
    };

    rightDiv.append(sizeSpan, removeBtn);
    div.append(nameSpan, rightDiv);
    attachmentFileList.appendChild(div);
  });

  createIcons({ icons });

  if (pageState.attachmentsToAdd.length > 0) {
    if (attachmentLevelOptions)
      attachmentLevelOptions.classList.remove('hidden');
    if (processBtn) processBtn.classList.remove('hidden');
  } else {
    if (attachmentLevelOptions) attachmentLevelOptions.classList.add('hidden');
  }
  syncToolOutputToolbar();
}

async function loadAttachmentsForAllFiles() {
  if (pageState.files.length === 0) return;

  showLoader('Loading attachments...');

  if (!isCpdfAvailable()) {
    showWasmRequiredDialog('cpdf');
    hideLoader();
    return;
  }

  try {
    const collected: IndexedAttachment[] = [];
    for (let i = 0; i < pageState.files.length; i++) {
      const file = pageState.files[i];
      const fileBuffer = await file.arrayBuffer();
      const response = await callWorker(
        {
          command: 'get-attachments',
          fileBuffer,
          fileName: file.name,
          fileIndex: i,
          cpdfUrl: WasmProvider.getUrl('cpdf')! + 'coherentpdf.browser.min.js',
        },
        [fileBuffer]
      );

      if (
        response.status === 'success' &&
        Array.isArray(response.attachments)
      ) {
        if (i === 0 && typeof response.totalPages === 'number') {
          pageState.totalPages = response.totalPages;
          const totalPagesSpan = document.getElementById(
            'attachment-total-pages'
          );
          if (totalPagesSpan && pageState.totalPages > 0) {
            totalPagesSpan.textContent = pageState.totalPages.toString();
          }
        }
        for (const raw of response.attachments as Array<{
          index: number;
          name: string;
          page: number;
          data: ArrayBuffer;
        }>) {
          collected.push({
            index: raw.index,
            fileIndex: i,
            fileName: file.name,
            key: `${i}:${raw.index}`,
            name: raw.name,
            page: raw.page,
            data: new Uint8Array(raw.data),
          });
        }
      }
    }

    pageState.allAttachments = collected;
    renderAttachmentsList();
  } catch (error) {
    console.error('Error loading attachments:', error);
    showAlert('Error', 'Failed to load attachments from PDF.');
  } finally {
    hideLoader();
    syncToolOutputToolbar();
  }
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
        pageState.attachmentsToRemove.clear();
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

    await loadAttachmentsForAllFiles();
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
    if (fileControls) fileControls.classList.add('hidden');
    syncToolOutputToolbar();
  }
}

async function applyAttachmentOutput() {
  if (pageState.files.length === 0) {
    showAlert('Error', 'No PDF file loaded.');
    return;
  }

  if (!isCpdfAvailable()) {
    showWasmRequiredDialog('cpdf');
    return;
  }

  const cpdfUrl = WasmProvider.getUrl('cpdf')! + 'coherentpdf.browser.min.js';

  if (pageState.activeMode === 'extract') {
    showResultLoader('Extracting attachments...');
    try {
      const decryptedFiles = await batchDecryptIfNeeded(pageState.files);
      pageState.files = decryptedFiles;

      const fileBuffers: ArrayBuffer[] = [];
      const fileNames: string[] = [];
      for (const file of pageState.files) {
        fileBuffers.push(await file.arrayBuffer());
        fileNames.push(file.name);
      }

      const response = await callWorker(
        {
          command: 'extract-attachments',
          fileBuffers,
          fileNames,
          cpdfUrl,
        },
        fileBuffers
      );

      if (response.status === 'error') {
        showAlert(
          'No Attachments',
          String(
            response.message ||
              'The PDF file(s) do not contain any attachments to extract.'
          )
        );
        return;
      }

      const extracted = (response.attachments ?? []) as Array<{
        name: string;
        data: ArrayBuffer;
      }>;
      if (extracted.length === 0) {
        showAlert(
          'No Attachments',
          'The PDF file(s) do not contain any attachments to extract.'
        );
        return;
      }

      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const attachment of extracted) {
        const base =
          (attachment.name || 'attachment')
            .split(/[/\\]/)
            .pop()
            ?.replace(/^\.+/, '')
            .replace(/\p{Cc}/gu, '')
            .trim() || 'attachment';
        let safeName = base;
        let counter = 1;
        while (usedNames.has(safeName)) {
          const dot = base.lastIndexOf('.');
          safeName =
            dot > 0
              ? `${base.slice(0, dot)}_${counter}${base.slice(dot)}`
              : `${base}_${counter}`;
          counter++;
        }
        usedNames.add(safeName);
        zip.file(safeName, new Uint8Array(attachment.data));
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'extracted-attachments.zip');
    } finally {
      hideLoader();
    }
    return;
  }

  // Edit / Add mode
  const hasRemovals = pageState.attachmentsToRemove.size > 0;
  const hasAdditions = pageState.attachmentsToAdd.length > 0;
  if (!hasRemovals && !hasAdditions) {
    showAlert(
      'No Changes',
      'Select attachments to remove or add new files to attach.'
    );
    return;
  }

  const attachmentLevel =
    (
      document.querySelector(
        'input[name="attachment-level"]:checked'
      ) as HTMLInputElement | null
    )?.value || 'document';
  let pageRange = '';
  if (hasAdditions && attachmentLevel === 'page') {
    const pageRangeInput = document.getElementById(
      'attachment-page-range'
    ) as HTMLInputElement | null;
    pageRange = pageRangeInput?.value?.trim() || '';
    if (!pageRange) {
      showAlert(
        'Error',
        'Please specify a page range for page-level attachments.'
      );
      return;
    }
  }

  showResultLoader('Processing attachments...');
  try {
    const rawAddBuffers: ArrayBuffer[] = [];
    const attachmentNames: string[] = [];
    for (const attFile of pageState.attachmentsToAdd) {
      rawAddBuffers.push(await attFile.arrayBuffer());
      attachmentNames.push(attFile.name);
    }

    const modifiedFiles: Array<{ name: string; bytes: Uint8Array }> = [];

    for (let i = 0; i < pageState.files.length; i++) {
      const pdfFile = pageState.files[i];
      const indicesToRemove = pageState.allAttachments
        .filter(
          (att) =>
            att.fileIndex === i && pageState.attachmentsToRemove.has(att.key)
        )
        .map((att) => att.index);

      const pdfBuffer = await pdfFile.arrayBuffer();
      const perFileAddBuffers = rawAddBuffers.map((buf) => buf.slice(0));

      let response: Record<string, unknown>;
      if (hasAdditions && indicesToRemove.length === 0) {
        response = await callWorker(
          {
            command: 'add-attachments',
            pdfBuffer,
            fileName: pdfFile.name,
            attachmentBuffers: perFileAddBuffers,
            attachmentNames,
            attachmentLevel,
            pageRange,
            cpdfUrl,
          },
          [pdfBuffer, ...perFileAddBuffers]
        );
      } else {
        response = await callWorker(
          {
            command: 'edit-attachments',
            fileBuffer: pdfBuffer,
            fileName: pdfFile.name,
            attachmentsToRemove: indicesToRemove,
            attachmentBuffers: perFileAddBuffers,
            attachmentNames,
            attachmentLevel,
            pageRange,
            cpdfUrl,
          },
          [pdfBuffer, ...perFileAddBuffers]
        );
      }

      if (response.status === 'error' || !response.modifiedPDF) {
        throw new Error(
          String(response.message || `Failed to process ${pdfFile.name}`)
        );
      }

      modifiedFiles.push({
        name: pdfFile.name,
        bytes: new Uint8Array(response.modifiedPDF as ArrayBuffer),
      });
    }

    if (modifiedFiles.length === 1) {
      downloadFile(
        new Blob([new Uint8Array(modifiedFiles[0].bytes)], {
          type: 'application/pdf',
        }),
        modifiedFiles[0].name
      );
    } else {
      const zip = new JSZip();
      for (const item of modifiedFiles) {
        zip.file(item.name, item.bytes, { binary: true });
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'attachments-updated.zip');
    }
  } catch (error) {
    console.error('Error processing attachments:', error);
    showAlert(
      'Error',
      error instanceof Error ? error.message : 'Failed to process attachments.'
    );
  } finally {
    hideLoader();
  }
}

async function handleFileSelect(files: FileList | File[] | null) {
  if (!files || files.length === 0) return;
  const candidates = Array.from(files).filter(
    (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
  );
  if (candidates.length === 0) return;

  for (const candidate of candidates) {
    const result = await loadPdfWithPasswordPrompt(candidate);
    if (!result) continue;
    const numPages = (result.pdf as { numPages?: number })?.numPages ?? 0;
    if (pageState.files.length === 0 && numPages > 0) {
      pageState.totalPages = numPages;
      const totalPagesSpan = document.getElementById('attachment-total-pages');
      if (totalPagesSpan) totalPagesSpan.textContent = numPages.toString();
    }
    result.pdf.destroy();
    pageState.files.push(result.file);
  }

  await updateUI();
}

function handleAttachmentSelect(files: FileList | null) {
  if (files && files.length > 0) {
    pageState.attachmentsToAdd.push(...Array.from(files));
    updateAttachmentToAddList();
  }
}

function resolveOutputKind(): ToolOutputKind {
  if (pageState.activeMode === 'extract') {
    return 'non-pdf';
  }
  if (pageState.files.length > 1) {
    return 'multi-pdf-zip';
  }
  return 'pdf';
}

document.addEventListener('DOMContentLoaded', function () {
  applyLaunchContextToDom(document);
  pageState.activeMode = getInitialModeFromContext();
  syncModeButtonsAndPanels();

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const addMoreBtn = document.getElementById('add-more-btn');
  const clearFilesBtn = document.getElementById('clear-files-btn');
  const attachmentInput = document.getElementById(
    'attachment-files-input'
  ) as HTMLInputElement | null;
  const attachmentDropZone = document.getElementById('attachment-drop-zone');
  const processBtn = document.getElementById('process-btn');
  const pageRangeWrapper = document.getElementById('page-range-wrapper');

  document
    .getElementById('mode-edit')
    ?.addEventListener('click', () => setMode('edit', true));
  document
    .getElementById('mode-add')
    ?.addEventListener('click', () => setMode('add', true));
  document
    .getElementById('mode-extract')
    ?.addEventListener('click', () => setMode('extract', true));

  registerToolOutputSession({
    apply: () => applyAttachmentOutput(),
    reset: () => resetState(),
    canSave: () => {
      if (pageState.activeMode === 'extract') return false;
      if (pageState.files.length === 0) return false;
      return (
        pageState.attachmentsToRemove.size > 0 ||
        pageState.attachmentsToAdd.length > 0
      );
    },
    canDownload: () => {
      if (pageState.files.length === 0) return false;
      if (pageState.activeMode === 'extract') {
        return true;
      }
      return (
        pageState.attachmentsToRemove.size > 0 ||
        pageState.attachmentsToAdd.length > 0
      );
    },
    canReset: () =>
      pageState.files.length > 0 || pageState.attachmentsToAdd.length > 0,
    outputKind: resolveOutputKind,
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
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void handleFileSelect(files);
      }
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (addMoreBtn && fileInput) {
    addMoreBtn.addEventListener('click', () => {
      fileInput.value = '';
      fileInput.click();
    });
  }

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
      resetState();
    });
  }

  if (attachmentInput && attachmentDropZone) {
    attachmentInput.addEventListener('change', function (e) {
      handleAttachmentSelect((e.target as HTMLInputElement).files);
    });

    attachmentDropZone.addEventListener('dragover', function (e) {
      e.preventDefault();
      attachmentDropZone.classList.add('bg-gray-700');
    });

    attachmentDropZone.addEventListener('dragleave', function (e) {
      e.preventDefault();
      attachmentDropZone.classList.remove('bg-gray-700');
    });

    attachmentDropZone.addEventListener('drop', function (e) {
      e.preventDefault();
      attachmentDropZone.classList.remove('bg-gray-700');
      const files = e.dataTransfer?.files;
      if (files) {
        handleAttachmentSelect(files);
      }
    });

    attachmentInput.addEventListener('click', function () {
      attachmentInput.value = '';
    });
  }

  const attachmentLevelRadios = document.querySelectorAll(
    'input[name="attachment-level"]'
  );
  attachmentLevelRadios.forEach(function (radio) {
    radio.addEventListener('change', function (e) {
      const value = (e.target as HTMLInputElement).value;
      if (value === 'page' && pageRangeWrapper) {
        pageRangeWrapper.classList.remove('hidden');
      } else if (pageRangeWrapper) {
        pageRangeWrapper.classList.add('hidden');
      }
    });
  });

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void applyAttachmentOutput();
    });
  }

  onToolFilesSeeded(() => {
    if (
      fileInput?.files &&
      fileInput.files.length > 0 &&
      pageState.files.length === 0
    ) {
      void handleFileSelect(fileInput.files);
    }
  });
});
