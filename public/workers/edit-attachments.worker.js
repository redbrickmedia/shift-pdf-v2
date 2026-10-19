let cpdfLoaded = false;

function loadCpdf(cpdfUrl) {
  if (cpdfLoaded) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (typeof coherentpdf !== 'undefined') {
      cpdfLoaded = true;
      resolve();
      return;
    }

    try {
      self.importScripts(cpdfUrl);
      cpdfLoaded = true;
      resolve();
    } catch (error) {
      reject(new Error('Failed to load CoherentPDF: ' + error.message));
    }
  });
}

function parsePageRange(rangeString, totalPages) {
  const pages = new Set();
  const parts = String(rangeString || '')
    .split(',')
    .map((s) => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((s) => parseInt(s.trim(), 10));
      if (isNaN(start) || isNaN(end)) continue;
      for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
        pages.add(i);
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        pages.add(pageNum);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

function getAttachmentsFromPDFInWorker(fileBuffer, fileName, fileIndex) {
  try {
    const uint8Array = new Uint8Array(fileBuffer);

    let pdf;
    try {
      pdf = coherentpdf.fromMemory(uint8Array, '');
    } catch (error) {
      self.postMessage({
        status: 'error',
        message: `Failed to load PDF: ${fileName}. Error: ${error.message || error}`,
      });
      return;
    }

    const totalPages =
      typeof coherentpdf.pages === 'function' ? coherentpdf.pages(pdf) : 0;
    coherentpdf.startGetAttachments(pdf);
    const attachmentCount = coherentpdf.numberGetAttachments();

    if (attachmentCount === 0) {
      self.postMessage({
        status: 'success',
        attachments: [],
        fileName: fileName,
        fileIndex: fileIndex ?? 0,
        totalPages,
      });
      coherentpdf.endGetAttachments();
      coherentpdf.deletePdf(pdf);
      return;
    }

    const attachments = [];
    for (let i = 0; i < attachmentCount; i++) {
      try {
        const name = coherentpdf.getAttachmentName(i);
        const page = coherentpdf.getAttachmentPage(i);
        const attachmentData = coherentpdf.getAttachmentData(i);

        const dataArray = new Uint8Array(attachmentData);
        const buffer = dataArray.buffer.slice(
          dataArray.byteOffset,
          dataArray.byteOffset + dataArray.byteLength
        );

        attachments.push({
          index: i,
          fileIndex: fileIndex ?? 0,
          fileName: fileName,
          name: String(name),
          page: Number(page),
          data: buffer,
        });
      } catch (error) {
        console.warn(`Failed to get attachment ${i} from ${fileName}:`, error);
      }
    }

    coherentpdf.endGetAttachments();
    coherentpdf.deletePdf(pdf);

    const response = {
      status: 'success',
      attachments: attachments,
      fileName: fileName,
      fileIndex: fileIndex ?? 0,
      totalPages,
    };

    const transferBuffers = attachments.map((att) => att.data);
    self.postMessage(response, transferBuffers);
  } catch (error) {
    self.postMessage({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error occurred during attachment listing.',
    });
  }
}

function editAttachmentsInPDFInWorker(
  fileBuffer,
  fileName,
  attachmentsToRemove,
  attachmentBuffers,
  attachmentNames,
  attachmentLevel,
  pageRange
) {
  try {
    const uint8Array = new Uint8Array(fileBuffer);

    let pdf;
    try {
      pdf = coherentpdf.fromMemory(uint8Array, '');
    } catch (error) {
      self.postMessage({
        status: 'error',
        message: `Failed to load PDF: ${fileName}. Error: ${error.message || error}`,
      });
      return;
    }

    if (attachmentsToRemove && attachmentsToRemove.length > 0) {
      coherentpdf.startGetAttachments(pdf);
      const attachmentCount = coherentpdf.numberGetAttachments();
      const attachmentsToKeep = [];

      for (let i = 0; i < attachmentCount; i++) {
        if (!attachmentsToRemove.includes(i)) {
          const name = coherentpdf.getAttachmentName(i);
          const page = coherentpdf.getAttachmentPage(i);
          const data = coherentpdf.getAttachmentData(i);

          const dataCopy = new Uint8Array(data.length);
          dataCopy.set(new Uint8Array(data));

          attachmentsToKeep.push({
            name: String(name),
            page: Number(page),
            data: dataCopy,
          });
        }
      }

      coherentpdf.endGetAttachments();

      coherentpdf.removeAttachedFiles(pdf);

      for (const attachment of attachmentsToKeep) {
        if (attachment.page === 0) {
          coherentpdf.attachFileFromMemory(
            attachment.data,
            attachment.name,
            pdf
          );
        } else {
          coherentpdf.attachFileToPageFromMemory(
            attachment.data,
            attachment.name,
            pdf,
            attachment.page
          );
        }
      }
    }

    if (attachmentBuffers && attachmentBuffers.length > 0) {
      const totalPages = coherentpdf.pages(pdf);
      const level = attachmentLevel || 'document';
      let targetPages = [];
      if (level === 'page') {
        targetPages = parsePageRange(pageRange || '', totalPages);
        if (targetPages.length === 0) {
          coherentpdf.deletePdf(pdf);
          self.postMessage({
            status: 'error',
            message: 'Invalid page range specified.',
          });
          return;
        }
      }

      for (let i = 0; i < attachmentBuffers.length; i++) {
        const attachmentData = new Uint8Array(attachmentBuffers[i]);
        const attachmentName = attachmentNames[i];
        if (level === 'document') {
          coherentpdf.attachFileFromMemory(attachmentData, attachmentName, pdf);
        } else {
          for (const pageNum of targetPages) {
            coherentpdf.attachFileToPageFromMemory(
              attachmentData,
              attachmentName,
              pdf,
              pageNum
            );
          }
        }
      }
    }

    const modifiedBytes = coherentpdf.toMemory(pdf, false, true);
    coherentpdf.deletePdf(pdf);

    const buffer = modifiedBytes.buffer.slice(
      modifiedBytes.byteOffset,
      modifiedBytes.byteOffset + modifiedBytes.byteLength
    );

    const response = {
      status: 'success',
      modifiedPDF: buffer,
      fileName: fileName,
    };

    self.postMessage(response, [response.modifiedPDF]);
  } catch (error) {
    self.postMessage({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error occurred during attachment editing.',
    });
  }
}

function addAttachmentsToPDFInWorker(
  pdfBuffer,
  attachmentBuffers,
  attachmentNames,
  attachmentLevel,
  pageRange,
  fileName
) {
  try {
    const uint8Array = new Uint8Array(pdfBuffer);

    let pdf;
    try {
      pdf = coherentpdf.fromMemory(uint8Array, '');
    } catch (error) {
      const errorMsg = error.message || error.toString();
      self.postMessage({
        status: 'error',
        message: `Failed to load PDF: ${errorMsg}`,
      });
      return;
    }

    const totalPages = coherentpdf.pages(pdf);

    let targetPages = [];
    if (attachmentLevel === 'page') {
      if (!pageRange) {
        self.postMessage({
          status: 'error',
          message: 'Page range is required for page-level attachments.',
        });
        coherentpdf.deletePdf(pdf);
        return;
      }
      targetPages = parsePageRange(pageRange, totalPages);
      if (targetPages.length === 0) {
        self.postMessage({
          status: 'error',
          message: 'Invalid page range specified.',
        });
        coherentpdf.deletePdf(pdf);
        return;
      }
    }

    for (let i = 0; i < attachmentBuffers.length; i++) {
      try {
        const attachmentData = new Uint8Array(attachmentBuffers[i]);
        const attachmentName = attachmentNames[i];

        if (attachmentLevel === 'document') {
          coherentpdf.attachFileFromMemory(attachmentData, attachmentName, pdf);
        } else {
          for (const pageNum of targetPages) {
            coherentpdf.attachFileToPageFromMemory(
              attachmentData,
              attachmentName,
              pdf,
              pageNum
            );
          }
        }
      } catch (error) {
        console.warn(`Failed to attach file ${attachmentNames[i]}:`, error);
        self.postMessage({
          status: 'error',
          message: `Failed to attach file ${attachmentNames[i]}: ${error.message || error}`,
        });
        coherentpdf.deletePdf(pdf);
        return;
      }
    }

    const modifiedBytes = coherentpdf.toMemory(pdf, false, false);
    coherentpdf.deletePdf(pdf);

    const buffer = modifiedBytes.buffer.slice(
      modifiedBytes.byteOffset,
      modifiedBytes.byteOffset + modifiedBytes.byteLength
    );

    self.postMessage(
      {
        status: 'success',
        modifiedPDF: buffer,
        fileName: fileName,
      },
      [buffer]
    );
  } catch (error) {
    self.postMessage({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error occurred while adding attachments.',
    });
  }
}

function extractAttachmentsFromPDFsInWorker(fileBuffers, fileNames) {
  try {
    const allAttachments = [];
    const totalFiles = fileBuffers.length;

    for (let i = 0; i < totalFiles; i++) {
      const buffer = fileBuffers[i];
      const fileName = fileNames[i];
      const uint8Array = new Uint8Array(buffer);

      let pdf;
      try {
        pdf = coherentpdf.fromMemory(uint8Array, '');
      } catch (error) {
        console.warn(`Failed to load PDF: ${fileName}`, error);
        continue;
      }

      coherentpdf.startGetAttachments(pdf);
      const attachmentCount = coherentpdf.numberGetAttachments();

      if (attachmentCount === 0) {
        coherentpdf.endGetAttachments();
        coherentpdf.deletePdf(pdf);
        continue;
      }

      const baseName = fileName.replace(/\.pdf$/i, '');
      for (let j = 0; j < attachmentCount; j++) {
        try {
          const attachmentName = coherentpdf.getAttachmentName(j);
          const attachmentPage = coherentpdf.getAttachmentPage(j);
          const attachmentData = coherentpdf.getAttachmentData(j);

          let uniqueName = attachmentName;
          let counter = 1;
          while (allAttachments.some((att) => att.name === uniqueName)) {
            const nameParts = attachmentName.split('.');
            if (nameParts.length > 1) {
              const extension = nameParts.pop();
              uniqueName = `${nameParts.join('.')}_${counter}.${extension}`;
            } else {
              uniqueName = `${attachmentName}_${counter}`;
            }
            counter++;
          }

          if (attachmentPage > 0) {
            uniqueName = `${baseName}_page${attachmentPage}_${uniqueName}`;
          } else {
            uniqueName = `${baseName}_${uniqueName}`;
          }

          const dataArray = new Uint8Array(attachmentData);
          const copyBuffer = dataArray.buffer.slice(
            dataArray.byteOffset,
            dataArray.byteOffset + dataArray.byteLength
          );

          allAttachments.push({
            name: uniqueName,
            data: copyBuffer,
          });
        } catch (error) {
          console.warn(
            `Failed to extract attachment ${j} from ${fileName}:`,
            error
          );
        }
      }

      coherentpdf.endGetAttachments();
      coherentpdf.deletePdf(pdf);
    }

    if (allAttachments.length === 0) {
      self.postMessage({
        status: 'error',
        message: 'No attachments were found in the selected PDF(s).',
      });
      return;
    }

    const response = {
      status: 'success',
      attachments: [],
    };

    const transferBuffers = [];
    for (const attachment of allAttachments) {
      response.attachments.push({
        name: attachment.name,
        data: attachment.data,
      });
      transferBuffers.push(attachment.data);
    }

    self.postMessage(response, transferBuffers);
  } catch (error) {
    self.postMessage({
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error occurred during attachment extraction.',
    });
  }
}

self.onmessage = async function (e) {
  const { cpdfUrl } = e.data;

  if (!cpdfUrl) {
    self.postMessage({
      status: 'error',
      message:
        'CoherentPDF URL not provided. Please configure it in WASM Settings.',
    });
    return;
  }

  try {
    await loadCpdf(cpdfUrl);
  } catch (error) {
    self.postMessage({
      status: 'error',
      message: error.message,
    });
    return;
  }

  if (e.data.command === 'get-attachments') {
    getAttachmentsFromPDFInWorker(
      e.data.fileBuffer,
      e.data.fileName,
      e.data.fileIndex
    );
  } else if (e.data.command === 'edit-attachments') {
    editAttachmentsInPDFInWorker(
      e.data.fileBuffer,
      e.data.fileName,
      e.data.attachmentsToRemove,
      e.data.attachmentBuffers,
      e.data.attachmentNames,
      e.data.attachmentLevel,
      e.data.pageRange
    );
  } else if (e.data.command === 'add-attachments') {
    addAttachmentsToPDFInWorker(
      e.data.pdfBuffer,
      e.data.attachmentBuffers,
      e.data.attachmentNames,
      e.data.attachmentLevel || 'document',
      e.data.pageRange || '',
      e.data.fileName
    );
  } else if (e.data.command === 'extract-attachments') {
    extractAttachmentsFromPDFsInWorker(e.data.fileBuffers, e.data.fileNames);
  }
};
