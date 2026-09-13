import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Typography is owned centrally: the design-system type scale is pinned as
 * CSS tokens, Tailwind text/weight utilities resolve to those same steps, and
 * native form controls (select / input / textarea / label) share one rule that
 * ports text-field.css + Select trigger geometry.
 */
describe('central typography', () => {
  it('declares the design-system type scale on :root', async () => {
    const css = await readText('src/css/shift-theme.css');
    const root = css.slice(0, css.indexOf('/* ---- Shell layout'));

    for (const token of [
      '--text-xs: 12px',
      '--text-xs--line-height: 16px',
      '--text-sm: 14px',
      '--text-sm--line-height: 20px',
      '--text-base: 16px',
      '--text-base--line-height: 24px',
      '--text-lg: 18px',
      '--text-lg--line-height: 28px',
      '--text-xl: 24px',
      '--text-xl--line-height: 32px',
      '--font-weight-normal: 400',
      '--font-weight-medium: 500',
      '--font-weight-semibold: 600',
      '--font-weight-bold: 700',
      '--form-input-border-default:',
      '--form-input-border-focus:',
      '--form-input-surface-primary-default:',
    ]) {
      expect(root).toContain(token);
    }
  });

  it('pins the same scale for Tailwind text utilities', async () => {
    const styles = await readText('src/css/styles.css');
    const theme = styles.slice(
      styles.indexOf('@theme {'),
      styles.indexOf('@layer base')
    );

    expect(theme).toContain('--text-xs: 12px');
    expect(theme).toContain('--text-sm: 14px');
    expect(theme).toContain('--text-xl: 24px');
    expect(theme).toContain('--text-2xl: 24px');
    expect(theme).toContain('--font-weight-semibold: 600');
  });

  it('styles native form controls from one design-system rule', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(
      css.indexOf('/* ---- Form controls ----'),
      css.indexOf('/* Tool catalog search')
    );

    expect(section).toContain('font-size: var(--text-xs) !important');
    expect(section).toContain('font-size: var(--text-sm) !important');
    expect(section).toContain('min-height: 40px');
    expect(section).toContain(
      'outline: 1px solid var(--form-border) !important'
    );
    expect(section).toContain(
      'background-color: var(--form-surface) !important'
    );
    expect(section).toContain('select:not([multiple]):not([size])');
    expect(section).toContain('appearance: none');
  });

  /**
   * shift-theme.css is otherwise unlayered while Tailwind's output sits in
   * @layer base and @layer utilities, and an unlayered rule beats every
   * layered one whatever the specificity. Stating the heading defaults on bare
   * element selectors therefore outranked the utilities pages ask for:
   * `margin: 0` collapsed `mt-*`/`mb-*`, and the weight flattened `font-bold`.
   * Preflight zeroes margin and padding in @layer base already, so the reset
   * drops them entirely and keeps only the weight, from inside that layer.
   */
  it('lets headings keep their own spacing and weight utilities', async () => {
    const css = await readText('src/css/shift-theme.css');
    const start = css.indexOf('@layer base {\n  h1,');
    const reset = css.slice(start, css.indexOf('\n}', start));

    expect(start).toBeGreaterThan(-1);
    expect(reset).toContain('font-weight: var(--font-weight-normal)');
    expect(reset).not.toMatch(/\bmargin\b/);
    expect(reset).not.toMatch(/\bpadding\b/);

    // An unlayered copy anywhere else would defeat the utilities again.
    expect(css).not.toMatch(/\nh1,\n\s*h2,\n\s*h3,\n\s*h4,\n\s*h5,\n\s*h6 \{/);
  });

  it('keeps headings asking for that spacing and weight', async () => {
    // The other half of the rule above: the fix is only observable while the
    // markup still requests them, so assert the callers too.
    const hero = (await readText('about.html')).match(
      /<h1[^>]*class="([^"]+)"/
    )?.[1];
    const toolTitle = (await readText('src/pages/compress-pdf.html')).match(
      /<h1[^>]*class="([^"]+)"/
    )?.[1];

    expect(hero).toBeDefined();
    expect(hero).toContain('mt-3');
    expect(hero).toContain('mb-5');

    expect(toolTitle).toBeDefined();
    expect(toolTitle).toContain('font-bold');
    expect(toolTitle).toContain('mb-2');
  });

  it('does not leave off-scale text-[10px] utilities in the app', async () => {
    const files = [
      'src/pages/compare-pdfs.html',
      'src/js/logic/pdf-workflow-page.ts',
      'src/js/logic/form-creator.ts',
    ];

    for (const file of files) {
      const source = await readText(file);
      expect(source, file).not.toContain('text-[10px]');
    }
  });
});
