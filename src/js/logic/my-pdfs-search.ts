export const MY_PDFS_SEARCH_EMPTY_MESSAGE = 'No PDFs match your search';
export const MY_PDFS_SEARCH_INPUT_ID = 'shift-my-pdfs-search';
export const MY_PDFS_SEARCH_PLACEHOLDER = 'Filter by filename...';

const SEARCH_ICON_PATH =
  'M19.25 19.25 15.5 15.5M4.75 11a6.25 6.25 0 1 1 12.5 0 6.25 6.25 0 0 1-12.5 0';

let searchQuery = '';
let onQueryChange: (() => void) | null = null;

export function getMyPdfsSearchQuery(): string {
  return searchQuery;
}

export function isMyPdfsSearchActive(): boolean {
  return searchQuery.trim().length > 0;
}

export function setMyPdfsSearchQuery(query: string): void {
  searchQuery = query;
}

export function resetMyPdfsSearch(): void {
  searchQuery = '';
  onQueryChange = null;
}

export function filterLibraryFilesByName<T extends { name: string }>(
  files: readonly T[],
  query: string
): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return files.slice();
  return files.filter((file) => file.name.toLowerCase().includes(term));
}

export function createMyPdfsSearchEmptyCopy(
  root: Document
): HTMLParagraphElement {
  const message = root.createElement('p');
  message.className = 'shift-search-empty shift-my-pdfs-search-empty';
  message.textContent = MY_PDFS_SEARCH_EMPTY_MESSAGE;
  return message;
}

export function createMyPdfsSearchEmptyRow(
  root: Document
): HTMLTableRowElement {
  const row = root.createElement('tr');
  row.className = 'shift-my-pdfs-search-empty-row';
  const cell = root.createElement('td');
  cell.colSpan = 4;
  cell.appendChild(createMyPdfsSearchEmptyCopy(root));
  row.appendChild(cell);
  return row;
}

/**
 * Inject a full-width library filter below the upload drop zone (My Images
 * hierarchy: title → drop zone → filter → controls → grid).
 */
export function initMyPdfsSearch(
  root: Document,
  handleQueryChange: () => void
): void {
  const section = root.getElementById('shift-my-pdfs');
  if (!section) return;

  onQueryChange = handleQueryChange;
  const input = ensureMyPdfsSearchField(root);
  if (!input) return;

  if (input.dataset.searchBound === 'true') {
    syncClearButton(root, input);
    return;
  }
  input.dataset.searchBound = 'true';

  input.addEventListener('input', () => {
    applyQueryFromInput(input);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!input.value) return;
    event.preventDefault();
    input.value = '';
    applyQueryFromInput(input);
  });

  const clear = root.getElementById('shift-my-pdfs-search-clear');
  clear?.addEventListener('click', () => {
    if (!input.value) return;
    input.value = '';
    applyQueryFromInput(input);
    input.focus();
  });

  syncClearButton(root, input);
}

function applyQueryFromInput(input: HTMLInputElement): void {
  searchQuery = input.value;
  syncClearButton(input.ownerDocument, input);
  onQueryChange?.();
}

function syncClearButton(root: Document, input: HTMLInputElement): void {
  const clear = root.getElementById(
    'shift-my-pdfs-search-clear'
  ) as HTMLButtonElement | null;
  if (!clear) return;
  clear.hidden = input.value.length === 0;
}

function ensureMyPdfsSearchField(root: Document): HTMLInputElement | null {
  const section = root.getElementById('shift-my-pdfs');
  if (!section) return null;

  const existing = root.getElementById(
    MY_PDFS_SEARCH_INPUT_ID
  ) as HTMLInputElement | null;
  if (existing) {
    if (existing.value !== searchQuery) existing.value = searchQuery;
    existing.placeholder = MY_PDFS_SEARCH_PLACEHOLDER;
    placeSearchBar(root, existing.closest('.shift-my-pdfs-search'));
    return existing;
  }

  const wrap = root.createElement('div');
  wrap.className = 'shift-my-pdfs-search';

  const field = root.createElement('div');
  field.className = 'shift-search-field shift-my-pdfs-search-field';

  const icon = root.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'shift-search-icon');
  icon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  icon.setAttribute('width', '24');
  icon.setAttribute('height', '24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = root.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('d', SEARCH_ICON_PATH);
  icon.appendChild(path);

  const label = root.createElement('label');
  label.className = 'sr-only';
  label.htmlFor = MY_PDFS_SEARCH_INPUT_ID;
  label.textContent = 'Filter by filename';

  const input = root.createElement('input');
  input.type = 'search';
  input.id = MY_PDFS_SEARCH_INPUT_ID;
  input.className = 'shift-search-input';
  input.placeholder = MY_PDFS_SEARCH_PLACEHOLDER;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = searchQuery;

  const clear = root.createElement('button');
  clear.type = 'button';
  clear.id = 'shift-my-pdfs-search-clear';
  clear.className = 'shift-my-pdfs-search-clear';
  clear.setAttribute('aria-label', 'Clear search');
  clear.hidden = searchQuery.length === 0;
  clear.textContent = 'Clear';

  field.append(icon, label, input, clear);
  wrap.appendChild(field);
  placeSearchBar(root, wrap);

  return input;
}

/** Prefer drop zone → filter → controls; fall back to heading or section start. */
function placeSearchBar(root: Document, wrap: Element | null): void {
  if (!wrap) return;
  const section = root.getElementById('shift-my-pdfs');
  if (!section) return;

  // Leave a compact header mount if one was already forked into HTML — move it.
  const headerControls = section.querySelector(
    '.shift-open-file-header-controls'
  );
  if (headerControls?.contains(wrap)) {
    wrap.remove();
  }

  const dropZone = root.getElementById('drop-zone');
  const controls = section.querySelector('.shift-my-pdfs-controls');
  const header = section.querySelector('.shift-open-file-header');
  const table = section.querySelector('.shift-my-pdfs-table');
  const thumbs = root.getElementById('shift-my-pdfs-thumbs');

  if (dropZone && section.contains(dropZone)) {
    dropZone.insertAdjacentElement('afterend', wrap);
    return;
  }
  if (controls) {
    controls.insertAdjacentElement('beforebegin', wrap);
    return;
  }
  if (header) {
    header.insertAdjacentElement('afterend', wrap);
    return;
  }
  if (table) {
    table.insertAdjacentElement('beforebegin', wrap);
    return;
  }
  if (thumbs) {
    thumbs.insertAdjacentElement('beforebegin', wrap);
    return;
  }
  section.appendChild(wrap);
}
