import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getPdfDestinations,
  getSharedDestinations,
  getToPdfDestination,
  SINGLE_FILE_DESTINATION_IDS,
} from '../js/config/convert-destinations';

const repoRoot = path.resolve(__dirname, '../..');

function pdf(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

function pageFor(toolId: string): string | null {
  return (
    [
      path.join(repoRoot, `${toolId}.html`),
      path.join(repoRoot, 'src/pages', `${toolId}.html`),
    ].find((candidate) => existsSync(candidate)) ?? null
  );
}

describe('shared convert destinations', () => {
  it('keeps the whole grid for a batch of PDFs', () => {
    const single = getSharedDestinations([pdf('one.pdf')]);
    const batch = getSharedDestinations([pdf('one.pdf'), pdf('two.pdf')]);

    expect(single.primary.length).toBeGreaterThan(0);
    expect(batch.primary.map((entry) => entry.id)).toEqual(
      single.primary.map((entry) => entry.id)
    );
    expect(batch.secondary.map((entry) => entry.id)).toEqual(
      single.secondary.map((entry) => entry.id)
    );
  });

  it('shares one to-PDF destination across files of the same type', () => {
    const shared = getSharedDestinations([
      new File(['a'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'two.jpg', { type: 'image/jpeg' }),
    ]);

    expect(shared.primary.map((entry) => entry.id)).toEqual(['jpg-to-pdf']);
  });

  it('finds nothing in common for a mixed selection', () => {
    const shared = getSharedDestinations([
      pdf('one.pdf'),
      new File(['b'], 'two.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);

    expect(shared.primary).toEqual([]);
    expect(shared.secondary).toEqual([]);
  });

  it('has no destinations without a selection', () => {
    expect(getSharedDestinations([])).toEqual({ primary: [], secondary: [] });
  });
});

describe('destination batch capability', () => {
  // The hub disables a destination once the selection outgrows it, so the flag
  // has to match the page it links to. Anything else silently drops files: the
  // shared seed path keeps one file for a single-file input.
  it('matches the multiple attribute on every destination page', () => {
    const { primary, secondary } = getPdfDestinations();
    const mismatches: string[] = [];

    for (const destination of [...primary, ...secondary]) {
      const page = pageFor(destination.id);
      if (!page) continue;

      const markup = readFileSync(page, 'utf8');
      const input = /<input[^>]*id="file-input"[^>]*>/.exec(markup)?.[0] ?? '';
      const pageAcceptsMultiple = /\smultiple[\s/>]/.test(input);

      if (pageAcceptsMultiple !== destination.acceptsMultiple) {
        mismatches.push(
          `${destination.id}: page says ${pageAcceptsMultiple ? 'multiple' : 'single'}, config says ${destination.acceptsMultiple ? 'multiple' : 'single'}`
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('marks the known single-file destinations', () => {
    const { primary, secondary } = getPdfDestinations();
    const byId = new Map(
      [...primary, ...secondary].map((entry) => [entry.id, entry])
    );

    for (const id of SINGLE_FILE_DESTINATION_IDS) {
      expect(byId.get(id)?.acceptsMultiple ?? false).toBe(false);
    }
    expect(byId.get('pdf-to-docx')?.acceptsMultiple).toBe(true);
  });

  it('carries the capability onto to-PDF destinations', () => {
    const destination = getToPdfDestination(
      new File(['a'], 'photo.jpg', { type: 'image/jpeg' })
    );
    expect(destination?.acceptsMultiple).toBe(true);
  });
});
