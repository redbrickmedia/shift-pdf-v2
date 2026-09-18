(function () {
  'use strict';

  var CHANNEL = 'shift-pdf-viewer';
  var NARROW_QUERY = '(max-width: 560px)';
  /* PDF.js paints thumbnails on a fixed 126px canvas (THUMBNAIL_WIDTH) and
     writes that height inline. Figma's PDF/Page Thumbnail is 156px wide with a
     2px border inside that box, so the bitmap fills a 152px content area. */
  var THUMB_NATIVE_WIDTH = 126;
  var THUMB_DESIGN_WIDTH = 156;
  var THUMB_BORDER_WIDTH = 2;
  var THUMB_CONTENT_WIDTH = THUMB_DESIGN_WIDTH - THUMB_BORDER_WIDTH * 2;
  var THUMB_SCALE = THUMB_CONTENT_WIDTH / THUMB_NATIVE_WIDTH;

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

  /* PDF.js sets .thumbnailImageContainer height from the 126px canvas. Rewrite
     width/height to the 156px border-box (152px content) whenever that inline
     height changes, keeping the aspect ratio so the bitmap is not stretched. */
  function scaleThumbnail(container) {
    if (
      !container ||
      !container.classList ||
      !container.classList.contains('thumbnailImageContainer')
    ) {
      return;
    }
    if (container.dataset.launchpadScaling === '1') return;

    var height = parseFloat(container.style.height);
    if (!height) return;

    var scaled = container.dataset.launchpadScaledHeight;
    if (scaled && Math.abs(height - parseFloat(scaled)) < 0.5) {
      return;
    }

    /* Border-box height = scaled content height + top/bottom border. Mark the
       dataset before writing style so the MutationObserver cannot re-enter and
       scale the already-scaled value. */
    var next = height * THUMB_SCALE + THUMB_BORDER_WIDTH * 2;
    container.dataset.launchpadScaling = '1';
    container.dataset.launchpadScaledHeight = String(next);
    container.style.width = THUMB_DESIGN_WIDTH + 'px';
    container.style.height = next + 'px';
    container.dataset.launchpadScaling = '0';
  }

  function scaleAllThumbnails(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll
      ? scope.querySelectorAll('.thumbnailImageContainer')
      : [];
    for (var i = 0; i < nodes.length; i += 1) {
      scaleThumbnail(nodes[i]);
    }
  }

  function watchThumbnails() {
    var view = element('thumbnailsView');
    if (!view || view.dataset.launchpadThumbWatch === '1') return;
    view.dataset.launchpadThumbWatch = '1';

    scaleAllThumbnails(view);
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (record.type === 'attributes' && record.target) {
          scaleThumbnail(record.target);
        }
        if (record.type === 'childList') {
          scaleAllThumbnails(view);
        }
      }
    }).observe(view, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
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
    watchThumbnails();
    buildControls();
    bindParentActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
