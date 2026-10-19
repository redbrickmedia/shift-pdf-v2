import { WasmProvider } from './wasm-provider';
import { formatCpdfWorkerError } from './cpdf-helper';
import type { MergeFile } from '@/types';

export type { MergeFile } from '@/types';

export async function mergePdfsCpdf(
  files: MergeFile[],
  options?: { retainPageLabels?: boolean }
): Promise<Uint8Array> {
  if (files.length === 0) {
    throw new Error(
      formatCpdfWorkerError('noPdfsConnected', { node: 'Merge' })
    );
  }

  const cpdfBaseUrl = WasmProvider.getUrl('cpdf');
  if (!cpdfBaseUrl) {
    throw new Error(formatCpdfWorkerError('cpdfNotConfigured'));
  }

  const jobs = files.map((f) => ({
    fileName: f.name,
    rangeType: 'all' as const,
  }));

  return new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(
      import.meta.env.BASE_URL + 'workers/merge.worker.js'
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
          formatCpdfWorkerError('workerError', { message: err.message })
        )
      );
    };

    worker.postMessage(
      {
        command: 'merge',
        files,
        jobs,
        cpdfUrl: cpdfBaseUrl + 'coherentpdf.browser.min.js',
        retainPageLabels: options?.retainPageLabels === true,
      },
      files.map((f) => f.data)
    );
  });
}
