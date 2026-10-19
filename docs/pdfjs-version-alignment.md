# PDF.js version alignment

Programmatic PDF.js usage must go through `src/js/utils/pdfjs.ts`. It uses
the official legacy build and worker because the modern PDF.js 6 build relies
on APIs that are unavailable in the Shift Chromium runtime.

`public/pdfjs-viewer` is the official legacy full viewer distribution matching
the exact `pdfjs-dist` version pinned in `package.json` and `package-lock.json`.
Shift's form and signature viewer files,
signature fonts, and signature controls are preserved when the distribution is
refreshed.

`npm run check:pdfjs` verifies the declared, locked, installed, core, worker,
and viewer versions.

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
