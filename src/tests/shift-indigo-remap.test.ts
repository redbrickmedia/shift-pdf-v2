import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Bento used indigo as brand accent ink (Custom Settings toggles, hub icons).
 * Shift remaps those utilities in shift-theme.css: pale indigo → neutral text,
 * mid/deep indigo → brand fills. Dark mode must not restore true indigo.
 */
describe('indigo accent remapped to Shift theme', () => {
  it('maps pale indigo ink to neutral action text', async () => {
    const css = await readText('src/css/shift-theme.css');
    const root = css.slice(0, css.indexOf('html.dark {'));

    expect(root).toContain(
      '--color-indigo-400: var(--action-text-neutral-default)'
    );
    expect(root).toContain(
      '--color-indigo-300: var(--action-text-neutral-hover)'
    );
    expect(root).toContain(
      '--color-indigo-600: var(--action-button-surface-primary-default)'
    );
    expect(root).not.toMatch(/--color-indigo-400:\s*#2563eb/);
    expect(root).not.toMatch(/--color-indigo-400:\s*#818cf8/);
  });

  it('does not restore Bento indigo in dark mode', async () => {
    const css = await readText('src/css/shift-theme.css');
    const dark = css.slice(css.indexOf('html.dark {'));

    expect(dark).not.toContain('--color-indigo-400: #818cf8');
    expect(dark).not.toContain('--color-indigo-300: #a5b4fc');
    expect(dark).not.toContain('--color-indigo-200: #c7d2fe');
  });

  it('paints tool-card hover as a Shift grey lift, not a brand-blue wash', async () => {
    const css = await readText('src/css/shift-theme.css');
    const hoverAt = css.indexOf('\n.tool-card:hover {');
    const iconAt = css.indexOf('\n.shift-tool-icon {', hoverAt);
    const hover = css.slice(hoverAt, iconAt);
    const icon = css.slice(iconAt, css.indexOf('.shift-tool-icon svg'));

    expect(hover).toContain(
      'background-color: var(--action-controls-surface-primary-hover)'
    );
    expect(hover).not.toContain('var(--brand-50)');
    expect(hover).toContain('border-color: var(--border-brand-primary)');
    expect(icon).toContain('color: var(--border-brand-primary)');
  });

  it('keeps Custom Settings as a disclosure toggle class, not brand fill', async () => {
    const html = await readText('src/pages/compress-pdf.html');
    const toggle = html.match(
      /id="toggle-custom-settings"[\s\S]*?class="([^"]+)"/
    )?.[1];

    expect(toggle).toBeDefined();
    expect(toggle).toContain('text-indigo-400');
    expect(toggle).toContain('hover:text-indigo-300');
    expect(toggle).not.toMatch(/bg-indigo-/);
  });
});
