export const PACKAGE_VERSIONS = {
  ghostscript: '0.1.1',
  pymupdf: '0.11.16',
  cpdf: '2.5.5',
} as const;

export const ENGINE_SOURCE = {
  pymupdf: {
    name: 'PyMuPDF WASM',
    package: '@bentopdf/pymupdf-wasm',
    version: PACKAGE_VERSIONS.pymupdf,
    license: 'AGPL-3.0-only',
    source: 'https://github.com/alam00000/bentopdf-pymupdf-wasm',
    upstream: 'https://github.com/pymupdf/PyMuPDF',
    localPath: 'wasm/pymupdf/',
  },
  ghostscript: {
    name: 'Ghostscript WASM',
    package: '@bentopdf/gs-wasm',
    version: PACKAGE_VERSIONS.ghostscript,
    license: 'AGPL-3.0-only',
    source: 'https://github.com/alam00000/bentopdf-gs-wasm',
    upstream: 'https://github.com/ArtifexSoftware/ghostpdl',
    localPath: 'wasm/gs/',
  },
  cpdf: {
    name: 'CoherentPDF',
    package: 'coherentpdf',
    version: PACKAGE_VERSIONS.cpdf,
    license: 'AGPL-3.0-or-later',
    source: 'https://github.com/coherentgraphics/coherentpdf.js',
    upstream: 'https://www.coherentpdf.com',
    localPath: 'wasm/cpdf/',
  },
} as const;
