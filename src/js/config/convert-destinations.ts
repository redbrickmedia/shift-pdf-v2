import { categories, getCatalogEntryById } from './tools.js';
import { isPdfFile } from '../utils/pdf-file.js';

export { isPdfFile } from '../utils/pdf-file.js';

export type ConvertDestination = {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  href: string;
  outputExtension: string;
  /** Every in-place conversion destination supports multi-file batches. */
  acceptsMultiple: boolean;
  /** True when the destination outputs a PDF (or multi-PDF ZIP), false for Convert from PDF. */
  producesPdf: boolean;
};

export type ConvertSourceKind = 'pdf' | 'to-pdf' | 'unsupported';

const PRIMARY_PDF_DESTINATION_IDS = [
  'pdf-to-docx',
  'pdf-to-excel',
  'pdf-to-pptx',
  'pdf-to-jpg',
  'pdf-to-png',
] as const;

export const IMAGE_TO_PDF_DESTINATION_IDS = [
  'image-to-pdf',
  'jpg-to-pdf',
  'png-to-pdf',
  'webp-to-pdf',
  'svg-to-pdf',
  'bmp-to-pdf',
  'heic-to-pdf',
  'tiff-to-pdf',
  'psd-to-pdf',
] as const;

export const IMAGE_TO_PDF_DESTINATION_ID_SET: ReadonlySet<string> = new Set(
  IMAGE_TO_PDF_DESTINATION_IDS
);

const EXTENSION_TO_TOOL_ID: Record<string, string> = {
  bmp: 'bmp-to-pdf',
  csv: 'csv-to-pdf',
  doc: 'word-to-pdf',
  docx: 'word-to-pdf',
  eml: 'email-to-pdf',
  epub: 'epub-to-pdf',
  gif: 'image-to-pdf',
  heic: 'heic-to-pdf',
  heif: 'heic-to-pdf',
  htm: 'txt-to-pdf',
  html: 'txt-to-pdf',
  jpeg: 'jpg-to-pdf',
  jpg: 'jpg-to-pdf',
  jp2: 'image-to-pdf',
  jpx: 'image-to-pdf',
  jxr: 'image-to-pdf',
  markdown: 'markdown-to-pdf',
  md: 'markdown-to-pdf',
  mobi: 'mobi-to-pdf',
  msg: 'email-to-pdf',
  numbers: 'pages-to-pdf',
  odp: 'odp-to-pdf',
  ods: 'ods-to-pdf',
  odt: 'odt-to-pdf',
  odg: 'odg-to-pdf',
  pam: 'image-to-pdf',
  pages: 'pages-to-pdf',
  pbm: 'image-to-pdf',
  pgm: 'image-to-pdf',
  png: 'png-to-pdf',
  pnm: 'image-to-pdf',
  ppm: 'image-to-pdf',
  potx: 'powerpoint-to-pdf',
  ppsx: 'powerpoint-to-pdf',
  ppt: 'powerpoint-to-pdf',
  pptx: 'powerpoint-to-pdf',
  psd: 'psd-to-pdf',
  pub: 'pub-to-pdf',
  rtf: 'rtf-to-pdf',
  svg: 'svg-to-pdf',
  tif: 'tiff-to-pdf',
  tiff: 'tiff-to-pdf',
  txt: 'txt-to-pdf',
  vsd: 'vsd-to-pdf',
  vsdx: 'vsd-to-pdf',
  webp: 'webp-to-pdf',
  xls: 'excel-to-pdf',
  xlsb: 'excel-to-pdf',
  xlsx: 'excel-to-pdf',
  xltx: 'excel-to-pdf',
  xml: 'xml-to-pdf',
  xps: 'xps-to-pdf',
  oxps: 'xps-to-pdf',
};

const SUPPORTED_TO_PDF_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_TOOL_ID));

const IMAGE_EXTENSIONS = new Set([
  'bmp',
  'gif',
  'heic',
  'heif',
  'jp2',
  'jpeg',
  'jpg',
  'jpx',
  'jxr',
  'pam',
  'pbm',
  'pgm',
  'png',
  'pnm',
  'ppm',
  'psd',
  'svg',
  'tif',
  'tiff',
  'webp',
]);

export function getFileExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() ?? '') : '';
}

export function isImageSourceFile(file: File): boolean {
  if (isPdfFile(file)) return false;
  const extension = getFileExtension(file.name);
  if (IMAGE_EXTENSIONS.has(extension)) return true;
  return file.type.startsWith('image/');
}

export function getConvertSourceKind(file: File): ConvertSourceKind {
  if (isPdfFile(file)) return 'pdf';
  const extension = getFileExtension(file.name);
  if (SUPPORTED_TO_PDF_EXTENSIONS.has(extension)) return 'to-pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'to-pdf';
  return 'unsupported';
}

function inPlaceConverterHrefById(
  toolId: string,
  baseUrl = import.meta.env.BASE_URL
): string {
  return `${baseUrl}pdf-converter.html?entry=${toolId}`;
}

/** Slug suffixes that are not the file the tool actually downloads. */
const OUTPUT_EXTENSION_BY_TOOL_ID: Record<string, string> = {
  'extract-tables': 'csv',
  'pdf-to-excel': 'xlsx',
  'pdf-to-markdown': 'md',
  'pdf-to-text': 'txt',
};

function outputExtensionForTool(toolId: string): string {
  return (
    OUTPUT_EXTENSION_BY_TOOL_ID[toolId] ??
    (toolId.startsWith('pdf-to-') ? toolId.replace('pdf-to-', '') : 'pdf')
  );
}

function destinationFromTool(
  tool: (typeof categories)[number]['tools'][number],
  baseUrl = import.meta.env.BASE_URL
): ConvertDestination {
  const outputExtension = outputExtensionForTool(tool.id);
  const producesPdf = outputExtension === 'pdf';
  return {
    id: tool.id,
    name: tool.name,
    subtitle: tool.subtitle,
    icon: tool.icon,
    href:
      tool.surface === 'pdf-converter' && tool.id !== 'pdf-converter'
        ? tool.href
        : inPlaceConverterHrefById(tool.id, baseUrl),
    outputExtension,
    acceptsMultiple: true,
    producesPdf,
  };
}

export function getConvertDestinationById(
  id: string,
  baseUrl = import.meta.env.BASE_URL
): ConvertDestination | null {
  const normalized = id.trim().toLowerCase();
  if (
    !normalized ||
    normalized === 'pdf-converter' ||
    normalized === 'extract-images'
  ) {
    return null;
  }

  const entry = getCatalogEntryById(normalized);
  if (
    entry &&
    (entry.surface === 'pdf-converter' ||
      entry.id === 'txt-to-pdf' ||
      entry.id === 'markdown-to-pdf')
  ) {
    return destinationFromTool(entry, baseUrl);
  }
  return null;
}

export function filterConvertDestinations(
  destinations: readonly ConvertDestination[],
  query: string
): ConvertDestination[] {
  const term = query.trim().toLowerCase();
  if (!term) return [...destinations];

  return destinations.filter((destination) => {
    const haystack = [
      destination.name,
      destination.subtitle,
      destination.outputExtension,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(term);
  });
}

export function getPdfDestinations(options?: {
  isToolDisabled?: (toolId: string) => boolean;
}): { primary: ConvertDestination[]; secondary: ConvertDestination[] } {
  const isDisabled = options?.isToolDisabled ?? (() => false);
  const convertFromPdf =
    categories.find((category) => category.name === 'Convert from PDF')
      ?.tools ?? [];

  const destinations = convertFromPdf
    .filter((tool) => tool.surface === 'pdf-converter' && !isDisabled(tool.id))
    .map((tool) => destinationFromTool(tool));

  const primaryIds = new Set<string>(PRIMARY_PDF_DESTINATION_IDS);
  const primary: ConvertDestination[] = [];
  const secondary: ConvertDestination[] = [];

  for (const destination of destinations) {
    if (primaryIds.has(destination.id)) {
      primary.push(destination);
    } else {
      secondary.push(destination);
    }
  }

  primary.sort(
    (left, right) =>
      PRIMARY_PDF_DESTINATION_IDS.indexOf(
        left.id as (typeof PRIMARY_PDF_DESTINATION_IDS)[number]
      ) -
      PRIMARY_PDF_DESTINATION_IDS.indexOf(
        right.id as (typeof PRIMARY_PDF_DESTINATION_IDS)[number]
      )
  );

  return { primary, secondary };
}

export function getToPdfDestination(
  file: File,
  baseUrl = import.meta.env.BASE_URL
): ConvertDestination | null {
  const extension = getFileExtension(file.name);
  const toolId =
    EXTENSION_TO_TOOL_ID[extension] ??
    (IMAGE_EXTENSIONS.has(extension) ? 'image-to-pdf' : null);
  if (!toolId) return null;

  const tool = categories
    .flatMap((category) => category.tools)
    .find((entry) => entry.id === toolId);
  if (!tool) {
    return {
      id: toolId,
      name: 'PDF',
      subtitle: 'Convert this file to PDF.',
      icon: 'ph-file-pdf',
      href: inPlaceConverterHrefById(toolId, baseUrl),
      outputExtension: 'pdf',
      acceptsMultiple: true,
      producesPdf: true,
    };
  }

  return destinationFromTool(tool, baseUrl);
}

/**
 * Destinations every one of `files` can reach, keyed by id.
 *
 * PDFs all share the same destination list, so a batch of them keeps the full
 * grid. A non-PDF resolves to a to-PDF tool chosen by its extension; when
 * multiple images of different image formats are selected together, they share
 * the general `image-to-pdf` destination.
 */
export function getSharedDestinations(
  files: File[],
  options?: { isToolDisabled?: (toolId: string) => boolean }
): { primary: ConvertDestination[]; secondary: ConvertDestination[] } {
  if (files.length === 0) return { primary: [], secondary: [] };

  const perFile = files.map((file) => {
    if (isPdfFile(file)) return getPdfDestinations(options);
    const destination = getToPdfDestination(file);
    return destination
      ? { primary: [destination], secondary: [] }
      : { primary: [], secondary: [] };
  });

  const [first, ...rest] = perFile;
  if (!first) return { primary: [], secondary: [] };

  const sharedIds = rest.reduce<Set<string>>(
    (shared, entry) => {
      const ids = new Set(
        [...entry.primary, ...entry.secondary].map(
          (destination) => destination.id
        )
      );
      return new Set([...shared].filter((id) => ids.has(id)));
    },
    new Set(
      [...first.primary, ...first.secondary].map(
        (destination) => destination.id
      )
    )
  );

  const primary = first.primary.filter((entry) => sharedIds.has(entry.id));
  const secondary = first.secondary.filter((entry) => sharedIds.has(entry.id));

  if (
    primary.length === 0 &&
    secondary.length === 0 &&
    files.length > 1 &&
    files.every(isImageSourceFile)
  ) {
    const isDisabled = options?.isToolDisabled ?? (() => false);
    if (!isDisabled('image-to-pdf')) {
      const imageDest = getConvertDestinationById('image-to-pdf');
      if (imageDest) {
        return { primary: [imageDest], secondary: [] };
      }
    }
  }

  return { primary, secondary };
}

export function resolveDestinationHref(
  file: File,
  destination: ConvertDestination
): string {
  if (getConvertSourceKind(file) === 'to-pdf') {
    const resolved = getToPdfDestination(file);
    return resolved?.href ?? destination.href;
  }
  return destination.href;
}

export function getFilenameWithoutExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(0, index) : filename;
}

export function getOutputFilename(
  sourceName: string,
  destination: ConvertDestination
): string {
  return `${getFilenameWithoutExtension(sourceName)}.${destination.outputExtension}`;
}

export function buildConvertSourceAccept(): string {
  const extensions = new Set<string>(['.pdf', 'application/pdf']);
  for (const extension of SUPPORTED_TO_PDF_EXTENSIONS) {
    extensions.add(`.${extension}`);
  }
  return Array.from(extensions).join(',');
}
