import { describe, expect, it } from 'vitest';
import {
  isDuplicateMergeFile,
  mergeFileIdentityKey,
  mergeFilesMatch,
} from '../js/logic/merge-file-identity';

describe('merge file identity', () => {
  it('matches files by library id when both ids are present', () => {
    expect(
      mergeFilesMatch(
        { name: 'a.pdf', size: 10, libraryId: 'lib-1' },
        { name: 'b.pdf', size: 20, libraryId: 'lib-1' }
      )
    ).toBe(true);
  });

  it('falls back to name and size when library ids are missing', () => {
    expect(
      mergeFilesMatch(
        { name: 'briefing.pdf', size: 42 },
        { name: 'briefing.pdf', size: 42 }
      )
    ).toBe(true);
    expect(
      mergeFilesMatch(
        { name: 'briefing.pdf', size: 42 },
        { name: 'briefing.pdf', size: 43 }
      )
    ).toBe(false);
  });

  it('creates stable keys for deduplication', () => {
    expect(
      mergeFileIdentityKey({ name: 'a.pdf', size: 1, libraryId: 'x' })
    ).toBe('id:x');
    expect(mergeFileIdentityKey({ name: 'a.pdf', size: 1 })).toBe(
      'file:a.pdf:1'
    );
  });

  it('detects duplicates in a merge list', () => {
    const existing = [{ name: 'one.pdf', size: 10, libraryId: 'first' }];
    expect(
      isDuplicateMergeFile(existing, {
        name: 'one.pdf',
        size: 10,
        libraryId: 'first',
      })
    ).toBe(true);
    expect(isDuplicateMergeFile(existing, { name: 'one.pdf', size: 10 })).toBe(
      true
    );
    expect(isDuplicateMergeFile(existing, { name: 'two.pdf', size: 10 })).toBe(
      false
    );
  });
});
