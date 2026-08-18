#!/usr/bin/env node
/**
 * Experimental smoke check for Shift PDF v2 (Bento fork).
 * Assumes `npm run build` has produced dist/ and optionally a preview server.
 *
 * Usage:
 *   node scripts/smoke-shift-pages.mjs [baseUrl]
 * Default baseUrl: http://127.0.0.1:4173
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paths = [
  '/',
  '/merge-pdf.html',
  '/compress-pdf.html',
  '/pdf-converter.html',
  '/sign-pdf.html',
  '/images/shift-pdf-logo.svg',
];

let failed = 0;

const headersPath = join(root, 'dist', '_headers');
if (!existsSync(headersPath)) {
  console.error('FAIL dist/_headers missing — run npm run build');
  failed++;
} else {
  const headers = readFileSync(headersPath, 'utf8');
  for (const needle of [
    'Cross-Origin-Opener-Policy: same-origin',
    'Cross-Origin-Embedder-Policy: credentialless',
  ]) {
    if (!headers.includes(needle)) {
      console.error(`FAIL dist/_headers missing ${needle}`);
      failed++;
    } else {
      console.log(`OK   dist/_headers has ${needle}`);
    }
  }
}

for (const path of paths) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FAIL ${path} -> ${res.status}`);
      failed++;
      continue;
    }
    console.log(`OK   ${path} -> ${res.status}`);
    if (path.endsWith('.html') || path === '/') {
      const html = await res.text();
      if (!html.includes('shift-sidebar')) {
        console.error(`FAIL ${path} missing shift-sidebar`);
        failed++;
      } else {
        console.log(`OK   ${path} has shift-sidebar`);
      }
      if (path === '/' && !html.includes('Shift PDF')) {
        console.error('FAIL home missing Shift PDF brand');
        failed++;
      }
    }
  } catch (err) {
    console.error(`FAIL ${path} ${err.message}`);
    console.error('     Start preview first: npx vite preview --port 4173');
    failed++;
  }
}

if (failed) {
  console.error(`\nSmoke failed with ${failed} error(s)`);
  process.exit(1);
}
console.log(
  '\nSmoke passed (merge / compress / convert / sign routes + headers)'
);
