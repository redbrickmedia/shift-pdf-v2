import { showResultLoader } from './tool-success.js';
import { mountToolInputPreview } from './tool-input-preview.js';
import { EditMetadataState } from '@/types';
import { showLoader, hideLoader, showAlert } from '../ui.js';
import { downloadFile, formatBytes, formatIsoDate } from '../utils/helpers.js';
import { createIcons, icons } from 'lucide';
import { PDFName, PDFString } from 'pdf-lib';
import { loadPdfWithPasswordPrompt } from '../utils/password-prompt.js';
import { loadPdfDocument } from '../utils/load-pdf-document.js';
import {
  applyLaunchContextToDom,
  resolveLaunchContext,
} from './launch-context.js';
import {
  registerToolOutputSession,
  syncToolOutputToolbar,
} from './tool-output-toolbar.ts';
import { onToolFilesSeeded } from './tool-file-seed.js';
import {
  clearWorkspaceOpenFile,
  setWorkspaceFiles,
} from './workspace-files.js';

const STANDARD_FIELD_IDS = [
  'meta-title',
  'meta-author',
  'meta-subject',
  'meta-keywords',
  'meta-creator',
  'meta-producer',
  'meta-creation-date',
  'meta-mod-date',
] as const;

const pageState: EditMetadataState & {
  metadata: Record<string, string>;
  isDirty: boolean;
  clearedAll: boolean;
} = {
  file: null,
  pdfDoc: null,
  metadata: {},
  isDirty: false,
  clearedAll: false,
};

function markDirty() {
  pageState.isDirty = true;
  syncToolOutputToolbar();
}

function resetState() {
  pageState.file = null;
  pageState.pdfDoc = null;
  pageState.metadata = {};
  pageState.isDirty = false;
  pageState.clearedAll = false;

  const fileDisplayArea = document.getElementById('file-display-area');
  if (fileDisplayArea) fileDisplayArea.innerHTML = '';

  const toolOptions = document.getElementById('tool-options');
  if (toolOptions) toolOptions.classList.add('hidden');

  const metadataDisplay = document.getElementById('metadata-display');
  if (metadataDisplay) metadataDisplay.innerHTML = '';

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  if (fileInput) fileInput.value = '';

  STANDARD_FIELD_IDS.forEach(function (fieldId) {
    const field = document.getElementById(fieldId) as HTMLInputElement;
    if (field) field.value = '';
  });

  const customFieldsContainer = document.getElementById(
    'custom-fields-container'
  );
  if (customFieldsContainer) customFieldsContainer.innerHTML = '';

  void clearWorkspaceOpenFile();
  syncToolOutputToolbar();
}

function formatDateForInput(date: Date | undefined): string {
  if (!date) return '';
  try {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return '';
  }
}

function addCustomFieldRow(
  key: string = '',
  value: string = '',
  userInitiated: boolean = false
) {
  const container = document.getElementById('custom-fields-container');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'flex flex-col gap-2';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'Key (e.g., Department)';
  keyInput.value = key;
  keyInput.className =
    'custom-meta-key w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2.5';
  keyInput.addEventListener('input', markDirty);

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'Value (e.g., Marketing)';
  valueInput.value = value;
  valueInput.className =
    'custom-meta-value w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 p-2.5';
  valueInput.addEventListener('input', markDirty);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'p-2 self-center shift-tool-file-remove';
  removeBtn.setAttribute('aria-label', 'Remove field');
  removeBtn.title = 'Remove field';
  removeBtn.innerHTML = '<i data-lucide="x" class="w-5 h-5"></i>';
  removeBtn.onclick = function () {
    row.remove();
    markDirty();
  };

  row.append(keyInput, valueInput, removeBtn);
  container.appendChild(row);
  createIcons({ icons });

  if (userInitiated) {
    markDirty();
  }
}

function clearAllMetadataFields() {
  STANDARD_FIELD_IDS.forEach(function (fieldId) {
    const field = document.getElementById(fieldId) as HTMLInputElement | null;
    if (field) field.value = '';
  });

  const customFieldsContainer = document.getElementById(
    'custom-fields-container'
  );
  if (customFieldsContainer) customFieldsContainer.innerHTML = '';

  pageState.clearedAll = true;
  markDirty();
}

function populateMetadataFields() {
  if (!pageState.pdfDoc) return;

  const titleInput = document.getElementById('meta-title') as HTMLInputElement;
  const authorInput = document.getElementById(
    'meta-author'
  ) as HTMLInputElement;
  const subjectInput = document.getElementById(
    'meta-subject'
  ) as HTMLInputElement;
  const keywordsInput = document.getElementById(
    'meta-keywords'
  ) as HTMLInputElement;
  const creatorInput = document.getElementById(
    'meta-creator'
  ) as HTMLInputElement;
  const producerInput = document.getElementById(
    'meta-producer'
  ) as HTMLInputElement;
  const creationDateInput = document.getElementById(
    'meta-creation-date'
  ) as HTMLInputElement;
  const modDateInput = document.getElementById(
    'meta-mod-date'
  ) as HTMLInputElement;

  if (titleInput) titleInput.value = pageState.pdfDoc.getTitle() || '';
  if (authorInput) authorInput.value = pageState.pdfDoc.getAuthor() || '';
  if (subjectInput) subjectInput.value = pageState.pdfDoc.getSubject() || '';
  if (keywordsInput) keywordsInput.value = pageState.pdfDoc.getKeywords() || '';
  if (creatorInput) creatorInput.value = pageState.pdfDoc.getCreator() || '';
  if (producerInput) producerInput.value = pageState.pdfDoc.getProducer() || '';
  if (creationDateInput)
    creationDateInput.value = formatDateForInput(
      pageState.pdfDoc.getCreationDate()
    );
  if (modDateInput)
    modDateInput.value = formatDateForInput(
      pageState.pdfDoc.getModificationDate()
    );

  const customFieldsContainer = document.getElementById(
    'custom-fields-container'
  );
  if (customFieldsContainer) customFieldsContainer.innerHTML = '';

  try {
    // @ts-expect-error getInfoDict is private but accessible at runtime
    const infoDict = pageState.pdfDoc.getInfoDict();
    const standardKeys = new Set([
      'Title',
      'Author',
      'Subject',
      'Keywords',
      'Creator',
      'Producer',
      'CreationDate',
      'ModDate',
    ]);

    const allKeys = infoDict.keys().map(function (key: {
      asString: () => string;
    }) {
      return key.asString().substring(1);
    });

    allKeys.forEach(function (key: string) {
      if (!standardKeys.has(key)) {
        const rawValue = infoDict.lookup(key);
        let displayValue = '';

        if (rawValue && typeof rawValue.decodeText === 'function') {
          displayValue = rawValue.decodeText();
        } else if (rawValue && typeof rawValue.asString === 'function') {
          displayValue = rawValue.asString();
        } else if (rawValue) {
          displayValue = String(rawValue);
        }

        addCustomFieldRow(key, displayValue, false);
      }
    });
  } catch (e) {
    console.warn('Could not read custom metadata fields:', e);
  }
}

function createSection(title: string): {
  wrapper: HTMLDivElement;
  ul: HTMLUListElement;
} {
  const wrapper = document.createElement('div');
  wrapper.className = 'mb-6';
  const h3 = document.createElement('h3');
  h3.className = 'text-lg font-semibold text-white mb-2';
  h3.textContent = title;
  const ul = document.createElement('ul');
  ul.className =
    'space-y-3 text-sm bg-gray-900 p-4 rounded-lg border border-gray-700';
  wrapper.append(h3, ul);
  return { wrapper, ul };
}

function createListItem(key: string, value: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'flex flex-col sm:flex-row';
  const strong = document.createElement('strong');
  strong.className = 'w-40 flex-shrink-0 text-gray-400';
  strong.textContent = key;
  const div = document.createElement('div');
  div.className = 'flex-grow text-white break-all';
  div.textContent = value;
  li.append(strong, div);
  return li;
}

function parsePdfDate(pdfDate: string | unknown): string {
  if (!pdfDate || typeof pdfDate !== 'string' || !pdfDate.startsWith('D:')) {
    return String(pdfDate || '');
  }
  try {
    const year = pdfDate.substring(2, 6);
    const month = pdfDate.substring(6, 8);
    const day = pdfDate.substring(8, 10);
    const hour = pdfDate.substring(10, 12);
    const minute = pdfDate.substring(12, 14);
    const second = pdfDate.substring(14, 16);
    return new Date(
      `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
    ).toLocaleString();
  } catch {
    return pdfDate;
  }
}

function createXmpListItem(
  key: string,
  value: string,
  indent: number = 0
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'flex flex-col sm:flex-row';

  const strong = document.createElement('strong');
  strong.className = 'w-56 flex-shrink-0 text-gray-400';
  strong.textContent = key;
  strong.style.paddingLeft = `${indent * 1.2}rem`;

  const div = document.createElement('div');
  div.className = 'flex-grow text-white break-all';
  div.textContent = value;

  li.append(strong, div);
  return li;
}

function createXmpHeaderItem(key: string, indent: number = 0): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'flex pt-2';
  const strong = document.createElement('strong');
  strong.className = 'w-full flex-shrink-0 text-gray-300 font-medium';
  strong.textContent = key;
  strong.style.paddingLeft = `${indent * 1.2}rem`;
  li.append(strong);
  return li;
}

function appendXmpNodes(
  xmlNode: Element,
  ulElement: HTMLUListElement,
  indentLevel: number
) {
  const xmpDateKeys = ['xap:CreateDate', 'xap:ModifyDate', 'xap:MetadataDate'];

  const childNodes = Array.from(xmlNode.children);

  for (const child of childNodes) {
    if (child.nodeType !== 1) continue;

    let key = child.tagName;
    const elementChildren = Array.from(child.children).filter(function (c) {
      return c.nodeType === 1;
    });

    if (key === 'rdf:li') {
      appendXmpNodes(child, ulElement, indentLevel);
      continue;
    }
    if (key === 'rdf:Alt') {
      key = '(alt container)';
    }

    if (
      child.getAttribute('rdf:parseType') === 'Resource' &&
      elementChildren.length === 0
    ) {
      ulElement.appendChild(
        createXmpListItem(key, '(Empty Resource)', indentLevel)
      );
      continue;
    }

    if (elementChildren.length > 0) {
      ulElement.appendChild(createXmpHeaderItem(key, indentLevel));
      appendXmpNodes(child, ulElement, indentLevel + 1);
    } else {
      let value = (child.textContent || '').trim();
      if (value) {
        if (xmpDateKeys.includes(key)) {
          value = formatIsoDate(value);
        }
        ulElement.appendChild(createXmpListItem(key, value, indentLevel));
      }
    }
  }
}

async function renderMetadataInspector(pdfjsDoc: {
  getMetadata?: () => Promise<{
    info: unknown;
    metadata: { getRaw: () => string | null } | null;
  }>;
  getFieldObjects?: () => Promise<Record<
    string,
    Array<{ fieldValue?: unknown }>
  > | null>;
}) {
  const metadataDisplay = document.getElementById('metadata-display');
  if (!metadataDisplay) return;

  metadataDisplay.innerHTML = '';
  pageState.metadata = {};

  try {
    const [metadataResult, fieldObjects] = await Promise.all([
      typeof pdfjsDoc.getMetadata === 'function'
        ? pdfjsDoc.getMetadata()
        : Promise.resolve({ info: null, metadata: null }),
      typeof pdfjsDoc.getFieldObjects === 'function'
        ? pdfjsDoc.getFieldObjects()
        : Promise.resolve(null),
    ]);

    const { info, metadata } = metadataResult ?? { info: null, metadata: null };
    const rawXmpString = metadata ? metadata.getRaw() : null;

    // Info Dictionary Section
    const infoSection = createSection('Info Dictionary');
    const infoObj =
      info && typeof info === 'object'
        ? (info as Record<string, unknown>)
        : null;
    if (infoObj && Object.keys(infoObj).length > 0) {
      for (const key in infoObj) {
        const value = infoObj[key];
        let displayValue: string;

        if (value === null || typeof value === 'undefined') {
          displayValue = '- Not Set -';
        } else if (
          typeof value === 'object' &&
          value !== null &&
          'name' in value
        ) {
          displayValue = String((value as { name: string }).name);
        } else if (typeof value === 'object') {
          try {
            displayValue = JSON.stringify(value);
          } catch {
            displayValue = '[object Object]';
          }
        } else if (
          (key === 'CreationDate' || key === 'ModDate') &&
          typeof value === 'string'
        ) {
          displayValue = parsePdfDate(value);
        } else {
          displayValue = String(value);
        }

        pageState.metadata[key] = displayValue;
        infoSection.ul.appendChild(createListItem(key, displayValue));
      }
    } else if (pageState.pdfDoc) {
      const fallbackEntries: Array<[string, string | undefined]> = [
        ['Title', pageState.pdfDoc.getTitle()],
        ['Author', pageState.pdfDoc.getAuthor()],
        ['Subject', pageState.pdfDoc.getSubject()],
        ['Keywords', pageState.pdfDoc.getKeywords()],
        ['Creator', pageState.pdfDoc.getCreator()],
        ['Producer', pageState.pdfDoc.getProducer()],
      ];
      const populated = fallbackEntries.filter(([, val]) => Boolean(val));
      if (populated.length > 0) {
        for (const [k, val] of populated) {
          pageState.metadata[k] = val!;
          infoSection.ul.appendChild(createListItem(k, val!));
        }
      } else {
        infoSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No Info Dictionary data found -</span></li>`;
      }
    } else {
      infoSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No Info Dictionary data found -</span></li>`;
    }
    metadataDisplay.appendChild(infoSection.wrapper);

    // Interactive Form Fields Section
    const fieldsSection = createSection('Interactive Form Fields');
    if (fieldObjects && Object.keys(fieldObjects).length > 0) {
      for (const fieldName in fieldObjects) {
        const field = (
          fieldObjects as Record<string, Array<{ fieldValue?: unknown }>>
        )[fieldName]?.[0];
        const value = field?.fieldValue || '- Not Set -';
        fieldsSection.ul.appendChild(createListItem(fieldName, String(value)));
      }
    } else {
      fieldsSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No interactive form fields found -</span></li>`;
    }
    metadataDisplay.appendChild(fieldsSection.wrapper);

    // XMP Metadata Section
    const xmpSection = createSection('XMP Metadata');
    if (rawXmpString) {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(rawXmpString, 'application/xml');

        const descriptions = xmlDoc.getElementsByTagName('rdf:Description');
        if (descriptions.length > 0) {
          for (let i = 0; i < descriptions.length; i++) {
            appendXmpNodes(descriptions[i], xmpSection.ul, 0);
          }
        } else if (xmlDoc.documentElement) {
          appendXmpNodes(xmlDoc.documentElement, xmpSection.ul, 0);
        }

        if (xmpSection.ul.children.length === 0) {
          xmpSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No parseable XMP properties found -</span></li>`;
        }
      } catch (xmlError) {
        console.error('Failed to parse XMP XML:', xmlError);
        xmpSection.ul.innerHTML = `<li><span class="text-red-500 italic">- Error parsing XMP XML. Displaying raw. -</span></li>`;
        const pre = document.createElement('pre');
        pre.className = 'text-xs text-gray-300 whitespace-pre-wrap break-all';
        pre.textContent = rawXmpString;
        xmpSection.ul.appendChild(pre);
      }
    } else {
      xmpSection.ul.innerHTML = `<li><span class="text-gray-500 italic">- No XMP metadata found -</span></li>`;
    }
    metadataDisplay.appendChild(xmpSection.wrapper);
  } catch (e) {
    console.warn('Could not fully inspect XMP/form metadata:', e);
  }
}

function copyMetadataAsJson() {
  const jsonString = JSON.stringify(pageState.metadata, null, 2);
  navigator.clipboard
    .writeText(jsonString)
    .then(function () {
      showAlert('Copied', 'Metadata copied to clipboard as JSON.');
    })
    .catch(function (err) {
      console.error('Failed to copy:', err);
      showAlert('Error', 'Failed to copy metadata to clipboard.');
    });
}

async function updateUI() {
  const fileDisplayArea = document.getElementById('file-display-area');
  const toolOptions = document.getElementById('tool-options');

  if (!fileDisplayArea) return;

  fileDisplayArea.innerHTML = '';

  if (pageState.file) {
    const fileDiv = document.createElement('div');
    fileDiv.className =
      'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm';
    mountToolInputPreview(fileDiv, pageState.file);

    const infoContainer = document.createElement('div');
    infoContainer.className = 'flex flex-col overflow-hidden';

    const nameSpan = document.createElement('div');
    nameSpan.className = 'truncate font-medium text-gray-200 text-sm mb-1';
    nameSpan.textContent = pageState.file.name;

    const metaSpan = document.createElement('div');
    metaSpan.className = 'text-xs text-gray-400';
    metaSpan.textContent = `${formatBytes(pageState.file.size)} • Loading...`;

    infoContainer.append(nameSpan, metaSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ml-4 flex-shrink-0 shift-tool-file-remove';
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${pageState.file.name}`);
    removeBtn.title = `Remove ${pageState.file.name}`;
    removeBtn.innerHTML = '<i data-lucide="x" class="w-4 h-4"></i>';
    removeBtn.onclick = function () {
      resetState();
    };

    fileDiv.append(infoContainer, removeBtn);
    fileDisplayArea.appendChild(fileDiv);
    createIcons({ icons });

    try {
      const result = await loadPdfWithPasswordPrompt(pageState.file);
      if (!result) {
        resetState();
        return;
      }
      showLoader('Loading PDF...');
      pageState.file = result.file;
      pageState.pdfDoc = await loadPdfDocument(result.bytes);
      pageState.isDirty = false;
      pageState.clearedAll = false;

      const pageCount = pageState.pdfDoc.getPageCount();
      metaSpan.textContent = `${formatBytes(pageState.file.size)} • ${pageCount} pages`;

      populateMetadataFields();
      await renderMetadataInspector(result.pdf);
      result.pdf.destroy();
      hideLoader();

      if (toolOptions) toolOptions.classList.remove('hidden');
      setWorkspaceFiles([pageState.file]);

      if (resolveLaunchContext().entryId === 'view-metadata') {
        const inspector = document.getElementById('metadata-inspector');
        const parent = inspector?.parentElement;
        if (inspector && parent && parent.firstElementChild !== inspector) {
          parent.insertBefore(inspector, parent.firstElementChild);
        }
      }
      createIcons({ icons });
      syncToolOutputToolbar();
    } catch (error) {
      console.error('Error loading PDF:', error);
      hideLoader();
      showAlert('Error', 'Failed to load PDF file.');
      resetState();
    }
  } else {
    if (toolOptions) toolOptions.classList.add('hidden');
    syncToolOutputToolbar();
  }
}

async function saveMetadata() {
  if (!pageState.pdfDoc || !pageState.file) {
    showAlert('Error', 'Please upload a PDF first.');
    return;
  }

  showResultLoader('Updating metadata...');

  try {
    const titleInput = document.getElementById(
      'meta-title'
    ) as HTMLInputElement;
    const authorInput = document.getElementById(
      'meta-author'
    ) as HTMLInputElement;
    const subjectInput = document.getElementById(
      'meta-subject'
    ) as HTMLInputElement;
    const keywordsInput = document.getElementById(
      'meta-keywords'
    ) as HTMLInputElement;
    const creatorInput = document.getElementById(
      'meta-creator'
    ) as HTMLInputElement;
    const producerInput = document.getElementById(
      'meta-producer'
    ) as HTMLInputElement;
    const creationDateInput = document.getElementById(
      'meta-creation-date'
    ) as HTMLInputElement;
    const modDateInput = document.getElementById(
      'meta-mod-date'
    ) as HTMLInputElement;

    // @ts-expect-error getInfoDict is private but accessible at runtime
    const infoDict = pageState.pdfDoc.getInfoDict();

    if (pageState.clearedAll) {
      const existingKeys = infoDict.keys();
      existingKeys.forEach((k: PDFName) => infoDict.delete(k));
      try {
        if (pageState.pdfDoc.catalog.has(PDFName.of('Metadata'))) {
          pageState.pdfDoc.catalog.delete(PDFName.of('Metadata'));
        }
      } catch (e) {
        console.warn('Could not remove XMP metadata:', e);
      }
    }

    pageState.pdfDoc.setTitle(titleInput?.value ?? '');
    pageState.pdfDoc.setAuthor(authorInput?.value ?? '');
    pageState.pdfDoc.setSubject(subjectInput?.value ?? '');
    pageState.pdfDoc.setCreator(creatorInput?.value ?? '');
    pageState.pdfDoc.setProducer(producerInput?.value ?? '');

    const keywords = keywordsInput?.value ?? '';
    pageState.pdfDoc.setKeywords(
      keywords
        .split(',')
        .map(function (k) {
          return k.trim();
        })
        .filter(Boolean)
    );

    if (creationDateInput?.value) {
      pageState.pdfDoc.setCreationDate(new Date(creationDateInput.value));
    }

    if (modDateInput?.value) {
      pageState.pdfDoc.setModificationDate(new Date(modDateInput.value));
    } else if (!pageState.clearedAll) {
      pageState.pdfDoc.setModificationDate(new Date());
    }

    const standardKeys = new Set([
      'Title',
      'Author',
      'Subject',
      'Keywords',
      'Creator',
      'Producer',
      'CreationDate',
      'ModDate',
    ]);

    const allKeys = infoDict.keys().map(function (key: {
      asString: () => string;
    }) {
      return key.asString().substring(1);
    });

    allKeys.forEach(function (key: string) {
      if (!standardKeys.has(key)) {
        infoDict.delete(PDFName.of(key));
      }
    });

    const customKeys = document.querySelectorAll('.custom-meta-key');
    const customValues = document.querySelectorAll('.custom-meta-value');

    customKeys.forEach(function (keyInput, index) {
      const key = (keyInput as HTMLInputElement).value.trim();
      const value = (customValues[index] as HTMLInputElement).value.trim();
      if (key && value) {
        infoDict.set(PDFName.of(key), PDFString.of(value));
      }
    });

    const newPdfBytes = await pageState.pdfDoc.save();
    downloadFile(
      new Blob([new Uint8Array(newPdfBytes)], { type: 'application/pdf' }),
      pageState.file.name
    );
  } catch (e) {
    console.error(e);
    showAlert(
      'Error',
      'Could not update metadata. Please check that date formats are correct.'
    );
  } finally {
    hideLoader();
  }
}

function handleFileSelect(files: FileList | null) {
  if (files && files.length > 0) {
    const file = files[0];
    if (
      file.type === 'application/pdf' ||
      file.name.toLowerCase().endsWith('.pdf')
    ) {
      pageState.file = file;
      void updateUI();
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  applyLaunchContextToDom(document);

  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const dropZone = document.getElementById('drop-zone');
  const processBtn = document.getElementById('process-btn');
  const addCustomFieldBtn = document.getElementById('add-custom-field');
  const clearAllMetadataBtn = document.getElementById('clear-all-metadata');
  const copyBtn = document.getElementById('copy-metadata');

  for (const fieldId of STANDARD_FIELD_IDS) {
    const input = document.getElementById(fieldId);
    input?.addEventListener('input', markDirty);
    input?.addEventListener('change', markDirty);
  }

  if (addCustomFieldBtn) {
    addCustomFieldBtn.addEventListener('click', function () {
      addCustomFieldRow('', '', true);
    });
  }

  if (clearAllMetadataBtn) {
    clearAllMetadataBtn.addEventListener('click', clearAllMetadataFields);
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', copyMetadataAsJson);
  }

  registerToolOutputSession({
    apply: () => saveMetadata(),
    reset: () => resetState(),
    canSave: () => {
      if (!pageState.pdfDoc || !pageState.file) return false;
      if (resolveLaunchContext().entryId === 'view-metadata') {
        return pageState.isDirty;
      }
      return true;
    },
    canDownload: () => Boolean(pageState.pdfDoc && pageState.file),
    canPrint: () => Boolean(pageState.pdfDoc && pageState.file),
    canReset: () => Boolean(pageState.pdfDoc && pageState.file),
  });

  if (fileInput && dropZone) {
    fileInput.addEventListener('change', function (e) {
      handleFileSelect((e.target as HTMLInputElement).files);
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
        const pdfFiles = Array.from(files).filter(function (f) {
          return (
            f.type === 'application/pdf' ||
            f.name.toLowerCase().endsWith('.pdf')
          );
        });
        if (pdfFiles.length > 0) {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(pdfFiles[0]);
          handleFileSelect(dataTransfer.files);
        }
      }
    });

    fileInput.addEventListener('click', function () {
      fileInput.value = '';
    });
  }

  if (processBtn) {
    processBtn.addEventListener('click', saveMetadata);
  }

  onToolFilesSeeded(() => {
    if (fileInput?.files && fileInput.files.length > 0 && !pageState.file) {
      handleFileSelect(fileInput.files);
    }
  });
});
