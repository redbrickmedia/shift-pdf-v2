---
title: PDF to PowerPoint
description: Convert PDF files to editable PowerPoint (PPTX) slides. Supports batch conversion of multiple PDFs at once.
---

# PDF to PowerPoint

Converts PDF files to editable PowerPoint (`.pptx`) presentations. Each PDF page becomes one slide. The tool uses PyMuPDF to read the page, then builds the presentation in your browser. Supports single and batch conversion.

## How It Works

1. Upload one or more PDFs by clicking the drop zone or dragging files onto it. You can add more files or remove individual ones from the list.
2. Click **Convert to PPTX** to start processing.
3. A single file downloads as `filename.pptx`. Multiple files are packaged into `converted-presentations.zip`.

## Options

This tool has no configurable options. Each PDF page becomes one slide. Text blocks keep their position when PyMuPDF can read them. A page with no text layer is placed on the slide as a picture.

## Output Format

- **Single file**: `filename.pptx`
- **Multiple files**: `converted-presentations.zip` containing one `.pptx` per input PDF.

## Use Cases

- Turning a PDF report into slides you can edit in PowerPoint or Google Slides.
- Reusing a one-page PDF handout as a slide.
- Converting a folder of PDFs into presentations in one batch.

## Tips

- Complex layouts, multi-column text, and heavy graphics may not land in the same places as the PDF. Review the slides and adjust them in your presentation app.
- Scanned PDFs have no text layer, so each page becomes a picture on a slide. Run OCR first if you need editable text.
- The whole presentation uses one slide size, taken from the largest page. Mixed page sizes stay in the top-left of that slide.

## Related Tools

- [PDF to Word](./pdf-to-docx)
- [PDF to Excel](./pdf-to-excel)
- [PowerPoint to PDF](./powerpoint-to-pdf)
- [PDF Workflow Builder](./pdf-workflow)
