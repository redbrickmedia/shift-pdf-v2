import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Buttons are styled in one place: the `button` rule in shift-theme.css that
 * ports the design-system button. These guard the two ways that keeps breaking
 * — a second definition growing back somewhere else, and a token the central
 * rule reads but nothing declares.
 */
describe('central button style', () => {
  it('keeps the design-system geometry on the element rule', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(
      css.indexOf('/* ---- Buttons ----'),
      css.indexOf('/* Tailwind\u2019s `.container`')
    );

    expect(section).toContain('padding: 8px 10px !important');
    expect(section).toContain('border-radius: var(--radius-8) !important');
    expect(section).toContain(
      'background: var(--button-background) !important'
    );
    expect(section).toContain('color: var(--button-text) !important');
    expect(section).toContain('font-size: var(--text-xs) !important');
    expect(section).toContain(
      'font-weight: var(--font-weight-semibold) !important'
    );
    expect(section).toContain(
      'line-height: var(--text-xs--line-height) !important'
    );
    expect(section).toMatch(/gap:\s*10px/);
  });

  it('leaves the display property beatable by layout utilities', async () => {
    const css = await readText('src/css/shift-theme.css');
    const section = css.slice(css.indexOf('/* ---- Buttons ----'));
    const display = section.slice(0, section.indexOf('--button-background:'));

    // `hidden` and `flex-1` have to win, so the flex box lives in `:where()`.
    expect(display).toContain(':where(');
    expect(display).toContain('display: inline-flex');
    expect(display).not.toContain('display: inline-flex !important');
  });

  it('is the only place buttons are painted', async () => {
    const legacy = await readText('src/css/styles.css');
    const paints = /(background|padding|border-radius|font-weight|box-shadow)/;

    for (const [, block] of legacy.matchAll(
      /\.btn(-gradient)?[^{]*\{([^}]*)\}/g
    )) {
      expect(block ?? '', 'styles.css should not restyle buttons').not.toMatch(
        paints
      );
    }
  });

  it('declares every token the variants read', async () => {
    const css = await readText('src/css/shift-theme.css');
    const styles = await readText('src/css/styles.css');
    const declared = new Set(
      [...css.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((match) => match[1])
    );
    const tailwindTypographyTokens = new Set([
      '--text-xs',
      '--text-xs--line-height',
      '--font-weight-semibold',
    ]);
    const section = css.slice(
      css.indexOf('/* ---- Buttons ----'),
      css.indexOf('/* Tailwind\u2019s `.container`')
    );
    const referenced = [
      ...section.matchAll(
        /var\((--(?:action|text|border|radius|shift)[a-z0-9-]+)\)/g
      ),
    ].map((match) => match[1]);

    expect(referenced.length).toBeGreaterThan(0);
    expect(styles).toContain("@import 'tailwindcss'");
    expect(
      referenced.filter(
        (token) => !declared.has(token) && !tailwindTypographyTokens.has(token)
      )
    ).toEqual([]);
  });
});
