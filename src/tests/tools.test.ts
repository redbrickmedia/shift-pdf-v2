import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  categories,
  getCatalogEntriesForSurface,
  getCatalogEntryById,
  PRUNED_TOOL_IDS,
  PRUNED_TOOL_ID_SET,
} from '@/js/config/tools';
import { shiftToolIcons } from '@/js/config/shift-tool-icons';
import { getPdfDestinations } from '@/js/config/convert-destinations';
import { describe, it, expect } from 'vitest';

describe('Tool Categories Configuration', () => {
  it('should be an array of category objects', () => {
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);
  });

  describe.each(categories)('Category: "$name"', (category) => {
    it('should have a non-empty "name" string and a non-empty "tools" array', () => {
      expect(typeof category.name).toBe('string');
      expect(category.name.length).toBeGreaterThan(0);
      expect(Array.isArray(category.tools)).toBe(true);
      expect(category.tools.length).toBeGreaterThan(0);
    });

    it('should not contain any duplicate tool IDs within its own list', () => {
      const toolIds = category.tools.map((tool) => tool.id);
      const uniqueToolIds = new Set(toolIds);
      expect(uniqueToolIds.size).toBe(toolIds.length);
    });

    describe.each(category.tools)('Tool: "$name"', (tool) => {
      it('should have the entry-aware schema properties with valid values', () => {
        expect(tool).toHaveProperty('id');
        expect(tool).toHaveProperty('surface');
        expect(tool).toHaveProperty('href');
        expect(tool).toHaveProperty('cardinality');
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('icon');
        expect(tool).toHaveProperty('subtitle');

        for (const key of [
          'id',
          'surface',
          'href',
          'name',
          'icon',
          'subtitle',
        ] as const) {
          const value = tool[key];
          expect(typeof value).toBe('string');
          expect(value.length).toBeGreaterThan(0);
        }

        expect(['single', 'dual', 'batch']).toContain(tool.cardinality);

        if (tool.id === tool.surface) {
          expect(tool.href).toMatch(new RegExp(`${tool.surface}\\.html$`));
        } else {
          expect(tool.href).toMatch(
            new RegExp(`${tool.surface}\\.html\\?entry=${tool.id}$`)
          );
        }
      });
    });
  });

  it('prunes all 18 retired niche tools from the catalog, icons, and destination maps', () => {
    expect(PRUNED_TOOL_IDS).toHaveLength(18);
    const allToolIds = categories.flatMap((c) => c.tools.map((t) => t.id));
    const { primary, secondary } = getPdfDestinations();
    const pdfDestIds = new Set([...primary, ...secondary].map((d) => d.id));
    for (const prunedId of PRUNED_TOOL_IDS) {
      expect(PRUNED_TOOL_ID_SET.has(prunedId)).toBe(true);
      expect(allToolIds).not.toContain(prunedId);
      expect(getCatalogEntryById(prunedId)).toBeUndefined();
      expect(shiftToolIcons).not.toHaveProperty(prunedId);
      expect(pdfDestIds.has(prunedId)).toBe(false);
    }
  });

  it('applies category moves and renames (including English locale translation)', () => {
    const byCategory = new Map(
      categories.map((c) => [c.name, c.tools.map((t) => t.id)])
    );

    expect(byCategory.get('Convert from PDF')).toContain('extract-tables');
    expect(byCategory.get('Organize & Manage')).not.toContain('extract-tables');

    expect(byCategory.get('Edit & Annotate')).toContain('pdf-to-greyscale');
    expect(byCategory.get('Convert from PDF')).not.toContain(
      'pdf-to-greyscale'
    );

    expect(byCategory.get('Organize & Manage')).toContain('remove-blank-pages');
    expect(byCategory.get('Edit & Annotate')).not.toContain(
      'remove-blank-pages'
    );

    expect(byCategory.get('Secure PDF')).toContain('remove-restrictions');
    expect(byCategory.get('Optimize & Repair')).not.toContain(
      'remove-restrictions'
    );

    const popularOrganize = categories
      .find((c) => c.name === 'Popular Tools')
      ?.tools.find((t) => t.id === 'organize-pdf');
    expect(popularOrganize?.name).toBe('Organize & Duplicate');

    const enTools = JSON.parse(
      readFileSync('public/locales/en/tools.json', 'utf8')
    ) as { duplicateOrganize?: { name?: string } };
    expect(enTools.duplicateOrganize?.name).toBe('Organize & Duplicate');
  });

  it('maps consolidated entries to their target surfaces and cardinalities', () => {
    expect(getCatalogEntryById('rotate-pdf')).toMatchObject({
      id: 'rotate-pdf',
      surface: 'pdf-multi-tool',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('alternate-merge')).toMatchObject({
      id: 'alternate-merge',
      surface: 'merge-pdf',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('extract-pages')).toMatchObject({
      id: 'extract-pages',
      surface: 'split-pdf',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('jpg-to-pdf')).toMatchObject({
      id: 'jpg-to-pdf',
      surface: 'pdf-converter',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('pdf-to-docx')).toMatchObject({
      id: 'pdf-to-docx',
      surface: 'pdf-converter',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('sign-pdf')).toMatchObject({
      id: 'sign-pdf',
      surface: 'edit-pdf',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('table-of-contents')).toMatchObject({
      id: 'table-of-contents',
      surface: 'bookmark',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('remove-metadata')).toMatchObject({
      id: 'remove-metadata',
      surface: 'sanitize-pdf',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('view-metadata')).toMatchObject({
      id: 'view-metadata',
      surface: 'edit-metadata',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('add-attachments')).toMatchObject({
      id: 'add-attachments',
      surface: 'edit-attachments',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('remove-restrictions')).toMatchObject({
      id: 'remove-restrictions',
      surface: 'encrypt-pdf',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('timestamp-pdf')).toMatchObject({
      id: 'timestamp-pdf',
      surface: 'digital-sign-pdf',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('rasterize-pdf')).toMatchObject({
      id: 'rasterize-pdf',
      surface: 'flatten-pdf',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('pdf-to-greyscale')).toMatchObject({
      id: 'pdf-to-greyscale',
      surface: 'adjust-colors',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('bates-numbering')).toMatchObject({
      id: 'bates-numbering',
      surface: 'page-numbers',
      cardinality: 'batch',
    });
    expect(getCatalogEntryById('page-dimensions')).toMatchObject({
      id: 'page-dimensions',
      surface: 'fix-page-size',
      cardinality: 'single',
    });
    expect(getCatalogEntryById('compare-pdfs')).toMatchObject({
      id: 'compare-pdfs',
      surface: 'compare-pdfs',
      cardinality: 'dual',
    });
    expect(getCatalogEntryById('view-pdf')).toMatchObject({
      id: 'view-pdf',
      surface: 'view-pdf',
      cardinality: 'single',
    });

    const multiToolEntries = getCatalogEntriesForSurface('pdf-multi-tool').map(
      (e) => e.id
    );
    expect(multiToolEntries).toEqual(
      expect.arrayContaining([
        'pdf-multi-tool',
        'organize-pdf',
        'delete-pages',
        'rotate-pdf',
        'add-blank-page',
        'reverse-pages',
      ])
    );
  });

  it('retires all 87 consolidated and pruned standalone .html pages and maps every Catalog Entry surface to an existing canonical .html page', () => {
    const retiredStandalonePages = [
      // 69 consolidated standalone pages
      'organize-pdf.html',
      'delete-pages.html',
      'rotate-pdf.html',
      'add-blank-page.html',
      'reverse-pages.html',
      'extract-pages.html',
      'alternate-merge.html',
      'jpg-to-pdf.html',
      'png-to-pdf.html',
      'webp-to-pdf.html',
      'svg-to-pdf.html',
      'bmp-to-pdf.html',
      'heic-to-pdf.html',
      'tiff-to-pdf.html',
      'psd-to-pdf.html',
      'image-to-pdf.html',
      'word-to-pdf.html',
      'excel-to-pdf.html',
      'powerpoint-to-pdf.html',
      'odt-to-pdf.html',
      'ods-to-pdf.html',
      'odp-to-pdf.html',
      'odg-to-pdf.html',
      'rtf-to-pdf.html',
      'pages-to-pdf.html',
      'pub-to-pdf.html',
      'vsd-to-pdf.html',
      'epub-to-pdf.html',
      'mobi-to-pdf.html',
      'xps-to-pdf.html',
      'csv-to-pdf.html',
      'xml-to-pdf.html',
      'email-to-pdf.html',
      'pdf-to-jpg.html',
      'pdf-to-png.html',
      'pdf-to-webp.html',
      'pdf-to-bmp.html',
      'pdf-to-tiff.html',
      'pdf-to-svg.html',
      'pdf-to-docx.html',
      'pdf-to-pptx.html',
      'pdf-to-excel.html',
      'pdf-to-csv.html',
      'pdf-to-text.html',
      'pdf-to-markdown.html',
      'extract-tables.html',
      'sign-pdf.html',
      'add-stamps.html',
      'form-filler.html',
      'crop-pdf.html',
      'table-of-contents.html',
      'remove-annotations.html',
      'view-metadata.html',
      'remove-metadata.html',
      'add-attachments.html',
      'extract-attachments.html',
      'change-permissions.html',
      'decrypt-pdf.html',
      'remove-restrictions.html',
      'validate-signature-pdf.html',
      'timestamp-pdf.html',
      'rasterize-pdf.html',
      'pdf-to-greyscale.html',
      'invert-colors.html',
      'background-color.html',
      'text-color.html',
      'header-footer.html',
      'bates-numbering.html',
      'page-dimensions.html',
      // 18 pruned standalone pages
      'rotate-custom.html',
      'posterize-pdf.html',
      'pdf-booklet.html',
      'json-to-pdf.html',
      'pdf-to-json.html',
      'prepare-pdf-for-ai.html',
      'wpd-to-pdf.html',
      'wps-to-pdf.html',
      'fb2-to-pdf.html',
      'cbz-to-pdf.html',
      'pdf-to-cbz.html',
      'scanner-effect.html',
      'add-page-labels.html',
      'linearize-pdf.html',
      'font-to-outline.html',
      'pdf-layers.html',
      'pdf-workflow.html',
      'overlay-pdf.html',
    ];

    expect(retiredStandalonePages).toHaveLength(87);
    const pagesDir = resolve(process.cwd(), 'src/pages');
    const existingRetired = retiredStandalonePages.filter((page) =>
      existsSync(resolve(pagesDir, page))
    );
    expect(existingRetired).toEqual([]);

    const canonicalPagesInSrcPages = [
      'view-pdf.html',
      'edit-pdf.html',
      'pdf-multi-tool.html',
      'merge-pdf.html',
      'split-pdf.html',
      'bookmark.html',
      'form-creator.html',
      'add-watermark.html',
      'markdown-to-pdf.html',
      'txt-to-pdf.html',
      'compress-pdf.html',
      'repair-pdf.html',
      'pdf-to-pdfa.html',
      'deskew-pdf.html',
      'ocr-pdf.html',
      'flatten-pdf.html',
      'encrypt-pdf.html',
      'digital-sign-pdf.html',
      'sanitize-pdf.html',
      'edit-metadata.html',
      'edit-attachments.html',
      'adjust-colors.html',
      'page-numbers.html',
      'fix-page-size.html',
      'remove-blank-pages.html',
      'divide-pages.html',
      'n-up-pdf.html',
      'combine-single-page.html',
      'compare-pdfs.html',
      'extract-images.html',
      'pdf-to-zip.html',
      'wasm-settings.html',
    ].sort();

    const actualPagesInSrcPages = readdirSync(pagesDir)
      .filter((name) => name.endsWith('.html'))
      .sort();
    expect(actualPagesInSrcPages).toEqual(canonicalPagesInSrcPages);

    const uniqueSurfaces = new Set(
      categories.flatMap((category) =>
        category.tools.map((tool) => tool.surface)
      )
    );
    uniqueSurfaces.add('view-pdf');

    for (const surface of uniqueSurfaces) {
      const pagePath =
        surface === 'pdf-converter'
          ? resolve(process.cwd(), 'pdf-converter.html')
          : resolve(pagesDir, `${surface}.html`);
      expect(existsSync(pagePath), `missing canonical surface ${surface}`).toBe(
        true
      );
    }
  });
});
