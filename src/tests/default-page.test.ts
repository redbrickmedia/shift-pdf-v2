import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { primaryNavKeyFromPath } from '../js/logic/primary-nav';

const read = (path: string) => readFileSync(path, 'utf8');

describe('default starting page', () => {
  it('puts the My PDFs library on the root page', () => {
    const html = read('index.html');

    expect(html).toContain('id="shift-my-pdfs"');
    expect(html).toContain('<h1 id="shift-my-pdfs-heading">');
    expect(html).toContain('id="drop-zone"');
    expect(html).toContain('shift-home');
  });

  it('keeps the All tools catalog reachable on its own page', () => {
    const html = read('all-tools.html');
    const nav = read('src/partials/navbar.html');

    expect(html).toContain('id="tool-grid"');
    expect(html).toContain('id="search-bar"');
    expect(html).not.toContain('id="shift-my-pdfs"');
    expect(nav).toMatch(/href="\{\{baseUrl\}\}all-tools\.html"/);
    expect(nav).toMatch(/data-nav="home"/);
    expect(nav).toMatch(/href="\{\{baseUrl\}\}my-pdfs\.html"/);
  });

  /**
   * The walkthrough belongs on the page people land on, and its steps name
   * what that page shows: the drop zone, then the file cards, then a tool.
   * Both files are asserted because index.html and my-pdfs.html are separate
   * hand-maintained copies of the same page, so a card added to one only
   * greets half the visitors.
   */
  it.each(['index.html', 'my-pdfs.html'])(
    '%s opens with the My PDFs onboarding walkthrough',
    (page) => {
      const html = read(page);
      const steps = html.match(/class="shift-onboarding-step"/g);

      expect(html).toContain('<h1 id="shift-my-pdfs-heading">');
      expect(html).toContain('id="shift-promise-banner"');
      expect(html).toContain('id="shift-pdf-promise"');
      expect(html).toContain('Welcome to the PDF App 👋');
      expect(html).not.toContain('Getting started');
      expect(html).not.toContain('How Shift PDF works.');
      expect(html).not.toContain(
        'Files normally process in your browser. No account, daily quota, or'
      );
      expect(html).toContain('id="shift-promise-dismiss"');
      expect(html).toContain('id="shift-promise-upload"');
      expect(html).toContain('Upload a PDF');
      expect(html).toMatch(
        /id="shift-promise-banner"[\s\S]*justify-end[\s\S]*id="shift-promise-upload"/
      );
      expect(html).not.toMatch(
        /id="shift-promise-banner"[\s\S]*How privacy works/
      );
      expect(html).not.toMatch(
        /id="shift-promise-banner"[\s\S]*href="about\.html"/
      );
      expect(html).not.toContain('Browse all tools');
      expect(html).not.toMatch(
        /id="shift-promise-banner"[\s\S]*href="all-tools\.html"/
      );
      expect(steps).toHaveLength(3);
      expect(html).toContain('Add your PDFs');
      expect(html).toContain('Select the one you need');
      expect(html).toContain('Pick a tool');
      expect(html).not.toContain('shift-onboarding-step-figure');
      // Ordered, because the copy walks through one step at a time.
      expect(html.indexOf('id="shift-promise-banner"')).toBeLessThan(
        html.indexOf('id="shift-my-pdfs"')
      );
    }
  );

  it('does not repeat the walkthrough on the catalog page', () => {
    expect(read('all-tools.html')).not.toContain('shift-promise-banner');
  });

  /**
   * The column beside the sidebar is the scrollport, footer included. The
   * file list wrapper must not own overflow — that trapped the last cards
   * under a pinned footer. The table itself stays a table.
   */
  it('scrolls the whole My PDFs panel, including the footer', () => {
    const css = read('src/css/shift-theme.css');
    const panel = css.slice(
      css.indexOf(
        'body.shift-home:has(#shift-my-pdfs):not(.simple-mode):has(#shift-sidebar) {'
      )
    );
    const panelRule = panel.slice(0, panel.indexOf('}'));
    const scrollStart = css.indexOf(
      'body.shift-home:has(#shift-my-pdfs) .shift-my-pdfs-scroll'
    );
    const scrollRule = css.slice(scrollStart, css.indexOf('}', scrollStart));
    const footerStart = css.indexOf(
      'body.shift-home:has(#shift-my-pdfs):not(.simple-mode):has(#shift-sidebar)\n  > .shift-footer'
    );
    const footerRule = css.slice(footerStart, css.indexOf('}', footerStart));

    expect(panelRule).toContain('overflow-y: auto');
    expect(panelRule).not.toContain('overflow: hidden');
    expect(scrollRule).toContain('overflow: visible');
    expect(scrollRule).not.toContain('overflow-y: auto');
    expect(footerRule).toContain('position: static');
    expect(footerRule).not.toContain('position: sticky');
    // Table display must stay table; a block scrollport collapsed Date/Size.
    expect(css).not.toMatch(
      /#shift-my-pdfs\[data-view='list'\] \.shift-my-pdfs-table \{\s*display:\s*block/
    );
  });

  it('marks My PDFs active on the root and All tools active on the catalog page', () => {
    expect(primaryNavKeyFromPath('/')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/index.html')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/my-pdfs.html')).toBe('my-pdfs');
    expect(primaryNavKeyFromPath('/all-tools.html')).toBe('home');
    expect(primaryNavKeyFromPath('/all-tools')).toBe('home');
    expect(primaryNavKeyFromPath('/compress-pdf.html')).toBe('compress');
  });
});
