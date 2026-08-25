# PDF.js version alignment

Programmatic PDF.js usage must go through `src/js/utils/pdfjs.ts`. It uses
the official legacy build and worker because the modern PDF.js 6 build relies
on APIs that are unavailable in the Shift Chromium runtime.

`public/pdfjs-viewer` is the official legacy full viewer distribution matching
the exact `pdfjs-dist` version pinned in `package.json` and `package-lock.json`.
Shift's form and signature viewer files,
signature fonts, and signature controls are preserved when the distribution is
refreshed.

`public/pdfjs-annotation-viewer` remains pinned to PDF.js 4.3.136. Its Shift
annotation extension has no published npm distribution or safe upstream
6.2.108 refresh artifact. Replacing only its PDF.js files would create an
untested mixed bundle and could break signing. The pinned version is recorded
in `pdfjs-alignment.json` and checked by `npm run check:pdfjs`.

`npm run check:pdfjs` verifies the declared, locked, installed, core, worker,
and viewer versions. It also verifies both annotation-viewer bundles against
the documented legacy exception.

## Shift Chromium verification

Run `npm run build` and start `npm run preview -- --host 127.0.0.1 --port 4173`.
Then run the browser flow smoke with the exact Chromium executable and complete
version shipped by the target Shift release:

```sh
SHIFT_CHROMIUM_EXECUTABLE="/absolute/path/to/Shift Chromium" \
SHIFT_CHROMIUM_VERSION="major.minor.build.patch" \
npm run smoke:shift
```

The smoke script rejects a version mismatch. It exercises upload, initial
download, and **Download again** for Compress, Merge, PDF-to-JPG, and Sign PDF.
The checked-in PDF fixture is non-sensitive. If the Shift executable, exact
version, preview server, browser harness, or required WASM network assets are
unavailable, the script reports a blocker instead of claiming browser coverage.
