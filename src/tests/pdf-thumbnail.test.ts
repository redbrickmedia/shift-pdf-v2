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

  it('sizes an unspecified thumbnail from the css box and pixel ratio', async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    getPDFDocument.mockReturnValue({
      promise: Promise.resolve({
        getPage: vi.fn().mockResolvedValue({
          getViewport: ({ scale }: { scale: number }) => ({
            width: 100 * scale,
            height: 140 * scale,
          }),
          render,
        }),
        destroy: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { value: 280 });
    vi.spyOn(canvas, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
    const previous = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });

    await renderPdfFirstPage(
      new File(['%PDF-1.4'], 'page.pdf', { type: 'application/pdf' }),
      canvas
    );

    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: previous,
    });
    expect(canvas.width).toBe(560);
    expect(canvas.height).toBe(784);
  });
});
