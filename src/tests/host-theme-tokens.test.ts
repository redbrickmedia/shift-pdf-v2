import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('Shift theme palette aliases', () => {
  it('points buttons and surfaces at palette stops in both modes', async () => {
    const css = await readText('src/css/shift-theme.css');
    const root = block(css, ':root {');
    const dark = block(css, 'html.dark {');

    expect(root).toContain('--brand-600: #2563eb;');
    expect(root).toContain('--light-100: #f3f4f6;');
    expect(root).toContain('--dark-800: #262626;');
    expect(root).toContain('--negative-600: #dc2626;');
    expect(root).toContain(
      '--action-button-surface-primary-default: var(--brand-600);'
    );
    expect(root).toContain('--background-bar-primary: var(--light-100);');
    expect(root).toContain('--text-primary: var(--light-900);');

    expect(dark).toContain(
      '--action-button-surface-primary-default: var(--brand-500);'
    );
    expect(dark).toContain('--background-bar-primary: var(--dark-700);');
    expect(dark).toContain('--background-secondary: var(--dark-800);');
    expect(dark).toContain('--text-primary: var(--dark-50);');
    expect(dark).not.toMatch(/--brand-\d+:\s*#/);
    expect(dark).not.toMatch(/--light-\d+:\s*#/);
    expect(dark).not.toMatch(/--dark-\d+:\s*#/);
    expect(dark).not.toMatch(/--negative-\d+:\s*#/);
  });

  it('remaps preset palettes the way the design system does', async () => {
    const css = await readText('src/css/shift-theme.css');
    const amber = block(css, "[data-theme='amber'] {");
    const emerald = block(css, "[data-theme='emerald'] {");
    const pink = block(css, "[data-theme='pink'] {");
    const indigo = block(css, "[data-theme='indigo'] {");

    expect(amber).toContain('--brand-600: #90491e;');
    expect(amber).toContain('--light-100: #faf1ec;');
    expect(emerald).toContain('--brand-500: #008c68;');
    expect(pink).toContain('--brand-600: #942d55;');
    expect(indigo).toContain('--dark-800:');
    expect(indigo).not.toContain('--brand-600:');
  });
});
