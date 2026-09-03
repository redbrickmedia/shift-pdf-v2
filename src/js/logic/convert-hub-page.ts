import { createIcons, icons } from 'lucide';
import {
  buildConvertSourceAccept,
  getConvertSourceKind,
  getOutputFilename,
  getSharedDestinations,
  isPdfFile,
  resolveDestinationHref,
  type ConvertDestination,
} from '../config/convert-destinations.js';
import {
  isDuplicateMergeFile,
  mergeFilesMatch,
  type MergeFileIdentity,
} from './merge-file-identity.js';
import { addPdfToLibrary } from './pdf-library-store.js';
import { openPdfLibraryPicker } from './pdf-library-picker.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  getWorkspaceFiles,
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';
import { state as appState } from '../state.js';
import { isToolDisabled } from '../utils/disabled-tools.js';
import { formatBytes } from '../utils/helpers.js';

export type ConvertHubStep = 'source' | 'destination';

export type ConvertHubState = {
  step: ConvertHubStep;
  sourceFiles: File[];
};

export function createInitialConvertHubState(
  sourceFiles: File[] = []
): ConvertHubState {
  const supported = sourceFiles.filter(isSupportedSource);
  return {
    step: supported.length > 0 ? 'destination' : 'source',
    sourceFiles: supported,
  };
}

function isSupportedSource(file: File): boolean {
  return getConvertSourceKind(file) !== 'unsupported';
}

function toIdentity(file: File): MergeFileIdentity {
  return { name: file.name, size: file.size };
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

  // The same state object signals "nothing landed", which is what tells the
  // page to explain why instead of re-rendering an unchanged selection.
  if (added.length === state.sourceFiles.length) return state;
  return { step: 'destination', sourceFiles: added };
}

export function replaceConvertSources(
  state: ConvertHubState,
  files: File[]
): ConvertHubState {
  const next = createInitialConvertHubState(files);
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
  };
}

export function clearConvertSources(): ConvertHubState {
  return { step: 'source', sourceFiles: [] };
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

export function getDestinationsForSources(files: File[]): {
  primary: ConvertDestination[];
  secondary: ConvertDestination[];
} {
  return getSharedDestinations(files, { isToolDisabled });
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
      onFileSelected(selected[0].file);
    },
    onUpload: () => {
      fileInput?.click();
    },
  });
}

export async function handoffConvertSourcesToTool(
  files: File[],
  destination: ConvertDestination,
  root: Document = document
): Promise<void> {
  const handedOff = destination.acceptsMultiple ? files : files.slice(0, 1);
  if (handedOff.length === 0) return;

  setWorkspaceFiles(handedOff, root);
  await persistWorkspaceOpenFile();

  const pdfs = handedOff.filter(isPdfFile);
  if (pdfs.length > 0) {
    for (const pdf of pdfs) {
      await addPdfToLibrary(pdf, 'upload');
    }
    await syncHomeLibraryFromStore(root);
  }

  window.location.assign(resolveDestinationHref(handedOff[0], destination));
}

function describeOutput(
  files: File[],
  destination: ConvertDestination
): string {
  const first = files[0];
  if (!first) return '';
  if (files.length === 1) return getOutputFilename(first.name, destination);
  if (!destination.acceptsMultiple) return 'One file at a time';
  return `${files.length} files → .${destination.outputExtension}`;
}

function createDestinationButton(
  root: Document,
  files: File[],
  destination: ConvertDestination,
  onSelect: (destination: ConvertDestination) => void
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-convert-destination';
  button.dataset.destinationId = destination.id;

  // Handing a batch to a single-file tool would keep one file and drop the rest
  // without saying so, so the destination is offered only once the selection
  // fits what it can take.
  const tooManyFiles = files.length > 1 && !destination.acceptsMultiple;
  button.disabled = tooManyFiles;
  if (tooManyFiles) {
    button.classList.add('is-unavailable');
    button.title = `${destination.name} converts one file at a time.`;
  }

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
  if (!tooManyFiles) {
    button.addEventListener('click', () => onSelect(destination));
  }
  return button;
}

function renderDestinationGrid(
  root: Document,
  container: HTMLElement,
  files: File[],
  destinations: ConvertDestination[],
  onSelect: (destination: ConvertDestination) => void
): void {
  container.replaceChildren();
  for (const destination of destinations) {
    container.appendChild(
      createDestinationButton(root, files, destination, onSelect)
    );
  }
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

  const { primary, secondary } = getDestinationsForSources(files);
  const isUnsupported = primary.length === 0 && secondary.length === 0;
  unsupportedMessage?.classList.toggle('hidden', !isUnsupported);
  if (isUnsupported && unsupportedMessage) {
    unsupportedMessage.textContent = isBatch
      ? 'These files have no format in common. Convert them in separate batches, or remove the ones that do not match.'
      : 'That file type is not supported for conversion yet. Try a PDF or another common document format.';
  }

  if (primaryGrid) {
    renderDestinationGrid(root, primaryGrid, files, primary, (destination) => {
      handlers.onDestinationSelected(destination);
    });
  }

  if (secondaryGrid) {
    secondaryGrid.classList.toggle('hidden', !handlers.showMore);
    renderDestinationGrid(
      root,
      secondaryGrid,
      files,
      secondary,
      (destination) => {
        handlers.onDestinationSelected(destination);
      }
    );
  }

  if (showMoreButton) {
    const hasSecondary = secondary.length > 0 && sourceKind === 'pdf';
    showMoreButton.classList.toggle('hidden', !hasSecondary);
    showMoreButton.textContent = handlers.showMore ? 'Show less' : 'Show more';
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
  let state = createInitialConvertHubState();
  let showMore = false;

  const fileInput = root.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = root.getElementById('drop-zone');
  const unsupportedMessage = root.getElementById('convert-unsupported-message');

  if (fileInput) {
    fileInput.accept = buildConvertSourceAccept();
    fileInput.multiple = true;
  }

  const addSources = (files: File[]) => {
    const next = addConvertSources(state, files);
    if (next === state) {
      if (unsupportedMessage) {
        unsupportedMessage.classList.remove('hidden');
        unsupportedMessage.textContent =
          'That file type is not supported for conversion yet. Try a PDF or another common document format.';
      }
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
        state = clearConvertSources();
        showMore = false;
        void clearWorkspaceOpenFile(root).then(refresh);
      },
      onAddSource: () => {
        // The library only holds PDFs, so offering it alongside a batch of
        // images or documents would show nothing that could join them.
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
        if (state.sourceFiles.length === 0) return;
        void handoffConvertSourcesToTool(state.sourceFiles, destination, root);
      },
      onToggleMore: () => {
        showMore = !showMore;
        refresh();
      },
      showMore,
    });
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

  root.getElementById('convert-library-btn')?.addEventListener('click', () => {
    void openConvertSourcePicker(
      root,
      fileInput,
      (file) => addSources([file]),
      state.sourceFiles
    );
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
    if (document.getElementById('convert-hub')) {
      initConvertHubPage();
    }
  });
}
