import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const robotsPath = path.join(distDir, 'robots.txt');
const MAX_PAGES_FILE_BYTES = 25 * 1024 * 1024;

if (!fs.existsSync(distDir)) {
  console.error(`pages-prepare-dist: dist not found at ${distDir}`);
  process.exit(1);
}

fs.writeFileSync(
  robotsPath,
  ['User-agent: *', 'Disallow: /', ''].join('\n')
);
console.log(`Wrote noindex robots.txt to ${robotsPath}`);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const size = fs.statSync(full).size;
    if (size > MAX_PAGES_FILE_BYTES) {
      fs.unlinkSync(full);
      console.log(
        `Removed ${path.relative(distDir, full)} (${(size / (1024 * 1024)).toFixed(1)} MiB) — Cloudflare Pages max is 25 MiB`
      );
    }
  }
}

walk(distDir);
