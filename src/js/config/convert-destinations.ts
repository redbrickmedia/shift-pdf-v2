import { categories } from './tools.js';

export type ConvertDestination = {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  href: string;
  outputExtension: string;
};

export type ConvertSourceKind = 'pdf' | 'to-pdf' | 'unsupported';

const PRIMARY_PDF_DESTINATION_IDS = [
  'pdf-to-docx',
  'pdf-to-excel',
  'pdf-to-jpg',
  'pdf-to-png',
] as const;

const EXTENSION_TO_TOOL_ID: Record<string, string> = {
  bmp: 'bmp-to-pdf',
  cbz: 'cbz-to-pdf',
  csv: 'csv-to-pdf',
  doc: 'word-to-pdf',
  docx: 'word-to-pdf',
  eml: 'email-to-pdf',
  epub: 'epub-to-pdf',
  fb2: 'fb2-to-pdf',
  gif: 'image-to-pdf',
  heic: 'heic-to-pdf',
  heif: 'heic-to-pdf',
  htm: 'txt-to-pdf',
  html: 'txt-to-pdf',
  jpeg: 'jpg-to-pdf',
  jpg: 'jpg-to-pdf',
  jp2: 'image-to-pdf',
  jpx: 'image-to-pdf',
  md: 'markdown-to-pdf',
  mobi: 'mobi-to-pdf',
  msg: 'email-to-pdf',
  numbers: 'pages-to-pdf',
  odp: 'odp-to-pdf',
  ods: 'ods-to-pdf',
  odt: 'odt-to-pdf',
  odg: 'odg-to-pdf',
  pages: 'pages-to-pdf',
  pbm: 'image-to-pdf',
  pgm: 'image-to-pdf',
  png: 'png-to-pdf',
  pnm: 'image-to-pdf',
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
  wpd: 'wpd-to-pdf',
  wps: 'wps-to-pdf',
  xls: 'excel-to-pdf',
  xlsb: 'excel-to-pdf',
  xlsx: 'excel-to-pdf',
  xltx: 'excel-to-pdf',
  xml: 'xml-to-pdf',
  xps: 'xps-to-pdf',
  json: 'json-to-pdf',
};

const SUPPORTED_TO_PDF_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_TOOL_ID));

const IMAGE_EXTENSIONS = new Set([
  'bmp',
  'gif',
  'heic',
  'heif',
  'jp2',
  'jpx',
  'pbm',
  'pdf',
  'pgm',
  'pnm',
  'ppm',
  'psd',
  'tif',
  'tiff',
]);

export function getFileExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? (parts.pop() ?? '') : '';
}

export function isPdfFile(file: File): boolean {
  return (
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  );
}

export function getConvertSourceKind(file: File): ConvertSourceKind {
  if (isPdfFile(file)) return 'pdf';
  const extension = getFileExtension(file.name);
  if (SUPPORTED_TO_PDF_EXTENSIONS.has(extension)) return 'to-pdf';
  if (IMAGE_EXTENSIONS.has(extension)) return 'to-pdf';
  return 'unsupported';
}

function toolHrefById(
  toolId: string,
  baseUrl = import.meta.env.BASE_URL
): string {
  return `${baseUrl}${toolId}.html`;
}

function destinationFromTool(
  tool: (typeof categories)[number]['tools'][number]
): ConvertDestination {
  const outputExtension = tool.id.startsWith('pdf-to-')
    ? tool.id.replace('pdf-to-', '')
    : 'pdf';
  return {
    id: tool.id,
    name: tool.name,
    subtitle: tool.subtitle,
    icon: tool.icon,
    href: tool.href,
    outputExtension,
  };
}

export function getPdfDestinations(options?: {
  isToolDisabled?: (toolId: string) => boolean;
}): { primary: ConvertDestination[]; secondary: ConvertDestination[] } {
  const isDisabled = options?.isToolDisabled ?? (() => false);
  const convertFromPdf =
    categories.find((category) => category.name === 'Convert from PDF')
      ?.tools ?? [];

  const destinations = convertFromPdf
    .filter((tool) => !isDisabled(tool.id))
    .map(destinationFromTool);

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
      href: toolHrefById(toolId, baseUrl),
      outputExtension: 'pdf',
    };
  }

  return destinationFromTool(tool);
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
