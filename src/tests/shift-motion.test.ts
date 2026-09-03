import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * The app is a multi-page app, so page-to-page motion lives entirely in CSS.
 * These guard the three pieces that make it work: the cross-document opt-in,
 * the shared rail that keeps the sidebar from cross-fading with the panel, and
 * the reduced-motion escape hatch.
 */
describe('page and content motion', () => {
  it('opts into cross-document view transitions', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(css.indexOf('/* ---- Motion ----'));

    expect(section).toMatch(/@view-transition\s*\{\s*navigation:\s*auto;/);
    expect(section).toContain('::view-transition-new(root)');
    expect(section).toContain('animation: shift-fade-in 180ms ease-out both');
  });

  it('carries the sidebar across navigations instead of fading it', async () => {
    const css = await readText('src/css/shift-theme.css');
    expect(css).toMatch(
      /#shift-sidebar\s*\{\s*view-transition-name:\s*shift-sidebar;/
    );
  });

  it('animates content that mounts after first paint', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(css.indexOf('/* ---- Motion ----'));

    expect(section).toContain('@keyframes shift-rise-in');
    for (const selector of [
      '#file-display-area > *',
      '.shift-open-file-thumb',
      '.shift-my-pdfs-table tbody tr',
      '.shift-library-picker-row',
      '.shift-convert-destination',
    ]) {
      expect(section).toContain(selector);
    }
    expect(section).toContain('animation: shift-rise-in 160ms ease-out both');
  });

  it('leaves the reused sidebar thumbnails out of the mount animation', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(css.indexOf('/* ---- Motion ----'));
    const riseRule = section.slice(
      section.indexOf('.shift-enter,'),
      section.indexOf('animation: shift-rise-in')
    );

    expect(riseRule).not.toContain('.shift-open-file-item');
    expect(riseRule).not.toContain('.shift-open-file-preview');
  });

  it('turns every animation off under prefers-reduced-motion', async () => {
    const css = await readText('src/css/shift-theme.css');
    const reduced = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)')
    );

    expect(reduced).toMatch(/@view-transition\s*\{\s*navigation:\s*none;/);
    expect(reduced).toContain('animation: none');
  });
});
