import { downloadBlob, PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import { isPdfOutput, saveToShiftPdf } from './shift-pdf-save.js';
import { getWorkspaceFiles } from './workspace-files.js';

export const TOOL_SUCCESS_ID = 'shift-tool-success';

type ToolOutput = {
  blob: Blob;
  filename: string;
  summary?: string;
};

const queued: ToolOutput[] = [];
let flushScheduled = false;
let activeRoot: Document = document;

function libraryHref(): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}${base.endsWith('/') ? '' : '/'}my-pdfs.html`.replace(
    /([^:])\/{2,}/g,
    '$1/'
  );
}

function filenameOf(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash >= 0 ? path.slice(slash + 1) : path;
}

async function pdfsInsideZip(blob: Blob): Promise<File[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(blob);
  const files: File[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir || !entry.name.toLowerCase().endsWith('.pdf')) continue;
    const bytes = await entry.async('uint8array');
    files.push(
      new File([bytes], filenameOf(entry.name), { type: 'application/pdf' })
    );
  }
  return files;
}

async function libraryFiles(output: ToolOutput): Promise<File[]> {
  if (isPdfOutput(output.blob, output.filename)) {
    return [
      new File([output.blob], output.filename, {
        type: output.blob.type || 'application/pdf',
      }),
    ];
  }
  const zipped =
    output.filename.toLowerCase().endsWith('.zip') ||
    output.blob.type === 'application/zip';
  if (!zipped) return [];
  try {
    return await pdfsInsideZip(output.blob);
  } catch {
    return [];
  }
}

function ensureDialog(root: Document): HTMLElement {
  const existing = root.getElementById(TOOL_SUCCESS_ID);
  if (existing) return existing;

  const dialog = root.createElement('div');
  dialog.id = TOOL_SUCCESS_ID;
  dialog.className = 'shift-tool-success hidden';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'shift-tool-success-title');
  dialog.innerHTML = `
    <div class="shift-tool-success-card">
      <h2 id="shift-tool-success-title">Your file is ready</h2>
      <p id="shift-tool-success-message"></p>
      <div class="shift-tool-success-actions">
        <button type="button" id="shift-tool-success-download" class="shift-button shift-button-primary">Download</button>
        <a id="shift-tool-success-library" class="shift-button" href="${libraryHref()}">View in My PDFs</a>
        <button type="button" id="shift-tool-success-close" class="shift-button">Close</button>
      </div>
    </div>
  `;
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) hideToolSuccess(root);
  });
  dialog
    .querySelector('#shift-tool-success-close')
    ?.addEventListener('click', () => hideToolSuccess(root));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.classList.contains('hidden')) {
      hideToolSuccess(root);
    }
  });
  root.body.appendChild(dialog);
  return dialog;
}

export function hideToolSuccess(root: Document = document): void {
  root.getElementById(TOOL_SUCCESS_ID)?.classList.add('hidden');
}

function showDialog(
  root: Document,
  output: ToolOutput,
  addedNames: string[]
): void {
  const dialog = ensureDialog(root);
  const title = dialog.querySelector('#shift-tool-success-title');
  const message = dialog.querySelector('#shift-tool-success-message');
  const download = dialog.querySelector('#shift-tool-success-download');
  const library = dialog.querySelector('#shift-tool-success-library');
  if (
    !(title instanceof HTMLElement) ||
    !(message instanceof HTMLElement) ||
    !(download instanceof HTMLButtonElement) ||
    !(library instanceof HTMLAnchorElement)
  ) {
    return;
  }

  title.textContent =
    addedNames.length > 1 ? 'Your files are ready' : 'Your file is ready';
  const saved =
    addedNames.length === 0
      ? ''
      : addedNames.length === 1
        ? `${addedNames[0]} was added to My PDFs.`
        : `${addedNames.length} files were added to My PDFs.`;
  const ready = saved || `${output.filename} is ready to download.`;
  message.textContent = output.summary ? `${ready} ${output.summary}` : ready;
  library.hidden = addedNames.length === 0;
  download.onclick = () => {
    downloadBlob(output.blob, output.filename);
  };
  dialog.classList.remove('hidden');
  download.focus();
}

function claimedByOpenHandle(output: ToolOutput): boolean {
  if (!isPdfOutput(output.blob, output.filename)) return false;
  const selected = getWorkspaceFiles();
  return selected.length === 1 && Boolean(selected[0]?.handle);
}

async function presentBatch(batch: ToolOutput[], root: Document): Promise<void> {
  const pending = batch.filter((output) => !claimedByOpenHandle(output));
  const latest = pending[pending.length - 1];
  if (!latest) return;
  const added: string[] = [];
  for (const output of pending) {
    const files = await libraryFiles(output);
    for (const file of files) {
      const result = await saveToShiftPdf(file, file.name, root);
      if (result === 'added') added.push(file.name);
    }
  }
  showDialog(root, latest, added);
}

function scheduleFlush(root: Document): void {
  activeRoot = root;
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    const batch = queued.splice(0, queued.length);
    flushScheduled = false;
    void presentBatch(batch, activeRoot);
  });
}

export function enqueueToolSuccess(
  output: ToolOutput,
  root: Document = document
): void {
  queued.push(output);
  scheduleFlush(root);
}

export function initToolSuccess(root: Document = document): void {
  root.addEventListener(PDF_OUTPUT_READY_EVENT, (event) => {
    const detail = (event as CustomEvent<ToolOutput>).detail;
    if (
      !(detail?.blob instanceof Blob) ||
      typeof detail.filename !== 'string' ||
      !detail.filename.trim()
    ) {
      return;
    }
    enqueueToolSuccess(
      {
        blob: detail.blob,
        filename: detail.filename,
        summary: detail.summary,
      },
      root
    );
  });
}
