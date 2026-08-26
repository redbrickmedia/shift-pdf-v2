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
  annotationCore,
  annotationBundle,
  annotationAlignmentText,
] = await Promise.all([
  readText('package.json'),
  readText('package-lock.json'),
  readText('node_modules/pdfjs-dist/package.json'),
  readText('public/pdfjs-viewer/pdf.mjs'),
  readText('public/pdfjs-viewer/pdf.worker.mjs'),
  readText('public/pdfjs-viewer/viewer.mjs'),
  readText('public/pdfjs-annotation-viewer/build/pdf.mjs'),
  readText('public/pdfjs-annotation-viewer/web/viewer.mjs'),
  readText('public/pdfjs-annotation-viewer/pdfjs-alignment.json'),
]);

const packageJson = JSON.parse(packageJsonText);
const packageLock = JSON.parse(packageLockText);
const installedPackage = JSON.parse(installedPackageText);
const annotationAlignment = JSON.parse(annotationAlignmentText);
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

const annotationVersion = annotationAlignment.pdfjsVersion;
if (
  annotationAlignment.status !== 'pinned-legacy-exception' ||
  typeof annotationAlignment.reason !== 'string' ||
  annotationAlignment.reason.length < 20
) {
  throw new Error(
    'Annotation viewer alignment metadata must document its pinned legacy exception.'
  );
}
assertVersion(
  extractVersion(
    annotationCore,
    /const pdfjsVersion = "([0-9.]+)"/,
    'annotation core'
  ),
  annotationVersion,
  'Annotation viewer core'
);
assertVersion(
  extractVersion(
    annotationBundle,
    /const pdfjsVersion = "([0-9.]+)"/,
    'annotation viewer bundle'
  ),
  annotationVersion,
  'Annotation viewer bundle'
);

console.log(
  `PDF.js aligned at ${lockVersion}; annotation viewer is explicitly pinned at ${annotationVersion}.`
);
