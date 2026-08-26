import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist');

/**
 * Shift PDF ships as an app rather than a public website, so this audit covers
 * page correctness only. Canonical/hreflang/sitemap checks were dropped along
 * with the metadata they validated.
 */
const SKIP_DIRS = new Set([
  'assets',
  'docs',
  'pdfjs-viewer',
  'pdfjs-annotation-viewer',
]);

const BRAND = 'Shift PDF';
const UPSTREAM_BRAND = ['Bento', 'PDF'].join('');
const UPSTREAM_HOST = 'bentopdf.com';

/** The attribution page must be free to name the upstream project. */
const ATTRIBUTION_PAGES = new Set(['licensing.html']);

const failures = [];

function fail(rule, detail) {
  failures.push({ rule, detail });
}

function listDistHtml() {
  const files = [];
  function walk(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const rel = path.posix.join(prefix, entry);
      if (fs.statSync(full).isDirectory()) {
        if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
        walk(full, rel);
      } else if (entry.endsWith('.html')) {
        files.push({ full, rel });
      }
    }
  }
  walk(DIST_DIR);
  return files;
}

function auditHtml(file) {
  const html = fs.readFileSync(file.full, 'utf-8');

  const titles = [...html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)];
  if (titles.length === 0) {
    fail('title', `${file.rel}: no <title>`);
  } else if (titles.length > 1) {
    fail('title', `${file.rel}: ${titles.length} <title> tags (expected 1)`);
  } else {
    const title = titles[0][1].replace(/\s+/g, ' ').trim();
    if (!title) {
      fail('title', `${file.rel}: empty <title>`);
    } else if (!title.includes(BRAND)) {
      fail('title', `${file.rel}: title "${title}" is missing the brand`);
    }
  }

  if (html.includes(UPSTREAM_BRAND)) {
    fail('branding', `${file.rel}: contains upstream brand name`);
  }

  if (!ATTRIBUTION_PAGES.has(path.basename(file.rel))) {
    // The npm scope is a real dependency name and stays; the host must not.
    if (html.replace(/@bentopdf\//g, '').includes(UPSTREAM_HOST)) {
      fail('branding', `${file.rel}: references ${UPSTREAM_HOST}`);
    }
  }

  const emptyI18n = html.match(/<span[^>]*data-i18n="[^"]+"[^>]*>\s*<\/span>/g);
  if (emptyI18n && emptyI18n.length > 0) {
    fail(
      'data-i18n',
      `${file.rel}: ${emptyI18n.length} empty data-i18n spans (e.g. ${emptyI18n[0].slice(0, 80)})`
    );
  }

  if (html.includes('"aggregateRating"')) {
    fail('aggregateRating', `${file.rel}: contains aggregateRating JSON-LD`);
  }
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`Page audit: dist not found at ${DIST_DIR}`);
    process.exit(1);
  }

  const files = listDistHtml();
  if (files.length === 0) {
    fail('audit', 'no HTML files found in dist/');
  }

  for (const file of files) auditHtml(file);

  if (failures.length === 0) {
    console.log(`Page audit: ${files.length} HTML files passed.`);
    return;
  }

  console.error(`\nPage audit failures (${failures.length}):`);
  for (const { rule, detail } of failures.slice(0, 100)) {
    console.error(`  [${rule}] ${detail}`);
  }
  if (failures.length > 100) {
    console.error(`  ... and ${failures.length - 100} more failures`);
  }
  process.exit(1);
}

main();
