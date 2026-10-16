// This file centralizes the definition of all available tools, organized by category.

export type ToolCardinality = 'single' | 'dual' | 'batch';

export interface CatalogEntry {
  id: string;
  surface: string;
  href: string;
  cardinality: ToolCardinality;
  name: string;
  icon: string;
  subtitle: string;
}

export interface ToolCategory {
  name: string;
  tools: CatalogEntry[];
}

export const PRUNED_TOOL_IDS = [
  'rotate-custom',
  'posterize-pdf',
  'pdf-booklet',
  'json-to-pdf',
  'pdf-to-json',
  'prepare-pdf-for-ai',
  'wpd-to-pdf',
  'wps-to-pdf',
  'fb2-to-pdf',
  'cbz-to-pdf',
  'pdf-to-cbz',
  'scanner-effect',
  'add-page-labels',
  'linearize-pdf',
  'font-to-outline',
  'pdf-layers',
  'pdf-workflow',
  'overlay-pdf',
] as const;

export const PRUNED_TOOL_ID_SET: ReadonlySet<string> = new Set(PRUNED_TOOL_IDS);

const SURFACE_BY_ENTRY_ID: Record<string, string> = {
  // pdf-multi-tool
  'pdf-multi-tool': 'pdf-multi-tool',
  'organize-pdf': 'pdf-multi-tool',
  'delete-pages': 'pdf-multi-tool',
  'rotate-pdf': 'pdf-multi-tool',
  'add-blank-page': 'pdf-multi-tool',
  'reverse-pages': 'pdf-multi-tool',

  // merge-pdf
  'merge-pdf': 'merge-pdf',
  'alternate-merge': 'merge-pdf',

  // split-pdf
  'split-pdf': 'split-pdf',
  'extract-pages': 'split-pdf',

  // pdf-converter (Convert to PDF + Convert from PDF)
  'pdf-converter': 'pdf-converter',
  'image-to-pdf': 'pdf-converter',
  'jpg-to-pdf': 'pdf-converter',
  'png-to-pdf': 'pdf-converter',
  'webp-to-pdf': 'pdf-converter',
  'svg-to-pdf': 'pdf-converter',
  'bmp-to-pdf': 'pdf-converter',
  'heic-to-pdf': 'pdf-converter',
  'tiff-to-pdf': 'pdf-converter',
  'psd-to-pdf': 'pdf-converter',
  'word-to-pdf': 'pdf-converter',
  'excel-to-pdf': 'pdf-converter',
  'powerpoint-to-pdf': 'pdf-converter',
  'odt-to-pdf': 'pdf-converter',
  'ods-to-pdf': 'pdf-converter',
  'odp-to-pdf': 'pdf-converter',
  'odg-to-pdf': 'pdf-converter',
  'rtf-to-pdf': 'pdf-converter',
  'pages-to-pdf': 'pdf-converter',
  'pub-to-pdf': 'pdf-converter',
  'vsd-to-pdf': 'pdf-converter',
  'epub-to-pdf': 'pdf-converter',
  'mobi-to-pdf': 'pdf-converter',
  'xps-to-pdf': 'pdf-converter',
  'csv-to-pdf': 'pdf-converter',
  'xml-to-pdf': 'pdf-converter',
  'email-to-pdf': 'pdf-converter',
  'pdf-to-jpg': 'pdf-converter',
  'pdf-to-png': 'pdf-converter',
  'pdf-to-webp': 'pdf-converter',
  'pdf-to-bmp': 'pdf-converter',
  'pdf-to-tiff': 'pdf-converter',
  'pdf-to-svg': 'pdf-converter',
  'pdf-to-docx': 'pdf-converter',
  'pdf-to-pptx': 'pdf-converter',
  'pdf-to-text': 'pdf-converter',
  'pdf-to-markdown': 'pdf-converter',
  'pdf-to-excel': 'pdf-converter',
  'pdf-to-csv': 'pdf-converter',
  'extract-tables': 'pdf-converter',

  // edit-pdf
  'edit-pdf': 'edit-pdf',
  'add-stamps': 'edit-pdf',
  'sign-pdf': 'edit-pdf',
  'form-filler': 'edit-pdf',
  'crop-pdf': 'edit-pdf',

  // bookmark
  bookmark: 'bookmark',
  'table-of-contents': 'bookmark',

  // sanitize-pdf
  'sanitize-pdf': 'sanitize-pdf',
  'remove-annotations': 'sanitize-pdf',
  'remove-metadata': 'sanitize-pdf',

  // edit-metadata
  'edit-metadata': 'edit-metadata',
  'view-metadata': 'edit-metadata',

  // edit-attachments
  'edit-attachments': 'edit-attachments',
  'add-attachments': 'edit-attachments',
  'extract-attachments': 'edit-attachments',

  // encrypt-pdf
  'encrypt-pdf': 'encrypt-pdf',
  'change-permissions': 'encrypt-pdf',
  'decrypt-pdf': 'encrypt-pdf',
  'remove-restrictions': 'encrypt-pdf',

  // digital-sign-pdf
  'digital-sign-pdf': 'digital-sign-pdf',
  'validate-signature-pdf': 'digital-sign-pdf',
  'timestamp-pdf': 'digital-sign-pdf',

  // flatten-pdf
  'flatten-pdf': 'flatten-pdf',
  'rasterize-pdf': 'flatten-pdf',

  // adjust-colors
  'adjust-colors': 'adjust-colors',
  'pdf-to-greyscale': 'adjust-colors',
  'invert-colors': 'adjust-colors',
  'background-color': 'adjust-colors',
  'text-color': 'adjust-colors',

  // page-numbers
  'page-numbers': 'page-numbers',
  'header-footer': 'page-numbers',
  'bates-numbering': 'page-numbers',

  // fix-page-size
  'fix-page-size': 'fix-page-size',
  'page-dimensions': 'fix-page-size',
};

const CARDINALITY_BY_SURFACE: Record<string, ToolCardinality> = {
  // Consolidated surfaces
  'pdf-multi-tool': 'batch',
  'merge-pdf': 'batch',
  'split-pdf': 'single',
  'pdf-converter': 'batch',
  'edit-pdf': 'single',
  bookmark: 'single',
  'sanitize-pdf': 'single',
  'edit-metadata': 'single',
  'edit-attachments': 'batch',
  'encrypt-pdf': 'batch',
  'digital-sign-pdf': 'single',
  'flatten-pdf': 'batch',
  'adjust-colors': 'single',
  'page-numbers': 'batch',
  'fix-page-size': 'single',

  // Standalone single-PDF surfaces
  'view-pdf': 'single',
  'form-creator': 'single',
  'add-watermark': 'single',
  'markdown-to-pdf': 'single',
  'ocr-pdf': 'single',
  'remove-blank-pages': 'single',
  'divide-pages': 'single',
  'n-up-pdf': 'single',
  'combine-single-page': 'single',

  // Standalone dual-PDF surfaces
  'compare-pdfs': 'dual',

  // Standalone batch surfaces
  'txt-to-pdf': 'batch',
  'extract-images': 'batch',
  'pdf-to-zip': 'batch',
  'compress-pdf': 'batch',
  'pdf-to-pdfa': 'batch',
  'repair-pdf': 'batch',
  'deskew-pdf': 'batch',
};

interface RawCatalogTool {
  id: string;
  name: string;
  icon: string;
  subtitle: string;
}

interface RawCategory {
  name: string;
  tools: RawCatalogTool[];
}

export function buildCatalogHref(id: string, surface: string): string {
  const baseUrl = import.meta.env.BASE_URL;
  return id === surface
    ? `${baseUrl}${surface}.html`
    : `${baseUrl}${surface}.html?entry=${id}`;
}

function toCatalogEntry(raw: RawCatalogTool): CatalogEntry {
  const surface = SURFACE_BY_ENTRY_ID[raw.id] ?? raw.id;
  const cardinality =
    CARDINALITY_BY_SURFACE[surface] ??
    CARDINALITY_BY_SURFACE[raw.id] ??
    'single';
  return {
    id: raw.id,
    surface,
    href: buildCatalogHref(raw.id, surface),
    cardinality,
    name: raw.name,
    icon: raw.icon,
    subtitle: raw.subtitle,
  };
}

const baseCategories: RawCategory[] = [
  {
    name: 'Popular Tools',
    tools: [
      {
        id: 'pdf-multi-tool',
        name: 'PDF Multi Tool',
        icon: 'ph-pencil-ruler',
        subtitle:
          'Merge, Split, Organize, Delete, Rotate, Add Blank Pages, Extract and Duplicate in an unified interface.',
      },
      {
        id: 'merge-pdf',
        name: 'Merge PDF',
        icon: 'ph-browsers',
        subtitle: 'Combine multiple PDFs into one file. Preserves Bookmarks.',
      },
      {
        id: 'split-pdf',
        name: 'Split PDF',
        icon: 'ph-scissors',
        subtitle: 'Extract a range of pages into a new PDF.',
      },
      {
        id: 'compress-pdf',
        name: 'Compress PDF',
        icon: 'ph-lightning',
        subtitle: 'Reduce the file size of your PDF.',
      },
      {
        id: 'pdf-converter',
        name: 'Convert',
        icon: 'ph-arrows-clockwise',
        subtitle:
          'Convert PDFs to Word, Excel, images, and more — or turn documents into PDF.',
      },
      {
        id: 'edit-pdf',
        name: 'PDF Editor',
        icon: 'ph-pencil-simple',
        subtitle:
          'Annotate, highlight, redact, comment, add shapes/images, search, and view PDFs',
      },
      {
        id: 'jpg-to-pdf',
        name: 'JPG to PDF',
        icon: 'ph-file-jpg',
        subtitle: 'Create a PDF from one or more JPG images.',
      },
      {
        id: 'sign-pdf',
        name: 'Sign PDF',
        icon: 'ph-pen-nib',
        subtitle: 'Draw, type, or upload your signature.',
      },
      {
        id: 'crop-pdf',
        name: 'Crop PDF',
        icon: 'ph-crop',
        subtitle: 'Trim the margins of every page in your PDF.',
      },
      {
        id: 'extract-pages',
        name: 'Extract Pages',
        icon: 'ph-squares-four',
        subtitle: 'Save a selection of pages as new files.',
      },
      {
        id: 'organize-pdf',
        name: 'Organize & Duplicate',
        icon: 'ph-files',
        subtitle: 'Duplicate, reorder, and delete pages.',
      },
      {
        id: 'delete-pages',
        name: 'Delete Pages',
        icon: 'ph-trash',
        subtitle: 'Remove specific pages from your document.',
      },
    ],
  },
  {
    name: 'Edit & Annotate',
    tools: [
      {
        id: 'edit-pdf',
        name: 'PDF Editor',
        icon: 'ph-pencil-simple',
        subtitle:
          'Annotate, highlight, redact, comment, add shapes/images, search, and view PDFs.',
      },
      {
        id: 'bookmark',
        name: 'Edit Bookmarks',
        icon: 'ph-bookmark',
        subtitle: 'Add, edit, import, delete and extract PDF bookmarks.',
      },
      {
        id: 'table-of-contents',
        name: 'Table of Contents',
        icon: 'ph-list',
        subtitle: 'Generate a table of contents page from PDF bookmarks.',
      },
      {
        id: 'page-numbers',
        name: 'Page Numbers',
        icon: 'ph-list-numbers',
        subtitle: 'Insert page numbers into your document.',
      },
      {
        id: 'bates-numbering',
        name: 'Bates Numbering',
        icon: 'ph-hash',
        subtitle: 'Add sequential Bates numbers across one or more PDF files.',
      },
      {
        id: 'add-watermark',
        name: 'Add Watermark',
        icon: 'ph-drop',
        subtitle: 'Stamp text or an image over your PDF pages.',
      },
      {
        id: 'header-footer',
        name: 'Header & Footer',
        icon: 'ph-paragraph',
        subtitle: 'Add text to the top and bottom of pages.',
      },
      {
        id: 'invert-colors',
        name: 'Invert Colors',
        icon: 'ph-circle-half',
        subtitle: 'Create a "dark mode" version of your PDF.',
      },
      {
        id: 'adjust-colors',
        name: 'Adjust Colors',
        icon: 'ph-sliders-horizontal',
        subtitle: 'Fine-tune brightness, contrast, saturation and more.',
      },
      {
        id: 'pdf-to-greyscale',
        name: 'PDF to Greyscale',
        icon: 'ph-palette',
        subtitle: 'Convert all colors to black and white.',
      },
      {
        id: 'background-color',
        name: 'Background Color',
        icon: 'ph-palette',
        subtitle: 'Change the background color of your PDF.',
      },
      {
        id: 'text-color',
        name: 'Change Text Color',
        icon: 'ph-eyedropper',
        subtitle: 'Change the color of text in your PDF.',
      },
      {
        id: 'sign-pdf',
        name: 'Sign PDF',
        icon: 'ph-pen-nib',
        subtitle: 'Draw, type, or upload your signature.',
      },
      {
        id: 'add-stamps',
        name: 'Add Stamps',
        icon: 'ph-stamp',
        subtitle: 'Add image stamps to your PDF using the annotation toolbar.',
      },
      {
        id: 'remove-annotations',
        name: 'Remove Annotations',
        icon: 'ph-eraser',
        subtitle: 'Strip comments, highlights, and links.',
      },
      {
        id: 'crop-pdf',
        name: 'Crop PDF',
        icon: 'ph-crop',
        subtitle: 'Trim the margins of every page in your PDF.',
      },
      {
        id: 'form-filler',
        name: 'PDF Form Filler',
        icon: 'ph-pencil-line',
        subtitle:
          'Fill in forms directly in the browser. Also supports XFA forms.',
      },
      {
        id: 'form-creator',
        name: 'Create PDF Form',
        icon: 'ph-file-plus',
        subtitle: 'Create fillable PDF forms with drag-and-drop text fields.',
      },
    ],
  },
  {
    name: 'Convert to PDF',
    tools: [
      {
        id: 'image-to-pdf',
        name: 'Images to PDF',
        icon: 'ph-images',
        subtitle:
          'Convert JPG, PNG, BMP, GIF, TIFF, PNM, PGM, PBM, PPM, PAM, JXR, JPX, JP2, PSD, SVG, HEIC, WebP to PDF.',
      },
      {
        id: 'jpg-to-pdf',
        name: 'JPG to PDF',
        icon: 'ph-file-jpg',
        subtitle: 'Create a PDF from one or more JPG images.',
      },
      {
        id: 'png-to-pdf',
        name: 'PNG to PDF',
        icon: 'ph-file-png',
        subtitle: 'Create a PDF from one or more PNG images.',
      },
      {
        id: 'webp-to-pdf',
        name: 'WebP to PDF',
        icon: 'ph-image',
        subtitle: 'Create a PDF from one or more WebP images.',
      },
      {
        id: 'svg-to-pdf',
        name: 'SVG to PDF',
        icon: 'ph-file-svg',
        subtitle: 'Create a PDF from one or more SVG images.',
      },
      {
        id: 'bmp-to-pdf',
        name: 'BMP to PDF',
        icon: 'ph-image',
        subtitle: 'Create a PDF from one or more BMP images.',
      },
      {
        id: 'heic-to-pdf',
        name: 'HEIC to PDF',
        icon: 'ph-device-mobile',
        subtitle: 'Create a PDF from one or more HEIC images.',
      },
      {
        id: 'tiff-to-pdf',
        name: 'TIFF to PDF',
        icon: 'ph-image',
        subtitle: 'Create a PDF from one or more TIFF images.',
      },
      {
        id: 'txt-to-pdf',
        name: 'Text to PDF',
        icon: 'ph-text-t',
        subtitle: 'Convert a plain text file into a PDF.',
      },
      {
        id: 'markdown-to-pdf',
        name: 'Markdown to PDF',
        icon: 'ph-markdown-logo',
        subtitle:
          'Convert Markdown to PDF with live preview and syntax highlighting.',
      },
      {
        id: 'odt-to-pdf',
        name: 'ODT to PDF',
        icon: 'ph-file',
        subtitle: 'Convert ODT (OpenDocument Text) files to PDF.',
      },
      {
        id: 'csv-to-pdf',
        name: 'CSV to PDF',
        icon: 'ph-file-csv',
        subtitle: 'Convert CSV (Comma-Separated Values) spreadsheets to PDF.',
      },
      {
        id: 'rtf-to-pdf',
        name: 'RTF to PDF',
        icon: 'ph-file-text',
        subtitle: 'Convert RTF (Rich Text Format) documents to PDF.',
      },
      {
        id: 'word-to-pdf',
        name: 'Word to PDF',
        icon: 'ph-microsoft-word-logo',
        subtitle: 'Convert Word documents (DOCX, DOC, ODT) to PDF.',
      },
      {
        id: 'excel-to-pdf',
        name: 'Excel to PDF',
        icon: 'ph-microsoft-excel-logo',
        subtitle: 'Convert Excel spreadsheets (XLSX, XLS, ODS) to PDF.',
      },
      {
        id: 'powerpoint-to-pdf',
        name: 'PowerPoint to PDF',
        icon: 'ph-microsoft-powerpoint-logo',
        subtitle: 'Convert PowerPoint presentations (PPTX, PPT, ODP) to PDF.',
      },
      {
        id: 'xps-to-pdf',
        name: 'XPS to PDF',
        icon: 'ph-scan',
        subtitle: 'Convert XPS/OXPS documents to PDF.',
      },
      {
        id: 'mobi-to-pdf',
        name: 'MOBI to PDF',
        icon: 'ph-book-open-text',
        subtitle: 'Convert MOBI e-books to PDF.',
      },
      {
        id: 'epub-to-pdf',
        name: 'EPUB to PDF',
        icon: 'ph-book-open-text',
        subtitle: 'Convert EPUB e-books to PDF.',
      },
      {
        id: 'xml-to-pdf',
        name: 'XML to PDF',
        icon: 'ph-file-code',
        subtitle: 'Convert XML documents to PDF.',
      },
      {
        id: 'pages-to-pdf',
        name: 'Pages to PDF',
        icon: 'ph-file-text',
        subtitle: 'Convert Apple Pages documents to PDF.',
      },
      {
        id: 'odg-to-pdf',
        name: 'ODG to PDF',
        icon: 'ph-image',
        subtitle: 'Convert OpenDocument Graphics (ODG) to PDF.',
      },
      {
        id: 'ods-to-pdf',
        name: 'ODS to PDF',
        icon: 'ph-table',
        subtitle: 'Convert OpenDocument Spreadsheet (ODS) to PDF.',
      },
      {
        id: 'odp-to-pdf',
        name: 'ODP to PDF',
        icon: 'ph-presentation',
        subtitle: 'Convert OpenDocument Presentation (ODP) to PDF.',
      },
      {
        id: 'pub-to-pdf',
        name: 'PUB to PDF',
        icon: 'ph-book-open',
        subtitle: 'Convert Microsoft Publisher (PUB) to PDF.',
      },
      {
        id: 'vsd-to-pdf',
        name: 'VSD to PDF',
        icon: 'ph-git-branch',
        subtitle: 'Convert Microsoft Visio (VSD, VSDX) to PDF.',
      },
      {
        id: 'psd-to-pdf',
        name: 'PSD to PDF',
        icon: 'ph-image',
        subtitle:
          'Convert Adobe Photoshop (PSD) files to PDF. Multiple files supported.',
      },
      {
        id: 'email-to-pdf',
        name: 'Email to PDF',
        icon: 'ph-envelope',
        subtitle: 'Convert email files (EML, MSG) to PDF format.',
      },
    ],
  },
  {
    name: 'Convert from PDF',
    tools: [
      {
        id: 'pdf-to-jpg',
        name: 'PDF to JPG',
        icon: 'ph-file-image',
        subtitle: 'Convert each PDF page into a JPG image.',
      },
      {
        id: 'pdf-to-png',
        name: 'PDF to PNG',
        icon: 'ph-file-image',
        subtitle: 'Convert each PDF page into a PNG image.',
      },
      {
        id: 'pdf-to-webp',
        name: 'PDF to WebP',
        icon: 'ph-file-image',
        subtitle: 'Convert each PDF page into a WebP image.',
      },
      {
        id: 'pdf-to-bmp',
        name: 'PDF to BMP',
        icon: 'ph-file-image',
        subtitle: 'Convert each PDF page into a BMP image.',
      },
      {
        id: 'pdf-to-tiff',
        name: 'PDF to TIFF',
        icon: 'ph-file-image',
        subtitle: 'Convert each PDF page into a TIFF image.',
      },
      {
        id: 'pdf-to-svg',
        name: 'PDF to SVG',
        icon: 'ph-file-code',
        subtitle: 'Convert each PDF page into a scalable vector graphic.',
      },
      {
        id: 'pdf-to-csv',
        name: 'PDF to CSV',
        icon: 'ph-file-csv',
        subtitle: 'Extract tables from PDF and convert to CSV format.',
      },
      {
        id: 'pdf-to-excel',
        name: 'PDF to Excel',
        icon: 'ph-microsoft-excel-logo',
        subtitle: 'Extract tables from PDF and convert to Excel (XLSX).',
      },
      {
        id: 'extract-tables',
        name: 'Extract Tables',
        icon: 'ph-table',
        subtitle: 'Extract tables from PDFs as CSV, JSON, or Markdown.',
      },
      {
        id: 'pdf-to-docx',
        name: 'PDF to Word',
        icon: 'ph-microsoft-word-logo',
        subtitle: 'Convert PDF files to editable Word documents.',
      },
      {
        id: 'pdf-to-pptx',
        name: 'PDF to PowerPoint',
        icon: 'ph-microsoft-powerpoint-logo',
        subtitle: 'Convert PDF files to editable PowerPoint slides.',
      },
      {
        id: 'extract-images',
        name: 'Extract Images',
        icon: 'ph-download-simple',
        subtitle: 'Extract all embedded images from your PDF files.',
      },
      {
        id: 'pdf-to-markdown',
        name: 'PDF to Markdown',
        icon: 'ph-markdown-logo',
        subtitle: 'Convert PDF text and tables to Markdown format.',
      },
      {
        id: 'pdf-to-text',
        name: 'PDF to Text',
        icon: 'ph-text-aa',
        subtitle: 'Extract text from PDF files and save as plain text (.txt).',
      },
    ],
  },
  {
    name: 'Organize & Manage',
    tools: [
      {
        id: 'ocr-pdf',
        name: 'OCR PDF',
        icon: 'ph-barcode',
        subtitle: 'Make a PDF searchable and copyable.',
      },
      {
        id: 'merge-pdf',
        name: 'Merge PDF',
        icon: 'ph-browsers',
        subtitle: 'Combine multiple PDFs into one file.',
      },
      {
        id: 'alternate-merge',
        name: 'Alternate & Mix Pages',
        icon: 'ph-shuffle',
        subtitle:
          'Merge PDFs by alternating pages from each PDF. Preserves Bookmarks',
      },
      {
        id: 'organize-pdf',
        name: 'Organize & Duplicate',
        icon: 'ph-files',
        subtitle: 'Duplicate, reorder, and delete pages.',
      },
      {
        id: 'add-attachments',
        name: 'Add Attachments',
        icon: 'ph-paperclip',
        subtitle: 'Embed one or more files into your PDF.',
      },
      {
        id: 'extract-attachments',
        name: 'Extract Attachments',
        icon: 'ph-download',
        subtitle: 'Extract all embedded files from PDF(s) as a ZIP.',
      },
      {
        id: 'edit-attachments',
        name: 'Edit Attachments',
        icon: 'ph-paperclip-horizontal',
        subtitle: 'View or remove attachments in your PDF.',
      },
      {
        id: 'pdf-multi-tool',
        name: 'PDF Multi Tool',
        icon: 'ph-pencil-ruler',
        subtitle: 'Full-featured PDF editor with page management.',
      },
      {
        id: 'split-pdf',
        name: 'Split PDF',
        icon: 'ph-scissors',
        subtitle: 'Extract a range of pages into a new PDF.',
      },
      {
        id: 'divide-pages',
        name: 'Divide Pages',
        icon: 'ph-columns',
        subtitle: 'Divide pages horizontally or vertically.',
      },
      {
        id: 'extract-pages',
        name: 'Extract Pages',
        icon: 'ph-squares-four',
        subtitle: 'Save a selection of pages as new files.',
      },
      {
        id: 'delete-pages',
        name: 'Delete Pages',
        icon: 'ph-trash',
        subtitle: 'Remove specific pages from your document.',
      },
      {
        id: 'remove-blank-pages',
        name: 'Remove Blank Pages',
        icon: 'ph-file-minus',
        subtitle: 'Automatically detect and delete blank pages.',
      },
      {
        id: 'add-blank-page',
        name: 'Add Blank Page',
        icon: 'ph-file-plus',
        subtitle: 'Insert an empty page anywhere in your PDF.',
      },
      {
        id: 'reverse-pages',
        name: 'Reverse Pages',
        icon: 'ph-sort-descending',
        subtitle: 'Flip the order of all pages in your document.',
      },
      {
        id: 'rotate-pdf',
        name: 'Rotate PDF',
        icon: 'ph-arrow-clockwise',
        subtitle: 'Turn pages in 90-degree increments.',
      },
      {
        id: 'n-up-pdf',
        name: 'N-Up PDF',
        icon: 'ph-squares-four',
        subtitle: 'Arrange multiple pages onto a single sheet.',
      },
      {
        id: 'combine-single-page',
        name: 'Combine to Single Page',
        icon: 'ph-arrows-out-line-vertical',
        subtitle: 'Stitch all pages into one continuous scroll.',
      },
      {
        id: 'view-metadata',
        name: 'View Metadata',
        icon: 'ph-info',
        subtitle: 'Inspect the hidden properties of your PDF.',
      },
      {
        id: 'edit-metadata',
        name: 'Edit Metadata',
        icon: 'ph-file-code',
        subtitle: 'Change the author, title, and other properties.',
      },
      {
        id: 'pdf-to-zip',
        name: 'PDFs to ZIP',
        icon: 'ph-file-zip',
        subtitle: 'Package multiple PDF files into a ZIP archive.',
      },
      {
        id: 'compare-pdfs',
        name: 'Compare PDFs',
        icon: 'ph-git-diff',
        subtitle: 'Compare two PDFs side by side.',
      },
    ],
  },
  {
    name: 'Optimize & Repair',
    tools: [
      {
        id: 'compress-pdf',
        name: 'Compress PDF',
        icon: 'ph-lightning',
        subtitle: 'Reduce the file size of your PDF.',
      },
      {
        id: 'pdf-to-pdfa',
        name: 'PDF to PDF/A',
        icon: 'ph-archive',
        subtitle: 'Convert PDF to PDF/A for long-term archiving.',
      },
      {
        id: 'fix-page-size',
        name: 'Fix Page Size',
        icon: 'ph-ruler',
        subtitle: 'Standardize all pages to a uniform size.',
      },
      {
        id: 'page-dimensions',
        name: 'Page Dimensions',
        icon: 'ph-ruler',
        subtitle: 'Analyze page size, orientation, and units.',
      },
      {
        id: 'repair-pdf',
        name: 'Repair PDF',
        icon: 'ph-wrench',
        subtitle: 'Recover data from corrupted or damaged PDF files.',
      },
      {
        id: 'rasterize-pdf',
        name: 'Rasterize PDF',
        icon: 'ph-image',
        subtitle:
          'Convert PDF to image-based PDF. Flatten layers and remove selectable text.',
      },
      {
        id: 'deskew-pdf',
        name: 'Deskew PDF',
        icon: 'ph-perspective',
        subtitle: 'Automatically straighten tilted scanned pages using OpenCV.',
      },
    ],
  },
  {
    name: 'Secure PDF',
    tools: [
      {
        id: 'encrypt-pdf',
        name: 'Encrypt PDF',
        icon: 'ph-lock',
        subtitle: 'Lock your PDF by adding a password.',
      },
      {
        id: 'sanitize-pdf',
        name: 'Sanitize PDF',
        icon: 'ph-broom',
        subtitle: 'Remove metadata, annotations, scripts, and more.',
      },
      {
        id: 'decrypt-pdf',
        name: 'Decrypt PDF',
        icon: 'ph-lock-open',
        subtitle: 'Unlock PDF by removing password protection.',
      },
      {
        id: 'remove-restrictions',
        name: 'Remove Restrictions',
        icon: 'ph-link-break',
        subtitle:
          'Remove password protection and security restrictions associated with digitally signed PDF files.',
      },
      {
        id: 'flatten-pdf',
        name: 'Flatten PDF',
        icon: 'ph-stack',
        subtitle: 'Make form fields and annotations non-editable.',
      },
      {
        id: 'remove-metadata',
        name: 'Remove Metadata',
        icon: 'ph-file-x',
        subtitle: 'Strip hidden data from your PDF.',
      },
      {
        id: 'change-permissions',
        name: 'Change Permissions',
        icon: 'ph-shield-check',
        subtitle: 'Set or change user permissions on a PDF.',
      },
      {
        id: 'digital-sign-pdf',
        name: 'Digital Signature',
        icon: 'ph-certificate',
        subtitle:
          'Add a cryptographic digital signature using X.509 certificates.',
      },
      {
        id: 'validate-signature-pdf',
        name: 'Validate Signature',
        icon: 'ph-seal-check',
        subtitle: 'Verify digital signatures and view certificate details.',
      },
      {
        id: 'timestamp-pdf',
        name: 'Timestamp PDF',
        icon: 'ph-clock',
        subtitle:
          'Add an RFC 3161 document timestamp using a trusted TSA server.',
      },
    ],
  },
];

export const categories: ToolCategory[] = baseCategories.map((category) => ({
  name: category.name,
  tools: category.tools.map(toCatalogEntry),
}));

const VIEW_PDF_ENTRY: CatalogEntry = toCatalogEntry({
  id: 'view-pdf',
  name: 'View PDF',
  icon: 'ph-eye',
  subtitle: 'View and inspect PDF documents.',
});

const catalogEntriesById = new Map<string, CatalogEntry>();
for (const category of categories) {
  for (const tool of category.tools) {
    if (!catalogEntriesById.has(tool.id)) {
      catalogEntriesById.set(tool.id, tool);
    }
  }
}
catalogEntriesById.set(VIEW_PDF_ENTRY.id, VIEW_PDF_ENTRY);

export function getCatalogEntryById(id: string): CatalogEntry | undefined {
  return catalogEntriesById.get(id);
}

export function getCatalogEntriesForSurface(surfaceId: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const entry of catalogEntriesById.values()) {
    if (entry.surface === surfaceId) {
      entries.push(entry);
    }
  }
  return entries;
}
