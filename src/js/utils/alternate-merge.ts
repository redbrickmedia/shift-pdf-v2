import { WasmProvider } from './wasm-provider';
import { formatCpdfWorkerError } from './cpdf-helper';
import type { InterleaveFile } from '@/types';

export type { InterleaveFile } from '@/types';

export interface InterleaveOptions {
  retainPageLabels?: boolean;
  reverseFlags?: boolean[];
}

export interface InterleaveParams extends InterleaveOptions {
  files: InterleaveFile[];
}

export async function interleavePdfs(
  filesOrParams: InterleaveFile[] | InterleaveParams,
  options?: InterleaveOptions
): Promise<Uint8Array> {
  const files = Array.isArray(filesOrParams)
    ? filesOrParams
    : filesOrParams.files;
  const resolvedOptions: InterleaveOptions | undefined = Array.isArray(
    filesOrParams
  )
    ? options
    : filesOrParams;

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
        reverseFlags: resolvedOptions?.reverseFlags,
        cpdfUrl: cpdfBaseUrl + 'coherentpdf.browser.min.js',
        retainPageLabels: resolvedOptions?.retainPageLabels === true,
      },
      files.map((f) => f.data)
    );
  });
}
