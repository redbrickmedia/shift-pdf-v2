/* Marks viewer.html as a Shift embed so shift-viewer-theme.css can restyle the
 * PDF.js chrome to match the app shell, and mirrors the shell's colour mode.
 *
 * This runs as a parser-blocking script in <head>, before viewer.mjs and before
 * any chrome paints, so the viewer never flashes its dark default.
 *
 * Every embed is themed the same way; the value only records which one it is.
 * `bentoSign` enables the PDF.js signature editor. Sign PDF also sets
 * `shiftLaunchpad` so the iframe uses the same chrome as View PDF; launchpad
 * wins for `data-shift-viewer`, and the editor still reads `bentoSign`.
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
  var params = new URLSearchParams(document.location.search);
  var signing = params.get('bentoSign') === '1';
  var launchpad = params.get('shiftLaunchpad') === '1';

  root.dataset.shiftViewer = launchpad
    ? 'launchpad'
    : signing
      ? 'sign'
      : 'embed';

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

  /* PDF.js reports invalid files on the console only. Forward that to the
     embedding page, which can show the error. Top-level viewer.html has no
     parent to notify. */
  if (window.parent && window.parent !== window) {
    var reportedDocumentError = false;
    var errorAttempts = 0;
    var errorTimer = window.setInterval(function () {
      errorAttempts += 1;
      var app = window.PDFViewerApplication;
      if (app && app.eventBus && typeof app.eventBus.on === 'function') {
        window.clearInterval(errorTimer);
        app.eventBus.on('documenterror', function (evt) {
          if (reportedDocumentError) return;
          reportedDocumentError = true;
          var message =
            evt && typeof evt.message === 'string' && evt.message.trim()
              ? evt.message.trim()
              : 'This PDF could not be opened. The file may be invalid or corrupted.';
          try {
            window.parent.postMessage(
              {
                channel: 'shift-pdf-viewer',
                event: 'document-error',
                message: message,
              },
              window.location.origin
            );
          } catch (postError) {
            /* Parent gone or origin rejected. The viewer has already logged. */
          }
        });
        return;
      }
      if (errorAttempts > 40) window.clearInterval(errorTimer);
    }, 50);
  }
})();
