#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] || 'http://127.0.0.1:4173').replace(/\/$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'src', 'tests', 'fixtures', 'sample.pdf');
const paths = [
  '/',
  '/merge-pdf.html',
  '/compress-pdf.html',
  '/pdf-to-jpg.html',
  '/sign-pdf.html',
  '/about.html',
  '/licensing.html',
  '/images/shift-pdf-logo.svg',
];
const expectedTitles = new Map([
  ['/merge-pdf.html', 'Merge PDF | Shift PDF'],
  ['/compress-pdf.html', 'Compress PDF | Shift PDF'],
  ['/pdf-to-jpg.html', 'PDF to JPG | Shift PDF'],
  ['/sign-pdf.html', 'Sign PDF | Shift PDF'],
]);

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
      const expectedTitle = expectedTitles.get(path);
      if (expectedTitle && !html.includes(`<title>${expectedTitle}</title>`)) {
        console.error(`FAIL ${path} missing expected title "${expectedTitle}"`);
        failed++;
      } else if (expectedTitle) {
        console.log(`OK   ${path} title is ${expectedTitle}`);
      }
      if (!html.includes('about.html') || !html.includes('licensing.html')) {
        console.error(`FAIL ${path} missing About or Source footer link`);
        failed++;
      } else {
        console.log(`OK   ${path} exposes About and Source`);
      }
      if (
        path === '/licensing.html' &&
        (!html.includes('id="source-offer"') ||
          !html.includes('https://github.com/redbrickmedia/shift-pdf-v2'))
      ) {
        console.error('FAIL Source page missing corresponding source offer');
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

const executablePath = process.env.SHIFT_CHROMIUM_EXECUTABLE;
const expectedVersion = process.env.SHIFT_CHROMIUM_VERSION;
if (!executablePath || !expectedVersion) {
  console.error(
    '\nBLOCKED browser flow smoke: set both SHIFT_CHROMIUM_EXECUTABLE and ' +
      'SHIFT_CHROMIUM_VERSION to the exact executable and version shipped by Shift.'
  );
  console.error(
    'Example: SHIFT_CHROMIUM_EXECUTABLE="/path/to/Shift Chromium" ' +
      'SHIFT_CHROMIUM_VERSION="<exact-version-from-Shift-release>" ' +
      'npm run smoke:shift'
  );
  process.exit(2);
}
if (!existsSync(executablePath)) {
  console.error(
    `\nBLOCKED Shift Chromium executable not found: ${executablePath}`
  );
  process.exit(2);
}
if (!existsSync(fixture)) {
  console.error(`\nFAIL non-sensitive smoke fixture missing: ${fixture}`);
  process.exit(1);
}

const playwrightPath = join(
  root,
  '.smoke-tools',
  'node_modules',
  'playwright',
  'index.mjs'
);
if (!existsSync(playwrightPath)) {
  console.error(
    '\nBLOCKED Playwright smoke harness is not installed in .smoke-tools. ' +
      'Install it there without adding a project dependency.'
  );
  process.exit(2);
}

// The path is fixed under the repository and checked for existence above.
// eslint-disable-next-line no-unsanitized/method
const { chromium } = await import(playwrightPath);
const browser = await chromium.launch({
  executablePath,
  headless: true,
});

try {
  const actualVersion = browser.version();
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Shift Chromium version mismatch: got ${actualVersion}; expected ${expectedVersion}.`
    );
  }
  console.log(`OK   exact Shift Chromium ${actualVersion}`);

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));

  async function expectDownload(action, label) {
    const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
    await action();
    const download = await downloadPromise;
    const downloadError = await download.failure();
    if (downloadError) {
      throw new Error(`${label} download failed: ${downloadError}`);
    }
    console.log(`OK   ${label} download: ${download.suggestedFilename()}`);
  }

  async function openTool(path, files = fixture) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.locator('#file-input').setInputFiles(files);
  }

  async function verifyCompletion(label) {
    await page.locator('#completion-panel:not(.hidden)').waitFor({
      timeout: 90_000,
    });
    await expectDownload(
      () => page.locator('#completion-download').click(),
      `${label} Download again`
    );
  }

  await openTool('/compress-pdf.html');
  await page.locator('#compression-algorithm').selectOption('photon');
  await expectDownload(
    () => page.locator('#process-btn').click(),
    'Compress initial'
  );
  await verifyCompletion('Compress');

  await openTool('/merge-pdf.html', [fixture, fixture]);
  await expectDownload(
    () => page.locator('#process-btn').click(),
    'Merge initial'
  );
  await verifyCompletion('Merge');

  await openTool('/pdf-to-jpg.html');
  await expectDownload(
    () => page.locator('#process-btn').click(),
    'PDF-to-JPG initial'
  );
  await verifyCompletion('PDF-to-JPG');

  await openTool('/sign-pdf.html');
  const viewer = page.frameLocator('iframe[title="Visual signature editor"]');
  await viewer.locator('#editorSignatureButton').waitFor({ timeout: 90_000 });
  await viewer.locator('#editorSignatureButton').click();
  await viewer.locator('#editorSignatureAddSignature').click();
  await viewer.locator('#addSignatureTypeInput').fill('Shift smoke');
  await viewer.locator('#addSignatureAddButton').click();
  await expectDownload(
    () => page.locator('#process-btn').click(),
    'Sign PDF initial'
  );
  await verifyCompletion('Sign PDF');

  if (browserErrors.length > 0) {
    throw new Error(`Browser errors:\n${browserErrors.join('\n')}`);
  }
  await context.close();
  console.log(
    '\nSmoke passed: four upload-to-download flows in exact Shift Chromium.'
  );
} finally {
  await browser.close();
}
