import { openPdfLibraryPicker } from './pdf-library-picker.js';
import {
  applyFilesToInput,
  applyFilesToToolInput,
  isHomeDocument,
} from './seed-tool-open-file.js';
import {
  getWorkspaceFiles,
  markFileLibraryId,
  pickerAcceptsFile,
  pickerAcceptsPdf,
  WORKSPACE_FILES_RENDERED_EVENT,
} from './workspace-files.js';

export const TOOL_LIBRARY_BTN_ID = 'tool-library-btn';
const TOOL_LIBRARY_WRAP_CLASS = 'tool-library-btn-wrap';
/** Opts a per-slot CTA out of the primary CTA's global auto-hide rules. */
const TOOL_LIBRARY_SLOT_WRAP_CLASS = 'tool-library-slot-wrap';
const TOOL_LIBRARY_OR_CLASS = 'tool-library-or';
/** Matches the empty-state reference: secondary CTA after the OR divider. */
export const TOOL_LIBRARY_BTN_LABEL = 'Select files from My PDFs';

/**
 * Drop targets that predate the shared `#drop-zone` markup. compare-pdfs and
 * overlay-pdf each carry two labelled slots, so they get one CTA per slot
 * wired to that slot's own picker — choosing from My PDFs fills the slot the
 * user actually clicked rather than a single canonical input.
 */
const LEGACY_UPLOAD_SLOTS: ReadonlyArray<{ zoneId: string; inputId: string }> =
  [
    { zoneId: 'drop-zone-1', inputId: 'file-input-1' },
    { zoneId: 'drop-zone-2', inputId: 'file-input-2' },
    { zoneId: 'base-drop-zone', inputId: 'base-file-input' },
    { zoneId: 'overlay-drop-zone', inputId: 'overlay-file-input' },
    { zoneId: 'dropZone', inputId: 'pdfFileInput' },
    { zoneId: 'upload-area', inputId: 'pdf-file-input' },
  ];

type UploadSlot = {
  zone: HTMLElement;
  /** Null only for the primary slot, which resolves through getActiveFileInput. */
  inputId: string | null;
  buttonId: string;
  isPrimary: boolean;
};

let boundRoot: Document | null = null;

/**
 * Shared empty-state for tool pages: keep a "Select files from My PDFs"
 * control inside every PDF drop target so clearing workspace files never
 * dead-ends the uploader.
 */
export function initToolEmptyState(root: Document = document): void {
  if (isHomeDocument(root)) return;
  if (boundRoot === root) {
    syncToolEmptyState(root);
    return;
  }
  boundRoot = root;
  root.addEventListener(WORKSPACE_FILES_RENDERED_EVENT, () => {
    syncToolEmptyState(root);
  });
  // Multi-slot pages track visibility per picker, and filling one slot does not
  // re-render the workspace file list, so listen for the pickers themselves.
  root.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === 'file') {
        syncToolEmptyState(root);
      }
    },
    true
  );
  syncToolEmptyState(root);
}

export function syncToolEmptyState(root: Document = document): void {
  if (isHomeDocument(root)) return;

  const slots = collectUploadSlots(root);
  const live = new Set(slots.map((slot) => slot.buttonId));
  for (const button of root.querySelectorAll(
    `[id^="${TOOL_LIBRARY_BTN_ID}"]`
  )) {
    if (!live.has(button.id)) removeLibraryButton(root, button.id);
  }

  for (const slot of slots) syncUploadSlot(root, slot);
}

export function resetToolEmptyState(): void {
  boundRoot = null;
}

function collectUploadSlots(root: Document): UploadSlot[] {
  const slots: UploadSlot[] = [];

  const dropZone = root.getElementById('drop-zone');
  const toolUploader = root.getElementById('tool-uploader');
  if (dropZone && toolUploader) {
    slots.push({
      zone: dropZone,
      inputId: null,
      buttonId: TOOL_LIBRARY_BTN_ID,
      isPrimary: true,
    });
  }

  for (const { zoneId, inputId } of LEGACY_UPLOAD_SLOTS) {
    const zone = root.getElementById(zoneId);
    const input = root.getElementById(inputId);
    if (!(zone instanceof HTMLElement)) continue;
    if (!(input instanceof HTMLInputElement)) continue;
    slots.push({
      zone,
      inputId,
      buttonId: `${TOOL_LIBRARY_BTN_ID}-${zoneId}`,
      isPrimary: false,
    });
  }

  return slots;
}

function syncUploadSlot(root: Document, slot: UploadSlot): void {
  if (!slotAcceptsPdf(root, slot)) {
    removeLibraryButton(root, slot.buttonId);
    return;
  }

  const button = ensureLibraryButton(root, slot);
  const show = shouldShowLibraryButton(root, slot);
  button.hidden = !show;
  const wrap = button.closest(`.${TOOL_LIBRARY_WRAP_CLASS}`);
  if (wrap instanceof HTMLElement) wrap.hidden = !show;
}

function slotInput(root: Document, slot: UploadSlot): HTMLInputElement | null {
  if (!slot.inputId) {
    return root.querySelector<HTMLInputElement>('input#file-input');
  }
  const input = root.getElementById(slot.inputId);
  return input instanceof HTMLInputElement ? input : null;
}

function slotAcceptsPdf(root: Document, slot: UploadSlot): boolean {
  if (slot.isPrimary) return pickerAcceptsPdf(root);
  const input = slotInput(root, slot);
  if (!input) return false;
  return pickerAcceptsFile(
    input,
    new File([], 'document.pdf', { type: 'application/pdf' })
  );
}

function shouldShowLibraryButton(root: Document, slot: UploadSlot): boolean {
  if (slot.zone.hidden) return false;

  if (!slot.isPrimary) {
    // compare-pdfs and overlay-pdf keep both zones on screen at once, so a
    // file in one slot must not blank the other slot's CTA.
    const input = slotInput(root, slot);
    return !input?.files?.length;
  }

  if (getWorkspaceFiles().length > 0) return false;
  if (root.body.classList.contains('shift-open-file-in-tool')) return false;
  return true;
}

function ensureLibraryButton(
  root: Document,
  slot: UploadSlot
): HTMLButtonElement {
  const existing = root.getElementById(
    slot.buttonId
  ) as HTMLButtonElement | null;
  if (existing) {
    existing.textContent = TOOL_LIBRARY_BTN_LABEL;
    existing.classList.add('btn', 'tool-library-btn');
    bindLibraryButton(existing, root, slot);
    const wrap = ensureLibraryWrap(root, existing);
    if (!slot.isPrimary) wrap.classList.add(TOOL_LIBRARY_SLOT_WRAP_CLASS);
    placeLibraryWrap(root, slot, wrap);
    return existing;
  }

  const wrap = root.createElement('div');
  wrap.className = TOOL_LIBRARY_WRAP_CLASS;
  if (!slot.isPrimary) wrap.classList.add(TOOL_LIBRARY_SLOT_WRAP_CLASS);

  const or = root.createElement('div');
  or.className = TOOL_LIBRARY_OR_CLASS;
  or.setAttribute('aria-hidden', 'true');
  or.textContent = 'OR';

  const button = root.createElement('button');
  button.id = slot.buttonId;
  button.type = 'button';
  button.className = 'btn tool-library-btn';
  button.textContent = TOOL_LIBRARY_BTN_LABEL;
  bindLibraryButton(button, root, slot);

  wrap.append(or, button);
  placeLibraryWrap(root, slot, wrap);
  return button;
}

/** Keep the absolute file-input overlay from stealing library CTA clicks. */
function bindLibraryButton(
  button: HTMLButtonElement,
  root: Document,
  slot: UploadSlot
): void {
  if (button.dataset.toolLibraryBound === '1') return;
  button.dataset.toolLibraryBound = '1';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openLibraryForSlot(root, slot);
  });
  button.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
}

function ensureLibraryWrap(
  root: Document,
  button: HTMLButtonElement
): HTMLElement {
  const existing = button.closest(`.${TOOL_LIBRARY_WRAP_CLASS}`);
  let wrap: HTMLElement;
  if (existing instanceof HTMLElement) {
    wrap = existing;
  } else {
    wrap = root.createElement('div');
    wrap.className = TOOL_LIBRARY_WRAP_CLASS;
    button.replaceWith(wrap);
    wrap.appendChild(button);
  }

  if (!wrap.querySelector(`.${TOOL_LIBRARY_OR_CLASS}`)) {
    const or = root.createElement('div');
    or.className = TOOL_LIBRARY_OR_CLASS;
    or.setAttribute('aria-hidden', 'true');
    or.textContent = 'OR';
    wrap.insertBefore(or, button);
  }

  button.classList.add('tool-library-btn');
  return wrap;
}

/**
 * Mount the library CTA inside its drop zone. Where the picker is a full-bleed
 * transparent overlay it has to go before that input, so z-index +
 * pointer-events can keep clicks on the button. Pages whose picker is simply
 * `hidden` behind their own upload button (pdf-multi-tool) put the CTA last,
 * which reads as primary action, then OR, then the secondary route.
 */
function placeLibraryWrap(
  root: Document,
  slot: UploadSlot,
  wrap: HTMLElement
): void {
  const input = slotInput(root, slot);
  const overlay = input && isOverlayPicker(input, slot.zone) ? input : null;

  if (overlay) {
    if (wrap.nextElementSibling !== overlay) {
      slot.zone.insertBefore(wrap, overlay);
    }
    return;
  }

  if (wrap.parentElement !== slot.zone || wrap.nextElementSibling) {
    slot.zone.appendChild(wrap);
  }
}

/**
 * True when the picker is the transparent full-bleed input that makes the whole
 * zone clickable. Tailwind's `hidden` class is checked alongside the attribute:
 * pdf-multi-tool hides its input that way and drives it from its own button, so
 * nothing there covers the CTA.
 */
function isOverlayPicker(input: HTMLInputElement, zone: HTMLElement): boolean {
  if (input.parentElement !== zone) return false;
  return !input.hidden && !input.classList.contains('hidden');
}

function removeLibraryButton(root: Document, buttonId: string): void {
  const button = root.getElementById(buttonId);
  button?.closest(`.${TOOL_LIBRARY_WRAP_CLASS}`)?.remove();
  button?.remove();
}

async function openLibraryForSlot(
  root: Document,
  slot: UploadSlot
): Promise<void> {
  const input = slotInput(root, slot);
  await openPdfLibraryPicker({
    root,
    title: 'Choose a PDF from your library',
    onSelect: (entries) => {
      const files = entries.map((entry) =>
        markFileLibraryId(entry.file, entry.id)
      );
      if (slot.isPrimary) {
        applyFilesToToolInput(files, root);
        return;
      }
      if (input) applyFilesToInput(input, files);
    },
    onUpload: () => {
      if (!input) return;
      input.value = '';
      input.click();
    },
  });
}
