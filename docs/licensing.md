# Licensing

This Shift fork is licensed under **AGPL-3.0-only**. There is no commercial license that waives AGPL obligations for the combined work.

::: tip Corresponding source
Each production deployment names its git revision on [`licensing.html`](/licensing.html) and links the pinned engine source. The same page and the repository [`NOTICE`](/NOTICE) file list third-party terms.
:::

## What you receive

The public repository is the corresponding source for the Shift shell, modifications, and build scripts. PyMuPDF, Ghostscript, and CoherentPDF ship from the app origin as pinned npm packages. Their package repositories and upstream projects are the corresponding source for those engines.

## AGPL processing engines

These engines run in the user's browser. Fetching them as part of the app is conveyance. A CDN of binaries is not a source offer, so the default build copies the packages into `wasm/` on this origin.

| Component       | Package                  | Version | License           | Source                                                                      |
| --------------- | ------------------------ | ------- | ----------------- | --------------------------------------------------------------------------- |
| **PyMuPDF**     | `@bentopdf/pymupdf-wasm` | 0.11.16 | AGPL-3.0-only     | [bentopdf-pymupdf-wasm](https://github.com/alam00000/bentopdf-pymupdf-wasm) |
| **Ghostscript** | `@bentopdf/gs-wasm`      | 0.1.1   | AGPL-3.0-only     | [bentopdf-gs-wasm](https://github.com/alam00000/bentopdf-gs-wasm)           |
| **CoherentPDF** | `coherentpdf`            | 2.5.5   | AGPL-3.0-or-later | [coherentpdf.js](https://github.com/coherentgraphics/coherentpdf.js)        |

Build instructions live in each package repository. Do not compile these engines into Shift Browser.

## Other notices

LibreOffice (MPL-2.0), qpdf (Apache-2.0), PDFium (BSD-3-Clause), and PDF.js (Apache-2.0) are documented in [`NOTICE`](/NOTICE). Those binaries also stay on the PDF app origin.

## FAQ

### Can I use this fork in a closed-source product?

No. AGPL-3.0 applies to this combined work. Shift cannot sell a waiver for Artifex or Coherent Graphics components.

### Do I need a license key?

No. There is no commercial license key and no dual-license offer on this fork.

### Where is the source for a live deployment?

Open `/licensing.html` on that origin. It names the deployed git revision and links each pinned engine.
