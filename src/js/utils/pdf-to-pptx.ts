import JSZip from 'jszip';
import { loadPyMuPDF } from './pymupdf-loader.js';

const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EMU_PER_POINT = 12700;
const DEFAULT_PAGE_WIDTH_PT = 612;
const DEFAULT_PAGE_HEIGHT_PT = 792;
const TEXT_FRAME_MARGIN_PT = 36;
const TEXT_FRAME_FONT_PT = 18;
const FALLBACK_RENDER_DPI = 144;

export const EMPTY_PRESENTATION_MESSAGE =
  'No slides could be created from this PDF.';

export interface PptxRun {
  text: string;
  fontSizePt: number;
  color?: string;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
}

export interface PptxParagraph {
  runs: PptxRun[];
}

export interface PptxTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  paragraphs: PptxParagraph[];
}

export interface PptxPicture {
  bytes: Uint8Array;
  ext: 'png' | 'jpeg' | 'gif';
  /** PDF points. Omitted coordinates fill the slide (scanned-page fallback). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Clockwise degrees around the picture center. Omitted when the image is upright. */
  rotationDeg?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface PptxLink {
  uri: string;
  bbox: number[];
}

export interface PptxSlide {
  widthPt: number;
  heightPt: number;
  textBoxes: PptxTextBox[];
  /** Positioned images drawn behind the text. */
  pictures?: PptxPicture[];
  /** Full-page picture used only when the page has no text and no images. */
  picture?: PptxPicture;
}

/**
 * Page surface used by the CDN PyMuPDF wrapper.
 * `getText("dict")` JSON-parses `page.get_text("dict")`, so the value is an
 * object at runtime even though the published type says `string`. Image
 * blocks embed raw bytes and make that dump throw; `blocks` still has boxes.
 */
export interface PyMuPdfSlidePage {
  width?: number;
  height?: number;
  rect?: { x0: number; y0: number; x1: number; y1: number };
  getText(format?: string): unknown;
  toPixmap?(options?: { dpi?: number }): {
    toBlob(format: string, quality?: number): Blob;
  };
  toImage?(options?: { dpi?: number }): Promise<Uint8Array> | Uint8Array;
  /**
   * CDN page objects expose these. `getText("dict")` cannot be serialized
   * once a page contains image bytes, so the rich path reads text and
   * images through Python instead.
   */
  runPython?(code: string): unknown;
  docVar?: string;
  pageNumber?: number;
}

export async function pdfToPptx(file: Blob): Promise<Blob> {
  const pymupdf = await loadPyMuPDF();
  const doc = await pymupdf.open(file);
  try {
    const slides: PptxSlide[] = [];
    for (let index = 0; index < doc.pageCount; index++) {
      const slide = await slideFromPyMuPdfPage(
        doc.getPage(index) as PyMuPdfSlidePage
      );
      if (slide) slides.push(slide);
    }
    return buildPptx(slides);
  } finally {
    doc.close();
  }
}

export async function slideFromPyMuPdfPage(
  page: PyMuPdfSlidePage
): Promise<PptxSlide | null> {
  const rich = readRichPage(page);
  if (rich) {
    const size = pageSize(page, rich);
    const textBoxes = textBoxesFromPageText(
      { width: rich.width, height: rich.height, blocks: rich.blocks },
      size.width,
      size.height,
      rich.links
    );
    const pictures = picturesFromRich(rich);
    if (textBoxes.length > 0 || pictures.length > 0) {
      // Do not paint a full-page render behind these text boxes. That render
      // already includes the glyphs, and the boxes have no fill.
      return {
        widthPt: size.width,
        heightPt: size.height,
        textBoxes,
        pictures,
      };
    }
  }

  const textValue = readPageText(page);
  const size = pageSize(page, textValue);
  let textBoxes = textBoxesFromPageText(textValue, size.width, size.height);

  if (textBoxes.length === 0 && !isPlainText(textValue)) {
    textBoxes = textBoxesFromCall(page, 'blocks', size);
    if (textBoxes.length === 0) {
      textBoxes = textBoxesFromCall(page, 'text', size);
    }
  }

  let picture: PptxPicture | undefined;
  if (textBoxes.length === 0) {
    picture = await renderPagePicture(page);
  }

  if (textBoxes.length === 0 && !picture) return null;

  return {
    widthPt: size.width,
    heightPt: size.height,
    textBoxes,
    picture,
  };
}

/**
 * Dict blocks become one text box per visual run when spans carry their own
 * boxes. A block without span boxes stays one text box. A plain string
 * becomes one text frame.
 */
export function textBoxesFromPageText(
  value: unknown,
  pageWidthPt: number,
  pageHeightPt: number,
  links: PptxLink[] = []
): PptxTextBox[] {
  const parsed = parseTextValue(value);
  const dictBoxes = boxesFromDict(parsed, pageWidthPt, pageHeightPt, links);
  if (dictBoxes) return dictBoxes;

  const blockBoxes = boxesFromBlockTuples(parsed, pageWidthPt, pageHeightPt);
  if (blockBoxes) return blockBoxes;

  if (typeof parsed === 'string') {
    return boxesFromPlainText(parsed, pageWidthPt, pageHeightPt);
  }

  return [];
}

export async function buildPptx(slides: PptxSlide[]): Promise<Blob> {
  if (slides.length === 0) {
    throw new Error(EMPTY_PRESENTATION_MESSAGE);
  }

  const slideWidth = Math.max(...slides.map((slide) => slide.widthPt));
  const slideHeight = Math.max(...slides.map((slide) => slide.heightPt));
  const assets = collectSlideAssets(slides);
  const zip = new JSZip();

  zip.file('[Content_Types].xml', contentTypesXml(slides.length, assets));
  zip.file('_rels/.rels', rootRelsXml());
  zip.file('docProps/core.xml', corePropsXml());
  zip.file('docProps/app.xml', appPropsXml(slides.length));
  zip.file(
    'ppt/presentation.xml',
    presentationXml(slides, slideWidth, slideHeight)
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    presentationRelsXml(slides.length)
  );
  zip.file('ppt/presProps.xml', presentationPropsXml());
  zip.file('ppt/theme/theme1.xml', themeXml());
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMasterXml());
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    slideMasterRelsXml()
  );
  zip.file('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    slideLayoutRelsXml()
  );

  slides.forEach((slide, index) => {
    const slideNumber = index + 1;
    const slideAssets = assets[index];
    zip.file(
      `ppt/slides/slide${slideNumber}.xml`,
      slideXml(slide, slideAssets)
    );
    zip.file(
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      slideRelsXml(slideAssets)
    );
  });

  for (const slideAssets of assets) {
    for (const picture of slideAssets.pictures) {
      zip.file(`ppt/media/${picture.name}`, picture.bytes, { binary: true });
    }
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: PPTX_MIME,
  });
}

interface RichPage {
  width?: number;
  height?: number;
  blocks: unknown[];
  images: unknown[];
  links: PptxLink[];
}

function readPageText(page: PyMuPdfSlidePage): unknown {
  try {
    return page.getText('dict');
  } catch {
    try {
      return page.getText('blocks');
    } catch {
      try {
        return page.getText('text');
      } catch {
        return '';
      }
    }
  }
}

/**
 * `getText("dict")` JSON-dumps image bytes and throws. This script keeps the
 * span geometry and returns image bytes as base64 instead.
 */
function readRichPage(page: PyMuPdfSlidePage): RichPage | null {
  if (
    typeof page.runPython !== 'function' ||
    typeof page.docVar !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(page.docVar) ||
    typeof page.pageNumber !== 'number' ||
    !Number.isInteger(page.pageNumber) ||
    page.pageNumber < 0
  ) {
    return null;
  }

  try {
    const result = page.runPython(richPagePython(page.docVar, page.pageNumber));
    return parseRichPage(result);
  } catch {
    return null;
  }
}

function richPagePython(docVar: string, pageNumber: number): string {
  return `
import json, base64
page = ${docVar}[${pageNumber}]

def _num(value, fallback=0.0):
    try:
        return float(value)
    except Exception:
        return float(fallback)

def _bbox(value):
    if not value or len(value) < 4:
        return [0.0, 0.0, 0.0, 0.0]
    return [_num(value[0]), _num(value[1]), _num(value[2]), _num(value[3])]

raw = page.get_text("dict")
blocks = []
for block in raw.get("blocks", []):
    if block.get("type", 0) != 0:
        continue
    lines = []
    for line in block.get("lines", []):
        spans = []
        for span in line.get("spans", []):
            text = span.get("text") or ""
            if not text:
                continue
            origin = span.get("origin") or [0, 0]
            spans.append({
                "text": text,
                "bbox": _bbox(span.get("bbox")),
                "size": _num(span.get("size"), 12),
                "font": span.get("font") or "",
                "color": int(_num(span.get("color"), 0)),
                "flags": int(_num(span.get("flags"), 0)),
                "origin": [_num(origin[0]), _num(origin[1])],
            })
        if spans:
            lines.append({"bbox": _bbox(line.get("bbox")), "spans": spans})
    if lines:
        blocks.append({"type": 0, "bbox": _bbox(block.get("bbox")), "lines": lines})

images = []
seen = set()
missed = set()
raw_fallbacks = {}

def _transform(value):
    if value is None:
        return None
    try:
        seq = [value[i] for i in range(6)]
    except Exception:
        try:
            seq = [value.a, value.b, value.c, value.d, value.e, value.f]
        except Exception:
            return None
    return [_num(item) for item in seq]

def _key(bbox):
    x0, y0, x1, y1 = bbox
    return (round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1))

def _visible(bbox):
    x0, y0, x1, y1 = bbox
    return (x1 - x0) >= 2 and (y1 - y0) >= 2

def _supported(ext):
    token = (ext or "").lower().lstrip(".")
    return token in ("png", "jpg", "jpeg", "gif")

def _add_image(bbox, ext, data, transform):
    if not data or not _supported(ext):
        return False
    if not _visible(bbox):
        return True
    key = _key(bbox)
    if key in seen:
        return True
    seen.add(key)
    missed.discard(key)
    x0, y0, x1, y1 = bbox
    images.append({
        "bbox": [x0, y0, x1, y1],
        "ext": ext or "png",
        "data": data,
        "transform": transform,
    })
    return True

def _fitz():
    try:
        import pymupdf as fitz
        return fitz
    except Exception:
        pass
    try:
        import fitz
        return fitz
    except Exception:
        return None

def _rgb(fitz, pix):
    alpha = getattr(pix, "alpha", 0) or 0
    components = getattr(pix, "n", 0) - alpha
    if getattr(pix, "colorspace", None) is not None and components > 3:
        return fitz.Pixmap(fitz.csRGB, pix)
    return pix

def _to_png(doc, xref, smask):
    fitz = _fitz()
    if fitz is None:
        raise RuntimeError("pixmap unavailable")
    pix = None
    try:
        extracted = doc.extract_image(xref)
        raw = extracted.get("image") if extracted else None
        if raw:
            pix = fitz.Pixmap(raw)
    except Exception:
        pix = None
    if pix is None:
        pix = fitz.Pixmap(doc, xref)
    if smask:
        if getattr(pix, "alpha", 0):
            pix = fitz.Pixmap(pix, 0)
        mask = fitz.Pixmap(doc.extract_image(smask)["image"])
        pix = fitz.Pixmap(pix, mask)
    return _rgb(fitz, pix).tobytes("png")

try:
    infos = page.get_image_info(xrefs=True)
except Exception:
    infos = []
for info in infos:
    bbox = _bbox(info.get("bbox"))
    xref = int(_num(info.get("xref"), 0))
    transform = _transform(info.get("transform"))
    placed = False
    if xref:
        try:
            img = page.parent.extract_image(xref)
        except Exception:
            img = None
        if img and img.get("image"):
            smask = int(_num(img.get("smask"), 0))
            ext = img.get("ext") or ""
            encoded = base64.b64encode(img["image"]).decode("ascii")
            try:
                if smask or not _supported(ext):
                    png = _to_png(page.parent, xref, smask)
                    placed = _add_image(
                        bbox,
                        "png",
                        base64.b64encode(png).decode("ascii"),
                        transform,
                    )
                else:
                    placed = _add_image(bbox, ext, encoded, transform)
            except Exception:
                placed = False
            if not placed and _supported(ext) and _visible(bbox):
                raw_fallbacks[_key(bbox)] = (bbox, ext, encoded, transform)
    if not placed and _visible(bbox):
        missed.add(_key(bbox))

for block in raw.get("blocks", []):
    if block.get("type") != 1:
        continue
    bbox = _bbox(block.get("bbox"))
    key = _key(bbox)
    if key in seen:
        continue
    # Only fill images the xref path failed to embed. A second copy of an
    # already placed picture would stack on the slide.
    if infos and key not in missed:
        continue
    raw_img = block.get("image")
    transform = _transform(block.get("transform"))
    if not isinstance(raw_img, (bytes, bytearray)) or not raw_img:
        if _visible(bbox):
            missed.add(key)
        continue
    ext = block.get("ext") or "png"
    data = bytes(raw_img)
    try:
        if not _supported(ext):
            fitz = _fitz()
            if fitz is None:
                raise RuntimeError("pixmap unavailable")
            pix = _rgb(fitz, fitz.Pixmap(data))
            data = pix.tobytes("png")
            ext = "png"
        placed = _add_image(
            bbox,
            ext,
            base64.b64encode(data).decode("ascii"),
            transform,
        )
    except Exception:
        placed = False
    if not placed and _visible(bbox):
        missed.add(key)

for key, item in raw_fallbacks.items():
    if key in seen:
        continue
    bbox, ext, data, transform = item
    _add_image(bbox, ext, data, transform)

links = []
try:
    for link in page.get_links():
        uri = link.get("uri")
        rect = link.get("from")
        if not uri or rect is None:
            continue
        links.append({
            "uri": uri,
            "bbox": [float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)],
        })
except Exception:
    links = []

json.dumps({
    "width": float(page.rect.width),
    "height": float(page.rect.height),
    "blocks": blocks,
    "images": images,
    "links": links,
})
`;
}

function parseRichPage(result: unknown): RichPage | null {
  let value = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as {
    width?: unknown;
    height?: unknown;
    blocks?: unknown;
    images?: unknown;
    links?: unknown;
  };
  if (!Array.isArray(record.blocks) && !Array.isArray(record.images)) {
    return null;
  }
  const links: PptxLink[] = [];
  if (Array.isArray(record.links)) {
    for (const link of record.links) {
      if (!link || typeof link !== 'object') continue;
      const uri = (link as { uri?: unknown }).uri;
      const bbox = numberTuple((link as { bbox?: unknown }).bbox, 4);
      if (typeof uri !== 'string' || !uri || !bbox) continue;
      links.push({ uri, bbox });
    }
  }
  return {
    width: asNumber(record.width),
    height: asNumber(record.height),
    blocks: Array.isArray(record.blocks) ? record.blocks : [],
    images: Array.isArray(record.images) ? record.images : [],
    links,
  };
}

function picturesFromRich(rich: RichPage): PptxPicture[] {
  const pictures: PptxPicture[] = [];
  for (const image of rich.images) {
    if (!image || typeof image !== 'object') continue;
    const record = image as {
      bbox?: unknown;
      ext?: unknown;
      data?: unknown;
      transform?: unknown;
    };
    const bbox = numberTuple(record.bbox, 4);
    const ext = normalizeExt(typeof record.ext === 'string' ? record.ext : '');
    if (!bbox || !ext || typeof record.data !== 'string' || !record.data) {
      continue;
    }
    const frame = pictureFrame(bbox, numberTuple(record.transform, 6));
    if (frame.width < 2 || frame.height < 2) continue;
    const bytes = decodeBase64(record.data);
    if (!bytes || bytes.length === 0) continue;
    pictures.push({
      bytes,
      ext,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      ...(frame.rotationDeg ? { rotationDeg: frame.rotationDeg } : {}),
      ...(frame.flipH ? { flipH: true } : {}),
      ...(frame.flipV ? { flipV: true } : {}),
    });
  }
  pictures.sort(
    (left, right) =>
      (right.width ?? 0) * (right.height ?? 0) -
      (left.width ?? 0) * (left.height ?? 0)
  );
  return pictures;
}

interface PictureFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  flipH: boolean;
  flipV: boolean;
}

/**
 * `transform` maps the unit image square onto the page (y down). PowerPoint
 * rotates and flips around the center of the unrotated box, so a tilted
 * picture keeps its edge lengths instead of stretching into the bbox.
 * Skewed placements stay on the bbox; DrawingML has no picture shear.
 */
function pictureFrame(
  bbox: number[],
  transform: number[] | null
): PictureFrame {
  const upright: PictureFrame = {
    x: bbox[0],
    y: bbox[1],
    width: bbox[2] - bbox[0],
    height: bbox[3] - bbox[1],
    rotationDeg: 0,
    flipH: false,
    flipV: false,
  };
  if (!transform) return upright;
  const placed = decomposeImageTransform(transform);
  if (!placed) return upright;
  const uprightEnough =
    !placed.flipH &&
    !placed.flipV &&
    Math.abs(placed.rotationDeg) < 0.05 &&
    Math.abs(placed.width - upright.width) < 0.5 &&
    Math.abs(placed.height - upright.height) < 0.5;
  return uprightEnough ? upright : placed;
}

function decomposeImageTransform(transform: number[]): PictureFrame | null {
  const [a, b, c, d, e, f] = transform;
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  const sideW = Math.hypot(a, b);
  const sideH = Math.hypot(c, d);
  if (sideW < 1 || sideH < 1) return null;

  const options = [
    { flipH: false, flipV: false, theta: Math.atan2(b, a) },
    { flipH: false, flipV: true, theta: Math.atan2(b, a) },
    { flipH: true, flipV: false, theta: Math.atan2(-b, -a) },
  ];
  let best: {
    flipH: boolean;
    flipV: boolean;
    theta: number;
    error: number;
  } | null = null;
  for (const option of options) {
    const predicted = imageLinearMap(
      sideW,
      sideH,
      option.theta,
      option.flipH,
      option.flipV
    );
    const error =
      Math.abs(predicted.a - a) / sideW +
      Math.abs(predicted.b - b) / sideW +
      Math.abs(predicted.c - c) / sideH +
      Math.abs(predicted.d - d) / sideH;
    const flipCount = (option.flipH ? 1 : 0) + (option.flipV ? 1 : 0);
    const bestFlip = best ? (best.flipH ? 1 : 0) + (best.flipV ? 1 : 0) : 0;
    const closer =
      !best ||
      error < best.error - 1e-6 ||
      (Math.abs(error - best.error) <= 1e-6 &&
        (flipCount < bestFlip ||
          (flipCount === bestFlip &&
            Math.abs(option.theta) < Math.abs(best.theta))));
    if (closer) best = { ...option, error };
  }
  // Orthogonal rotation and flips match exactly. Shear does not.
  if (!best || best.error > 0.08) return null;

  let rotationDeg = (best.theta * 180) / Math.PI;
  rotationDeg = ((((rotationDeg + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(rotationDeg) < 0.05) rotationDeg = 0;
  if (Math.abs(Math.abs(rotationDeg) - 180) < 0.05) {
    rotationDeg = rotationDeg < 0 ? -180 : 180;
  }

  const cx = e + (a + c) / 2;
  const cy = f + (b + d) / 2;
  return {
    x: cx - sideW / 2,
    y: cy - sideH / 2,
    width: sideW,
    height: sideH,
    rotationDeg,
    flipH: best.flipH,
    flipV: best.flipV,
  };
}

function imageLinearMap(
  width: number,
  height: number,
  theta: number,
  flipH: boolean,
  flipV: boolean
): { a: number; b: number; c: number; d: number } {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const ux = flipH ? -width : width;
  const vy = flipV ? -height : height;
  return {
    a: ux * cos,
    b: ux * sin,
    c: -vy * sin,
    d: vy * cos,
  };
}

function textBoxesFromCall(
  page: PyMuPdfSlidePage,
  format: string,
  size: { width: number; height: number }
): PptxTextBox[] {
  try {
    return textBoxesFromPageText(page.getText(format), size.width, size.height);
  } catch {
    return [];
  }
}

function isPlainText(value: unknown): boolean {
  return typeof value === 'string' && parseTextValue(value) === value;
}

function parseTextValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return parseTextValue(JSON.parse(trimmed) as unknown);
  } catch {
    return value;
  }
}

function boxesFromDict(
  value: unknown,
  pageWidthPt: number,
  pageHeightPt: number,
  links: PptxLink[]
): PptxTextBox[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const blocks = (value as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return null;

  const boxes: PptxTextBox[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const record = block as {
      type?: number;
      bbox?: unknown;
      lines?: unknown;
    };
    if (record.type === 1) continue;
    if (blockHasSpanBoxes(record.lines)) {
      boxes.push(
        ...boxesFromSpanLines(record.lines, pageWidthPt, pageHeightPt, links)
      );
      continue;
    }
    const bbox = numberTuple(record.bbox, 4);
    if (!bbox) continue;
    const paragraphs = paragraphsFromLines(record.lines);
    if (paragraphs.length === 0) continue;
    const placed = placeBox(
      bbox[0],
      bbox[1],
      bbox[2] - bbox[0],
      bbox[3] - bbox[1],
      pageWidthPt,
      pageHeightPt
    );
    if (!placed) continue;
    boxes.push({ ...placed, paragraphs });
  }
  return boxes;
}

interface LayoutSpan {
  text: string;
  bbox: number[];
  size: number;
  color?: string;
  font?: string;
  bold: boolean;
  italic: boolean;
}

function blockHasSpanBoxes(lines: unknown): boolean {
  if (!Array.isArray(lines)) return false;
  return lines.some((line) => spansFromLine(line).length > 0);
}

function boxesFromSpanLines(
  lines: unknown,
  pageWidthPt: number,
  pageHeightPt: number,
  links: PptxLink[]
): PptxTextBox[] {
  if (!Array.isArray(lines)) return [];
  const boxes: PptxTextBox[] = [];
  for (const line of lines) {
    const spans = spansFromLine(line).sort(
      (left, right) => left.bbox[0] - right.bbox[0]
    );
    let group: LayoutSpan[] = [];
    const flush = () => {
      const box = boxFromSpans(group, pageWidthPt, pageHeightPt, links);
      if (box) boxes.push(box);
      group = [];
    };
    for (const span of spans) {
      if (group.length === 0) {
        group.push(span);
        continue;
      }
      const previous = group[group.length - 1];
      const gap = span.bbox[0] - previous.bbox[2];
      const em = Math.max(span.size, previous.size, 1);
      if (gap <= em * 0.8) group.push(span);
      else {
        flush();
        group.push(span);
      }
    }
    flush();
  }
  return boxes;
}

function spansFromLine(line: unknown): LayoutSpan[] {
  if (!line || typeof line !== 'object') return [];
  const spans = (line as { spans?: unknown }).spans;
  if (!Array.isArray(spans)) return [];
  const result: LayoutSpan[] = [];
  for (const span of spans) {
    if (!span || typeof span !== 'object') continue;
    const record = span as {
      text?: unknown;
      bbox?: unknown;
      size?: unknown;
      color?: unknown;
      font?: unknown;
      flags?: unknown;
    };
    if (typeof record.text !== 'string' || record.text.length === 0) continue;
    const bbox = numberTuple(record.bbox, 4);
    if (!bbox) continue;
    const font = typeof record.font === 'string' ? record.font : undefined;
    const flags = asNumber(record.flags) ?? 0;
    result.push({
      text: record.text,
      bbox,
      size: clampFont(asNumber(record.size) ?? 12),
      color: colorToHex(record.color),
      font: font ? pdfFontFamily(font) : undefined,
      bold: isBold(font, flags),
      italic: isItalic(font, flags),
    });
  }
  return result;
}

function boxFromSpans(
  spans: LayoutSpan[],
  pageWidthPt: number,
  pageHeightPt: number,
  links: PptxLink[]
): PptxTextBox | null {
  if (spans.length === 0 || spans.every((span) => span.text.trim() === '')) {
    return null;
  }
  const x0 = Math.min(...spans.map((span) => span.bbox[0]));
  const y0 = Math.min(...spans.map((span) => span.bbox[1]));
  const x1 = Math.max(...spans.map((span) => span.bbox[2]));
  const y1 = Math.max(...spans.map((span) => span.bbox[3]));
  const fontSize = Math.max(...spans.map((span) => span.size));
  const placed = placeBox(
    x0,
    y0,
    Math.max(x1 - x0 + 4, fontSize),
    Math.max(y1 - y0 + 2, fontSize * 1.3),
    pageWidthPt,
    pageHeightPt
  );
  if (!placed) return null;
  return { ...placed, paragraphs: [{ runs: runsFromSpans(spans, links) }] };
}

function runsFromSpans(spans: LayoutSpan[], links: PptxLink[]): PptxRun[] {
  const runs: PptxRun[] = [];
  spans.forEach((span, index) => {
    let text = span.text;
    if (index > 0) {
      const previous = spans[index - 1];
      const gap = span.bbox[0] - previous.bbox[2];
      const em = Math.max(span.size, previous.size, 1);
      const needsSpace =
        gap > em * 0.15 && !/\s$/.test(previous.text) && !/^\s/.test(span.text);
      if (needsSpace) text = ` ${text}`;
    }
    if (text.length === 0) return;
    const run: PptxRun = { text, fontSizePt: span.size };
    if (span.color) run.color = span.color;
    if (span.font) run.font = span.font;
    if (span.bold) run.bold = true;
    if (span.italic) run.italic = true;
    const link = linkForSpan(span.bbox, links);
    if (link) run.link = link;
    runs.push(run);
  });
  return runs;
}

function linkForSpan(bbox: number[], links: PptxLink[]): string | undefined {
  const centerX = (bbox[0] + bbox[2]) / 2;
  const centerY = (bbox[1] + bbox[3]) / 2;
  return links.find(
    (link) =>
      centerX >= link.bbox[0] &&
      centerX <= link.bbox[2] &&
      centerY >= link.bbox[1] &&
      centerY <= link.bbox[3]
  )?.uri;
}

function boxesFromBlockTuples(
  value: unknown,
  pageWidthPt: number,
  pageHeightPt: number
): PptxTextBox[] | null {
  if (!Array.isArray(value)) return null;
  const boxes: PptxTextBox[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 5) continue;
    const x0 = asNumber(entry[0]);
    const y0 = asNumber(entry[1]);
    const x1 = asNumber(entry[2]);
    const y1 = asNumber(entry[3]);
    const text = entry[4];
    const blockType = entry.length > 6 ? entry[6] : 0;
    if (
      x0 === undefined ||
      y0 === undefined ||
      x1 === undefined ||
      y1 === undefined ||
      typeof text !== 'string' ||
      blockType === 1
    ) {
      continue;
    }
    const paragraphs = paragraphsFromPlain(
      text,
      Math.min(18, Math.max(8, (y1 - y0) * 0.6))
    );
    if (paragraphs.length === 0) continue;
    const placed = placeBox(
      x0,
      y0,
      x1 - x0,
      y1 - y0,
      pageWidthPt,
      pageHeightPt
    );
    if (!placed) continue;
    boxes.push({ ...placed, paragraphs });
  }
  return boxes;
}

function boxesFromPlainText(
  text: string,
  pageWidthPt: number,
  pageHeightPt: number
): PptxTextBox[] {
  const paragraphs = paragraphsFromPlain(text, TEXT_FRAME_FONT_PT);
  if (paragraphs.length === 0) return [];
  const placed = placeBox(
    TEXT_FRAME_MARGIN_PT,
    TEXT_FRAME_MARGIN_PT,
    pageWidthPt - TEXT_FRAME_MARGIN_PT * 2,
    pageHeightPt - TEXT_FRAME_MARGIN_PT * 2,
    pageWidthPt,
    pageHeightPt
  );
  if (!placed) return [];
  return [{ ...placed, paragraphs }];
}

function paragraphsFromLines(lines: unknown): PptxParagraph[] {
  if (!Array.isArray(lines)) return [];
  const paragraphs: PptxParagraph[] = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const spans = (line as { spans?: unknown }).spans;
    if (!Array.isArray(spans)) continue;
    const runs: PptxRun[] = [];
    for (const span of spans) {
      if (!span || typeof span !== 'object') continue;
      const record = span as {
        text?: unknown;
        size?: unknown;
        color?: unknown;
        font?: unknown;
        flags?: unknown;
      };
      if (typeof record.text !== 'string' || record.text.length === 0) continue;
      const font = typeof record.font === 'string' ? record.font : undefined;
      const flags = asNumber(record.flags) ?? 0;
      const run: PptxRun = {
        text: record.text,
        fontSizePt: clampFont(asNumber(record.size) ?? 12),
        color: colorToHex(record.color),
      };
      if (font) run.font = pdfFontFamily(font);
      if (isBold(font, flags)) run.bold = true;
      if (isItalic(font, flags)) run.italic = true;
      runs.push(run);
    }
    if (runs.length > 0) paragraphs.push({ runs });
  }
  return paragraphs;
}

function paragraphsFromPlain(
  text: string,
  fontSizePt: number
): PptxParagraph[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  return lines
    .filter((line) => line.length > 0)
    .map((line) => ({
      runs: [{ text: line, fontSizePt: clampFont(fontSizePt) }],
    }));
}

function pageSize(
  page: PyMuPdfSlidePage,
  textValue: unknown
): { width: number; height: number } {
  const fromPage = {
    width: finitePositive(page.width),
    height: finitePositive(page.height),
  };
  const rectWidth = page.rect
    ? finitePositive(page.rect.x1 - page.rect.x0)
    : undefined;
  const rectHeight = page.rect
    ? finitePositive(page.rect.y1 - page.rect.y0)
    : undefined;
  const fromText = sizeFromText(textValue);
  return {
    width:
      fromPage.width ?? rectWidth ?? fromText.width ?? DEFAULT_PAGE_WIDTH_PT,
    height:
      fromPage.height ??
      rectHeight ??
      fromText.height ??
      DEFAULT_PAGE_HEIGHT_PT,
  };
}

function sizeFromText(value: unknown): { width?: number; height?: number } {
  const parsed = parseTextValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as { width?: unknown; height?: unknown };
  return {
    width: finitePositive(asNumber(record.width)),
    height: finitePositive(asNumber(record.height)),
  };
}

async function renderPagePicture(
  page: PyMuPdfSlidePage
): Promise<PptxPicture | undefined> {
  try {
    if (typeof page.toPixmap === 'function') {
      const blob = page.toPixmap({ dpi: FALLBACK_RENDER_DPI }).toBlob('png');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length > 0) return { bytes, ext: 'png' };
    }
  } catch {
    // The CDN wrapper exposes toImage instead of toPixmap.
  }

  try {
    if (typeof page.toImage === 'function') {
      const rendered = await page.toImage({ dpi: FALLBACK_RENDER_DPI });
      const bytes =
        rendered instanceof Uint8Array ? rendered : new Uint8Array(rendered);
      if (bytes.length > 0) return { bytes, ext: 'png' };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

interface StoredPicture {
  id: string;
  name: string;
  bytes: Uint8Array;
  ext: 'png' | 'jpeg' | 'gif';
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  flipH?: boolean;
  flipV?: boolean;
}

interface StoredLink {
  id: string;
  uri: string;
}

interface SlideAssets {
  pictures: StoredPicture[];
  links: StoredLink[];
}

function slidePictureList(slide: PptxSlide): PptxPicture[] {
  const positioned = (slide.pictures ?? []).filter(
    (picture) => picture.bytes.length > 0
  );
  if (positioned.length > 0) return positioned;
  if (slide.picture && slide.picture.bytes.length > 0) return [slide.picture];
  return [];
}

function collectSlideAssets(slides: PptxSlide[]): SlideAssets[] {
  let imageCount = 0;
  return slides.map((slide) => {
    const pictures = slidePictureList(slide).map((picture) => {
      imageCount += 1;
      const ext = normalizeExt(picture.ext) ?? 'png';
      return {
        id: '',
        name: `image${imageCount}.${ext}`,
        bytes: picture.bytes,
        ext,
        x: picture.x ?? 0,
        y: picture.y ?? 0,
        width:
          picture.width !== undefined && picture.width > 0
            ? picture.width
            : slide.widthPt,
        height:
          picture.height !== undefined && picture.height > 0
            ? picture.height
            : slide.heightPt,
        rotationDeg: picture.rotationDeg,
        flipH: picture.flipH,
        flipV: picture.flipV,
      };
    });
    const uris: string[] = [];
    for (const box of slide.textBoxes) {
      for (const paragraph of box.paragraphs) {
        for (const run of paragraph.runs) {
          if (run.link && !uris.includes(run.link)) uris.push(run.link);
        }
      }
    }
    let relationship = 2;
    for (const picture of pictures) {
      picture.id = `rId${relationship}`;
      relationship += 1;
    }
    const links = uris.map((uri) => {
      const link = { id: `rId${relationship}`, uri };
      relationship += 1;
      return link;
    });
    return { pictures, links };
  });
}

function contentTypesXml(slideCount: number, assets: SlideAssets[]): string {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) =>
    override(
      `/ppt/slides/slide${index + 1}.xml`,
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
    )
  ).join('');
  const extensions = new Set<string>(['png', 'jpeg']);
  for (const asset of assets) {
    for (const picture of asset.pictures) extensions.add(picture.ext);
  }
  const defaults = [...extensions]
    .sort()
    .map(
      (extension) =>
        `<Default Extension="${extension}" ContentType="${imageContentType(extension)}"/>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${defaults}
  ${override('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')}
  ${override('/ppt/slideMasters/slideMaster1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml')}
  ${override('/ppt/slideLayouts/slideLayout1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml')}
  ${slideOverrides}
  ${override('/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml')}
  ${override('/ppt/presProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml')}
  ${override('/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml')}
  ${override('/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml')}
</Types>`;
}

function imageContentType(extension: string): string {
  if (extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  return 'image/png';
}

function override(partName: string, contentType: string): string {
  return `<Override PartName="${partName}" ContentType="${contentType}"/>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function corePropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Presentation</dc:title>
  <dc:creator>Shift PDF</dc:creator>
  <cp:lastModifiedBy>Shift PDF</cp:lastModifiedBy>
</cp:coreProperties>`;
}

function appPropsXml(slideCount: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Shift PDF</Application>
  <PresentationFormat>On-screen Show</PresentationFormat>
  <Slides>${slideCount}</Slides>
</Properties>`;
}

function presentationXml(
  slides: PptxSlide[],
  widthPt: number,
  heightPt: number
): string {
  const slideIds = slides
    .map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>${slideIds}</p:sldIdLst>
  <p:sldSz cx="${emu(widthPt)}" cy="${emu(heightPt)}" type="custom"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRelsXml(slideCount: number): string {
  const slideRels = Array.from({ length: slideCount }, (_, index) =>
    relationship(
      `rId${index + 2}`,
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      `slides/slide${index + 1}.xml`
    )
  ).join('');
  const propsId = `rId${slideCount + 2}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationship('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', 'slideMasters/slideMaster1.xml')}
  ${slideRels}
  ${relationship(propsId, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps', 'presProps.xml')}
</Relationships>`;
}

function relationship(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
}

function presentationPropsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
}

function slideMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

function slideMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationship('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml')}
  ${relationship('rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', '../theme/theme1.xml')}
</Relationships>`;
}

function slideLayoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

function slideLayoutRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationship('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', '../slideMasters/slideMaster1.xml')}
</Relationships>`;
}

function slideXml(slide: PptxSlide, assets: SlideAssets): string {
  const shapes: string[] = [];
  const linkIds = new Map(assets.links.map((link) => [link.uri, link.id]));
  let nextId = 2;
  for (const picture of assets.pictures) {
    shapes.push(pictureXml(picture, nextId));
    nextId += 1;
  }
  for (const box of slide.textBoxes) {
    shapes.push(textBoxXml(box, nextId, linkIds));
    nextId += 1;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      ${shapes.join('')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function slideRelsXml(assets: SlideAssets): string {
  const imageRels = assets.pictures
    .map((picture) =>
      relationship(
        picture.id,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        `../media/${picture.name}`
      )
    )
    .join('');
  const linkRels = assets.links
    .map(
      (link) =>
        `<Relationship Id="${link.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(link.uri)}" TargetMode="External"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationship('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml')}
  ${imageRels}
  ${linkRels}
</Relationships>`;
}

function pictureXfrm(picture: StoredPicture): string {
  const attrs: string[] = [];
  if (picture.flipH) attrs.push('flipH="1"');
  if (picture.flipV) attrs.push('flipV="1"');
  if (picture.rotationDeg) {
    attrs.push(`rot="${Math.round(picture.rotationDeg * 60000)}"`);
  }
  const suffix = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  return `<a:xfrm${suffix}><a:off x="${emu(picture.x)}" y="${emu(picture.y)}"/><a:ext cx="${emu(picture.width)}" cy="${emu(picture.height)}"/></a:xfrm>`;
}

function pictureXml(picture: StoredPicture, shapeId: number): string {
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${shapeId}" name="Image ${shapeId}"/>
      <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="${picture.id}" cstate="print"/>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      ${pictureXfrm(picture)}
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:pic>`;
}

function textBoxXml(
  box: PptxTextBox,
  id: number,
  linkIds: Map<string, string>
): string {
  const paragraphs = box.paragraphs
    .map((paragraph) => {
      const runs = paragraph.runs
        .map((run) => {
          const color = run.color ?? '000000';
          const font = escapeXml(run.font || 'Calibri');
          const bold = run.bold ? ' b="1"' : '';
          const italic = run.italic ? ' i="1"' : '';
          const linkId = run.link ? linkIds.get(run.link) : undefined;
          const link = linkId ? `<a:hlinkClick r:id="${linkId}"/>` : '';
          return `<a:r><a:rPr lang="en-US" sz="${Math.round(clampFont(run.fontSizePt) * 100)}" dirty="0"${bold}${italic}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/><a:cs typeface="${font}"/>${link}</a:rPr><a:t xml:space="preserve">${escapeXml(run.text)}</a:t></a:r>`;
        })
        .join('');
      return `<a:p>${runs}</a:p>`;
    })
    .join('');
  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="Text ${id}"/>
      <p:cNvSpPr txBox="1"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.width)}" cy="${emu(box.height)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:spAutoFit/></a:bodyPr>
      <a:lstStyle/>
      ${paragraphs}
    </p:txBody>
  </p:sp>`;
}

function themeXml(): string {
  const scheme = [
    ['dk1', '000000'],
    ['lt1', 'FFFFFF'],
    ['dk2', '1F4E79'],
    ['lt2', 'E7E6E6'],
    ['accent1', '5B9BD5'],
    ['accent2', 'ED7D31'],
    ['accent3', 'A5A5A5'],
    ['accent4', 'FFC000'],
    ['accent5', '4472C4'],
    ['accent6', '70AD47'],
    ['hlink', '0563C1'],
    ['folHlink', '954F72'],
  ]
    .map(([name, hex]) => `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`)
    .join('');
  const fill = (hex: string) =>
    `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
  const line = `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Shift">
  <a:themeElements>
    <a:clrScheme name="Shift">${scheme}</a:clrScheme>
    <a:fontScheme name="Shift">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Shift">
      <a:fillStyleLst>${fill('FFFFFF')}${fill('000000')}${fill('5B9BD5')}</a:fillStyleLst>
      <a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>
      <a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst>
      <a:bgFillStyleLst>${fill('FFFFFF')}${fill('E7E6E6')}${fill('5B9BD5')}</a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

function placeBox(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidthPt: number,
  pageHeightPt: number
): Pick<PptxTextBox, 'x' | 'y' | 'width' | 'height'> | null {
  if (
    ![x, y, width, height, pageWidthPt, pageHeightPt].every(Number.isFinite)
  ) {
    return null;
  }
  if (width < 1 || height < 1) return null;
  // Header runs in printed mail sit a few points above the page.
  if (x >= pageWidthPt || y >= pageHeightPt) return null;
  if (x + width <= -72 || y + height <= -72) return null;
  return { x, y, width, height };
}

function emu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

function clampFont(size: number): number {
  if (!Number.isFinite(size)) return 12;
  return Math.min(400, Math.max(1, size));
}

function colorToHex(color: unknown): string | undefined {
  const value = asNumber(color);
  if (value === undefined) return undefined;
  return (value >>> 0).toString(16).padStart(6, '0').slice(-6).toUpperCase();
}

function numberTuple(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length < length) return null;
  const numbers = value.slice(0, length).map(asNumber);
  if (numbers.some((entry) => entry === undefined)) return null;
  return numbers as number[];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function finitePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizeExt(ext: string): 'png' | 'jpeg' | 'gif' | null {
  const normalized = ext.toLowerCase().replace(/^\./, '');
  if (normalized === 'jpg' || normalized === 'jpeg') return 'jpeg';
  if (normalized === 'png') return 'png';
  if (normalized === 'gif') return 'gif';
  return null;
}

function decodeBase64(data: string): Uint8Array | null {
  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function pdfFontFamily(raw: string): string {
  const stripped = raw.replace(/^[A-Z]{6}\+/, '');
  const withoutStyle = stripped
    .replace(
      /[-,]?(BoldItalic|Bold|Italic|Oblique|Regular|Roman|PSMT|BoldMT|ItalicMT|MT)$/i,
      ''
    )
    .replace(/[-,]/g, ' ');
  const spaced = withoutStyle
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  const compact = spaced.replace(/\s+/g, '').toLowerCase();
  if (compact.includes('times')) return 'Times New Roman';
  if (compact.includes('helvetica') || compact.includes('arial'))
    return 'Arial';
  if (compact.includes('courier')) return 'Courier New';
  if (compact.includes('calibri')) return 'Calibri';
  if (compact.includes('verdana')) return 'Verdana';
  if (compact.includes('georgia')) return 'Georgia';
  if (compact.includes('trebuchet')) return 'Trebuchet MS';
  if (compact.includes('cambria')) return 'Cambria';
  return spaced || 'Calibri';
}

function isBold(font: string | undefined, flags: number): boolean {
  return (flags & 16) !== 0 || /bold/i.test(font ?? '');
}

function isItalic(font: string | undefined, flags: number): boolean {
  return (flags & 2) !== 0 || /italic|oblique/i.test(font ?? '');
}

function escapeXml(value: string): string {
  let cleaned = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isDisallowedControl =
      code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
    if (!isDisallowedControl) cleaned += char;
  }
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
