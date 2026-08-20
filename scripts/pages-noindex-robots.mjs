import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const robotsPath = path.join(distDir, 'robots.txt');

if (!fs.existsSync(distDir)) {
  console.error(`pages-noindex-robots: dist not found at ${distDir}`);
  process.exit(1);
}

fs.writeFileSync(
  robotsPath,
  ['User-agent: *', 'Disallow: /', ''].join('\n')
);
console.log(`Wrote noindex robots.txt to ${robotsPath}`);
