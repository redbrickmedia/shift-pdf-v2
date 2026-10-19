import { WasmProvider } from './wasm-provider';
import { formatCpdfWorkerError } from './cpdf-helper';
import type { InterleaveFile } from '@/types';

export type { InterleaveFile } from '@/types';

export async function interleavePdfs(
  files: InterleaveFile[],
  options?: { retainPageLabels?: boolean }
): Promise<Uint8Array> {
  if (files.length < 2) {
    throw new Error(formatCpdfWorkerError('alternateMergeNeedsTwo'));
  }

  const cpdfBaseUrl = WasmProvider.getUrl('cpdf');
  if (!cpdfBaseUrl) {
    throw new Error(formatCpdfWorkerError('cpdfNotConfigured'));
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(
      import.meta.env.BASE_URL + 'workers/alternate-merge.worker.js'
    );

    worker.onmessage = (e: MessageEvent) => {
      worker.terminate();
      if (e.data.status === 'success') {
        resolve(new Uint8Array(e.data.pdfBytes));
      } else {
        reject(
          new Error(
            e.data.message ||
              formatCpdfWorkerError('workerError', { message: 'unknown' })
          )
        );
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(
        new Error(
          formatCpdfWorkerError('alternateMergeWorkerError', {
            message: err.message,
          })
        )
      );
    };

    worker.postMessage(
      {
        command: 'interleave',
        files,
        cpdfUrl: cpdfBaseUrl + 'coherentpdf.browser.min.js',
        retainPageLabels: options?.retainPageLabels === true,
      },
      files.map((f) => f.data)
    );
  });
}
