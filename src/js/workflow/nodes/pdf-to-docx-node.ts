import { ClassicPreset } from 'rete';
import { BaseWorkflowNode } from './base-node';
import { pdfSocket } from '../sockets';
import type { SocketData } from '../types';
import { requirePdfInput, extractAllPdfs } from '../types';
import { downloadFile } from '../../utils/helpers.js';
import { loadPyMuPDF } from '../../utils/pymupdf-loader.js';
import {
  DEFAULT_CONVERSION_LIMITS,
  runWithTimeout,
  validateInputFile,
  validateOutputBlob,
} from '../../utils/conversion-guard.js';

export class PdfToDocxNode extends BaseWorkflowNode {
  readonly category = 'Output' as const;
  readonly icon = 'ph-microsoft-word-logo';
  readonly description = 'Convert PDF to Word document';

  constructor() {
    super('PDF to Word');
    this.addInput('pdf', new ClassicPreset.Input(pdfSocket, 'PDF'));
  }

  async data(
    inputs: Record<string, SocketData[]>
  ): Promise<Record<string, SocketData>> {
    const pdfInputs = requirePdfInput(inputs, 'PDF to Word');
    const allPdfs = extractAllPdfs(pdfInputs);
    const pymupdf = await runWithTimeout(
      loadPyMuPDF(),
      DEFAULT_CONVERSION_LIMITS.initTimeoutMs,
      'PDF to Word engine load'
    );

    if (allPdfs.length === 1) {
      const blob = new Blob([new Uint8Array(allPdfs[0].bytes)], {
        type: 'application/pdf',
      });
      validateInputFile(
        new File([blob], allPdfs[0].filename, { type: 'application/pdf' })
      );
      const docxBlob = await runWithTimeout(
        pymupdf.pdfToDocx(blob),
        DEFAULT_CONVERSION_LIMITS.conversionTimeoutMs,
        'PDF to Word conversion'
      );
      validateOutputBlob(docxBlob, blob.size);
      const name = allPdfs[0].filename.replace(/\.pdf$/i, '') + '.docx';
      downloadFile(docxBlob, name);
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
        const docxBlob = await runWithTimeout(
          pymupdf.pdfToDocx(blob),
          DEFAULT_CONVERSION_LIMITS.conversionTimeoutMs,
          'PDF to Word conversion'
        );
        validateOutputBlob(docxBlob, blob.size);
        const name = pdf.filename.replace(/\.pdf$/i, '') + '.docx';
        const arrayBuffer = await docxBlob.arrayBuffer();
        zip.file(name, arrayBuffer);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadFile(zipBlob, 'docx_files.zip');
    }

    return {};
  }
}
