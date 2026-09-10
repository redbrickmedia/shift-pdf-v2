/* Marks viewer.html as a Shift embed so shift-viewer-theme.css can restyle the
 * PDF.js chrome to match the app shell, and mirrors the shell's colour mode.
 *
 * This runs as a parser-blocking script in <head>, before viewer.mjs and before
 * any chrome paints, so the viewer never flashes its dark default.
 *
 * Every embed is themed the same way; the value only records which one it is.
 * `bentoSign` is the flag sign-pdf-page.ts puts on the iframe URL and viewer.mjs
 * reads to enable the signature editor, so it distinguishes the signing viewer
 * from a plain one for an exception the theme does not need today.
 *
 * The colour mode is read off the embedding document rather than passed on the
 * URL, so the three call sites that build a viewer iframe (sign-pdf-page,
 * form-filler-page, add-stamps) need to know nothing about theming. The frame
 * is same-origin, so `parent.document` is readable; the try/catch is there for
 * the standalone case where viewer.html is opened directly.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var signing =
    new URLSearchParams(document.location.search).get('bentoSign') === '1';

  root.dataset.shiftViewer = signing ? 'sign' : 'embed';

  function hostRoot() {
    try {
      if (window.parent && window.parent !== window) {
        return window.parent.document.documentElement;
      }
    } catch (err) {
      /* Cross-origin embed: fall back to this document's own preference. */
    }
    return null;
  }

  function preferredMode() {
    var host = hostRoot();
    if (host) return host.classList.contains('dark') ? 'dark' : 'light';
    return window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyMode(mode) {
    root.classList.remove('light', 'dark');
    root.classList.add(mode);
    /* `only <mode>` pins every light-dark() value in viewer.css to one branch,
       so nothing in the chrome follows the OS setting independently. */
    root.style.colorScheme = 'only ' + mode;
    /* The older build behind the stamps viewer branches on
       `@media (prefers-color-scheme: dark)` instead of light-dark(), which
       color-scheme cannot pin. That build guards each dark rule with
       `:where(html:not(.is-light))`, so this class is the switch that keeps its
       chrome light when the shell is light. The current build ignores it. */
    root.classList.toggle('is-light', mode === 'light');
  }

  applyMode(preferredMode());

  /* Follow the shell if the host flips colour mode while the viewer is open. */
  var host = hostRoot();
  if (host && typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      applyMode(preferredMode());
    }).observe(host, { attributes: true, attributeFilter: ['class'] });
  }
})();
