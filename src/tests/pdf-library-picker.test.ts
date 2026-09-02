import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPdfToLibrary,
  clearPdfLibrary,
} from '../js/logic/pdf-library-store';
import { openPdfLibraryPicker } from '../js/logic/pdf-library-picker';

afterEach(async () => {
  document.body.innerHTML = '';
  await clearPdfLibrary();
});

describe('pdf library picker', () => {
  it('lists saved PDFs and reports a selection', async () => {
    await addPdfToLibrary(
      new File(['one'], 'first.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['two'], 'second.pdf', { type: 'application/pdf' }),
      'upload'
    );

    const onSelect = vi.fn();
    await openPdfLibraryPicker({ onSelect });

    const rows = document.querySelectorAll('.shift-library-picker-row');
    expect(rows).toHaveLength(2);
    (rows[1] as HTMLButtonElement).click();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.[0]?.name).toBe('first.pdf');
    expect(document.getElementById('shift-pdf-library-picker')).toBeNull();
  });

  it('disables PDFs that are already in the merge list', async () => {
    const entry = await addPdfToLibrary(
      new File(['one'], 'first.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['two'], 'second.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openPdfLibraryPicker({
      exclude: [
        {
          name: entry.name,
          size: entry.size,
          libraryId: entry.id,
        },
      ],
      onSelect: vi.fn(),
    });

    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.shift-library-picker-row')
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.textContent?.includes('first.pdf'))?.disabled
    ).toBe(true);
    expect(
      rows.find((row) => row.textContent?.includes('second.pdf'))?.disabled
    ).toBe(false);
  });

  it('shows excluded PDFs as disabled rows without an empty state', async () => {
    const entry = await addPdfToLibrary(
      new File(['one'], 'only.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openPdfLibraryPicker({
      exclude: [
        {
          name: entry.name,
          size: entry.size,
          libraryId: entry.id,
        },
      ],
      onSelect: vi.fn(),
      onUpload: vi.fn(),
    });

    expect(document.querySelector('.shift-library-picker-empty')).toBeNull();
    const rows = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.shift-library-picker-row')
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.disabled).toBe(true);
    expect(
      document.querySelector('.shift-library-picker-footer')
    ).not.toBeNull();
  });

  it('offers upload from device as a secondary action', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    const onUpload = vi.fn();
    await openPdfLibraryPicker({ onSelect: vi.fn(), onUpload });

    expect(
      document.querySelector('.shift-library-picker-footer')
    ).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>('.shift-library-picker-upload')
      ?.click();

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('shift-pdf-library-picker')).toBeNull();
  });

  it('renders an empty state with heading, message, and upload action', async () => {
    const onUpload = vi.fn();
    await openPdfLibraryPicker({
      title: 'Choose a file to convert',
      emptyMessage:
        'No saved PDFs in your library yet. Upload one from your device.',
      onSelect: vi.fn(),
      onUpload,
    });

    expect(
      document.querySelector('.shift-library-picker-empty-heading')?.textContent
    ).toBe('No saved PDFs');
    expect(
      document.querySelector('.shift-library-picker-empty-message')?.textContent
    ).toBe('No saved PDFs in your library yet. Upload one from your device.');
    expect(document.querySelectorAll('.shift-library-picker-row')).toHaveLength(
      0
    );
    expect(document.querySelector('.shift-library-picker-footer')).toBeNull();

    document
      .querySelector<HTMLButtonElement>('.shift-library-picker-upload')
      ?.click();

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(document.getElementById('shift-pdf-library-picker')).toBeNull();
  });

  it('does not render the empty state when saved PDFs exist', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );
    await addPdfToLibrary(
      new File(['two'], 'another.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openPdfLibraryPicker({ onSelect: vi.fn() });

    expect(document.querySelector('.shift-library-picker-empty')).toBeNull();
    expect(document.querySelectorAll('.shift-library-picker-row')).toHaveLength(
      2
    );
  });

  it('uses merge wording for row aria-labels by default', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openPdfLibraryPicker({ onSelect: vi.fn() });

    expect(
      document
        .querySelector<HTMLButtonElement>('.shift-library-picker-row')
        ?.getAttribute('aria-label')
    ).toBe('Add saved.pdf');
  });

  it('uses caller-specific row aria-label wording', async () => {
    await addPdfToLibrary(
      new File(['one'], 'saved.pdf', { type: 'application/pdf' }),
      'upload'
    );

    await openPdfLibraryPicker({
      rowAriaLabel: (entry, disabled) =>
        disabled ? `${entry.name} already added` : `Use ${entry.name}`,
      onSelect: vi.fn(),
    });

    expect(
      document
        .querySelector<HTMLButtonElement>('.shift-library-picker-row')
        ?.getAttribute('aria-label')
    ).toBe('Use saved.pdf');
  });
});
