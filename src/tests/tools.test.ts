import {
  categories,
  getCatalogEntriesForSurface,
  getCatalogEntryById,
  PRUNED_TOOL_IDS,
  PRUNED_TOOL_ID_SET,
} from '@/js/config/tools';
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

  it('prunes all 18 retired niche tools from the catalog', () => {
    expect(PRUNED_TOOL_IDS).toHaveLength(18);
    const allToolIds = categories.flatMap((c) => c.tools.map((t) => t.id));
    for (const prunedId of PRUNED_TOOL_IDS) {
      expect(PRUNED_TOOL_ID_SET.has(prunedId)).toBe(true);
      expect(allToolIds).not.toContain(prunedId);
      expect(getCatalogEntryById(prunedId)).toBeUndefined();
    }
  });

  it('applies category moves and renames', () => {
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
});
