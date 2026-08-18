/**
 * One-off helper: inject Shift design-system icons into the Concept A tool tiles.
 *
 * Reads the SVG artwork captured by extract-ds-icons.mjs and rewrites each
 * `<div class="card">Label</div>` into an iconed tile.
 *
 * Usage:
 *   node design/explorations/apply-tile-icons.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const icons = JSON.parse(readFileSync(join(here, 'ds-icons.json'), 'utf8'));
const target = join(here, 'concept-a-sidebar.html');

// Tool label -> design-system icon. Labels are unique per section, so a couple of
// tools (PDF Editor, Compress) intentionally reuse the same glyph across sections.
const map = {
  'Merge PDF': 'MergeIcon',
  'Compress PDF': 'CompressIcon',
  'Sign PDF': 'DrawSignatureIcon',
  'JPG to PDF': 'TypeImageIcon',
  'PDF Editor': 'EditIcon',
  'Split PDF': 'UngroupIcon',
  Bookmarks: 'BookmarkIcon',
  Watermark: 'AddTextIcon',
  'Page Numbers': 'PageSettingsIcon',
  'Word to PDF': 'TypeWordIcon',
  'Excel to PDF': 'TypeExcelIcon',
  'PNG to PDF': 'ImageIcon',
  'PDF to Word': 'TypeWordIcon',
  'PDF to Excel': 'TypeExcelIcon',
  'PDF to JPG': 'TypeImageIcon',
  'PDF to PNG': 'ImageIcon',
  Organize: 'ReorganiseIcon',
  Extract: 'PageThumbnailsIcon',
  'Delete Pages': 'TrashIcon',
  Rotate: 'RedoIcon',
  Compress: 'CompressIcon',
  Repair: 'WrenchIcon',
  OCR: 'ScanPdfIcon',
  Linearize: 'SpeedIcon',
  Encrypt: 'LockIcon',
  Decrypt: 'LockOffIcon',
  Redact: 'EyeLockIcon',
  Sign: 'ESignIcon',
};

/**
 * DS icons ship on 16/20/24/64 grids. Scaling them all into one box would make
 * the small-grid artwork look heavy, so tag each with its native grid and let
 * CSS size them optically instead.
 */
function prepare(name) {
  const raw = icons[name];
  if (!raw) throw new Error(`No artwork captured for ${name}`);
  const grid = Number(
    raw.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/)?.[1] ?? 24
  );
  const bucket = grid <= 16 ? 'g16' : grid <= 24 ? 'g24' : 'g64';
  return raw
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace('<svg', `<svg class="card-icon ${bucket}" aria-hidden="true"`);
}

let html = readFileSync(target, 'utf8');
let replaced = 0;
const missing = [];

html = html.replace(/<div class="card">([^<]+)<\/div>/g, (whole, rawLabel) => {
  const label = rawLabel.trim();
  const iconName = map[label];
  if (!iconName) {
    missing.push(label);
    return whole;
  }
  replaced += 1;
  return [
    '<div class="card">',
    `            ${prepare(iconName)}`,
    `            <span>${label}</span>`,
    '          </div>',
  ].join('\n            ');
});

writeFileSync(target, html);
console.log(`Iconed ${replaced} tiles`);
if (missing.length) console.log(`No mapping for: ${missing.join(', ')}`);
