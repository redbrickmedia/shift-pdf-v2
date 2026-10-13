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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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

  it('keeps span font size and splits runs that sit far apart', () => {
    const boxes = textBoxesFromPageText(
      {
        width: 612,
        height: 792,
        blocks: [
          {
            type: 0,
            bbox: [0, -4, 500, 80],
            lines: [
              {
                spans: [
                  {
                    text: 'Title',
                    bbox: [-1, -3.5, 40, 8],
                    size: 10,
                    font: 'Times-Roman',
                    color: 0,
                    flags: 0,
                  },
                  {
                    text: 'https://mail.example',
                    bbox: [300, -3.5, 500, 8],
                    size: 10,
                    font: 'Times-Roman',
                    color: 0,
                    flags: 0,
                  },
                ],
              },
            ],
          },
        ],
      },
      612,
      792
    );

    expect(boxes).toHaveLength(2);
    expect(boxes[0].y).toBeLessThan(0);
    expect(boxes[0].paragraphs[0].runs[0]).toMatchObject({
      text: 'Title',
      fontSizePt: 10,
      font: 'Times New Roman',
    });
    expect(boxes[0].height).toBeLessThan(30);
    expect(boxes[1].x).toBeGreaterThan(200);
  });

  it('merges adjacent words and keeps bold from the font name', () => {
    const boxes = textBoxesFromPageText(
      {
        blocks: [
          {
            type: 0,
            bbox: [10, 20, 80, 32],
            lines: [
              {
                spans: [
                  {
                    text: 'Hello',
                    bbox: [10, 20, 40, 32],
                    size: 11,
                    font: 'Helvetica-Bold',
                    flags: 16,
                  },
                  {
                    text: 'there',
                    bbox: [44, 20, 80, 32],
                    size: 11,
                    font: 'Helvetica-Bold',
                    flags: 16,
                  },
                ],
              },
            ],
          },
        ],
      },
      612,
      792,
      [{ uri: 'mailto:logan@kuzyk.net', bbox: [10, 18, 90, 36] }]
    );

    expect(boxes).toHaveLength(1);
    const runs = boxes[0].paragraphs[0].runs;
    expect(runs.map((run) => run.text).join('')).toContain('Hello');
    expect(runs.map((run) => run.text).join('')).toContain('there');
    expect(runs[0]).toMatchObject({
      font: 'Arial',
      bold: true,
      link: 'mailto:logan@kuzyk.net',
    });
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

  it('places span text and images together when the page has both', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const payload = {
      width: 612,
      height: 792,
      blocks: [
        {
          type: 0,
          bbox: [10, 20, 500, 40],
          lines: [
            {
              spans: [
                {
                  text: 'Hello',
                  bbox: [10, 22, 50, 34],
                  size: 10,
                  font: 'Times-Bold',
                  color: 0,
                  flags: 16,
                },
                {
                  text: 'there',
                  bbox: [54, 22, 90, 34],
                  size: 10,
                  font: 'Times-Bold',
                  color: 0,
                  flags: 16,
                },
                {
                  text: 'https://example.com',
                  bbox: [300, 20, 500, 32],
                  size: 9,
                  font: 'Helvetica',
                  color: 0x0563c1,
                  flags: 0,
                },
              ],
            },
          ],
        },
      ],
      images: [
        {
          bbox: [40, 80, 200, 140],
          ext: 'jpeg',
          data: toBase64(jpeg),
        },
        {
          bbox: [20, 40, 80, 60],
          ext: 'png',
          data: toBase64(PNG),
        },
      ],
      links: [{ uri: 'https://example.com', bbox: [298, 18, 510, 36] }],
    };
    const toImage = vi.fn();
    const page: PyMuPdfSlidePage = {
      width: 612,
      height: 792,
      docVar: 'doc_1',
      pageNumber: 0,
      runPython: () => JSON.stringify(payload),
      getText() {
        throw new Error('dict serialization should not be required');
      },
      toImage,
    };

    const slide = await slideFromPyMuPdfPage(page);

    expect(toImage).not.toHaveBeenCalled();
    expect(slide?.picture).toBeUndefined();
    expect(slide?.pictures).toHaveLength(2);
    expect(slide?.pictures?.[0]).toMatchObject({
      x: 40,
      y: 80,
      width: 160,
      height: 60,
      ext: 'jpeg',
    });
    expect(slide?.pictures?.[0].bytes).toEqual(jpeg);
    expect(slide?.pictures?.[1].ext).toBe('png');

    const runs =
      slide?.textBoxes.flatMap((box) =>
        box.paragraphs.flatMap((paragraph) => paragraph.runs)
      ) ?? [];
    const hello = runs.find((run) => run.text.includes('Hello'));
    expect(hello).toMatchObject({
      fontSizePt: 10,
      font: 'Times New Roman',
      bold: true,
    });
    expect(
      runs.find((run) => run.text.includes('https://example.com'))
    ).toMatchObject({ link: 'https://example.com', font: 'Arial' });

    const blob = await buildPptx([slide!]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file('ppt/media/image1.jpeg')).toBeTruthy();
    expect(zip.file('ppt/media/image2.png')).toBeTruthy();
    const xml = await slideXml(blob, 'ppt/slides/slide1.xml');
    expect(xml.indexOf('<p:pic>')).toBeLessThan(xml.indexOf('<p:sp>'));
    expect(xml).toContain('r:embed="rId2"');
    expect(xml).toContain('r:embed="rId3"');
    expect(xml).toContain(`cx="${160 * 12700}"`);
    expect(xml).toContain('typeface="Times New Roman"');
    expect(xml).toContain('b="1"');
    expect(xml).toContain('sz="1000"');
    const rels = await slideXml(blob, 'ppt/slides/_rels/slide1.xml.rels');
    expect(rels).toContain('Target="https://example.com"');
    expect(rels).toContain('TargetMode="External"');
    expect(rels).toContain('../media/image1.jpeg');
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
