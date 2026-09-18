import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BRAND = 'Shift PDF';

/**
 * The upstream display brand, split so this file does not itself trip the
 * repository-wide scan it performs.
 */
const UPSTREAM_BRAND = ['Bento', 'PDF'].join('');
const UPSTREAM_BRAND_SPACED = ['Bento', 'PDF'].join(' ');
const UPSTREAM_HOST = ['bento', 'pdf.com'].join('');

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

const pageSources = [
  ...globSync('src/pages/*.html'),
  ...globSync('src/partials/*.html'),
  ...globSync('*.html'),
];

const localeSources = globSync('public/locales/*/*.json');

/**
 * These two credit the project this one is forked from, so they are the one
 * place the upstream brand belongs. Holding them to the rename is what turned
 * their copy into "Shift PDF is a branded fork of Shift PDF".
 */
const ATTRIBUTION_PAGES = new Set(['licensing.html', 'about.html']);

const brandedPageSources = pageSources.filter(
  (page) => !ATTRIBUTION_PAGES.has(basename(page))
);

/**
 * The social handle and the upstream repository/domain are external
 * identifiers rather than display branding, so they are excluded here.
 */
const stripExternalIdentifiers = (content: string) =>
  content
    .replaceAll(`@${UPSTREAM_BRAND}`, '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '')
    .replace(/@bentopdf\/[\w-]+/gi, '');

describe('page branding', () => {
  it('finds page and locale sources to check', () => {
    expect(pageSources.length).toBeGreaterThan(100);
    expect(localeSources.length).toBeGreaterThan(20);
  });

  it.each(brandedPageSources)(
    '%s uses the Shift brand in metadata',
    async (page) => {
      const content = stripExternalIdentifiers(await readText(page));

      expect(content).not.toContain(UPSTREAM_BRAND);
      expect(content).not.toContain(UPSTREAM_BRAND_SPACED);
    }
  );

  it.each([...ATTRIBUTION_PAGES])(
    '%s credits the upstream project',
    async (page) => {
      // The inverse of the rule above: attribution has to survive a future
      // sweep of the brand name, so assert the credit is actually present.
      const content = stripExternalIdentifiers(await readText(page));

      expect(content).toContain(UPSTREAM_BRAND);

      // A blanket rename turns every credit into Shift crediting itself. Match
      // on the phrases that introduce the upstream project rather than on the
      // sentences seen so far, which is how "Shift PDF / Shift PDF fork"
      // outlived the first pass at this.
      for (const lead of ['builds on', 'fork of', 'Built from', 'upstream']) {
        expect(content, lead).not.toMatch(
          new RegExp(`${lead}\\s+(the\\s+)?${BRAND}\\b`, 'i')
        );
      }

      expect(content).not.toMatch(
        new RegExp(`${BRAND}\\s*/\\s*${BRAND}\\b`, 'i')
      );
    }
  );

  it.each(localeSources)('%s uses the Shift brand', async (locale) => {
    const content = stripExternalIdentifiers(await readText(locale));

    expect(content).not.toContain(UPSTREAM_BRAND);
    expect(content).not.toContain(UPSTREAM_BRAND_SPACED);
  });

  it('gives every tool page a non-empty title carrying the brand', async () => {
    const toolPages = globSync('src/pages/*.html');
    const offenders: string[] = [];

    for (const page of toolPages) {
      const content = await readText(page);
      const title = content
        .match(/<title>([\s\S]*?)<\/title>/)?.[1]
        .replace(/\s+/g, ' ')
        .trim();

      if (!title || !title.endsWith(`| ${BRAND}`)) {
        offenders.push(`${page}: ${title ?? '<missing>'}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps public-website SEO metadata out of the app pages', async () => {
    const seoTags = [
      /<link\b[^>]*rel="canonical"/,
      /<link\b[^>]*rel="alternate"[^>]*hreflang/,
      /<meta\b[^>]*property="og:url"/,
      /<meta\b[^>]*name="twitter:url"/,
      /<meta\b[^>]*property="og:image"/,
      /<meta\b[^>]*name="twitter:image"/,
    ];
    const offenders: string[] = [];

    for (const page of pageSources) {
      const content = await readText(page);
      for (const tag of seoTags) {
        if (tag.test(content)) offenders.push(`${page}: ${tag.source}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never points a page at the upstream host', async () => {
    // The attribution page must be free to name the upstream project.
    const attributionPages = new Set(['licensing.html']);
    const offenders: string[] = [];

    for (const page of pageSources) {
      if (attributionPages.has(page)) continue;
      // The npm scope shares the name but is a real dependency.
      const content = (await readText(page)).replaceAll('@bentopdf/', '');
      if (content.includes(UPSTREAM_HOST)) offenders.push(page);
    }

    expect(offenders).toEqual([]);
  });

  it('lets the home picker accept multiple PDFs at once', async () => {
    const home = await readText('index.html');
    const input = home.match(/<input\b[^>]*id="file-input"[^>]*>/)?.[0];

    expect(input).toBeDefined();
    expect(input).toContain('multiple');
  });

  it('uses the Shift logo as the page favicon', async () => {
    const offenders: string[] = [];

    for (const page of pageSources) {
      const content = await readText(page);
      if (!content.includes('rel="icon"')) continue;
      if (content.includes('/images/favicon.svg')) {
        offenders.push(`${page}: still points at the upstream favicon.svg`);
      }
      if (
        content.includes('rel="icon"') &&
        !content.includes('/images/shift-pdf-logo.svg')
      ) {
        offenders.push(`${page}: missing Shift favicon`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('does not ship the upstream diamond mark as the favicon', async () => {
    const favicon = await readText('public/images/favicon.svg');
    const faviconNoBg = await readText('public/images/favicon-no-bg.svg');
    const shiftLogo = await readText('public/images/shift-pdf-logo.svg');

    expect(favicon).toBe(shiftLogo);
    expect(faviconNoBg).toBe(shiftLogo);
    expect(favicon).not.toContain('#A5B4FC');
    expect(favicon).not.toContain('#6366F1');
    expect(favicon).toContain('#DC2626');
  });

  it('names the web app Shift PDF', async () => {
    const manifest = await readText('public/site.webmanifest');

    expect(manifest).toContain('"name": "Shift PDF"');
    expect(manifest).toContain('/images/shift-pdf-logo.svg');
    expect(manifest).not.toContain('BentoPDF');
  });

  it('keeps every tool page title unique', async () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];

    for (const page of globSync('src/pages/*.html')) {
      const content = await readText(page);
      const title = content
        .match(/<title>([\s\S]*?)<\/title>/)?.[1]
        .replace(/\s+/g, ' ')
        .trim();

      if (!title) continue;
      const previous = seen.get(title);
      if (previous) {
        duplicates.push(`${title} (${previous}, ${page})`);
      } else {
        seen.set(title, page);
      }
    }

    expect(duplicates).toEqual([]);
  });
});
