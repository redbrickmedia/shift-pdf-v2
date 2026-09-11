import { describe, expect, it } from 'vitest';
import {
  listCatalogTools,
  partitionPinnedTools,
  PDF_VIEWER_PAGE_ID,
} from '../js/logic/pdf-viewer-launchers';

const catalog = [
  {
    tools: [
      {
        id: 'view-pdf',
        name: 'View PDF',
        href: '/view-pdf.html',
        icon: 'ph-file-pdf',
      },
      {
        id: 'sign-pdf',
        name: 'Sign PDF',
        href: '/sign-pdf.html',
        icon: 'ph-pen-nib',
      },
      {
        id: 'pdf-converter',
        name: 'Convert',
        href: '/pdf-converter.html',
        icon: 'ph-arrows-clockwise',
      },
    ],
  },
  {
    tools: [
      {
        id: 'sign-pdf',
        name: 'Sign PDF',
        href: '/sign-pdf.html',
        icon: 'ph-pen-nib',
      },
      {
        id: 'compress-pdf',
        name: 'Compress PDF',
        href: '/compress-pdf.html',
        icon: 'ph-lightning',
      },
    ],
  },
];

describe('pdf viewer launchers', () => {
  it('lists unique catalog tools and skips the viewer page', () => {
    const tools = listCatalogTools(catalog);

    expect(tools.map((tool) => tool.id)).toEqual([
      'sign-pdf',
      'pdf-converter',
      'compress-pdf',
    ]);
    expect(tools.some((tool) => tool.id === PDF_VIEWER_PAGE_ID)).toBe(false);
  });

  it('skips disabled tools', () => {
    const tools = listCatalogTools(catalog, {
      isDisabled: (id) => id === 'compress-pdf',
    });

    expect(tools.map((tool) => tool.id)).toEqual(['sign-pdf', 'pdf-converter']);
  });

  it('pins favorites first and leaves the rest for More tools', () => {
    const tools = listCatalogTools(catalog);
    const { pinned, more } = partitionPinnedTools(tools, [
      'pdf-converter',
      'missing',
      'sign-pdf',
    ]);

    expect(pinned.map((tool) => tool.id)).toEqual([
      'pdf-converter',
      'sign-pdf',
    ]);
    expect(more.map((tool) => tool.id)).toEqual(['compress-pdf']);
  });
});
