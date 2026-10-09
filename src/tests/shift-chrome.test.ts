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
      <div id="row" role="toolbar">
        <span data-viewer-chrome="launchers">Launch</span>
        <button type="button" data-viewer-chrome="print">Print</button>
        <button type="button" data-shift-action="undo">Undo</button>
        <button type="button" data-viewer-chrome="download">Download</button>
        <button type="button" data-shift-action="extra">Upload</button>
      </div>
    `;
    const row = document.getElementById('row') as HTMLElement;
    arrangeShiftActionRow(row);

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
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(css).not.toMatch(/bg-gray-|text-gray-/);
    expect(css).toContain('var(--action-button-surface-primary-default)');
    expect(css).toContain('var(--radius-8)');
  });

  it('routes the multi-tool page through the shared action row', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/pdf-multi-tool.html'),
      'utf8'
    );
    const toolbar = page.slice(
      page.indexOf('class="toolbar-container'),
      page.indexOf('id="main-scroll-container"')
    );
    expect(toolbar).toContain('class="shift-action-row"');
    expect(toolbar).toContain('role="toolbar"');
    expect(toolbar).not.toMatch(/bg-gray-|text-gray-/);
    const history = toolbar.indexOf('data-shift-action-group="history"');
    const output = toolbar.indexOf('data-shift-action-group="output"');
    const extras = toolbar.indexOf('data-shift-action-group="extras"');
    expect(history).toBeLessThan(output);
    expect(output).toBeLessThan(extras);
    expect(toolbar.indexOf('id="undo-btn"')).toBeLessThan(
      toolbar.indexOf('id="bulk-download-btn"')
    );
    expect(toolbar.indexOf('id="bulk-download-btn"')).toBeLessThan(
      toolbar.indexOf('id="upload-pdfs-btn"')
    );
  });

  it('routes the bookmark editor through the shared action row', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/bookmark.html'),
      'utf8'
    );
    const headerStart = page.indexOf('<header class="shift-chrome-bar');
    const header = page.slice(
      headerStart,
      page.indexOf('</header>', headerStart)
    );
    expect(header).toContain('class="shift-action-row"');
    expect(header).toContain('role="toolbar"');
    expect(header).not.toContain('data-shift-viewer-actions');
    expect(header).not.toMatch(/bg-gray-|text-gray-|bg-red-|bg-orange-/);
    const navigate = header.indexOf('data-shift-action-group="navigate"');
    const history = header.indexOf('data-shift-action-group="history"');
    const extras = header.indexOf('data-shift-action-group="extras"');
    expect(navigate).toBeLessThan(history);
    expect(history).toBeLessThan(extras);
    expect(header.indexOf('id="back-btn"')).toBeLessThan(
      header.indexOf('id="undo-btn"')
    );
    expect(header.indexOf('id="undo-btn"')).toBeLessThan(
      header.indexOf('id="reset-btn"')
    );
    expect(header.indexOf('id="reset-btn"')).toBeLessThan(
      header.indexOf('id="delete-all-btn"')
    );
  });
});
