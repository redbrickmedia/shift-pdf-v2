import { describe, expect, it } from 'vitest';
import { validateMergePageRange } from '../js/utils/merge-pdf-validation';

describe('validateMergePageRange', () => {
  it('treats an empty range as all pages', () => {
    expect(validateMergePageRange('  ', 3)).toEqual({
      valid: true,
      normalized: '',
      pages: [0, 1, 2],
    });
  });

  it('accepts pages and ascending ranges within bounds', () => {
    expect(validateMergePageRange('1-3, 5', 5)).toEqual({
      valid: true,
      normalized: '1-3,5',
      pages: [0, 1, 2, 4],
    });
  });

  it('returns a canonical range for worker input', () => {
    expect(validateMergePageRange(' 01 - 03, 005 ', 5)).toEqual({
      valid: true,
      normalized: '1-3,5',
      pages: [0, 1, 2, 4],
    });
  });

  it.each(['1,,3', 'abc', '1-', '2-3-4'])(
    'rejects malformed range %s',
    (range) => {
      expect(validateMergePageRange(range, 5).valid).toBe(false);
    }
  );

  it('rejects descending ranges', () => {
    expect(validateMergePageRange('4-2', 5)).toEqual({
      valid: false,
      error: '“4-2” is a descending page range.',
    });
  });

  it.each(['0', '6', '3-8'])('rejects out-of-bounds range %s', (range) => {
    expect(validateMergePageRange(range, 5).valid).toBe(false);
  });
});
