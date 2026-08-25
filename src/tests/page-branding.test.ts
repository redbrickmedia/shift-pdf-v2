import { globSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

  it.each(pageSources)('%s uses the Shift brand in metadata', async (page) => {
    const content = stripExternalIdentifiers(await readText(page));

    expect(content).not.toContain(UPSTREAM_BRAND);
    expect(content).not.toContain(UPSTREAM_BRAND_SPACED);
  });

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
