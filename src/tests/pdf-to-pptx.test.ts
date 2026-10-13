import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const { mockLoadPyMuPDF } = vi.hoisted(() => ({
  mockLoadPyMuPDF: vi.fn(),
}));

vi.mock('../js/utils/pymupdf-loader', () => ({
  loadPyMuPDF: mockLoadPyMuPDF,
}));

import {
  buildPptx,
  EMPTY_PRESENTATION_MESSAGE,
  pdfToPptx,
  slideFromPyMuPdfPage,
  textBoxesFromPageText,
  type PyMuPdfSlidePage,
} from '../js/utils/pdf-to-pptx';

const PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 248, 207, 192, 80, 15, 0, 4, 133, 1, 128, 132, 169, 140, 33, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

async function slideXml(blob: Blob, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = zip.file(name);
  expect(file).toBeTruthy();
  return file!.async('string');
}

describe('textBoxesFromPageText', () => {
  it('places one text box per dict block', () => {
    const boxes = textBoxesFromPageText(
      {
        width: 612,
        height: 792,
        blocks: [
          {
            type: 0,
            bbox: [72, 80, 300, 110],
            lines: [
              {
                spans: [{ text: 'Quarterly', size: 18, color: 0x112233 }],
              },
            ],
          },
          {
            type: 1,
            bbox: [0, 0, 10, 10],
            lines: [],
          },
        ],
      },
      612,
      792
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ x: 72, y: 80, width: 228, height: 30 });
    expect(boxes[0].paragraphs[0].runs[0]).toMatchObject({
      text: 'Quarterly',
      fontSizePt: 18,
      color: '112233',
    });
  });

  it('places one text box per blocks tuple and skips images', () => {
    const boxes = textBoxesFromPageText(
      [
        [40, 50, 240, 90, 'From blocks\n', 0, 0],
        [0, 0, 20, 20, '', 1, 1],
      ],
      612,
      792
    );

    expect(boxes).toHaveLength(1);
    expect(boxes[0].paragraphs[0].runs[0].text).toBe('From blocks');
  });

  it('parses a JSON string from getText("json")', () => {
    const boxes = textBoxesFromPageText(
      JSON.stringify({
        blocks: [
          {
            type: 0,
            bbox: [10, 20, 200, 40],
            lines: [{ spans: [{ text: 'Parsed', size: 12 }] }],
          },
        ],
      }),
      612,
      792
    );

    expect(boxes[0].paragraphs[0].runs[0].text).toBe('Parsed');
  });

  it('uses one text frame when the page text is a plain string', () => {
    const boxes = textBoxesFromPageText('Hello\nthere', 612, 792);

    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBe(36);
    expect(
      boxes[0].paragraphs.map((paragraph) => paragraph.runs[0].text)
    ).toEqual(['Hello', 'there']);
  });
});

describe('slideFromPyMuPdfPage', () => {
  it('does not render a picture when dict text is available', async () => {
    const toImage = vi.fn();
    const page: PyMuPdfSlidePage = {
      width: 612,
      height: 792,
      getText(format) {
        if (format === 'dict') {
          return {
            blocks: [
              {
                type: 0,
                bbox: [72, 72, 200, 96],
                lines: [{ spans: [{ text: 'Hello', size: 14 }] }],
              },
            ],
          };
        }
        throw new Error(`unexpected ${format}`);
      },
      toImage,
    };

    const slide = await slideFromPyMuPdfPage(page);

    expect(slide?.textBoxes[0].paragraphs[0].runs[0].text).toBe('Hello');
    expect(slide?.picture).toBeUndefined();
    expect(toImage).not.toHaveBeenCalled();
  });

  it('falls back to blocks when dict serialization throws', async () => {
    const page: PyMuPdfSlidePage = {
      width: 500,
      height: 400,
      getText(format) {
        if (format === 'dict') throw new Error('image bytes');
        if (format === 'blocks') return [[12, 16, 180, 40, 'Recovered', 0, 0]];
        throw new Error(`unexpected ${format}`);
      },
    };

    const slide = await slideFromPyMuPdfPage(page);

    expect(slide?.widthPt).toBe(500);
    expect(slide?.textBoxes[0].paragraphs[0].runs[0].text).toBe('Recovered');
  });

  it('uses a full-page picture when the page has no text', async () => {
    const page: PyMuPdfSlidePage = {
      width: 200,
      height: 100,
      getText: () => '',
      toPixmap: () => ({
        toBlob: () => new Blob([PNG]),
      }),
    };

    const slide = await slideFromPyMuPdfPage(page);

    expect(slide?.textBoxes).toEqual([]);
    expect(slide?.picture?.bytes).toEqual(PNG);
    expect(slide?.picture?.ext).toBe('png');
  });

  it('returns null when a page has no text and no picture', async () => {
    const page: PyMuPdfSlidePage = {
      getText: () => '',
      toImage: async () => new Uint8Array(),
    };

    await expect(slideFromPyMuPdfPage(page)).resolves.toBeNull();
  });
});

describe('buildPptx', () => {
  it('writes one slide per page with its text', async () => {
    const blob = await buildPptx([
      {
        widthPt: 612,
        heightPt: 792,
        textBoxes: [
          {
            x: 72,
            y: 80,
            width: 200,
            height: 30,
            paragraphs: [
              {
                runs: [{ text: 'A & B <C>', fontSizePt: 18, color: '112233' }],
              },
            ],
          },
        ],
      },
      {
        widthPt: 612,
        heightPt: 792,
        textBoxes: [
          {
            x: 72,
            y: 80,
            width: 200,
            height: 30,
            paragraphs: [{ runs: [{ text: 'Appendix', fontSizePt: 16 }] }],
          },
        ],
      },
    ]);

    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideNames = Object.keys(zip.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    );
    expect(slideNames).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
    ]);

    const contentTypes = await slideXml(blob, '[Content_Types].xml');
    expect(contentTypes).toContain(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
    );

    const first = await slideXml(blob, 'ppt/slides/slide1.xml');
    const second = await slideXml(blob, 'ppt/slides/slide2.xml');
    expect(first).toContain('A &amp; B &lt;C&gt;');
    expect(first).toContain('sz="1800"');
    expect(first).toContain('val="112233"');
    expect(second).toContain('Appendix');

    const presentation = await slideXml(blob, 'ppt/presentation.xml');
    expect(presentation).toContain(`cx="${612 * 12700}"`);
    expect(presentation).toContain(`cy="${792 * 12700}"`);
  });

  it('stores a media part for a page with no text', async () => {
    const blob = await buildPptx([
      {
        widthPt: 200,
        heightPt: 100,
        textBoxes: [],
        picture: { bytes: PNG, ext: 'png' },
      },
    ]);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const media = zip.file('ppt/media/image1.png');
    expect(media).toBeTruthy();
    const bytes = await media!.async('uint8array');
    expect(bytes).toEqual(PNG);

    const slide = await slideXml(blob, 'ppt/slides/slide1.xml');
    expect(slide).toContain('<p:pic>');
    expect(slide).toContain('r:embed="rId2"');
    const rels = await slideXml(blob, 'ppt/slides/_rels/slide1.xml.rels');
    expect(rels).toContain('../media/image1.png');
  });

  it('rejects an empty deck', async () => {
    await expect(buildPptx([])).rejects.toThrow(EMPTY_PRESENTATION_MESSAGE);
  });
});

describe('pdfToPptx', () => {
  beforeEach(() => {
    mockLoadPyMuPDF.mockReset();
  });

  it('fails when every page is empty and closes the document', async () => {
    const close = vi.fn();
    mockLoadPyMuPDF.mockResolvedValue({
      open: vi.fn().mockResolvedValue({
        pageCount: 1,
        getPage: () => ({
          width: 612,
          height: 792,
          getText: () => '',
          toImage: async () => new Uint8Array(),
        }),
        close,
      }),
    });

    await expect(pdfToPptx(new Blob(['%PDF']))).rejects.toThrow(
      EMPTY_PRESENTATION_MESSAGE
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
