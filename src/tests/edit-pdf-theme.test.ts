import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Edit PDF runs on EmbedPDF, a web component that renders its chrome in a
 * shadow root. Nothing in shift-theme.css reaches inside it, so the only seam
 * is the `--ep-*` input layer the component resolves its own palette from.
 * shift-theme.css sets those inputs on the host element, where the outer tree
 * outranks the component's `:host` defaults.
 *
 * The risk these cover: a package upgrade adding an input the block does not
 * map (that one token silently falls back to Tailwind slate), and a value
 * written as a hex, which would pin the chrome to one colour mode.
 */

/** The `#embed-pdf-container embedpdf-container` block, declarations only. */
async function editorTokenBlock(): Promise<string> {
  const css = await readText('src/css/shift-theme.css');
  const start = css.indexOf('#embed-pdf-container embedpdf-container {');

  expect(start).toBeGreaterThan(-1);

  return css.slice(start, css.indexOf('}', start));
}

function declarations(block: string): [string, string][] {
  return [...block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map(
    ([, name, value]) => [name, value.replace(/\s+/g, ' ').trim()]
  );
}

/** Every `--ep-*` the shipped component reads, whichever build is installed. */
async function embedPdfInputTokens(): Promise<Set<string>> {
  const dir = resolve(process.cwd(), 'node_modules/embedpdf-snippet/dist');
  const files = (await readdir(dir)).filter(
    (file) => file.endsWith('.js') && !file.startsWith('._')
  );
  const names = new Set<string>();

  for (const file of files) {
    const source = await readFile(join(dir, file), 'utf8');
    for (const [, name] of source.matchAll(/var\((--ep-[a-z0-9-]+)\)/g)) {
      names.add(name);
    }
  }

  expect(names.size).toBeGreaterThan(20);
  return names;
}

/** Public ThemeColors fields the installed build declares but never reads. */
const MAPPED_AHEAD_OF_USE = [
  '--ep-accent-primary-active',
  '--ep-interactive-focus',
  '--ep-state-info',
];

/** States the shell has no tokens for, left on the component's own colours. */
const LEFT_TO_THE_COMPONENT = [
  '--ep-state-success',
  '--ep-state-success-light',
  '--ep-state-warning',
  '--ep-state-warning-light',
];

describe('Shift theme for the Edit PDF editor', () => {
  it('maps every colour input the component reads', async () => {
    const mapped = declarations(await editorTokenBlock())
      .map(([name]) => name)
      .filter((name) => name.startsWith('--ep-'));
    const inputs = await embedPdfInputTokens();

    const expected = [
      ...[...inputs].filter((name) => !LEFT_TO_THE_COMPONENT.includes(name)),
      ...MAPPED_AHEAD_OF_USE,
    ].sort();

    // Exact, both ways: a new input in an upgraded build would otherwise fall
    // back to Tailwind slate, and a typo'd name would read as mapped here
    // while changing nothing in the editor.
    expect([...mapped].sort()).toEqual(expected);
  });

  it('maps them onto shell tokens so the chrome follows the colour mode', async () => {
    const css = await readText('src/css/shift-theme.css');

    for (const [name, value] of declarations(await editorTokenBlock())) {
      // The modal scrim is the one literal: it is a black wash over whatever
      // is behind it, matching .shift-confirm-overlay in both modes.
      if (name === '--ep-background-overlay') {
        expect(value).toBe('rgba(0, 0, 0, 0.75)');
        continue;
      }

      expect(value).toMatch(/^var\(\s*--[a-z0-9-]+\s*\)$/);

      const referenced = value.replace(/^var\(\s*|\s*\)$/g, '');
      expect(css).toMatch(new RegExp(`^\\s*${referenced}:\\s*\\S`, 'm'));
    }
  });

  it('shares one workspace colour with the PDF.js viewer', async () => {
    const shell = await readText('src/css/shift-theme.css');
    const viewer = await readText('public/pdfjs-viewer/shift-viewer-theme.css');
    const light =
      '--shift-viewer-workspace: var(--action-controls-surface-primary-hover)';
    const dark = '--shift-viewer-workspace: var(--background-bar-primary)';

    // Pages sit on this, so a mismatch reads as two different viewers.
    expect(shell).toContain(light);
    expect(shell).toContain(dark);
    expect(viewer).toContain(light);
    expect(viewer).toContain(dark);

    // The dark value has to be the one in the html.dark block, not a second
    // light-mode declaration.
    expect(shell.indexOf(dark)).toBeGreaterThan(shell.indexOf('html.dark {'));
  });
});
