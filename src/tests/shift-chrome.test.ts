import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arrangeShiftActionRow,
  createShiftActionButton,
  SHIFT_ACTION_GROUPS,
} from '../js/logic/shift-action-row';
import {
  createShiftBrowserEmpty,
  markShiftFileBrowser,
  setShiftBrowserItemState,
} from '../js/logic/shift-file-browser';
import { createShiftFilePreview } from '../js/logic/shift-file-preview';

describe('shared chrome', () => {
  it('orders a mixed toolbar into Navigate, History, Output, then extras', () => {
    document.body.innerHTML = `
      <div id="row">
        <span data-viewer-chrome="launchers">Launch</span>
        <button type="button" data-viewer-chrome="print">Print</button>
        <button type="button" data-shift-action="undo">Undo</button>
        <button type="button" data-viewer-chrome="download">Download</button>
        <button type="button" data-shift-action="extra">Upload</button>
      </div>
    `;
    const row = document.getElementById('row') as HTMLElement;
    arrangeShiftActionRow(row);

    expect(row.getAttribute('role')).toBe('group');
    expect(row.getAttribute('aria-label')).toBe('PDF actions');
    expect(row.getAttribute('tabindex')).toBeNull();
    expect(
      [...row.querySelectorAll('[data-shift-action-group]')].map((group) =>
        group.getAttribute('data-shift-action-group')
      )
    ).toEqual([...SHIFT_ACTION_GROUPS]);
    expect(
      [
        ...row.querySelectorAll(
          '[data-shift-action-group] > [data-viewer-chrome], [data-shift-action-group] > [data-shift-action]'
        ),
      ].map(
        (node) =>
          node.getAttribute('data-viewer-chrome') ||
          node.getAttribute('data-shift-action')
      )
    ).toEqual(['undo', 'download', 'print', 'launchers', 'extra']);
  });

  it('builds toolbar buttons with an accessible name', () => {
    const button = createShiftActionButton(document, {
      label: 'Print',
      iconClass: 'ph-printer',
      action: 'print',
      feature: 'print',
    });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Print');
    expect(button.classList.contains('shift-action-button')).toBe(true);
    expect(button.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses one preview frame for rail and card slots', () => {
    const rail = createShiftFilePreview(document, {
      size: 'rail',
      empty: true,
      selected: true,
      fallback: document.createElement('span'),
    });
    const card = createShiftFilePreview(document, {
      size: 'card',
      empty: false,
      viewing: true,
    });

    expect(rail.classList.contains('shift-file-preview')).toBe(true);
    expect(rail.classList.contains('shift-open-file-preview')).toBe(true);
    expect(rail.classList.contains('is-empty')).toBe(true);
    expect(rail.classList.contains('is-selected')).toBe(true);
    expect(rail.querySelector('.shift-file-preview-fallback')).not.toBeNull();
    expect(card.dataset.shiftPreviewSize).toBe('card');
    expect(card.classList.contains('is-viewing')).toBe(true);
    expect(card.classList.contains('is-empty')).toBe(false);
  });

  it('shares one empty state and selection model', () => {
    const host = document.createElement('section');
    markShiftFileBrowser(host, 'grid');
    const item = document.createElement('button');
    item.append(createShiftFilePreview(document, { size: 'card' }));
    setShiftBrowserItemState(item, { selected: true, viewing: false });
    host.append(item);
    const empty = createShiftBrowserEmpty(document, {
      heading: 'Add a PDF to get started',
      message: 'Files stay on your machine.',
      actionLabel: 'Choose files',
      onAction: () => undefined,
    });

    expect(host.dataset.shiftFileBrowser).toBe('grid');
    expect(item.classList.contains('is-selected')).toBe(true);
    expect(
      item
        .querySelector('.shift-file-preview')
        ?.classList.contains('is-selected')
    ).toBe(true);
    expect(empty.classList.contains('shift-file-browser-empty')).toBe(true);
    expect(empty.querySelector('button')?.textContent).toBe('Choose files');
  });

  it('keeps new chrome on semantic tokens', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-chrome.css'),
      'utf8'
    );
    const withoutDarkFocus = css.replace(
      /html\.dark[\s\S]*?outline-color:\s*#60a5fa;[\s\S]*?\}/,
      ''
    );
    expect(withoutDarkFocus).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(css).toContain('outline-color: #60a5fa');
    expect(css).not.toMatch(/bg-gray-|text-gray-/);
    expect(css).toContain('var(--action-button-surface-primary-default)');
    expect(css).toContain('var(--radius-8)');
  });

  it('keeps card previews on a portrait page ratio', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/css/shift-chrome.css'),
      'utf8'
    );
    const start = css.indexOf(
      ".shift-file-preview[data-shift-preview-size='card'] {"
    );
    const rule = css.slice(start, css.indexOf('\n}', start));

    expect(rule).toMatch(/aspect-ratio:\s*8\.5\s*\/\s*11/);
    expect(rule).not.toMatch(/height:\s*154px/);
    expect(rule).toMatch(/width:\s*100%/);
  });

  it('routes the multi-tool page through the shared viewer header and manipulation sub-toolbar', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/pdf-multi-tool.html'),
      'utf8'
    );
    expect(page).toContain('class="shift-pdf-viewer-header"');
    expect(page).toContain('class="shift-pdf-viewer-heading"');
    expect(page).toContain('data-shift-viewer-actions');
    const headerIndex = page.indexOf('class="shift-pdf-viewer-header"');
    const toolbarIndex = page.indexOf('class="toolbar-container');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(headerIndex).toBeLessThan(toolbarIndex);

    const toolbar = page.slice(
      toolbarIndex,
      page.indexOf('id="main-scroll-container"')
    );
    expect(toolbar).toContain('class="shift-action-row"');
    expect(toolbar).toContain('role="group"');
    expect(toolbar).toContain('aria-labelledby="multi-tool-rotate-caption"');
    expect(toolbar).toContain('aria-label="Left"');
    expect(toolbar).toContain('id="reverse-pages-btn"');
    expect(toolbar).not.toContain('id="export-pdf-btn"');
    expect(toolbar).not.toContain('id="undo-btn"');
    expect(toolbar).not.toContain('id="redo-btn"');
    expect(toolbar).not.toContain('id="reset-btn"');
    expect(toolbar).not.toContain('role="toolbar"');
    expect(toolbar).not.toMatch(/bg-gray-|text-gray-/);
    const output = toolbar.indexOf('data-shift-action-group="output"');
    const extras = toolbar.indexOf('data-shift-action-group="extras"');
    expect(output).toBeLessThan(extras);
    expect(toolbar.indexOf('id="bulk-download-btn"')).toBeLessThan(
      toolbar.indexOf('id="upload-pdfs-btn"')
    );
  });

  it('routes the bookmark editor through the shared viewer header and workspace tabs', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/bookmark.html'),
      'utf8'
    );
    expect(page).toContain('class="shift-pdf-viewer-header"');
    expect(page).toContain('class="shift-pdf-viewer-heading"');
    expect(page).toContain('data-shift-viewer-actions');
    expect(page).toContain('id="tab-bookmarks"');
    expect(page).toContain('id="tab-toc"');
    expect(page).toContain('id="delete-all-btn"');
    expect(page).not.toContain('id="back-btn"');
    expect(page).not.toContain('id="download-btn"');
  });
});
