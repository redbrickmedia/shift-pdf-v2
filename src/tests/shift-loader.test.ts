import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  hideLoader,
  resetShiftLoaderForTests,
  SHIFT_LOADER_DELAY_MS,
  showLoader,
} from '../js/logic/shift-loader.js';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

describe('shift in-card loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="tool-uploader" class="rounded-xl"></div>
      <div id="loader-modal" class="fixed inset-0"></div>
    `;
  });

  afterEach(() => {
    hideLoader();
    resetShiftLoaderForTests();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('mounts on the tool card instead of the full-screen modal', () => {
    showLoader('Compressing...');

    const card = document.getElementById('tool-uploader');
    const overlay = card?.querySelector('.shift-loader');
    const modal = document.getElementById('loader-modal');

    expect(overlay).toBeTruthy();
    expect(card?.classList.contains('shift-loader-host')).toBe(true);
    expect(overlay?.classList.contains('is-active')).toBe(true);
    expect(overlay?.classList.contains('is-visible')).toBe(false);
    expect(overlay?.querySelector('.shift-loader-text')?.textContent).toBe(
      'Compressing...'
    );
    expect(modal?.classList.contains('hidden')).toBe(true);
    expect(card?.getAttribute('aria-busy')).toBe('true');
  });

  it('does not reveal the spinner until the design-system delay', () => {
    showLoader('Working...');
    const overlay = document.querySelector('.shift-loader');

    vi.advanceTimersByTime(SHIFT_LOADER_DELAY_MS - 1);
    expect(overlay?.classList.contains('is-visible')).toBe(false);

    vi.advanceTimersByTime(1);
    expect(overlay?.classList.contains('is-visible')).toBe(true);
  });

  it('never flashes if hideLoader runs before the delay', () => {
    showLoader('Working...');
    vi.advanceTimersByTime(100);
    hideLoader();
    vi.advanceTimersByTime(SHIFT_LOADER_DELAY_MS);

    const overlay = document.querySelector('.shift-loader');
    expect(overlay?.classList.contains('is-visible')).toBe(false);
    expect(overlay?.classList.contains('is-active')).toBe(false);
    expect(
      document.getElementById('tool-uploader')?.getAttribute('aria-busy')
    ).toBeNull();
  });

  it('reuses one overlay and can attach to a custom host', () => {
    showLoader('First');
    showLoader('Second');
    expect(document.querySelectorAll('.shift-loader')).toHaveLength(1);
    expect(document.querySelector('.shift-loader-text')?.textContent).toBe(
      'Second'
    );

    const extra = document.createElement('div');
    extra.id = 'custom-host';
    document.body.append(extra);
    showLoader('Elsewhere', undefined, { host: extra });
    expect(extra.querySelector('.shift-loader-text')?.textContent).toBe(
      'Elsewhere'
    );
    expect(
      document
        .getElementById('tool-uploader')
        ?.querySelector('.shift-loader')
        ?.classList.contains('is-active')
    ).toBe(false);
  });

  it('shows a progress bar when a percent is provided', () => {
    showLoader('Compressing...', 42);
    const bar = document.querySelector<HTMLElement>(
      '.shift-loader-progress-bar'
    );
    const wrap = document.querySelector('.shift-loader-progress');
    expect(wrap?.classList.contains('hidden')).toBe(false);
    expect(bar?.style.width).toBe('42%');
    expect(
      document.querySelector('.shift-loader-progress-text')?.textContent
    ).toBe('42%');
  });

  it('keeps the full-screen modal hidden in theme CSS', async () => {
    const css = await readText('src/css/shift-theme.css');
    expect(css).toContain('#loader-modal');
    expect(css).toContain('.shift-loader.is-visible');
    expect(css).toContain(
      'animation: shift-spinner-rotation 2s linear infinite'
    );
    const modalRule = css.slice(css.indexOf('#loader-modal {'));
    expect(modalRule).toMatch(/display:\s*none\s*!important/);
  });
});
