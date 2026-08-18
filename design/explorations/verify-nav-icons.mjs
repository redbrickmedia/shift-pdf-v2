/**
 * Verifies that every inline SVG in the experimental sidebar really is Shift
 * design-system artwork, by rendering the whole DS icon set and matching on
 * path data.
 *
 * Usage:
 *   node design/explorations/verify-nav-icons.mjs [pathToWebUiCheckout]
 */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const webUiRoot =
  process.argv[2] || '/Users/krislemieux/Shift/Repos/shift-browser/web-ui';
const require = createRequire(pathToFileURL(join(webUiRoot, 'noop.js')));

const React = (await import(pathToFileURL(require.resolve('react')).href))
  .default;
const { renderToStaticMarkup } = await import(
  pathToFileURL(require.resolve('react-dom/server')).href
);
const Icons = await import(
  pathToFileURL(require.resolve('@redbrickmedia/shift-design-system/icons'))
    .href
);

const pathsOf = (svg) => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);

// Fingerprint every DS icon by its path data.
const dsByFingerprint = new Map();
for (const [name, Component] of Object.entries(Icons)) {
  if (!name.endsWith('Icon') || typeof Component !== 'function') continue;
  try {
    const key = pathsOf(renderToStaticMarkup(React.createElement(Component)))
      .join('|')
      .trim();
    if (!key) continue;
    if (!dsByFingerprint.has(key)) dsByFingerprint.set(key, []);
    dsByFingerprint.get(key).push(name);
  } catch {
    /* some icons need props; skip them */
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  resolve(here, 'concept-a-sidebar.html'),
  resolve(here, '../../src/partials/navbar.html'),
];

let anyUnknown = false;

for (const file of targets) {
  const html = readFileSync(file, 'utf8');
  // Anchor on the real <nav> element, not a CSS rule that mentions the class.
  const navOpen = html.match(/<nav[^>]*primary-nav[^>]*>/);
  if (!navOpen) {
    console.log(`\n=== ${file} ===\n  no primary nav found`);
    continue;
  }
  const navStart = navOpen.index + navOpen[0].length;
  const nav = html.slice(navStart, html.indexOf('</nav>', navStart));

  console.log(`\n=== ${file.replace(resolve(here, '../..'), '.')} ===`);

  // One entry per nav link, so a link's icon can never be paired with another's label.
  const links = [...nav.matchAll(/<a\b[\s\S]*?<\/a>/g)];
  for (const [block] of links) {
    const svgMatch = block.match(/<svg[\s\S]*?<\/svg>/);
    const svg = svgMatch ? svgMatch[0] : '';
    const label =
      block.match(/<span[^>]*>([^<]+)</)?.[1].trim() ?? '(no label)';
    const key = pathsOf(svg).join('|').trim();
    const match = dsByFingerprint.get(key);
    if (match) {
      console.log(`  ${label.padEnd(10)} -> ${match.join(' / ')}`);
    } else {
      anyUnknown = true;
      console.log(`  ${label.padEnd(10)} -> NOT A DESIGN-SYSTEM ICON`);
    }
  }
}

console.log(
  anyUnknown
    ? '\nResult: found artwork that is not from the design system.'
    : '\nResult: every sidebar icon is genuine design-system artwork.'
);
