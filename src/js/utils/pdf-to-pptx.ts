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
  ext: 'png' | 'jpeg';
}

export interface PptxSlide {
  widthPt: number;
  heightPt: number;
  textBoxes: PptxTextBox[];
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
 * Locked layout from the PyMuPDF wrapper:
 * dict blocks with bounding boxes become one text box each;
 * a plain string becomes one text frame.
 */
export function textBoxesFromPageText(
  value: unknown,
  pageWidthPt: number,
  pageHeightPt: number
): PptxTextBox[] {
  const parsed = parseTextValue(value);
  const dictBoxes = boxesFromDict(parsed, pageWidthPt, pageHeightPt);
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
  const pictures = collectPictures(slides);
  const zip = new JSZip();

  zip.file('[Content_Types].xml', contentTypesXml(slides.length, pictures));
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
    const picture = pictures.get(index);
    zip.file(
      `ppt/slides/slide${slideNumber}.xml`,
      slideXml(slide, picture?.id)
    );
    zip.file(
      `ppt/slides/_rels/slide${slideNumber}.xml.rels`,
      slideRelsXml(picture)
    );
  });

  for (const picture of pictures.values()) {
    zip.file(`ppt/media/${picture.name}`, picture.bytes, { binary: true });
  }

  return zip.generateAsync({
    type: 'blob',
    mimeType: PPTX_MIME,
  });
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
  pageHeightPt: number
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
    const paragraphs = paragraphsFromPlain(text, Math.max(8, (y1 - y0) * 0.7));
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
      };
      if (typeof record.text !== 'string' || record.text.length === 0) continue;
      runs.push({
        text: record.text,
        fontSizePt: clampFont(asNumber(record.size) ?? 12),
        color: colorToHex(record.color),
      });
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
  ext: 'png' | 'jpeg';
}

function collectPictures(slides: PptxSlide[]): Map<number, StoredPicture> {
  const pictures = new Map<number, StoredPicture>();
  let count = 0;
  slides.forEach((slide, index) => {
    if (!slide.picture || slide.picture.bytes.length === 0) return;
    count += 1;
    const extension = slide.picture.ext === 'jpeg' ? 'jpeg' : 'png';
    pictures.set(index, {
      id: 'rId2',
      name: `image${count}.${extension}`,
      bytes: slide.picture.bytes,
      ext: extension,
    });
  });
  return pictures;
}

function contentTypesXml(
  slideCount: number,
  pictures: Map<number, StoredPicture>
): string {
  const slideOverrides = Array.from({ length: slideCount }, (_, index) =>
    override(
      `/ppt/slides/slide${index + 1}.xml`,
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
    )
  ).join('');
  const extensions = new Set<string>(['png', 'jpeg']);
  for (const picture of pictures.values()) extensions.add(picture.ext);
  const defaults = [...extensions]
    .sort()
    .map(
      (extension) =>
        `<Default Extension="${extension}" ContentType="${extension === 'jpeg' ? 'image/jpeg' : 'image/png'}"/>`
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

function slideXml(slide: PptxSlide, pictureId?: string): string {
  const shapes: string[] = [];
  if (slide.picture && pictureId) {
    shapes.push(
      pictureXml(
        pictureId,
        slide.textBoxes.length + 2,
        slide.widthPt,
        slide.heightPt
      )
    );
  }
  slide.textBoxes.forEach((box, index) => {
    shapes.push(textBoxXml(box, index + 2));
  });
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

function slideRelsXml(picture?: StoredPicture): string {
  const imageRel = picture
    ? relationship(
        picture.id,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        `../media/${picture.name}`
      )
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationship('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml')}
  ${imageRel}
</Relationships>`;
}

function pictureXml(
  relationshipId: string,
  shapeId: number,
  widthPt: number,
  heightPt: number
): string {
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${shapeId}" name="Page"/>
      <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="${relationshipId}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(widthPt)}" cy="${emu(heightPt)}"/></a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:pic>`;
}

function textBoxXml(box: PptxTextBox, id: number): string {
  const paragraphs = box.paragraphs
    .map((paragraph) => {
      const runs = paragraph.runs
        .map((run) => {
          const color = run.color ?? '000000';
          return `<a:r><a:rPr lang="en-US" sz="${Math.round(clampFont(run.fontSizePt) * 100)}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t xml:space="preserve">${escapeXml(run.text)}</a:t></a:r>`;
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
      <a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/>
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
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const boxWidth = Math.min(width, pageWidthPt - left);
  const boxHeight = Math.min(height, pageHeightPt - top);
  if (boxWidth < 1 || boxHeight < 1) return null;
  return { x: left, y: top, width: boxWidth, height: boxHeight };
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
