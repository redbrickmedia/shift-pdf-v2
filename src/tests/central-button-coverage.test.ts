import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * Buttons are styled by one rule keyed on the element, so this reads the real
 * selectors out of shift-theme.css and runs them over every page. It fails if
 * the rule stops covering the pages' buttons, or starts covering the things it
 * is meant to leave alone (icon buttons, pills, dropdown rows, link buttons).
 */
async function buttonSelectors() {
  const css = await readText('src/css/shift-theme.css');
  const section = css.slice(css.indexOf('/* ---- Buttons ----'));

  const selectorBefore = (start: string, stop: string) => {
    const from = section.indexOf(start);
    const raw = section.slice(from, section.indexOf(stop, from));
    return raw.slice(0, raw.lastIndexOf('{')).trim();
  };

  return {
    styled: selectorBefore(
      '.shift-button,\n.btn-gradient,',
      '--button-background: var(--button-background-default)'
    ),
    primary: selectorBefore(
      '.shift-button-primary,',
      '--button-background-default: var(--action-button-surface-primary-default)'
    ),
    negative: selectorBefore(
      '.shift-button-negative,',
      '--button-background-default: var(--action-button-surface-negative-default)'
    ),
  };
}

async function pageDocuments() {
  const paths = [...globSync('*.html'), ...globSync('src/pages/*.html')];
  const parser = new DOMParser();

  return Promise.all(
    paths.map(async (path) => ({
      path,
      doc: parser.parseFromString(await readText(path), 'text/html'),
    }))
  );
}

describe('central button coverage', () => {
  it('styles the tool pages buttons from the one rule', async () => {
    const { styled } = await buttonSelectors();
    const pages = await pageDocuments();
    const unstyled: string[] = [];
    let covered = 0;

    for (const { path, doc } of pages) {
      for (const button of doc.querySelectorAll('button')) {
        if (button.matches(styled)) {
          covered += 1;
          continue;
        }
        // A page's main action must never fall back to its own utilities.
        if (button.id === 'process-btn' || button.className.includes('btn-')) {
          unstyled.push(`${path} #${button.id} ${button.className}`);
        }
      }
    }

    expect(unstyled).toEqual([]);
    expect(covered).toBeGreaterThan(400);
  });

  it('leaves menu rows, pills and icon buttons to their own components', async () => {
    const { styled } = await buttonSelectors();
    const pages = await pageDocuments();
    const captured: string[] = [];

    for (const { path, doc } of pages) {
      for (const button of doc.querySelectorAll('button')) {
        if (!button.matches(styled)) continue;
        const classes = button.className;
        if (
          /(^|\s)(text-left|rounded-full)(\s|$)/.test(classes) ||
          /compare-pill|category-filter|export-menu-item|shift-/.test(classes)
        ) {
          captured.push(`${path} ${classes}`);
        }
      }
    }

    expect(captured).toEqual([]);
  });

  it('reads the loud surfaces as primary and the alarming ones as negative', async () => {
    const { styled, primary, negative } = await buttonSelectors();
    const pages = await pageDocuments();
    const miscast: string[] = [];

    for (const { path, doc } of pages) {
      for (const button of doc.querySelectorAll('button')) {
        if (!button.matches(styled)) continue;
        const classes = button.className;
        const wantsPrimary = /(^|\s)bg-(indigo|blue|green)-/.test(classes);
        const wantsNegative = /(^|\s)bg-(red|orange)-/.test(classes);

        if (wantsPrimary && !button.matches(primary)) {
          miscast.push(`${path} should be primary: ${classes}`);
        }
        if (wantsNegative && !button.matches(negative)) {
          miscast.push(`${path} should be negative: ${classes}`);
        }
      }
    }

    expect(miscast).toEqual([]);
  });
});
