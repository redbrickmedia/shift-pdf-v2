import { ClassicPreset } from 'rete';
import { BaseWorkflowNode } from './base-node';
import { pdfSocket } from '../sockets';
import type { SocketData } from '../types';
import { requirePdfInput, extractAllPdfs } from '../types';
import { downloadFile } from '../../utils/helpers.js';
import { loadPyMuPDF } from '../../utils/pymupdf-loader.js';
import { pdfToPptx } from '../../utils/pdf-to-pptx.js';
import {
  DEFAULT_CONVERSION_LIMITS,
  runWithTimeout,
  validateInputFile,
  validateOutputBlob,
} from '../../utils/conversion-guard.js';

export class PdfToPptxNode extends BaseWorkflowNode {
  readonly category = 'Output' as const;
  readonly icon = 'ph-microsoft-powerpoint-logo';
  readonly description = 'Convert PDF to PowerPoint slides';

  constructor() {
    super('PDF to PowerPoint');
    this.addInput('pdf', new ClassicPreset.Input(pdfSocket, 'PDF'));
  }

  async data(
    inputs: Record<string, SocketData[]>
  ): Promise<Record<string, SocketData>> {
    const pdfInputs = requirePdfInput(inputs, 'PDF to PowerPoint');
    const allPdfs = extractAllPdfs(pdfInputs);
    await runWithTimeout(
      loadPyMuPDF(),
      DEFAULT_CONVERSION_LIMITS.initTimeoutMs,
      'PDF to PowerPoint engine load'
    );

    if (allPdfs.length === 1) {
      const blob = new Blob([new Uint8Array(allPdfs[0].bytes)], {
        type: 'application/pdf',
      });
      validateInputFile(
        new File([blob], allPdfs[0].filename, { type: 'application/pdf' })
      );
      const pptxBlob = await runWithTimeout(
        pdfToPptx(blob),
        DEFAULT_CONVERSION_LIMITS.conversionTimeoutMs,
        'PDF to PowerPoint conversion'
      );
      validateOutputBlob(pptxBlob, blob.size);
      const name = allPdfs[0].filename.replace(/\.pdf$/i, '') + '.pptx';
      downloadFile(pptxBlob, name);
    } else {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const pdf of allPdfs) {
        const blob = new Blob([new Uint8Array(pdf.bytes)], {
          type: 'application/pdf',
        });
        validateInputFile(
          new File([blob], pdf.filename, { type: 'application/pdf' })
        );
        const pptxBlob = await runWithTimeout(
          pdfToPptx(blob),
          DEFAULT_CONVERSION_LIMITS.conversionTimeoutMs,
          'PDF to PowerPoint conversion'
        );
        validateOutputBlob(pptxBlob, blob.size);
        const name = pdf.filename.replace(/\.pdf$/i, '') + '.pptx';
        const arrayBuffer = await pptxBlob.arrayBuffer();
        zip.file(name, arrayBuffer);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'pptx_files.zip');
    }

    return {};
  }
}
