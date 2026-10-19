import { createIcons, icons } from 'lucide';
import { listenForShiftFileHandoff } from '../embedder/shift-file-handoff.js';
import {
  beginToolUse,
  endToolUse,
  getToolIdFromPath,
  track,
  PDF_ENGINE_EVENTS,
} from '../host/analytics.js';
import {
  buildConvertSourceAccept,
  filterConvertDestinations,
  getConvertDestinationById,
  getConvertSourceKind,
  getOutputFilename,
  getSharedDestinations,
  IMAGE_TO_PDF_DESTINATION_ID_SET,
  isImageSourceFile,
  isPdfFile,
  type ConvertDestination,
} from '../config/convert-destinations.js';
import {
  createDefaultConvertFormatOptions,
  readConvertFormatOptionsFromDom,
  renderConvertFormatOptions,
  type ConvertFormatOptions,
} from './convert-format-options.js';
import { runInPlaceConversion } from './convert-runner.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
  setLaunchContext,
} from './launch-context.js';
import {
  isDuplicateMergeFile,
  mergeFilesMatch,
  type MergeFileIdentity,
} from './merge-file-identity.js';
import { markOpenWithSelection } from './open-file-store.js';
import { addPdfToLibrary } from './pdf-library-store.js';
import { openPdfLibraryPicker } from './pdf-library-picker.js';
import { clearLatestPdfOutput, initShiftPdfSave } from './shift-pdf-save.js';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
  type ToolOutputKind,
} from './tool-output-toolbar.js';
import {
  clearWorkspaceOpenFile,
  getWorkspaceFiles,
  markFileFromHandoff,
  markFileLibraryId,
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
  syncHomeLibraryFromStore,
} from './workspace-files.js';
import { state as appState } from '../state.js';
import { isToolDisabled } from '../utils/disabled-tools.js';
import { formatBytes } from '../utils/helpers.js';

export type ConvertHubStep = 'source' | 'destination';

export type ConvertHubState = {
  step: ConvertHubStep;
  sourceFiles: File[];
  selectedDestinationId?: string | null;
};

export const CONVERT_DESTINATION_SEARCH_ID = 'convert-destination-search';
export const CONVERT_DESTINATION_SEARCH_EMPTY_ID =
  'convert-destination-search-empty';

let destinationSearchQuery = '';

export function createInitialConvertHubState(
  sourceFiles: File[] = [],
  selectedDestinationId: string | null = null
): ConvertHubState {
  const supported = sourceFiles.filter(isSupportedSource);
  return {
    step: supported.length > 0 ? 'destination' : 'source',
    sourceFiles: supported,
    selectedDestinationId: resolveAutoSelectedDestinationId(
      supported,
      selectedDestinationId
    ),
  };
}

function isSupportedSource(file: File): boolean {
  return getConvertSourceKind(file) !== 'unsupported';
}

function toIdentity(file: File): MergeFileIdentity {
  return { name: file.name, size: file.size };
}

export function getDestinationsForSources(
  files: File[],
  preferredDestinationId?: string | null
): {
  primary: ConvertDestination[];
  secondary: ConvertDestination[];
} {
  if (
    preferredDestinationId === 'image-to-pdf' &&
    files.length > 0 &&
    files.every(isImageSourceFile) &&
    !isToolDisabled('image-to-pdf')
  ) {
    const imageDest = getConvertDestinationById('image-to-pdf');
    if (imageDest) {
      return { primary: [imageDest], secondary: [] };
    }
  }
  return getSharedDestinations(files, { isToolDisabled });
}

export function resolveAutoSelectedDestinationId(
  files: File[],
  currentSelectedId: string | null = null
): string | null {
  if (files.length === 0) {
    return currentSelectedId;
  }

  const { primary, secondary } = getDestinationsForSources(
    files,
    currentSelectedId
  );
  const all = [...primary, ...secondary];
  if (all.length === 0) return null;

  if (currentSelectedId && all.some((dest) => dest.id === currentSelectedId)) {
    return currentSelectedId;
  }

  // Non-PDF sources with a single shared Convert to PDF destination auto-select it.
  if (all.length === 1 && all[0]?.producesPdf) {
    return all[0].id;
  }

  return null;
}

/**
 * Add to the selection rather than replace it. Unsupported types are dropped so
 * a stray file in a multi-file drop cannot empty a valid selection, and repeats
 * are ignored so the same PDF cannot be converted twice in one batch.
 */
export function addConvertSources(
  state: ConvertHubState,
  files: File[]
): ConvertHubState {
  const added = [...state.sourceFiles];
  for (const file of files) {
    if (!isSupportedSource(file)) continue;
    if (isDuplicateMergeFile(added.map(toIdentity), toIdentity(file))) continue;
    added.push(file);
  }

  if (added.length === state.sourceFiles.length) return state;
  return {
    step: 'destination',
    sourceFiles: added,
    selectedDestinationId: resolveAutoSelectedDestinationId(
      added,
      state.selectedDestinationId ?? null
    ),
  };
}

/**
 * Why an add left the selection unchanged. A second copy of find_all.pdf is
 * not an unsupported type, which is what the hub used to claim.
 */
export function describeRejectedConvertSources(
  state: ConvertHubState,
  files: File[]
): string {
  const supported = files.filter(isSupportedSource);
  if (supported.length === 0) {
    return 'That file type is not supported for conversion yet. Try a PDF or another common document format.';
  }

  const identities = state.sourceFiles.map(toIdentity);
  const alreadyAdded = supported.every((file) =>
    isDuplicateMergeFile(identities, toIdentity(file))
  );
  if (alreadyAdded) {
    if (supported.length === 1) {
      return `${supported[0]?.name ?? 'That file'} is already in this conversion.`;
    }
    return 'Those files are already in this conversion.';
  }

  return 'Some of those files are already added or are not a supported type.';
}

export function replaceConvertSources(
  state: ConvertHubState,
  files: File[]
): ConvertHubState {
  const next = createInitialConvertHubState(
    files,
    state.selectedDestinationId ?? null
  );
  return next.sourceFiles.length > 0 ? next : state;
}

export function removeConvertSource(
  state: ConvertHubState,
  file: MergeFileIdentity
): ConvertHubState {
  const remaining = state.sourceFiles.filter(
    (entry) => !mergeFilesMatch(toIdentity(entry), file)
  );
  return {
    step: remaining.length > 0 ? 'destination' : 'source',
    sourceFiles: remaining,
    selectedDestinationId:
      remaining.length > 0
        ? resolveAutoSelectedDestinationId(
            remaining,
            state.selectedDestinationId ?? null
          )
        : null,
  };
}

export function clearConvertSources(
  initialDestinationId: string | null = null
): ConvertHubState {
  return {
    step: 'source',
    sourceFiles: [],
    selectedDestinationId: initialDestinationId,
  };
}

function sameSelection(left: File[], right: File[]): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const other = right[index];
      return (
        Boolean(other) &&
        mergeFilesMatch(toIdentity(file), toIdentity(other as File))
      );
    })
  );
}

/**
 * Prefer the in-memory workspace after the shared seed path has run. Falls back
 * to app state, which seedToolOpenFile / applyFilesToToolInput populate.
 */
export function resolveInitialConvertSources(
  getWorkspace = getWorkspaceFiles,
  getStateFiles = (): File[] => appState.files
): File[] {
  const workspace = getWorkspace()
    .map((entry) => entry.blob)
    .filter((blob): blob is File => blob instanceof File);
  if (workspace.length > 0) return workspace;

  return getStateFiles().slice();
}

export async function openConvertSourcePicker(
  root: Document,
  fileInput: HTMLInputElement | null,
  onFileSelected: (file: File) => void,
  currentSources: File[] = []
): Promise<void> {
  await openPdfLibraryPicker({
    root,
    title: 'Choose a file to convert',
    emptyMessage:
      'No saved PDFs in your library yet. Upload one from your device.',
    exclude: currentSources.map(toIdentity),
    rowAriaLabel: (entry, disabled) =>
      disabled ? `${entry.name} already added` : `Use ${entry.name}`,
    onSelect: (selected) => {
      const entry = selected[0];
      if (!entry) return;
      onFileSelected(markFileLibraryId(entry.file, entry.id));
    },
    onUpload: () => {
      fileInput?.click();
    },
  });
}

export async function openDedicatedTextOrMarkdownEditor(
  files: File[],
  editorId: 'txt-to-pdf' | 'markdown-to-pdf',
  root: Document = document
): Promise<void> {
  if (files.length === 0) return;
  setWorkspaceFiles(files, root);
  await persistWorkspaceOpenFile();
  markOpenWithSelection();
  window.location.assign(`${import.meta.env.BASE_URL}${editorId}.html`);
}

/**
 * Selects a destination in-place on `pdf-converter.html` without navigating away,
 * syncing Launch Context (`?entry=<id>`) and workspace files.
 */
export async function handoffConvertSourcesToTool(
  files: File[],
  destination: ConvertDestination,
  root: Document = document
): Promise<void> {
  if (files.length === 0) return;

  setWorkspaceFiles(files, root);
  await persistWorkspaceOpenFile();

  const pdfs = files.filter(isPdfFile);
  if (pdfs.length > 0) {
    for (const pdf of pdfs) {
      await addPdfToLibrary(pdf, 'upload');
    }
    await syncHomeLibraryFromStore(root);
  }

  setLaunchContext(destination.id, root);
  const fileInput = root.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  if (fileInput) {
    fileInput.multiple = true;
  }

  track(PDF_ENGINE_EVENTS.toolUsed, {
    tool_id: getToolIdFromPath(window.location.pathname || '/'),
    result: 'success',
  });
}

function describeOutput(
  files: File[],
  destination: ConvertDestination
): string {
  const first = files[0];
  if (!first) return '';
  if (files.length === 1) return getOutputFilename(first.name, destination);
  return `${files.length} files → .${destination.outputExtension}`;
}

function createDestinationButton(
  root: Document,
  files: File[],
  destination: ConvertDestination,
  isSelected: boolean,
  onSelect: (destination: ConvertDestination) => void
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-convert-destination';
  button.dataset.destinationId = destination.id;
  button.classList.toggle('is-selected', isSelected);
  button.setAttribute('aria-pressed', String(isSelected));

  const icon = root.createElement('i');
  icon.className = `ph ${destination.icon} shift-convert-destination-icon`;
  icon.setAttribute('aria-hidden', 'true');

  const info = root.createElement('div');
  info.className = 'shift-convert-destination-info';

  const name = root.createElement('span');
  name.className = 'shift-convert-destination-name';
  name.textContent = destination.name;

  const output = root.createElement('span');
  output.className = 'shift-convert-destination-output';
  output.textContent = describeOutput(files, destination);

  info.append(name, output);
  button.append(icon, info);
  button.addEventListener('click', () => onSelect(destination));
  return button;
}

export function getConvertDestinationSearchQuery(): string {
  return destinationSearchQuery;
}

export function setConvertDestinationSearchQuery(query: string): void {
  destinationSearchQuery = query;
}

function ensureConvertDestinationSearch(
  root: Document,
  onQuery: (query: string) => void
): HTMLInputElement | null {
  const destinationStep = root.getElementById('convert-destination-step');
  const heading = root.getElementById('convert-destination-heading');
  if (!destinationStep || !heading) return null;

  let input = root.getElementById(
    CONVERT_DESTINATION_SEARCH_ID
  ) as HTMLInputElement | null;
  if (!input) {
    const field = root.createElement('div');
    field.className = 'shift-search-field shift-convert-search-field';

    const icon = root.createElement('i');
    icon.className = 'ph ph-magnifying-glass shift-search-icon';
    icon.setAttribute('aria-hidden', 'true');

    const label = root.createElement('label');
    label.className = 'shift-convert-search-label';
    label.setAttribute('for', CONVERT_DESTINATION_SEARCH_ID);
    label.textContent = 'Search formats';

    input = root.createElement('input');
    input.id = CONVERT_DESTINATION_SEARCH_ID;
    input.type = 'search';
    input.className = 'shift-search-input';
    input.placeholder = 'Search formats';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');

    field.append(icon, label, input);
    heading.insertAdjacentElement('afterend', field);
  }

  if (input.dataset.searchBound !== 'true') {
    input.dataset.searchBound = 'true';
    input.addEventListener('input', () => {
      destinationSearchQuery = input!.value;
      onQuery(input!.value);
    });
  }

  if (input.value !== destinationSearchQuery) {
    input.value = destinationSearchQuery;
  }
  return input;
}

function renderDestinationGrid(
  root: Document,
  container: HTMLElement,
  files: File[],
  destinations: ConvertDestination[],
  selectedDestinationId: string | null,
  onSelect: (destination: ConvertDestination) => void
): void {
  const existingById = new Map<string, HTMLButtonElement>();
  container
    .querySelectorAll<HTMLButtonElement>(
      ':scope > button.shift-convert-destination[data-destination-id]'
    )
    .forEach((btn) => {
      const id = btn.dataset.destinationId;
      if (id) existingById.set(id, btn);
    });

  const nextNodes: HTMLButtonElement[] = [];
  for (const destination of destinations) {
    const isSelected = destination.id === selectedDestinationId;
    const existing = existingById.get(destination.id);
    if (existing) {
      existing.classList.toggle('is-selected', isSelected);
      existing.setAttribute('aria-pressed', String(isSelected));
      const output = existing.querySelector<HTMLElement>(
        '.shift-convert-destination-output'
      );
      if (output) {
        output.textContent = describeOutput(files, destination);
      }
      nextNodes.push(existing);
    } else {
      nextNodes.push(
        createDestinationButton(root, files, destination, isSelected, onSelect)
      );
    }
  }
  container.replaceChildren(...nextNodes);
}

function createSourceRow(
  root: Document,
  file: File,
  onRemove: (file: MergeFileIdentity) => void
): HTMLElement {
  const row = root.createElement('li');
  row.className = 'shift-convert-source-row';

  const copy = root.createElement('div');
  copy.className = 'shift-convert-source-row-copy';

  const name = root.createElement('span');
  name.className = 'shift-convert-source-row-name';
  name.textContent = file.name;

  const meta = root.createElement('span');
  meta.className = 'shift-convert-source-row-meta';
  meta.textContent = formatBytes(file.size);

  copy.append(name, meta);

  const remove = root.createElement('button');
  remove.type = 'button';
  remove.className = 'shift-convert-source-remove';
  remove.setAttribute('aria-label', `Remove ${file.name}`);
  remove.title = `Remove ${file.name}`;
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => onRemove(toIdentity(file)));

  row.append(copy, remove);
  return row;
}

export function renderConvertHub(
  root: Document,
  state: ConvertHubState,
  handlers: {
    onSourceSelected: (file: File) => void;
    onChangeSource: () => void;
    onAddSource: () => void;
    onRemoveSource: (file: MergeFileIdentity) => void;
    onDestinationSelected: (destination: ConvertDestination) => void;
    onToggleMore: () => void;
    onSearch?: (query: string) => void;
    onFormatOptionsChange?: (options: ConvertFormatOptions) => void;
    onOpenDedicatedEditor?: (
      editorId: 'txt-to-pdf' | 'markdown-to-pdf'
    ) => void;
    formatOptions?: ConvertFormatOptions;
    showMore: boolean;
  }
): void {
  const sourceStep = root.getElementById('convert-source-step');
  const destinationStep = root.getElementById('convert-destination-step');
  const sourceLabel = root.getElementById('convert-source-label');
  const sourceName = root.getElementById('convert-source-name');
  const sourceMeta = root.getElementById('convert-source-meta');
  const sourceList = root.getElementById('convert-source-list');
  const destinationHeading = root.getElementById('convert-destination-heading');
  const primaryGrid = root.getElementById('convert-destination-primary');
  const secondaryGrid = root.getElementById('convert-destination-secondary');
  const showMoreButton = root.getElementById(
    'convert-show-more-formats'
  ) as HTMLButtonElement | null;
  const unsupportedMessage = root.getElementById('convert-unsupported-message');

  sourceStep?.classList.toggle('hidden', state.step !== 'source');
  destinationStep?.classList.toggle('hidden', state.step !== 'destination');

  const files = state.sourceFiles;
  const first = files[0];
  if (!first) {
    unsupportedMessage?.classList.add('hidden');
    sourceList?.replaceChildren();
    renderConvertFormatOptions(root, {
      destinationId: null,
      sourceFiles: [],
      options: handlers.formatOptions ?? createDefaultConvertFormatOptions(),
      onOptionsChange: (next) => handlers.onFormatOptionsChange?.(next),
      onOpenDedicatedEditor: handlers.onOpenDedicatedEditor,
    });
    return;
  }

  const isBatch = files.length > 1;
  const sourceKind = getConvertSourceKind(first);

  if (sourceLabel) {
    sourceLabel.textContent = isBatch ? 'Source files' : 'Source file';
  }
  if (sourceName) {
    sourceName.textContent = isBatch
      ? `${files.length} files selected`
      : first.name;
  }
  if (sourceMeta) {
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    sourceMeta.textContent = isBatch
      ? formatBytes(totalBytes)
      : `${formatBytes(first.size)} · ${sourceKind === 'pdf' ? 'PDF' : 'Document'}`;
  }

  if (sourceList) {
    sourceList.classList.toggle('hidden', !isBatch);
    sourceList.replaceChildren();
    if (isBatch) {
      for (const file of files) {
        sourceList.appendChild(
          createSourceRow(root, file, handlers.onRemoveSource)
        );
      }
    }
  }

  if (destinationHeading) {
    destinationHeading.textContent =
      sourceKind === 'pdf' ? 'Convert to…' : 'Convert to PDF';
  }

  ensureConvertDestinationSearch(root, (query) => {
    handlers.onSearch?.(query);
  });

  const selectedId = resolveAutoSelectedDestinationId(
    files,
    state.selectedDestinationId ?? null
  );
  const { primary, secondary } = getDestinationsForSources(files, selectedId);
  const visiblePrimary = filterConvertDestinations(
    primary,
    destinationSearchQuery
  );
  const visibleSecondary = filterConvertDestinations(
    secondary,
    destinationSearchQuery
  );
  const isSearching = destinationSearchQuery.trim().length > 0;
  const isUnsupported = primary.length === 0 && secondary.length === 0;
  unsupportedMessage?.classList.toggle('hidden', !isUnsupported);
  if (isUnsupported && unsupportedMessage) {
    unsupportedMessage.textContent = isBatch
      ? 'These files have no format in common. Convert them in separate batches, or remove the ones that do not match.'
      : 'That file type is not supported for conversion yet. Try a PDF or another common document format.';
  }

  const selectedInSecondary = Boolean(
    selectedId && secondary.some((dest) => dest.id === selectedId)
  );
  const showSecondary = handlers.showMore || isSearching || selectedInSecondary;

  if (primaryGrid) {
    renderDestinationGrid(
      root,
      primaryGrid,
      files,
      visiblePrimary,
      selectedId,
      (destination) => {
        handlers.onDestinationSelected(destination);
      }
    );
  }

  if (secondaryGrid) {
    secondaryGrid.classList.toggle('hidden', !showSecondary);
    renderDestinationGrid(
      root,
      secondaryGrid,
      files,
      visibleSecondary,
      selectedId,
      (destination) => {
        handlers.onDestinationSelected(destination);
      }
    );
  }

  renderConvertFormatOptions(root, {
    destinationId: selectedId,
    sourceFiles: files,
    options: handlers.formatOptions ?? createDefaultConvertFormatOptions(),
    onOptionsChange: (next) => handlers.onFormatOptionsChange?.(next),
    onOpenDedicatedEditor: handlers.onOpenDedicatedEditor,
  });

  let searchEmpty = root.getElementById(CONVERT_DESTINATION_SEARCH_EMPTY_ID);
  if (!searchEmpty && destinationStep) {
    searchEmpty = root.createElement('p');
    searchEmpty.id = CONVERT_DESTINATION_SEARCH_EMPTY_ID;
    searchEmpty.className = 'shift-convert-search-empty';
    destinationStep.appendChild(searchEmpty);
  }
  if (searchEmpty) {
    const noMatches =
      isSearching &&
      visiblePrimary.length === 0 &&
      visibleSecondary.length === 0 &&
      !isUnsupported;
    searchEmpty.hidden = !noMatches;
    searchEmpty.textContent = noMatches ? 'No formats match your search.' : '';
  }

  if (showMoreButton) {
    const hasSecondary = secondary.length > 0 && sourceKind === 'pdf';
    showMoreButton.classList.toggle('hidden', !hasSecondary || isSearching);
    showMoreButton.textContent = showSecondary ? 'Show less' : 'Show more';
    showMoreButton.onclick = () => handlers.onToggleMore();
  }

  const changeSourceButton = root.getElementById(
    'convert-change-source'
  ) as HTMLButtonElement | null;
  if (changeSourceButton) {
    changeSourceButton.textContent = isBatch ? 'Start over' : 'Change file';
    changeSourceButton.onclick = () => handlers.onChangeSource();
  }

  const addSourceButton = root.getElementById(
    'convert-add-source'
  ) as HTMLButtonElement | null;
  if (addSourceButton) {
    addSourceButton.onclick = () => handlers.onAddSource();
  }
}

export function initConvertHubPage(root: Document = document): void {
  const initialLaunchCtx = applyLaunchContextToDom(root);
  const initialEntryDestination = initialLaunchCtx.isConsolidatedEntry
    ? getConvertDestinationById(initialLaunchCtx.entryId)
    : null;
  const initialDestinationId = initialEntryDestination?.id ?? null;

  let state = createInitialConvertHubState([], initialDestinationId);
  let showMore = false;
  let formatOptions = createDefaultConvertFormatOptions();

  const fileInput = root.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = root.getElementById('drop-zone');
  const unsupportedMessage = root.getElementById('convert-unsupported-message');

  if (fileInput) {
    fileInput.accept = initialLaunchCtx.isConsolidatedEntry
      ? initialLaunchCtx.accept
      : buildConvertSourceAccept();
    fileInput.multiple = true;
  }

  initShiftPdfSave(root);

  const resolveActiveDestination = (): ConvertDestination | null => {
    const activeId =
      state.sourceFiles.length > 0
        ? resolveAutoSelectedDestinationId(
            state.sourceFiles,
            state.selectedDestinationId ?? null
          )
        : (state.selectedDestinationId ?? null);
    if (!activeId) return null;
    if (state.sourceFiles.length > 0) {
      const { primary, secondary } = getDestinationsForSources(
        state.sourceFiles,
        activeId
      );
      const match = [...primary, ...secondary].find((d) => d.id === activeId);
      if (match) return match;
    }
    return getConvertDestinationById(activeId);
  };

  const resolveCurrentOutputKind = (): ToolOutputKind => {
    const dest = resolveActiveDestination();
    if (dest) {
      if (!dest.producesPdf) return 'non-pdf';
      const liveOptions = readConvertFormatOptionsFromDom(root, formatOptions);
      if (state.sourceFiles.length > 1) {
        if (
          IMAGE_TO_PDF_DESTINATION_ID_SET.has(dest.id) &&
          liveOptions.imageCombineMode !== 'separate'
        ) {
          return 'pdf';
        }
        return 'multi-pdf-zip';
      }
      return 'pdf';
    }
    if (state.sourceFiles.length > 0 && state.sourceFiles.every(isPdfFile)) {
      return 'non-pdf';
    }
    return 'pdf';
  };

  const resetHub = async () => {
    state = clearConvertSources(initialDestinationId);
    showMore = false;
    destinationSearchQuery = '';
    formatOptions = createDefaultConvertFormatOptions();
    setLaunchContext(initialDestinationId ?? 'pdf-converter', root);
    if (fileInput) {
      if (!initialDestinationId) {
        fileInput.accept = buildConvertSourceAccept();
      }
      fileInput.multiple = true;
    }
    clearLatestPdfOutput(root);
    await clearWorkspaceOpenFile(root);
    refresh();
  };

  registerToolOutputSession(
    {
      outputKind: () => resolveCurrentOutputKind(),
      canSave: () => {
        const dest = resolveActiveDestination();
        return Boolean(
          state.sourceFiles.length > 0 && dest && dest.producesPdf
        );
      },
      canDownload: () => {
        const dest = resolveActiveDestination();
        return Boolean(state.sourceFiles.length > 0 && dest);
      },
      canReset: () => state.sourceFiles.length > 0,
      reset: () => resetHub(),
      apply: async () => {
        const dest = resolveActiveDestination();
        if (!dest || state.sourceFiles.length === 0) return;
        const liveOptions = readConvertFormatOptionsFromDom(
          root,
          formatOptions
        );
        formatOptions = liveOptions;
        await runInPlaceConversion(state.sourceFiles, dest, liveOptions);
      },
    },
    root
  );

  const addSources = (files: File[]) => {
    const next = addConvertSources(state, files);
    if (next === state) {
      if (unsupportedMessage) {
        unsupportedMessage.classList.remove('hidden');
        unsupportedMessage.textContent = describeRejectedConvertSources(
          state,
          files
        );
      }
      beginToolUse();
      endToolUse('error');
      return;
    }
    state = next;
    showMore = false;
    unsupportedMessage?.classList.add('hidden');
    setWorkspaceFiles(state.sourceFiles, root);
    refresh();
  };

  const refresh = () => {
    renderConvertHub(root, state, {
      onSourceSelected: (file) => addSources([file]),
      onChangeSource: () => {
        void resetHub();
      },
      onAddSource: () => {
        if (!state.sourceFiles.every(isPdfFile)) {
          fileInput?.click();
          return;
        }
        void openConvertSourcePicker(
          root,
          fileInput,
          (file) => addSources([file]),
          state.sourceFiles
        );
      },
      onRemoveSource: (identity) => {
        state = removeConvertSource(state, identity);
        setWorkspaceFiles(state.sourceFiles, root);
        refresh();
      },
      onDestinationSelected: (destination) => {
        state = {
          ...state,
          selectedDestinationId: destination.id,
        };
        setLaunchContext(destination.id, root);
        if (fileInput) {
          fileInput.multiple = true;
        }
        refresh();
      },
      onToggleMore: () => {
        showMore = !showMore;
        refresh();
      },
      onSearch: (query) => {
        destinationSearchQuery = query;
        refresh();
      },
      onFormatOptionsChange: (nextOptions) => {
        formatOptions = nextOptions;
        syncToolOutputToolbar(root);
      },
      onOpenDedicatedEditor: (editorId) => {
        void openDedicatedTextOrMarkdownEditor(
          state.sourceFiles,
          editorId,
          root
        );
      },
      formatOptions,
      showMore,
    });
    syncToolOutputToolbar(root);
    createIcons({ icons });
  };

  const chooseSource = (files: FileList | File[] | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    addSources(selected);
  };

  dropZone?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.closest('input')) return;
    fileInput?.click();
  });
  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone?.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });
  dropZone?.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
    chooseSource(event.dataTransfer?.files ?? null);
  });
  fileInput?.addEventListener('change', () => {
    chooseSource(fileInput.files);
    fileInput.value = '';
  });

  listenForShiftFileHandoff({
    onFile: (file) => {
      markFileFromHandoff(file);
      const before = state.sourceFiles.length;
      addSources([file]);
      return state.sourceFiles.length > before;
    },
  });

  const applySeededSource = () => {
    const seeded = resolveInitialConvertSources().filter(isSupportedSource);
    if (seeded.length === 0) return;
    if (sameSelection(seeded, state.sourceFiles)) {
      refresh();
      return;
    }
    state = replaceConvertSources(state, seeded);
    refresh();
  };

  onToolFilesSeeded(applySeededSource);
  void syncHomeLibraryFromStore(root).then(() => {
    applySeededSource();
    refresh();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('[data-convert-hub]')) {
      initConvertHubPage();
    }
  });
}
