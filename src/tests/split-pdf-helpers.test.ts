import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import createModule from '@neslinesli93/qpdf-wasm';
import { PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import type { QpdfInstanceExtended } from '@/types';
import {
  parseRangeGroups,
  evenOddIndices,
  allPagesIndices,
  nTimesGroups,
  bookmarkSplitGroups,
  groupFilename,
  uniqueZipName,
  pagesToSpec,
  extractPagesWithQpdf,
} from '@/js/utils/split-pdf-helpers';

async function makeSharedResourcePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([200, 200]);
  const xObjects = document.context.obj({}) as PDFDict;

  for (let index = 0; index < 24; index++) {
    let seed = index + 1;
    let content = '';
    for (let line = 0; line < 96; line++) {
      content += '%';
      for (let column = 0; column < 80; column++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        content += String.fromCharCode(33 + ((seed >>> 0) % 90));
      }
      content += '\n';
    }
    const stream = document.context.flateStream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 1, 1],
    });
    xObjects.set(
      PDFName.of(`Unused${index}`),
      document.context.register(stream)
    );
  }

  page.node.set(
    PDFName.of('Resources'),
    document.context.obj({ XObject: xObjects })
  );
  return document.save({ useObjectStreams: false });
}

async function makeBookmarkedPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const pages = [document.addPage(), document.addPage(), document.addPage()];
  const outlines = document.context.obj({
    Type: 'Outlines',
    Count: 1,
  }) as PDFDict;
  const outlinesRef = document.context.register(outlines);
  const item = document.context.obj({
    Title: PDFString.of('Section one'),
    Parent: outlinesRef,
    Dest: [pages[0].ref, 'Fit'],
  }) as PDFDict;
  const itemRef = document.context.register(item);
  outlines.set(PDFName.of('First'), itemRef);
  outlines.set(PDFName.of('Last'), itemRef);
  document.catalog.set(PDFName.of('Outlines'), outlinesRef);
  return document.save({ useObjectStreams: false });
}

describe('split-pdf-helpers (pure planning)', () => {
  describe('parseRangeGroups', () => {
    it('parses a single page into one group', () => {
      expect(parseRangeGroups('3', 10)).toEqual({
        groups: [[2]],
        indices: [2],
      });
    });

    it('parses a hyphen range into one consecutive group', () => {
      expect(parseRangeGroups('2-5', 10)).toEqual({
        groups: [[1, 2, 3, 4]],
        indices: [1, 2, 3, 4],
      });
    });

    it('keeps disjoint ranges as separate groups, indices flattened in order', () => {
      expect(parseRangeGroups('1-5, 8, 11-13', 20)).toEqual({
        groups: [[0, 1, 2, 3, 4], [7], [10, 11, 12]],
        indices: [0, 1, 2, 3, 4, 7, 10, 11, 12],
      });
    });

    it('preserves the user-entered order (does not sort)', () => {
      expect(parseRangeGroups('8, 1-2', 10)).toEqual({
        groups: [[7], [0, 1]],
        indices: [7, 0, 1],
      });
    });

    it('skips whitespace and empty parts', () => {
      expect(parseRangeGroups(' 1 , , 3-4 ', 10)).toEqual({
        groups: [[0], [2, 3]],
        indices: [0, 2, 3],
      });
    });

    it('skips out-of-bounds, reversed, and non-numeric ranges', () => {
      expect(parseRangeGroups('0-2, 9-5, abc, 3', 4)).toEqual({
        groups: [[2]],
        indices: [2],
      });
    });

    it('skips a range whose end exceeds the page count', () => {
      expect(parseRangeGroups('1-100', 5)).toEqual({ groups: [], indices: [] });
    });

    it('returns empty for an all-invalid input', () => {
      expect(parseRangeGroups('99, abc', 5)).toEqual({
        groups: [],
        indices: [],
      });
    });
  });

  describe('evenOddIndices', () => {
    it('selects even pages (1-based) as 0-based indices', () => {
      expect(evenOddIndices('even', 6)).toEqual([1, 3, 5]);
    });

    it('selects odd pages', () => {
      expect(evenOddIndices('odd', 6)).toEqual([0, 2, 4]);
    });

    it('handles odd total page counts', () => {
      expect(evenOddIndices('even', 5)).toEqual([1, 3]);
      expect(evenOddIndices('odd', 5)).toEqual([0, 2, 4]);
    });

    it('handles a single-page document', () => {
      expect(evenOddIndices('odd', 1)).toEqual([0]);
      expect(evenOddIndices('even', 1)).toEqual([]);
    });
  });

  describe('allPagesIndices', () => {
    it('returns every page index', () => {
      expect(allPagesIndices(4)).toEqual([0, 1, 2, 3]);
    });

    it('returns empty for zero pages', () => {
      expect(allPagesIndices(0)).toEqual([]);
    });
  });

  describe('nTimesGroups', () => {
    it('splits evenly when divisible', () => {
      expect(nTimesGroups(2, 6)).toEqual([
        [0, 1],
        [2, 3],
        [4, 5],
      ]);
    });

    it('puts the remainder in the final group', () => {
      expect(nTimesGroups(2, 5)).toEqual([[0, 1], [2, 3], [4]]);
    });

    it('returns a single group when N >= total', () => {
      expect(nTimesGroups(10, 3)).toEqual([[0, 1, 2]]);
    });

    it('produces one group per page when N is 1', () => {
      expect(nTimesGroups(1, 3)).toEqual([[0], [1], [2]]);
    });
  });

  describe('bookmarkSplitGroups', () => {
    it('builds consecutive ranges from boundary pages, first section starts at 0', () => {
      expect(bookmarkSplitGroups([2, 4], 8)).toEqual([
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ]);
    });

    it('sorts unsorted boundaries before grouping', () => {
      expect(bookmarkSplitGroups([4, 2], 8)).toEqual([
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ]);
    });

    it('treats a lone boundary as one whole-document group (preserves existing behavior)', () => {
      expect(bookmarkSplitGroups([3], 5)).toEqual([[0, 1, 2, 3, 4]]);
    });

    it('splits at every boundary after the first', () => {
      expect(bookmarkSplitGroups([2, 4, 6], 8)).toEqual([
        [0, 1, 2, 3],
        [4, 5],
        [6, 7],
      ]);
    });
  });

  describe('groupFilename', () => {
    it('names a single-page group page-N.pdf', () => {
      expect(groupFilename([4])).toBe('page-5.pdf');
    });

    it('names a multi-page group pages-min-max.pdf', () => {
      expect(groupFilename([0, 1, 2, 3, 4])).toBe('pages-1-5.pdf');
    });
  });

  describe('uniqueZipName', () => {
    it('returns the name unchanged on first use', () => {
      const used = new Map<string, number>();
      expect(uniqueZipName('page-1.pdf', used)).toBe('page-1.pdf');
    });

    it('suffixes collisions instead of overwriting', () => {
      const used = new Map<string, number>();
      expect(uniqueZipName('page-1.pdf', used)).toBe('page-1.pdf');
      expect(uniqueZipName('page-1.pdf', used)).toBe('page-1-1.pdf');
      expect(uniqueZipName('page-1.pdf', used)).toBe('page-1-2.pdf');
    });
  });

  describe('pagesToSpec', () => {
    it('converts 0-based indices to a 1-based comma-separated qpdf spec', () => {
      expect(pagesToSpec([0, 1, 7])).toBe('1,2,8');
    });

    it('preserves order for non-ascending selections', () => {
      expect(pagesToSpec([7, 0, 1])).toBe('8,1,2');
    });
  });
});

describe('extractPagesWithQpdf (error handling, stubbed)', () => {
  function stubQpdf(
    exitCode: number,
    output: Uint8Array
  ): QpdfInstanceExtended {
    return {
      callMain: () => exitCode,
      FS: {
        mkdir: () => {},
        mount: () => {},
        unmount: () => {},
        writeFile: () => {},
        readFile: () => output,
        unlink: () => {},
        analyzePath: () => ({ exists: true }),
      },
    };
  }

  it('throws on a hard qpdf error (exit code 2)', () => {
    const qpdf = stubQpdf(2, new Uint8Array([1, 2, 3]));
    expect(() => extractPagesWithQpdf(qpdf, '/in.pdf', [0])).toThrow(
      /exit code 2/
    );
  });

  it('throws when qpdf produces an empty file', () => {
    const qpdf = stubQpdf(0, new Uint8Array());
    expect(() => extractPagesWithQpdf(qpdf, '/in.pdf', [0])).toThrow(
      /empty PDF/
    );
  });

  it('accepts exit code 3 (warnings) with valid output', () => {
    const out = new Uint8Array([37, 80, 68, 70]);
    const qpdf = stubQpdf(3, out);
    expect(extractPagesWithQpdf(qpdf, '/in.pdf', [0])).toBe(out);
  });
});

describe('split modes end-to-end with real qpdf', () => {
  let qpdf: QpdfInstanceExtended;

  async function makePdf(pageCount: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i++) doc.addPage([100 + i, 200]);
    return new Uint8Array(await doc.save());
  }

  async function originalIndices(bytes: Uint8Array): Promise<number[]> {
    const doc = await PDFDocument.load(bytes);
    return doc.getPages().map((p) => Math.round(p.getWidth()) - 100);
  }

  function extract(source: Uint8Array, indices: number[]): Uint8Array {
    qpdf.FS.writeFile('/in.pdf', source);
    try {
      return extractPagesWithQpdf(qpdf, '/in.pdf', indices);
    } finally {
      qpdf.FS.unlink('/in.pdf');
    }
  }

  beforeAll(async () => {
    const wasmBinary = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm'
      )
    );
    qpdf = await (
      createModule as unknown as (o: object) => Promise<QpdfInstanceExtended>
    )({ wasmBinary, noInitialRun: true });
  });

  it('range (combine): disjoint ranges -> one PDF with the right pages in order', async () => {
    const src = await makePdf(20);
    const { indices } = parseRangeGroups('1-5, 8, 11-13', 20);
    const out = extract(src, indices);
    expect(await originalIndices(out)).toEqual([0, 1, 2, 3, 4, 7, 10, 11, 12]);
  });

  it('range (separate): each range group -> its own PDF', async () => {
    const src = await makePdf(20);
    const { groups } = parseRangeGroups('1-5, 8, 11-13', 20);
    const outputs = groups.map((g) => extract(src, g));
    const counts = await Promise.all(
      outputs.map(async (o) => (await PDFDocument.load(o)).getPageCount())
    );
    expect(counts).toEqual([5, 1, 3]);
    expect(groups.map(groupFilename)).toEqual([
      'pages-1-5.pdf',
      'page-8.pdf',
      'pages-11-13.pdf',
    ]);
  });

  it('even-odd: extracts the correct pages', async () => {
    const src = await makePdf(6);
    expect(
      await originalIndices(extract(src, evenOddIndices('even', 6)))
    ).toEqual([1, 3, 5]);
    expect(
      await originalIndices(extract(src, evenOddIndices('odd', 6)))
    ).toEqual([0, 2, 4]);
  });

  it('all: one single-page PDF per page', async () => {
    const src = await makePdf(4);
    const groups = allPagesIndices(4).map((i) => [i]);
    const outputs = groups.map((g) => extract(src, g));
    const ids = await Promise.all(outputs.map((o) => originalIndices(o)));
    expect(ids).toEqual([[0], [1], [2], [3]]);
  });

  it('n-times: chunks of N pages with remainder in the last file', async () => {
    const src = await makePdf(5);
    const groups = nTimesGroups(2, 5);
    const outputs = groups.map((g) => extract(src, g));
    const ids = await Promise.all(outputs.map((o) => originalIndices(o)));
    expect(ids).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('bookmarks: boundary pages -> consecutive section PDFs', async () => {
    const src = await makePdf(8);
    const groups = bookmarkSplitGroups([2, 4], 8);
    const outputs = groups.map((g) => extract(src, g));
    const ids = await Promise.all(outputs.map((o) => originalIndices(o)));
    expect(ids).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it('produces a single valid one-page PDF for a single index', async () => {
    const src = await makePdf(3);
    const out = extract(src, [1]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(101);
  });

  it('fixes resource bloat: a single-page extract is far smaller than pdf-lib copyPages', async () => {
    const src = await makeSharedResourcePdf();

    const srcDoc = await PDFDocument.load(src);
    const plDoc = await PDFDocument.create();
    (await plDoc.copyPages(srcDoc, [0])).forEach((p) => plDoc.addPage(p));
    const pdfLibSize = (await plDoc.save()).length;

    const qpdfSize = extract(src, [0]).length;

    expect(qpdfSize).toBeLessThan(pdfLibSize * 0.5);
  });

  it('preserves the document outline that pdf-lib copyPages drops', async () => {
    const src = await makeBookmarkedPdf();

    const srcDoc = await PDFDocument.load(src);
    const plDoc = await PDFDocument.create();
    (await plDoc.copyPages(srcDoc, [0, 1, 2])).forEach((p) => plDoc.addPage(p));
    const pdfLibOut = new TextDecoder('latin1').decode(await plDoc.save());

    const qpdfOut = new TextDecoder('latin1').decode(extract(src, [0, 1, 2]));

    expect(pdfLibOut).not.toContain('/Outlines');
    expect(qpdfOut).toContain('/Outlines');
  });
});
