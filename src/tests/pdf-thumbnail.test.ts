import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPDFDocument } = vi.hoisted(() => ({
  getPDFDocument: vi.fn(),
}));

vi.mock('../js/utils/pdfjs.js', () => ({
  getPDFDocument,
}));

import { renderPdfFirstPage } from '../js/utils/pdf-thumbnail';

describe('pdf thumbnail', () => {
  beforeEach(() => {
    getPDFDocument.mockReset();
  });

  it('renders the first page onto the canvas', async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const destroy = vi.fn().mockResolvedValue(undefined);
    getPDFDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 140 * scale,
          }),
          render,
        }),
        destroy,
      }),
    });

    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    const file = new File(['%PDF-1.4'], 'page.pdf', {
      type: 'application/pdf',
    });
    await renderPdfFirstPage(file, canvas, 180);

    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(252);
    expect(render).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
