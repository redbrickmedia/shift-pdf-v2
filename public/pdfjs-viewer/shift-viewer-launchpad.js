(function () {
  'use strict';

  var CHANNEL = 'shift-pdf-viewer';
  var NARROW_QUERY = '(max-width: 560px)';

  function element(id) {
    return document.getElementById(id);
  }

  function divider() {
    var node = document.createElement('span');
    node.className = 'shiftLaunchpadDivider';
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function fitButton(scaleSelect) {
    var button = document.createElement('button');
    button.id = 'shiftLaunchpadFit';
    button.className = 'toolbarButton shiftLaunchpadFit';
    button.type = 'button';
    button.setAttribute('aria-label', 'Fit page');
    button.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 6V2.75H6M10 2.75h3.25V6M13.25 10v3.25H10M6 13.25H2.75V10" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Fit</span>';
    button.addEventListener('click', function () {
      scaleSelect.value = 'page-fit';
      scaleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return button;
  }

  function pageTotal(source) {
    var total = document.createElement('span');
    total.id = 'shiftLaunchpadPageTotal';
    total.className = 'toolbarLabel';

    function sync() {
      var match = source.textContent.match(/\d+/);
      total.textContent = '/ ' + (match ? match[0] : '–');
    }

    sync();
    new MutationObserver(sync).observe(source, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    return total;
  }

  function prefersThumbnails() {
    return !(window.matchMedia && window.matchMedia(NARROW_QUERY).matches);
  }

  /* PDF.js nests the rail inside #toolbarViewerLeft, and launchpad mode hides
     that stock toolbar. A hidden ancestor still resolves computed styles on the
     rail, so it reads as visible while laying out at zero size — the rail has to
     leave that subtree. #outerContainer is already the positioned ancestor the
     stock open/close rules and the launchpad geometry both measure against. */
  function relocateRail(outer) {
    var rail = element('viewsManager');
    if (!rail || rail.parentElement === outer) return;
    outer.append(rail);
  }

  function buildControls() {
    var previous = element('previous');
    var pageNumber = element('pageNumber');
    var numPages = element('numPages');
    var next = element('next');
    var zoomOut = element('zoomOutButton');
    var scaleContainer = element('scaleSelectContainer');
    var scaleSelect = element('scaleSelect');
    var zoomIn = element('zoomInButton');
    var toggle = element('viewsManagerToggleButton');
    var outer = element('outerContainer');

    if (
      !previous ||
      !pageNumber ||
      !numPages ||
      !next ||
      !zoomOut ||
      !scaleContainer ||
      !scaleSelect ||
      !zoomIn ||
      !toggle ||
      !outer
    ) {
      return;
    }

    var controls = document.createElement('div');
    controls.id = 'shiftLaunchpadControls';
    controls.setAttribute('role', 'toolbar');
    controls.setAttribute('aria-label', 'PDF preview controls');

    var pageGroup = document.createElement('div');
    pageGroup.className = 'shiftLaunchpadControlGroup';
    pageGroup.append(previous, pageNumber, pageTotal(numPages), next);

    var zoomGroup = document.createElement('div');
    zoomGroup.className = 'shiftLaunchpadControlGroup';
    zoomGroup.append(zoomOut, scaleContainer, zoomIn);

    controls.append(
      pageGroup,
      divider(),
      zoomGroup,
      divider(),
      fitButton(scaleSelect)
    );
    outer.append(toggle, controls);

    var attempts = 0;
    var fitDocument = function () {
      scaleSelect.value = 'page-fit';
      scaleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    };
    var openThumbnails = function () {
      if (!prefersThumbnails()) {
        window.setTimeout(fitDocument, 0);
        return;
      }
      if (outer.classList.contains('viewsManagerOpen')) {
        window.setTimeout(fitDocument, 0);
        return;
      }
      if (!outer.classList.contains('viewsManagerMoving')) {
        toggle.click();
      }
      attempts += 1;
      if (!outer.classList.contains('viewsManagerOpen') && attempts < 100) {
        window.setTimeout(openThumbnails, 50);
      }
    };
    window.setTimeout(openThumbnails, 0);
  }

  function bindParentActions() {
    window.addEventListener('message', function (event) {
      if (
        event.source !== window.parent ||
        event.origin !== window.location.origin
      ) {
        return;
      }
      if (!event.data || event.data.channel !== CHANNEL) return;

      if (event.data.action === 'print') {
        element('printButton')?.click();
        return;
      }
      if (event.data.action === 'download') {
        element('downloadButton')?.click();
        window.parent.postMessage(
          { channel: CHANNEL, event: 'download-started' },
          window.location.origin
        );
      }
    });
  }

  function init() {
    if (document.documentElement.dataset.shiftViewer !== 'launchpad') return;
    // Ahead of buildControls, which bails out if any stock control is missing.
    // The rail must survive that case, since the toggle stays usable.
    var outer = element('outerContainer');
    if (outer) relocateRail(outer);
    buildControls();
    bindParentActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
