import { createIcons, icons } from 'lucide';
import {
  buildConvertSourceAccept,
  getConvertSourceKind,
  getOutputFilename,
  getPdfDestinations,
  getToPdfDestination,
  isPdfFile,
  resolveDestinationHref,
  type ConvertDestination,
} from '../config/convert-destinations.js';
import { addPdfToLibrary } from './pdf-library-store.js';
import { openPdfLibraryPicker } from './pdf-library-picker.js';
import { readPersistedOpenFiles } from './open-file-store.js';
import { syncHomeLibraryFromStore } from './home-files.js';
import {
  getWorkspaceFiles,
  persistWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';
import { isToolDisabled } from '../utils/disabled-tools.js';
import { formatBytes } from '../utils/helpers.js';

export type ConvertHubStep = 'source' | 'destination';

export type ConvertHubState = {
  step: ConvertHubStep;
  sourceFile: File | null;
};

export function createInitialConvertHubState(
  sourceFile: File | null
): ConvertHubState {
  return {
    step: sourceFile ? 'destination' : 'source',
    sourceFile,
  };
}

export function selectConvertSource(
  state: ConvertHubState,
  file: File
): ConvertHubState {
  if (getConvertSourceKind(file) === 'unsupported') {
    return state;
  }
  return {
    step: 'destination',
    sourceFile: file,
  };
}

export function clearConvertSource(_state: ConvertHubState): ConvertHubState {
  return {
    step: 'source',
    sourceFile: null,
  };
}

export function getDestinationsForSource(file: File): {
  primary: ConvertDestination[];
  secondary: ConvertDestination[];
} {
  if (isPdfFile(file)) {
    return getPdfDestinations({ isToolDisabled });
  }

  const destination = getToPdfDestination(file);
  if (!destination) {
    return { primary: [], secondary: [] };
  }

  return { primary: [destination], secondary: [] };
}

export async function resolveInitialConvertSource(
  getWorkspace = getWorkspaceFiles,
  readPersisted = readPersistedOpenFiles
): Promise<File | null> {
  const workspace = getWorkspace()
    .map((entry) => entry.blob)
    .filter((blob): blob is File => blob instanceof File);
  if (workspace.length > 0) {
    return workspace[0];
  }

  const persisted = await readPersisted();
  if (persisted.length > 0) {
    return persisted[0].file;
  }

  return null;
}

export async function openConvertSourcePicker(
  root: Document,
  fileInput: HTMLInputElement | null,
  onFileSelected: (file: File) => void,
  currentSource: File | null = null
): Promise<void> {
  const exclude = currentSource
    ? [{ name: currentSource.name, size: currentSource.size }]
    : [];

  await openPdfLibraryPicker({
    root,
    title: 'Choose a file to convert',
    emptyMessage:
      'No saved PDFs in your library yet. Upload one from your device.',
    exclude,
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

export async function handoffConvertSourceToTool(
  file: File,
  destination: ConvertDestination,
  root: Document = document
): Promise<void> {
  setWorkspaceFiles([file], root);
  await persistWorkspaceOpenFile();
  if (isPdfFile(file)) {
    await addPdfToLibrary(file, 'upload');
    await syncHomeLibraryFromStore(root);
  }
  const href = resolveDestinationHref(file, destination);
  window.location.assign(href);
}

function createDestinationButton(
  root: Document,
  file: File,
  destination: ConvertDestination,
  onSelect: (destination: ConvertDestination) => void
): HTMLButtonElement {
  const button = root.createElement('button');
  button.type = 'button';
  button.className = 'shift-convert-destination';
  button.dataset.destinationId = destination.id;

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
  output.textContent = getOutputFilename(file.name, destination);

  info.append(name, output);
  button.append(icon, info);
  button.addEventListener('click', () => onSelect(destination));
  return button;
}

function renderDestinationGrid(
  root: Document,
  container: HTMLElement,
  file: File,
  destinations: ConvertDestination[],
  onSelect: (destination: ConvertDestination) => void
): void {
  container.replaceChildren();
  for (const destination of destinations) {
    container.appendChild(
      createDestinationButton(root, file, destination, onSelect)
    );
  }
}

export function renderConvertHub(
  root: Document,
  state: ConvertHubState,
  handlers: {
    onSourceSelected: (file: File) => void;
    onChangeSource: () => void;
    onDestinationSelected: (destination: ConvertDestination) => void;
    onToggleMore: () => void;
    showMore: boolean;
  }
): void {
  const sourceStep = root.getElementById('convert-source-step');
  const destinationStep = root.getElementById('convert-destination-step');
  const sourceName = root.getElementById('convert-source-name');
  const sourceMeta = root.getElementById('convert-source-meta');
  const destinationHeading = root.getElementById('convert-destination-heading');
  const primaryGrid = root.getElementById('convert-destination-primary');
  const secondaryGrid = root.getElementById('convert-destination-secondary');
  const showMoreButton = root.getElementById(
    'convert-show-more-formats'
  ) as HTMLButtonElement | null;
  const unsupportedMessage = root.getElementById('convert-unsupported-message');

  const hasSource = state.sourceFile !== null;
  sourceStep?.classList.toggle('hidden', state.step !== 'source');
  destinationStep?.classList.toggle('hidden', state.step !== 'destination');

  if (!hasSource || !state.sourceFile) {
    unsupportedMessage?.classList.add('hidden');
    return;
  }

  const file = state.sourceFile;
  const sourceKind = getConvertSourceKind(file);

  if (sourceName) sourceName.textContent = file.name;
  if (sourceMeta) {
    sourceMeta.textContent = `${formatBytes(file.size)} · ${sourceKind === 'pdf' ? 'PDF' : 'Document'}`;
  }

  if (destinationHeading) {
    destinationHeading.textContent =
      sourceKind === 'pdf' ? 'Convert to…' : 'Convert to PDF';
  }

  const { primary, secondary } = getDestinationsForSource(file);
  const isUnsupported = primary.length === 0 && secondary.length === 0;
  unsupportedMessage?.classList.toggle('hidden', !isUnsupported);

  if (primaryGrid) {
    renderDestinationGrid(root, primaryGrid, file, primary, (destination) => {
      handlers.onDestinationSelected(destination);
    });
  }

  if (secondaryGrid) {
    secondaryGrid.classList.toggle('hidden', !handlers.showMore);
    renderDestinationGrid(
      root,
      secondaryGrid,
      file,
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
    changeSourceButton.onclick = () => handlers.onChangeSource();
  }
}

export function initConvertHubPage(root: Document = document): void {
  let state = createInitialConvertHubState(null);
  let showMore = false;

  const fileInput = root.getElementById(
    'file-input'
  ) as HTMLInputElement | null;
  const dropZone = root.getElementById('drop-zone');
  const unsupportedMessage = root.getElementById('convert-unsupported-message');

  if (fileInput) {
    fileInput.accept = buildConvertSourceAccept();
  }

  const applySelectedSource = (file: File) => {
    state = selectConvertSource(state, file);
    if (state.step === 'source') {
      if (unsupportedMessage) {
        unsupportedMessage.classList.remove('hidden');
        unsupportedMessage.textContent =
          'That file type is not supported for conversion yet. Try a PDF or another common document format.';
      }
      return;
    }
    showMore = false;
    unsupportedMessage?.classList.add('hidden');
    if (state.sourceFile) {
      setWorkspaceFiles([state.sourceFile], root);
    }
    refresh();
  };

  const refresh = () => {
    renderConvertHub(root, state, {
      onSourceSelected: applySelectedSource,
      onChangeSource: () => {
        void openConvertSourcePicker(
          root,
          fileInput,
          applySelectedSource,
          state.sourceFile
        );
      },
      onDestinationSelected: (destination) => {
        if (!state.sourceFile) return;
        void handoffConvertSourceToTool(state.sourceFile, destination, root);
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
    const file = Array.from(files ?? [])[0];
    if (!file) return;
    applySelectedSource(file);
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
      applySelectedSource,
      state.sourceFile
    );
  });

  void (async () => {
    await syncHomeLibraryFromStore(root);
    const initial = await resolveInitialConvertSource();
    if (initial && getConvertSourceKind(initial) !== 'unsupported') {
      state = selectConvertSource(state, initial);
      setWorkspaceFiles([initial], root);
    }
    refresh();
  })();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('convert-hub')) {
      initConvertHubPage();
    }
  });
}
