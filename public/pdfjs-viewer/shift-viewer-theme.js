/* Flags the signing embed of viewer.html so shift-viewer-theme.css can scope
 * the Shift theme to it and leave the form-filler embed on stock PDF.js.
 *
 * This runs as a parser-blocking script in <head>, before viewer.mjs and before
 * any chrome paints, so the viewer never flashes its dark default. `bentoSign`
 * is the same flag sign-viewer.html adds to the URL and viewer.mjs reads to
 * enable the signature editor.
 */
(function () {
  'use strict';

  if (new URLSearchParams(document.location.search).get('bentoSign') === '1') {
    document.documentElement.dataset.shiftViewer = 'sign';
  }
})();
