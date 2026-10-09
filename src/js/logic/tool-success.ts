import { downloadBlob, PDF_OUTPUT_READY_EVENT } from '../utils/helpers.js';
import { findWritableLibraryEntry } from './pdf-library-store.js';
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
    const bytes = await entry.async('arraybuffer');
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

const returnFocus = new WeakMap<HTMLElement, HTMLElement>();

function isOpen(dialog: HTMLElement): boolean {
  return !dialog.classList.contains('hidden') && !dialog.hidden;
}

function focusableControls(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')
  ).filter((element) => {
    if (element.hidden || element.closest('[hidden]')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

function ensureDialog(root: Document): HTMLElement {
  const existing = root.getElementById(TOOL_SUCCESS_ID);
  if (existing) return existing;

  const dialog = root.createElement('div');
  dialog.id = TOOL_SUCCESS_ID;
  dialog.className = 'shift-tool-success hidden';
  dialog.hidden = true;
  dialog.inert = true;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'shift-tool-success-title');
  dialog.setAttribute('aria-describedby', 'shift-tool-success-message');
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
  root.body.appendChild(dialog);
  return dialog;
}

function onDialogKeydown(event: KeyboardEvent, root: Document): void {
  const dialog = root.getElementById(TOOL_SUCCESS_ID);
  if (!(dialog instanceof HTMLElement) || !isOpen(dialog)) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    hideToolSuccess(root);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusables = focusableControls(dialog);
  if (focusables.length === 0) return;

  const active =
    root.activeElement instanceof HTMLElement ? root.activeElement : null;
  const index = active ? focusables.indexOf(active) : -1;
  const next =
    index === -1
      ? focusables[event.shiftKey ? focusables.length - 1 : 0]
      : focusables[
          (index + (event.shiftKey ? -1 : 1) + focusables.length) %
            focusables.length
        ];
  event.preventDefault();
  event.stopPropagation();
  next.focus();
}

export function hideToolSuccess(root: Document = document): void {
  const dialog = root.getElementById(TOOL_SUCCESS_ID);
  if (!(dialog instanceof HTMLElement) || !isOpen(dialog)) return;

  const restore = returnFocus.get(dialog) ?? null;
  returnFocus.delete(dialog);
  if (restore?.isConnected && !dialog.contains(restore)) {
    restore.focus();
  } else if (
    root.activeElement instanceof HTMLElement &&
    dialog.contains(root.activeElement)
  ) {
    root.activeElement.blur();
  }
  dialog.classList.add('hidden');
  dialog.hidden = true;
  dialog.inert = true;
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
  root.getElementById('completion-panel')?.classList.add('hidden');
  download.onclick = () => {
    downloadBlob(output.blob, output.filename);
    if (isOpen(dialog)) download.focus();
  };

  const active = root.activeElement;
  if (
    !isOpen(dialog) &&
    active instanceof HTMLElement &&
    !dialog.contains(active)
  ) {
    returnFocus.set(dialog, active);
  }
  dialog.hidden = false;
  dialog.inert = false;
  dialog.classList.remove('hidden');
  download.focus();
}

/** In-place save already confirms; skip the success dialog so only one UI shows. */
async function claimedByOpenHandle(output: ToolOutput): Promise<boolean> {
  if (!isPdfOutput(output.blob, output.filename)) return false;
  const selected = getWorkspaceFiles();
  if (selected.length !== 1 || !selected[0]) return false;
  if (selected[0].handle) return true;
  try {
    const entry = await findWritableLibraryEntry(selected[0]);
    return Boolean(entry?.handle);
  } catch {
    return false;
  }
}

async function presentBatch(batch: ToolOutput[], root: Document): Promise<void> {
  const pending: ToolOutput[] = [];
  for (const output of batch) {
    if (await claimedByOpenHandle(output)) continue;
    pending.push(output);
  }
  const latest = pending[pending.length - 1];
  if (!latest) return;
  const added: string[] = [];
  for (const output of pending) {
    const files = await libraryFiles(output);
    for (const file of files) {
      try {
        const result = await saveToShiftPdf(file, file.name, root);
        if (result === 'added') added.push(file.name);
      } catch {
        // A library failure must not block the download dialog.
      }
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

const boundRoots = new WeakSet<Document>();

export function initToolSuccess(root: Document = document): void {
  if (boundRoots.has(root)) return;
  boundRoots.add(root);
  root.addEventListener(
    'keydown',
    (event) => {
      if (event instanceof KeyboardEvent) onDialogKeydown(event, root);
    },
    true
  );
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
