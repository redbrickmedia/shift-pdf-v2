import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLOBAL_DROP_ACTIVE_CLASS,
  GLOBAL_DROP_AFFORDANCE_ID,
  initGlobalFileDrop,
  isExternalFileDrag,
  isGlobalDropExcludedTarget,
  isGlobalDropPageEligible,
  resetGlobalFileDrop,
} from '../js/logic/global-file-drop';
import { pickerAcceptsFile } from '../js/logic/workspace-files';
import { isBlankOrGenericMime, isPdfFile } from '../js/utils/pdf-file';

function pdf(name: string, type: string = 'application/pdf'): File {
  return new File(['%PDF-1.4'], name, { type });
}

function mountSingleInput(options: { multiple?: boolean } = {}) {
  document.body.className = '';
  document.body.innerHTML = `
    <aside id="shift-sidebar">Sidebar</aside>
    <main id="app">
      <div id="page-background">
        <h1>Compress PDF</h1>
        <div id="drop-zone">
          <input
            id="file-input"
            type="file"
            accept="application/pdf,.pdf"
            ${options.multiple ? 'multiple' : ''}
          />
        </div>
        <div id="signature-editor" class="hidden">
          <div id="canvas-container-sign"><iframe title="viewer"></iframe></div>
        </div>
      </div>
    </main>
  `;
  initGlobalFileDrop(document);
}

function mountCompareLikeShell() {
  document.body.innerHTML = `
    <div id="drop-zone-1">
      <input id="file-input-1" type="file" accept="application/pdf" />
    </div>
    <div id="drop-zone-2">
      <input id="file-input-2" type="file" accept="application/pdf" />
    </div>
  `;
  initGlobalFileDrop(document);
}

function fileDataTransfer(files: File[], types: string[] = ['Files']) {
  const dt = {
    types,
    files,
    dropEffect: 'none',
    items: {
      length: files.length,
      add: () => {},
    },
  };
  return dt as unknown as DataTransfer;
}

function dispatchDrag(
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  target: EventTarget,
  dataTransfer: DataTransfer
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  target.dispatchEvent(event);
  return event as DragEvent;
}

afterEach(() => {
  resetGlobalFileDrop();
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('isPdfFile helper', () => {
  it('accepts application/pdf MIME', () => {
    expect(isPdfFile(pdf('a.pdf'))).toBe(true);
  });

  it('accepts Windows blank MIME with .pdf extension', () => {
    expect(isPdfFile(pdf('report.pdf', ''))).toBe(true);
    expect(isBlankOrGenericMime('')).toBe(true);
    expect(isBlankOrGenericMime('application/octet-stream')).toBe(true);
  });

  it('accepts uppercase .PDF extension', () => {
    expect(isPdfFile(pdf('SCAN.PDF', ''))).toBe(true);
  });

  it('rejects non-PDF files', () => {
    expect(
      isPdfFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))
    ).toBe(false);
    expect(isPdfFile(new File(['x'], 'photo.png', { type: '' }))).toBe(false);
  });
});

describe('pickerAcceptsFile PDF eligibility', () => {
  it('shares the helper for blank MIME and uppercase extension', () => {
    mountSingleInput();
    const input = document.getElementById('file-input') as HTMLInputElement;
    expect(pickerAcceptsFile(input, pdf('win.pdf', ''))).toBe(true);
    expect(pickerAcceptsFile(input, pdf('SCAN.PDF', ''))).toBe(true);
    expect(
      pickerAcceptsFile(
        input,
        new File(['x'], 'notes.txt', { type: 'text/plain' })
      )
    ).toBe(false);
  });
});

describe('global file drop', () => {
  it('is eligible on ordinary single-input tool pages', () => {
    mountSingleInput();
    expect(isGlobalDropPageEligible(document)).toBe(true);
  });

  it('is not eligible on dual-slot compare pages', () => {
    mountCompareLikeShell();
    expect(isGlobalDropPageEligible(document)).toBe(false);
  });

  it('ignores non-file drags', () => {
    expect(
      isExternalFileDrag({ types: ['text/plain'] } as unknown as DataTransfer)
    ).toBe(false);
    expect(
      isExternalFileDrag({ types: ['Files'] } as unknown as DataTransfer)
    ).toBe(true);
  });

  it('treats sidebar, drop-zone, dialog, and viewer targets as excluded', () => {
    mountSingleInput();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    expect(
      isGlobalDropExcludedTarget(document.getElementById('shift-sidebar'))
    ).toBe(true);
    expect(
      isGlobalDropExcludedTarget(document.getElementById('drop-zone'))
    ).toBe(true);
    expect(isGlobalDropExcludedTarget(dialog)).toBe(true);
    expect(isGlobalDropExcludedTarget(document.querySelector('iframe'))).toBe(
      true
    );
    expect(
      isGlobalDropExcludedTarget(document.getElementById('page-background'))
    ).toBe(false);
  });

  it('clears drag UI after nested enter/leave returns to zero', () => {
    mountSingleInput();
    const page = document.getElementById('page-background')!;
    const child = document.createElement('div');
    page.appendChild(child);
    const dt = fileDataTransfer([pdf('a.pdf')]);

    dispatchDrag('dragenter', page, dt);
    expect(document.body.classList.contains(GLOBAL_DROP_ACTIVE_CLASS)).toBe(
      true
    );

    dispatchDrag('dragenter', child, dt);
    expect(document.body.classList.contains(GLOBAL_DROP_ACTIVE_CLASS)).toBe(
      true
    );

    dispatchDrag('dragleave', child, dt);
    expect(document.body.classList.contains(GLOBAL_DROP_ACTIVE_CLASS)).toBe(
      true
    );

    dispatchDrag('dragleave', page, dt);
    expect(document.body.classList.contains(GLOBAL_DROP_ACTIVE_CLASS)).toBe(
      false
    );
    expect(
      (document.getElementById(GLOBAL_DROP_AFFORDANCE_ID) as HTMLElement).hidden
    ).toBe(true);
  });

  it('does not intercept drops on the local drop-zone', () => {
    mountSingleInput();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);

    const dropZone = document.getElementById('drop-zone')!;
    const event = dispatchDrag(
      'drop',
      dropZone,
      fileDataTransfer([pdf('a.pdf')])
    );

    expect(event.defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(input.files?.length ?? 0).toBe(0);
  });

  it('dispatches change on the primary input for page-background drops', () => {
    mountSingleInput();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);

    const page = document.getElementById('page-background')!;
    const event = dispatchDrag(
      'drop',
      page,
      fileDataTransfer([pdf('win.pdf', '')])
    );

    expect(event.defaultPrevented).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe('win.pdf');
    expect(document.body.classList.contains(GLOBAL_DROP_ACTIVE_CLASS)).toBe(
      false
    );
  });

  it('keeps a single file for non-multiple inputs', () => {
    mountSingleInput({ multiple: false });
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);

    dispatchDrag(
      'drop',
      document.getElementById('page-background')!,
      fileDataTransfer([pdf('first.pdf'), pdf('second.pdf')])
    );

    expect(change).toHaveBeenCalledTimes(1);
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe('second.pdf');
  });

  it('keeps multiple files when the input allows it', () => {
    mountSingleInput({ multiple: true });
    const input = document.getElementById('file-input') as HTMLInputElement;

    dispatchDrag(
      'drop',
      document.getElementById('page-background')!,
      fileDataTransfer([pdf('first.pdf'), pdf('second.pdf')])
    );

    expect(input.files).toHaveLength(2);
  });

  it('rejects non-PDF drops on PDF-only inputs without changing the input', () => {
    mountSingleInput();
    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);

    dispatchDrag(
      'drop',
      document.getElementById('page-background')!,
      fileDataTransfer([new File(['x'], 'notes.txt', { type: 'text/plain' })])
    );

    expect(change).not.toHaveBeenCalled();
    expect(input.files?.length ?? 0).toBe(0);
  });

  it('still routes through a hidden viewer upload input', () => {
    mountSingleInput();
    const dropZone = document.getElementById('drop-zone')!;
    dropZone.hidden = true;
    dropZone.classList.add('shift-tool-viewer-suppressed');

    const input = document.getElementById('file-input') as HTMLInputElement;
    const change = vi.fn();
    input.addEventListener('change', change);

    dispatchDrag(
      'drop',
      document.getElementById('page-background')!,
      fileDataTransfer([pdf('hidden.pdf', 'application/octet-stream')])
    );

    expect(change).toHaveBeenCalledTimes(1);
    expect(input.files?.[0]?.name).toBe('hidden.pdf');
  });

  it('does not claim drops on dual-slot pages', () => {
    mountCompareLikeShell();
    const background = document.createElement('div');
    document.body.appendChild(background);
    const input1 = document.getElementById('file-input-1') as HTMLInputElement;
    const change = vi.fn();
    input1.addEventListener('change', change);

    const event = dispatchDrag(
      'drop',
      background,
      fileDataTransfer([pdf('a.pdf')])
    );

    expect(event.defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
  });
});
