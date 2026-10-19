import { readFile } from 'node:fs/promises';

const readText = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function extractVersion(contents, pattern, label) {
  const match = pattern.exec(contents);
  if (!match) {
    throw new Error(`Could not determine ${label} version.`);
  }
  return match[1];
}

function assertVersion(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}; expected ${expected}.`);
  }
}

const [
  packageJsonText,
  packageLockText,
  installedPackageText,
  viewerCore,
  viewerWorker,
  viewerBundle,
] = await Promise.all([
  readText('package.json'),
  readText('package-lock.json'),
  readText('node_modules/pdfjs-dist/package.json'),
  readText('public/pdfjs-viewer/pdf.mjs'),
  readText('public/pdfjs-viewer/pdf.worker.mjs'),
  readText('public/pdfjs-viewer/viewer.mjs'),
]);

const packageJson = JSON.parse(packageJsonText);
const packageLock = JSON.parse(packageLockText);
const installedPackage = JSON.parse(installedPackageText);
const lockVersion = packageLock.packages?.['node_modules/pdfjs-dist']?.version;

if (!lockVersion) {
  throw new Error('pdfjs-dist is missing from package-lock.json.');
}

assertVersion(installedPackage.version, lockVersion, 'Installed pdfjs-dist');
assertVersion(
  packageJson.dependencies?.['pdfjs-dist'],
  lockVersion,
  'Declared pdfjs-dist dependency'
);

const distributionPattern = /pdfjsVersion = ([0-9.]+)/;
assertVersion(
  extractVersion(viewerCore, distributionPattern, 'viewer core'),
  lockVersion,
  'Vendored viewer core'
);
assertVersion(
  extractVersion(viewerWorker, distributionPattern, 'viewer worker'),
  lockVersion,
  'Vendored viewer worker'
);
assertVersion(
  extractVersion(
    viewerBundle,
    /const viewerVersion = ['"]([0-9.]+)['"]/,
    'viewer bundle'
  ),
  lockVersion,
  'Vendored viewer bundle'
);

console.log(`PDF.js aligned at ${lockVersion}.`);
