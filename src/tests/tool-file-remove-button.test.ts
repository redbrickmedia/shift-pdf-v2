import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createToolFileRemoveButton,
  toolFileRemoveLabel,
} from '../js/utils/tool-file-remove-button';

const themeRule = async (selector: string) => {
  const css = await readFile(
    resolve(process.cwd(), 'src/css/shift-theme.css'),
    'utf8'
  );
  const from = css.indexOf(`${selector} {`);
  return from === -1 ? '' : css.slice(from, css.indexOf('}', from));
};

describe('tool file remove button', () => {
  it('labels the action as Remove, not Delete', () => {
    expect(toolFileRemoveLabel()).toBe('Remove file');
    expect(toolFileRemoveLabel('report.pdf')).toBe('Remove report.pdf');
    expect(toolFileRemoveLabel('report.pdf')).not.toMatch(/delete/i);
  });

  it('uses an X icon for removing a selected file from a tool', () => {
    const button = createToolFileRemoveButton({ fileName: 'notes.pdf' });

    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Remove notes.pdf');
    expect(button.title).toBe('Remove notes.pdf');
    expect(button.querySelector('[data-lucide="x"]')).not.toBeNull();
    expect(button.querySelector('[data-lucide="trash-2"]')).toBeNull();
    expect(button.className).toContain('shift-tool-file-remove');
    expect(button.className).not.toMatch(/text-red-/);
  });

  it('reads as neutral chrome rather than a destructive action', async () => {
    const base = await themeRule('.shift-tool-file-remove');
    const hover = await themeRule('.shift-tool-file-remove:hover');

    expect(base).toContain('color: var(--text-secondary)');
    expect(hover).toContain('color: var(--text-primary)');
    expect(`${base}${hover}`).not.toMatch(/negative|#f87171|red/i);
  });

  /* The pages spell out their own `p-2` / `ml-4` on this button, so the shared
     rule must not win the box back from them. */
  it('leaves the pages own spacing utilities in charge', async () => {
    const base = await themeRule('.shift-tool-file-remove');
    const box = await themeRule(':where(.shift-tool-file-remove)');

    expect(base).not.toMatch(/padding|margin/);
    expect(box).toContain('display: inline-flex');
  });
});
