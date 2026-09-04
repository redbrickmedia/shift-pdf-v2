/* Marks viewer.html as a Shift embed so shift-viewer-theme.css can restyle the
 * PDF.js chrome to match the app shell.
 *
 * This runs as a parser-blocking script in <head>, before viewer.mjs and before
 * any chrome paints, so the viewer never flashes its dark default.
 *
 * Every embed is themed the same way; the value only records which one it is.
 * `bentoSign` is the flag sign-pdf-page.ts puts on the iframe URL and viewer.mjs
 * reads to enable the signature editor, so it distinguishes the signing viewer
 * from a plain one for an exception the theme does not need today.
 */
(function () {
  'use strict';

  var signing =
    new URLSearchParams(document.location.search).get('bentoSign') === '1';

  document.documentElement.dataset.shiftViewer = signing ? 'sign' : 'embed';
})();
