import { mountToolInputPreview } from './tool-input-preview.js';
import { createIcons, icons } from 'lucide';
import { showAlert, showLoader, hideLoader } from '../ui.js';
import {
  readFileAsArrayBuffer,
  formatBytes,
  downloadFile,
  escapeHtml,
} from '../utils/helpers.js';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { t } from '../i18n/i18n';
import {
  signPdf,
  timestampPdf,
  parsePfxFile,
  parseCombinedPem,
  getCertificateInfo,
} from './digital-sign-pdf.js';
import { validatePdfSignatures } from './validate-signature-pdf.js';
import { TIMESTAMP_TSA_PRESETS } from '../config/timestamp-tsa.js';
import {
  NetworkDisclosureBlockedError,
  requireNetworkDisclosure,
} from './network-disclosure-guard.js';
import forge from 'node-forge';
import {
  SignatureInfo,
  VisibleSignatureOptions,
  DigitalSignState,
  SignatureValidationResult,
} from '@/types';
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
import {
  markOpenWithSelection,
  writePersistedOpenFile,
} from './open-file-store.js';

type DigitalSignTab = 'sign' | 'validate' | 'timestamp';

const state: DigitalSignState & {
  activeTab: DigitalSignTab;
  results: SignatureValidationResult[];
  trustedCertFile: File | null;
  trustedCert: forge.pki.Certificate | null;
} = {
  pdfFile: null,
  pdfBytes: null,
  certFile: null,
  certData: null,
  sigImageData: null,
  sigImageType: null,
  activeTab: 'sign',
  results: [],
  trustedCertFile: null,
  trustedCert: null,
};

function getElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function getInitialTabFromContext(): DigitalSignTab {
  const entryId = resolveLaunchContext().entryId;
  if (entryId === 'validate-signature-pdf') return 'validate';
  if (entryId === 'timestamp-pdf') return 'timestamp';
  return 'sign';
}

function entryIdForTab(tab: DigitalSignTab): string {
  if (tab === 'validate') return 'validate-signature-pdf';
  if (tab === 'timestamp') return 'timestamp-pdf';
  return 'digital-sign-pdf';
}

function syncTabsUI(): void {
  const tabMap: Array<[DigitalSignTab, string, string]> = [
    ['sign', 'tab-sign', 'panel-sign'],
    ['validate', 'tab-validate', 'panel-validate'],
    ['timestamp', 'tab-timestamp', 'panel-timestamp'],
  ];

  for (const [tab, btnId, panelId] of tabMap) {
    const btn = getElement<HTMLButtonElement>(btnId);
    const panel = getElement<HTMLDivElement>(panelId);
    const isActive = state.activeTab === tab;
    if (btn) {
      btn.setAttribute('aria-pressed', String(isActive));
      btn.classList.toggle('bg-indigo-600', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('text-gray-300', !isActive);
    }
    if (panel) {
      panel.classList.toggle('hidden', !isActive);
    }
  }

  const signNetworkBanner = getElement<HTMLDivElement>('sign-network-banner');
  if (signNetworkBanner) {
    signNetworkBanner.classList.toggle('hidden', state.activeTab !== 'sign');
  }

  updateProcessButton();
  syncToolOutputToolbar();
}

function setActiveTab(tab: DigitalSignTab, updateUrl: boolean = true): void {
  state.activeTab = tab;
  if (updateUrl) {
    setLaunchContext(entryIdForTab(tab));
  }
  syncTabsUI();
  if (tab === 'validate' && state.pdfBytes) {
    void validateSignatures();
  }
}

function populateTsaPresets(): void {
  const tsaPreset = getElement<HTMLSelectElement>('tsa-preset');
  if (!tsaPreset) return;
  tsaPreset.replaceChildren();
  for (const preset of TIMESTAMP_TSA_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.url;
    option.textContent = preset.label;
    tsaPreset.append(option);
  }
}

function resetState(): void {
  state.pdfFile = null;
  state.pdfBytes = null;
  state.certFile = null;
  state.certData = null;
  state.sigImageData = null;
  state.sigImageType = null;
  state.results = [];
  state.trustedCertFile = null;
  state.trustedCert = null;

  const fileDisplayArea = getElement<HTMLDivElement>('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const certDisplayArea = getElement<HTMLDivElement>('cert-display-area');
  if (certDisplayArea) certDisplayArea.innerHTML = '';

  const customCertDisplayArea = getElement<HTMLDivElement>(
    'custom-cert-display-area'
  );
  if (customCertDisplayArea) customCertDisplayArea.innerHTML = '';

  const resultsSection = getElement<HTMLDivElement>('results-section');
  if (resultsSection) resultsSection.classList.add('hidden');

  const resultsContainer = getElement<HTMLDivElement>('results-container');
  if (resultsContainer) resultsContainer.innerHTML = '';

  const toolOptions = getElement<HTMLDivElement>('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const fileInput = getElement<HTMLInputElement>('file-input');
  if (fileInput) fileInput.value = '';

  const certInput = getElement<HTMLInputElement>('cert-input');
  if (certInput) certInput.value = '';

  const customCertInput = getElement<HTMLInputElement>('custom-cert-input');
  if (customCertInput) customCertInput.value = '';

  const sigImageInput = getElement<HTMLInputElement>('sig-image-input');
  if (sigImageInput) sigImageInput.value = '';

  const sigImagePreview = getElement<HTMLDivElement>('sig-image-preview');
  if (sigImagePreview) sigImagePreview.classList.add('hidden');

  hidePasswordSection();
  hideSignatureOptions();
  hideCertInfo();
  updateProcessButton();
  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

function resolveOutputKind(): ToolOutputKind {
  if (state.activeTab === 'validate') {
    return 'inspection-only';
  }
  return 'pdf';
}

function canCommitCurrentTab(): boolean {
  if (!state.pdfBytes || !state.pdfFile) return false;
  if (state.activeTab === 'sign') {
    return state.certData !== null;
  }
  if (state.activeTab === 'timestamp') {
    return Boolean(getElement<HTMLSelectElement>('tsa-preset')?.value);
  }
  return false;
}

async function applyActiveTabOutput(): Promise<void> {
  if (state.activeTab === 'sign') {
    await processSignature();
  } else if (state.activeTab === 'timestamp') {
    await processTimestamp();
  } else if (state.activeTab === 'validate' && state.pdfBytes) {
    const blob = new Blob([new Uint8Array(state.pdfBytes)], {
      type: 'application/pdf',
    });
    downloadFile(blob, state.pdfFile?.name ?? 'document.pdf');
  }
}

async function handleSignPdfHandoff(e: Event): Promise<void> {
  e.preventDefault();
  if (state.pdfFile) {
    setWorkspaceFiles([state.pdfFile]);
    await writePersistedOpenFile(state.pdfFile, { source: 'upload' });
  }
  markOpenWithSelection();
  try {
    window.location.assign(
      `${import.meta.env.BASE_URL}edit-pdf.html?entry=sign-pdf`
    );
  } catch {
    // JSDOM does not implement navigation
  }
}

function initializePage(): void {
  const host = getElement<HTMLElement>('tool-uploader') ?? document.body;
  if (host.dataset.digitalSignBound === 'true') return;
  host.dataset.digitalSignBound = 'true';

  state.pdfFile = null;
  state.pdfBytes = null;
  state.certFile = null;
  state.certData = null;
  state.results = [];
  state.trustedCertFile = null;
  state.trustedCert = null;

  applyLaunchContextToDom(document);
  populateTsaPresets();
  state.activeTab = getInitialTabFromContext();
  syncTabsUI();
  createIcons({ icons });

  getElement<HTMLButtonElement>('tab-sign')?.addEventListener('click', () =>
    setActiveTab('sign', true)
  );
  getElement<HTMLButtonElement>('tab-validate')?.addEventListener('click', () =>
    setActiveTab('validate', true)
  );
  getElement<HTMLButtonElement>('tab-timestamp')?.addEventListener(
    'click',
    () => setActiveTab('timestamp', true)
  );

  getElement<HTMLElement>('sign-pdf-handoff')?.addEventListener(
    'click',
    (e) => {
      void handleSignPdfHandoff(e);
    }
  );

  registerToolOutputSession({
    apply: () => applyActiveTabOutput(),
    reset: () => resetState(),
    canSave: () => canCommitCurrentTab(),
    canDownload: () => {
      if (state.activeTab === 'validate') {
        return Boolean(state.pdfBytes && state.pdfFile);
      }
      return canCommitCurrentTab();
    },
    canPrint: () => {
      if (state.activeTab === 'validate') {
        return Boolean(state.pdfBytes && state.pdfFile);
      }
      return canCommitCurrentTab();
    },
    canReset: () => Boolean(state.pdfBytes || state.certFile),
    outputKind: resolveOutputKind,
  });

  const fileInput = getElement<HTMLInputElement>('file-input');
  const dropZone = getElement<HTMLDivElement>('drop-zone');
  const certInput = getElement<HTMLInputElement>('cert-input');
  const certDropZone = getElement<HTMLDivElement>('cert-drop-zone');
  const certPassword = getElement<HTMLInputElement>('cert-password');
  const customCertInput = getElement<HTMLInputElement>('custom-cert-input');
  const customCertDropZone = getElement<HTMLDivElement>(
    'custom-cert-drop-zone'
  );
  const processBtn = getElement<HTMLButtonElement>('process-btn');

  if (fileInput) {
    fileInput.addEventListener('change', handlePdfUpload);
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('bg-gray-700');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('bg-gray-700');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        void handlePdfFile(droppedFiles[0]);
      }
    });
  }

  if (certInput) {
    certInput.addEventListener('change', handleCertUpload);
    certInput.addEventListener('click', () => {
      certInput.value = '';
    });
  }

  if (certDropZone) {
    certDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      certDropZone.classList.add('bg-gray-700');
    });

    certDropZone.addEventListener('dragleave', () => {
      certDropZone.classList.remove('bg-gray-700');
    });

    certDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      certDropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        void handleCertFile(droppedFiles[0]);
      }
    });
  }

  if (customCertInput) {
    customCertInput.addEventListener('change', handleCustomCertUpload);
    customCertInput.addEventListener('click', () => {
      customCertInput.value = '';
    });
  }

  if (customCertDropZone) {
    customCertDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      customCertDropZone.classList.add('bg-gray-700');
    });
    customCertDropZone.addEventListener('dragleave', () => {
      customCertDropZone.classList.remove('bg-gray-700');
    });
    customCertDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      customCertDropZone.classList.remove('bg-gray-700');
      const droppedFiles = e.dataTransfer?.files;
      if (droppedFiles && droppedFiles.length > 0) {
        void handleCustomCertFile(droppedFiles[0]);
      }
    });
  }

  if (certPassword) {
    certPassword.addEventListener('input', () => {
      void handlePasswordInput();
    });
    certPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        void handlePasswordInput();
      }
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', () => {
      void applyActiveTabOutput();
    });
  }

  const enableVisibleSig = getElement<HTMLInputElement>('enable-visible-sig');
  const visibleSigOptions = getElement<HTMLDivElement>('visible-sig-options');
  const sigPage = getElement<HTMLSelectElement>('sig-page');
  const customPageWrapper = getElement<HTMLDivElement>('custom-page-wrapper');
  const sigImageInput = getElement<HTMLInputElement>('sig-image-input');
  const sigImagePreview = getElement<HTMLDivElement>('sig-image-preview');
  const sigImageThumb = getElement<HTMLImageElement>('sig-image-thumb');
  const removeSigImage = getElement<HTMLButtonElement>('remove-sig-image');
  const enableSigText = getElement<HTMLInputElement>('enable-sig-text');
  const sigTextOptions = getElement<HTMLDivElement>('sig-text-options');

  if (enableVisibleSig && visibleSigOptions) {
    enableVisibleSig.addEventListener('change', () => {
      visibleSigOptions.classList.toggle('hidden', !enableVisibleSig.checked);
    });
  }

  if (sigPage && customPageWrapper) {
    sigPage.addEventListener('change', () => {
      customPageWrapper.classList.toggle('hidden', sigPage.value !== 'custom');
    });
  }

  if (sigImageInput) {
    sigImageInput.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files.length > 0) {
        const file = input.files[0];
        const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
        if (!validTypes.includes(file.type)) {
          showAlert(
            t('tools:digitalSignPdf.invalidImageTitle'),
            t('tools:digitalSignPdf.invalidImageMessage')
          );
          return;
        }
        state.sigImageData = (await readFileAsArrayBuffer(file)) as ArrayBuffer;
        state.sigImageType = file.type.replace('image/', '') as
          | 'png'
          | 'jpeg'
          | 'webp';

        if (sigImageThumb && sigImagePreview) {
          const url = URL.createObjectURL(file);
          try {
            const parsed = new URL(url);
            if (parsed.protocol === 'blob:') {
              sigImageThumb.src = parsed.href;
              sigImagePreview.classList.remove('hidden');
            }
          } catch {
            console.warn('Invalid blob URL for signature preview');
          }
        }
      }
    });
  }

  if (removeSigImage && sigImagePreview) {
    removeSigImage.addEventListener('click', () => {
      state.sigImageData = null;
      state.sigImageType = null;
      sigImagePreview.classList.add('hidden');
      if (sigImageInput) sigImageInput.value = '';
    });
  }

  if (enableSigText && sigTextOptions) {
    enableSigText.addEventListener('change', () => {
      sigTextOptions.classList.toggle('hidden', !enableSigText.checked);
    });
  }

  onToolFilesSeeded(() => {
    if (fileInput?.files && fileInput.files.length > 0 && !state.pdfFile) {
      void handlePdfFile(fileInput.files[0]);
    }
  });
}

function handlePdfUpload(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    void handlePdfFile(input.files[0]);
  }
}

async function handlePdfFile(file: File): Promise<void> {
  if (
    file.type !== 'application/pdf' &&
    !file.name.toLowerCase().endsWith('.pdf')
  ) {
    showAlert(
      t('tools:digitalSignPdf.invalidFileTitle'),
      t('tools:digitalSignPdf.invalidFileMessage')
    );
    return;
  }

  state.pdfFile = file;
  state.pdfBytes = new Uint8Array(
    (await readFileAsArrayBuffer(file)) as ArrayBuffer
  );

  const toolOptions = getElement<HTMLDivElement>('tool-options');
  if (toolOptions) toolOptions.classList.remove('hidden');

  await updatePdfDisplay();
  showCertificateSection();
  updateProcessButton();
  syncToolOutputToolbar();

  if (state.activeTab === 'validate') {
    await validateSignatures();
  }
}

async function updatePdfDisplay(): Promise<void> {
  const fileDisplayArea = getElement<HTMLDivElement>('file-display-area');
  if (!fileDisplayArea || !state.pdfFile) return;

  fileDisplayArea.innerHTML = '';

  const fileDiv = document.createElement('div');
  fileDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';
  mountToolInputPreview(fileDiv, state.pdfFile);

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = state.pdfFile.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.textContent = `${formatBytes(state.pdfFile.size)} • ${t('common.loadingPageCount')}`;

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${state.pdfFile.name}`);
  removeBtn.title = `Remove ${state.pdfFile.name}`;
  removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    resetState();
  };

  fileDiv.append(infoContainer, removeBtn);
  fileDisplayArea.appendChild(fileDiv);
  createIcons({ icons });

  if (state.pdfFile) {
    const result = await loadPdfWithPasswordPrompt(state.pdfFile);
    if (!result) {
      resetState();
      return;
    }
    state.pdfFile = result.file;
    state.pdfBytes = new Uint8Array(result.bytes);
    nameSpan.textContent = result.file.name;
    metaSpan.textContent = `${formatBytes(result.file.size)} • ${t('tools:digitalSignPdf.pageCount', { count: result.pdf.numPages })}`;
    result.pdf.destroy();
    setWorkspaceFiles([state.pdfFile]);
  }
}

function showCertificateSection(): void {
  const certSection = getElement<HTMLDivElement>('certificate-section');
  if (certSection) {
    certSection.classList.remove('hidden');
  }
}

function handleCertUpload(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    void handleCertFile(input.files[0]);
  }
}

async function handleCertFile(file: File): Promise<void> {
  const validExtensions = ['.pfx', '.p12', '.pem'];
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidExtension) {
    showAlert(
      t('tools:digitalSignPdf.invalidCertificateTitle'),
      t('tools:digitalSignPdf.invalidCertificateMessage')
    );
    return;
  }

  state.certFile = file;
  state.certData = null;

  updateCertDisplay();

  const isPemFile = file.name.toLowerCase().endsWith('.pem');

  if (isPemFile) {
    try {
      const pemContent = await file.text();
      const isEncrypted = pemContent.includes('ENCRYPTED');

      if (isEncrypted) {
        showPasswordSection();
        updatePasswordLabel(t('tools:digitalSignPdf.privateKeyPassword'));
        hideSignatureOptions();
      } else {
        state.certData = parseCombinedPem(pemContent);
        updateCertInfo();
        showSignatureOptions();

        const certStatus = getElement<HTMLDivElement>('cert-status');
        if (certStatus) {
          certStatus.innerHTML = `${t('tools:digitalSignPdf.certificateLoaded')} <i data-lucide="check" class="inline w-4 h-4"></i>`;
          createIcons({ icons });
          certStatus.className = 'text-xs text-green-400';
        }
      }
    } catch {
      const certStatus = getElement<HTMLDivElement>('cert-status');
      if (certStatus) {
        certStatus.textContent = t('tools:digitalSignPdf.failedParsePem');
        certStatus.className = 'text-xs text-red-400';
      }
      hideSignatureOptions();
    }
  } else {
    showPasswordSection();
    updatePasswordLabel(t('tools:digitalSignPdf.certPassword'));
    hideSignatureOptions();
  }

  updateProcessButton();
  syncToolOutputToolbar();
}

function updateCertDisplay(): void {
  const certDisplayArea = getElement<HTMLDivElement>('cert-display-area');
  if (!certDisplayArea || !state.certFile) return;

  certDisplayArea.innerHTML = '';

  const certDiv = document.createElement('div');
  certDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  nameSpan.textContent = state.certFile.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-gray-400';
  metaSpan.id = 'cert-status';
  metaSpan.textContent = t('tools:digitalSignPdf.enterPasswordToUnlock');

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${state.certFile.name}`);
  removeBtn.title = `Remove ${state.certFile.name}`;
  removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  removeBtn.onclick = () => {
    state.certFile = null;
    state.certData = null;
    certDisplayArea.innerHTML = '';
    hidePasswordSection();
    hideCertInfo();
    hideSignatureOptions();
    updateProcessButton();
    syncToolOutputToolbar();
  };

  certDiv.append(infoContainer, removeBtn);
  certDisplayArea.appendChild(certDiv);
  createIcons({ icons });
}

function showPasswordSection(): void {
  const certPasswordSection = getElement<HTMLDivElement>(
    'cert-password-section'
  );
  if (certPasswordSection) {
    certPasswordSection.classList.remove('hidden');
  }

  const certPassword = getElement<HTMLInputElement>('cert-password');
  if (certPassword) {
    certPassword.value = '';
    certPassword.focus();
  }
}

function updatePasswordLabel(labelText: string): void {
  const label = document.querySelector('label[for="cert-password"]');
  if (label) {
    label.textContent = labelText;
  }
}

function hidePasswordSection(): void {
  const certPasswordSection = getElement<HTMLDivElement>(
    'cert-password-section'
  );
  if (certPasswordSection) {
    certPasswordSection.classList.add('hidden');
  }
}

function showSignatureOptions(): void {
  const signatureOptions = getElement<HTMLDivElement>('signature-options');
  if (signatureOptions) {
    signatureOptions.classList.remove('hidden');
  }
  const visibleSigSection = getElement<HTMLDivElement>(
    'visible-signature-section'
  );
  if (visibleSigSection) {
    visibleSigSection.classList.remove('hidden');
  }
}

function hideSignatureOptions(): void {
  const signatureOptions = getElement<HTMLDivElement>('signature-options');
  if (signatureOptions) {
    signatureOptions.classList.add('hidden');
  }
  const visibleSigSection = getElement<HTMLDivElement>(
    'visible-signature-section'
  );
  if (visibleSigSection) {
    visibleSigSection.classList.add('hidden');
  }
}

function hideCertInfo(): void {
  const certInfo = getElement<HTMLDivElement>('cert-info');
  if (certInfo) {
    certInfo.classList.add('hidden');
  }
}

async function handlePasswordInput(): Promise<void> {
  const certPassword = getElement<HTMLInputElement>('cert-password');
  const password = certPassword?.value ?? '';

  if (!state.certFile || !password) {
    return;
  }

  try {
    const isPemFile = state.certFile.name.toLowerCase().endsWith('.pem');

    if (isPemFile) {
      const pemContent = await state.certFile.text();
      state.certData = parseCombinedPem(pemContent, password);
    } else {
      const certBytes = (await readFileAsArrayBuffer(
        state.certFile
      )) as ArrayBuffer;
      state.certData = parsePfxFile(certBytes, password);
    }

    updateCertInfo();
    showSignatureOptions();
    updateProcessButton();
    syncToolOutputToolbar();

    const certStatus = getElement<HTMLDivElement>('cert-status');
    if (certStatus) {
      certStatus.innerHTML = `${t('tools:digitalSignPdf.certificateUnlocked')} <i data-lucide="check-circle" class="inline w-4 h-4"></i>`;
      createIcons({ icons });
      certStatus.className = 'text-xs text-green-400';
    }
  } catch (error) {
    state.certData = null;
    hideSignatureOptions();
    updateProcessButton();
    syncToolOutputToolbar();

    const certStatus = getElement<HTMLDivElement>('cert-status');
    if (certStatus) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('tools:digitalSignPdf.invalidPasswordOrCertificate');
      certStatus.textContent = errorMessage.includes('password')
        ? t('tools:digitalSignPdf.incorrectPassword')
        : t('tools:digitalSignPdf.failedParseCertificate');
      certStatus.className = 'text-xs text-red-400';
    }
  }
}

function updateCertInfo(): void {
  if (!state.certData) return;

  const certInfo = getElement<HTMLDivElement>('cert-info');
  const certSubject = getElement<HTMLSpanElement>('cert-subject');
  const certIssuer = getElement<HTMLSpanElement>('cert-issuer');
  const certValidity = getElement<HTMLSpanElement>('cert-validity');

  if (!certInfo) return;

  const info = getCertificateInfo(state.certData.certificate);

  if (certSubject) {
    certSubject.textContent = info.subject;
  }
  if (certIssuer) {
    certIssuer.textContent = info.issuer;
  }
  if (certValidity) {
    const formatDate = (date: Date) => date.toLocaleDateString();
    certValidity.textContent = `${formatDate(info.validFrom)} - ${formatDate(info.validTo)}`;
  }

  certInfo.classList.remove('hidden');
}

function updateProcessButton(): void {
  const processBtn = getElement<HTMLButtonElement>('process-btn');
  if (!processBtn) return;

  const canProcess = canCommitCurrentTab();
  processBtn.disabled = !canProcess;
  processBtn.style.display = canProcess ? '' : 'none';
}

function handleCustomCertUpload(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files && input.files.length > 0) {
    void handleCustomCertFile(input.files[0]);
  }
}

async function handleCustomCertFile(file: File): Promise<void> {
  const validExtensions = ['.pem', '.crt', '.cer', '.der'];
  const hasValidExtension = validExtensions.some((ext) =>
    file.name.toLowerCase().endsWith(ext)
  );

  if (!hasValidExtension) {
    showAlert(
      'Invalid Certificate',
      'Please select a .pem, .crt, .cer, or .der certificate file.'
    );
    return;
  }

  state.trustedCertFile = file;
  state.trustedCert = null;

  try {
    const content = await file.text();
    if (content.includes('-----BEGIN CERTIFICATE-----')) {
      state.trustedCert = forge.pki.certificateFromPem(content);
    } else {
      const bytes = new Uint8Array(
        (await readFileAsArrayBuffer(file)) as ArrayBuffer
      );
      const derString = String.fromCharCode.apply(null, Array.from(bytes));
      const asn1 = forge.asn1.fromDer(derString);
      state.trustedCert = forge.pki.certificateFromAsn1(asn1);
    }

    updateCustomCertDisplay();
    if (state.pdfBytes) {
      await validateSignatures();
    }
  } catch (error) {
    console.error('Error parsing certificate:', error);
    showAlert('Invalid Certificate', 'Failed to parse the certificate file.');
    state.trustedCertFile = null;
    state.trustedCert = null;
  }
}

function updateCustomCertDisplay(): void {
  const certDisplayArea = getElement<HTMLDivElement>(
    'custom-cert-display-area'
  );
  if (!certDisplayArea || !state.trustedCertFile || !state.trustedCert) return;

  certDisplayArea.innerHTML = '';

  const certDiv = document.createElement('div');
  certDiv.className =
    'flex items-center justify-between bg-gray-700 p-3 rounded-lg';

  const infoContainer = document.createElement('div');
  infoContainer.className = 'flex flex-col flex-1 min-w-0';

  const nameSpan = document.createElement('div');
  nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
  const cn = state.trustedCert.subject.getField('CN');
  nameSpan.textContent = (cn?.value as string) || state.trustedCertFile.name;

  const metaSpan = document.createElement('div');
  metaSpan.className = 'text-xs text-green-400';
  metaSpan.innerHTML =
    '<i data-lucide="check-circle" class="inline w-3 h-3 mr-1"></i>Trusted certificate loaded';

  infoContainer.append(nameSpan, metaSpan);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', `Remove ${state.trustedCertFile.name}`);
  removeBtn.title = `Remove ${state.trustedCertFile.name}`;
  removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
  removeBtn.onclick = async () => {
    state.trustedCertFile = null;
    state.trustedCert = null;
    certDisplayArea.innerHTML = '';
    if (state.pdfBytes) {
      await validateSignatures();
    }
  };

  certDiv.append(infoContainer, removeBtn);
  certDisplayArea.appendChild(certDiv);
  createIcons({ icons });
}

async function validateSignatures(): Promise<void> {
  if (!state.pdfBytes) return;

  showLoader('Analyzing signatures...');
  try {
    state.results = await validatePdfSignatures(
      state.pdfBytes,
      state.trustedCert ?? undefined
    );
    displayValidationResults();
  } catch (error) {
    console.error('Validation error:', error);
    showAlert(
      'Error',
      'Failed to validate signatures. The file may be corrupted.'
    );
  } finally {
    hideLoader();
  }
}

function displayValidationResults(): void {
  const resultsSection = getElement<HTMLDivElement>('results-section');
  const resultsContainer = getElement<HTMLDivElement>('results-container');
  if (!resultsSection || !resultsContainer) return;

  resultsContainer.innerHTML = '';
  resultsSection.classList.remove('hidden');

  if (state.results.length === 0) {
    resultsContainer.innerHTML = `
      <div class="bg-gray-700 rounded-lg p-6 text-center border border-gray-600">
        <i data-lucide="file-x" class="w-12 h-12 mx-auto mb-4 text-gray-400"></i>
        <h3 class="text-lg font-semibold text-white mb-2">No Signatures Found</h3>
        <p class="text-gray-400">This PDF does not contain any digital signatures.</p>
      </div>
    `;
    createIcons({ icons });
    return;
  }

  const summaryDiv = document.createElement('div');
  summaryDiv.className =
    'mb-4 p-3 bg-gray-700 rounded-lg border border-gray-600';

  const validCount = state.results.filter(
    (r) => r.isValid && !r.isExpired && r.isTrusted
  ).length;

  summaryDiv.innerHTML = `
    <p class="text-gray-300">
      <span class="font-semibold text-white">${state.results.length}</span>
      signature${state.results.length > 1 ? 's' : ''} found
      <span class="text-gray-500">•</span>
      <span class="${validCount === state.results.length ? 'text-green-400' : 'text-yellow-400'}">${validCount} valid</span>
    </p>
  `;
  resultsContainer.appendChild(summaryDiv);

  state.results.forEach((result, index) => {
    const card = document.createElement('div');
    card.className = 'bg-gray-700 rounded-lg p-4 border border-gray-600 mb-4';
    const isFullyValid =
      result.isValid && !result.isExpired && result.isTrusted;
    const statusText = isFullyValid
      ? 'Valid Signature'
      : !result.isValid
        ? 'Invalid Signature'
        : result.isExpired
          ? 'Expired Certificate'
          : 'Untrusted Certificate';
    const statusColor = isFullyValid
      ? 'text-green-400'
      : !result.isValid
        ? 'text-red-400'
        : 'text-yellow-400';

    card.innerHTML = `
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="font-semibold text-white">Signature ${index + 1}</h3>
          <p class="text-sm ${statusColor}">${statusText}</p>
        </div>
      </div>
      <div class="space-y-2 text-sm">
        <div>
          <p class="text-gray-400">Signed By</p>
          <p class="text-white font-medium">${escapeHtml(result.signerName)}</p>
        </div>
        <div>
          <p class="text-gray-400">Issuer</p>
          <p class="text-white font-medium">${escapeHtml(result.issuer)}</p>
        </div>
      </div>
    `;
    resultsContainer.appendChild(card);
  });

  createIcons({ icons });
}

async function processTimestamp(): Promise<void> {
  if (!state.pdfBytes || !state.pdfFile) {
    showAlert('No File', 'Please upload a PDF file first.');
    return;
  }

  const tsaUrl = getElement<HTMLSelectElement>('tsa-preset')?.value ?? null;
  if (!tsaUrl) return;

  try {
    await requireNetworkDisclosure('timestamp-tsa');
  } catch (error) {
    if (error instanceof NetworkDisclosureBlockedError) return;
    throw error;
  }

  showLoader('Applying timestamp...');
  try {
    const timestampedBytes = await timestampPdf(state.pdfBytes, tsaUrl);
    const blob = new Blob([new Uint8Array(timestampedBytes)], {
      type: 'application/pdf',
    });
    downloadFile(blob, state.pdfFile.name);
  } catch (error) {
    if (error instanceof NetworkDisclosureBlockedError) return;
    console.error('Timestamp error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    showAlert('Timestamp Failed', `Failed to timestamp PDF: ${message}`);
  } finally {
    hideLoader();
  }
}

async function processSignature(): Promise<void> {
  if (!state.pdfBytes || !state.certData) {
    showAlert(
      t('tools:digitalSignPdf.missingDataTitle'),
      t('tools:digitalSignPdf.missingDataMessage')
    );
    return;
  }

  const reason = getElement<HTMLInputElement>('sign-reason')?.value ?? '';
  const location = getElement<HTMLInputElement>('sign-location')?.value ?? '';
  const contactInfo = getElement<HTMLInputElement>('sign-contact')?.value ?? '';

  const signatureInfo: SignatureInfo = {};
  if (reason) signatureInfo.reason = reason;
  if (location) signatureInfo.location = location;
  if (contactInfo) signatureInfo.contactInfo = contactInfo;

  let visibleSignature: VisibleSignatureOptions | undefined;

  const enableVisibleSig = getElement<HTMLInputElement>('enable-visible-sig');
  if (enableVisibleSig?.checked) {
    const sigX = parseInt(
      getElement<HTMLInputElement>('sig-x')?.value ?? '25',
      10
    );
    const sigY = parseInt(
      getElement<HTMLInputElement>('sig-y')?.value ?? '700',
      10
    );
    const sigWidth = parseInt(
      getElement<HTMLInputElement>('sig-width')?.value ?? '150',
      10
    );
    const sigHeight = parseInt(
      getElement<HTMLInputElement>('sig-height')?.value ?? '70',
      10
    );

    const sigPageSelect = getElement<HTMLSelectElement>('sig-page');
    let sigPage: number | string = 0;
    let numPages = 1;

    if (state.pdfFile) {
      const pageCountResult = await loadPdfWithPasswordPrompt(state.pdfFile);
      if (!pageCountResult) return;
      state.pdfFile = pageCountResult.file;
      state.pdfBytes = new Uint8Array(pageCountResult.bytes);
      numPages = pageCountResult.pdf.numPages;
      pageCountResult.pdf.destroy();
    }

    if (sigPageSelect) {
      if (sigPageSelect.value === 'last') {
        sigPage = (numPages - 1).toString();
      } else if (sigPageSelect.value === 'all') {
        sigPage = numPages === 1 ? '0' : `0-${numPages - 1}`;
      } else if (sigPageSelect.value === 'custom') {
        sigPage =
          parseInt(
            getElement<HTMLInputElement>('sig-custom-page')?.value ?? '1',
            10
          ) - 1;
      } else {
        sigPage = parseInt(sigPageSelect.value, 10);
      }
    }

    const enableSigText = getElement<HTMLInputElement>('enable-sig-text');
    let sigText = enableSigText?.checked
      ? getElement<HTMLInputElement>('sig-text')?.value
      : undefined;
    const sigTextColor =
      getElement<HTMLInputElement>('sig-text-color')?.value ?? '#000000';
    const sigTextSize = parseInt(
      getElement<HTMLInputElement>('sig-text-size')?.value ?? '12',
      10
    );

    if (!state.sigImageData && !sigText && state.certData) {
      const certInfo = getCertificateInfo(state.certData.certificate);
      const date = new Date().toLocaleDateString();
      sigText = t('tools:digitalSignPdf.defaultSignatureText', {
        signer: certInfo.subject,
        date,
      });
    }

    let finalHeight = sigHeight;
    if (sigText && !state.sigImageData) {
      const lineCount = (sigText.match(/\n/g) || []).length + 1;
      const lineHeightFactor = 1.4;
      const padding = 16;
      const calculatedHeight = Math.ceil(
        lineCount * sigTextSize * lineHeightFactor + padding
      );
      finalHeight = Math.max(calculatedHeight, sigHeight);
    }

    visibleSignature = {
      enabled: true,
      x: sigX,
      y: sigY,
      width: sigWidth,
      height: finalHeight,
      page: sigPage,
      imageData: state.sigImageData ?? undefined,
      imageType: state.sigImageType ?? undefined,
      text: sigText,
      textColor: sigTextColor,
      textSize: sigTextSize,
    };
  }

  try {
    await requireNetworkDisclosure('digital-sign-chain-fetch');
  } catch (error) {
    if (error instanceof NetworkDisclosureBlockedError) return;
    throw error;
  }

  showLoader(t('tools:digitalSignPdf.applyingSignature'));

  try {
    const signedPdfBytes = await signPdf(state.pdfBytes, state.certData, {
      signatureInfo,
      visibleSignature,
    });

    const blob = new Blob([signedPdfBytes.slice().buffer], {
      type: 'application/pdf',
    });
    downloadFile(blob, state.pdfFile?.name ?? 'document.pdf');
  } catch (error) {
    if (error instanceof NetworkDisclosureBlockedError) {
      return;
    }
    console.error('Signing error:', error);
    const errorMessage =
      error instanceof Error ? error.message : t('common.unknownError');

    if (
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('CORS') ||
      errorMessage.includes('NetworkError')
    ) {
      showAlert(
        t('tools:digitalSignPdf.signingFailedTitle'),
        t('tools:digitalSignPdf.chainFetchFailed')
      );
    } else {
      showAlert(
        t('tools:digitalSignPdf.signingFailedTitle'),
        t('tools:digitalSignPdf.failedToSignPdf', { message: errorMessage })
      );
    }
  } finally {
    hideLoader();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePage);
} else {
  initializePage();
  document.addEventListener('DOMContentLoaded', initializePage);
}
