/*
 * Runs synchronously from <head>, before the sidebar markup is parsed, so the
 * rail paints in the shape the visitor left it in instead of correcting itself
 * afterwards. main.ts cannot do this job: it is a deferred module and does not
 * execute until after first paint, which is what made the collapsed rail snap
 * and the favourite pins pop in a frame or two late.
 *
 * The same script also applies the open-file signal (sessionStorage
 * shiftHasOpenFile) so tool pages do not flash an empty #drop-zone while
 * IndexedDB blobs hydrate, and paints a placeholder row from the stored file
 * name and size so the card is never blank. Blobs still arrive asynchronously
 * via seedToolOpenFile, which swaps the placeholder for the real row.
 *
 * It also settles the colour mode. startThemeSync() runs from main.ts on the
 * load event, which is later still than the deferred module itself, so every
 * document painted its light defaults first and corrected to dark a moment
 * later. This is a multi-page app, so that flash landed on the first load and
 * again on every navigation between tools.
 *
 * A classic script in public/ rather than inline markup: the shipped headers
 * set script-src 'self' with no unsafe-inline.
 *
 * Dev reset: on localhost / 127.0.0.1, ?dev-reset=1 bounces to /dev-reset.html
 * before this script paints from storage or main.ts opens IndexedDB. Wiping
 * from the live app page often leaves My PDFs intact because deleteDatabase
 * stays blocked while connections are open.
 */
(function () {
  try {
    var resetParams = new URLSearchParams(location.search);
    if (resetParams.get('dev-reset') === '1') {
      var resetHost = location.hostname;
      if (resetHost === 'localhost' || resetHost === '127.0.0.1') {
        resetParams.delete('dev-reset');
        var resetQuery = resetParams.toString();
        var resetReturn =
          location.pathname +
          (resetQuery ? '?' + resetQuery : '') +
          location.hash;
        location.replace(
          '/dev-reset.html?return=' + encodeURIComponent(resetReturn || '/')
        );
        return;
      }
    }
  } catch (resetError) {
    // Continue normal boot if URL parsing fails.
  }

  var RAIL_KEY = 'shiftPdfFavoriteRail';
  var OPEN_FILE_KEY = 'shiftHasOpenFile';
  var OPEN_FILE_SNAPSHOT_KEY = 'shiftOpenFileSnapshot';
  var OPEN_FILE_PENDING_CLASS = 'shift-open-file-pending';
  var HAS_OPEN_FILE_CLASS = 'shift-has-open-file';
  var OPEN_FILE_IN_TOOL_CLASS = 'shift-open-file-in-tool';
  var SKELETON_ATTR = 'data-shift-skeleton';
  var PENDING_FILE_ROW_ATTR = 'data-shift-pending-file';
  var REVEALED_PANEL_ATTR = 'data-shift-revealed';
  /* Keep the viewer names below in step with tool-viewer-layout.ts; its test
     asserts the literals match. */
  var TOOL_VIEWER_CLASS = 'shift-tool-viewer';
  var TOOL_VIEWER_PENDING_CLASS = 'shift-tool-viewer-pending';
  var VIEWER_BAR_CLASS = 'shift-pdf-viewer-header';
  var VIEWER_TITLE_CLASS = 'shift-pdf-viewer-heading';
  var VIEWER_ACTIONS_CLASS = 'shift-pdf-viewer-actions';
  var VIEWER_ACTIONS_ATTR = 'data-shift-viewer-actions';
  var VIEWER_FEATURE_ATTR = 'data-viewer-chrome';
  var VIEWER_SLOT_ATTR = 'data-shift-viewer-slot';
  var VIEWER_ROOT_IDS = [
    'embed-pdf-wrapper',
    'signature-editor',
    'form-filler-options',
    'cropper-editor',
    'compare-viewer',
    'viewer-card',
  ];
  /* Needs a file per slot, so one selection must not claim the layout. */
  var MULTI_FILE_VIEWER_ROOT_IDS = ['compare-viewer'];
  var PENDING_VIEWER_ROOT_IDS = VIEWER_ROOT_IDS.filter(function (id) {
    return MULTI_FILE_VIEWER_ROOT_IDS.indexOf(id) === -1;
  });
  var VIEWER_ACTION_IDS = [
    'download-edited-pdf',
    'process-btn',
    'crop-button',
    'save-stamped-btn',
  ];
  var SIDEBAR_THUMB_STORE_KEY = 'shiftSidebarThumbnails';
  var SIDEBAR_THUMB_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
  var MAX_SIDEBAR_ROWS = 3;
  /* Keep these two in sync with open-file-store.ts; open-file-boot.test.ts
     asserts the literals match. */
  var PANEL_REVEAL_PATTERN = '^file-controls$|-options$|-panel$';
  var PANEL_REVEAL_SKIP_PATTERN = '^(?:completion-panel|preview-panel)$';
  var MAX_SKELETON_ROWS = 6;
  var MAX_STORED_LENGTH = 8192;
  var MAX_PINS = 40;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function readSession(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /* Keep this in step with theme.ts: standalone builds are dark, and a build
     wired to a host follows the colour-scheme query the host maintains. The
     flag comes from the script tag because sidebarBootPlugin resolves
     VITE_HOST_API_ROOT at build time and a classic script cannot read it.

     startThemeSync() still owns the mode afterwards — it re-applies the same
     value and registers the listener that follows the host mid-session — so
     this only moves the first application ahead of paint. */
  var bootScript = document.currentScript;
  var hosted = !!bootScript && bootScript.hasAttribute('data-shift-hosted');
  var colorMode =
    hosted &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'light'
      : 'dark';
  document.documentElement.classList.add(colorMode);
  document.documentElement.style.colorScheme = colorMode;

  if (read('shiftSidebarCollapsed') === 'true') {
    document.documentElement.classList.add('shift-sidebar-collapsed-pending');
  }

  /* One open-file pass per document. The pass below watches the parser until
     DOMContentLoaded, so if this script runs again on a live document the
     earlier observer would still be reacting to the new DOM. `painted` is what
     stops a retired placeholder from being put straight back. */
  if (window.shiftOpenFileBoot && window.shiftOpenFileBoot.observer) {
    window.shiftOpenFileBoot.observer.disconnect();
  }
  var openFilePass = (window.shiftOpenFileBoot = {
    observer: null,
    painted: false,
    sidebarPainted: false,
  });

  // Optimistic hide for tool drop zones. Refined once #file-input exists so
  // image/non-PDF tools and home/My PDFs keep their pickers.
  if (readSession(OPEN_FILE_KEY) === '1') {
    document.documentElement.classList.add(OPEN_FILE_PENDING_CLASS);

    function acceptsPdf(input) {
      var accept = (input.accept || '').toLowerCase();
      if (!accept) return true;
      return accept.split(',').some(function (token) {
        token = token.trim();
        return (
          token === '*' ||
          token === '*/*' ||
          token === 'application/pdf' ||
          token === '.pdf'
        );
      });
    }

    function readSnapshot() {
      var raw = readSession(OPEN_FILE_SNAPSHOT_KEY);
      if (!raw || raw.length > MAX_STORED_LENGTH) return [];
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      var entries = [];
      for (
        var i = 0;
        i < parsed.length && entries.length < MAX_SKELETON_ROWS;
        i++
      ) {
        var entry = parsed[i];
        if (!entry || typeof entry.name !== 'string') continue;
        entries.push({
          name: entry.name,
          size: typeof entry.size === 'number' ? entry.size : 0,
        });
      }
      return entries;
    }

    function formatBytes(bytes) {
      if (!bytes) return '';
      var units = ['Bytes', 'KB', 'MB', 'GB'];
      var index = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
      );
      var value = bytes / Math.pow(1024, index);
      return (index === 0 ? value : value.toFixed(1)) + ' ' + units[index];
    }

    /* Mirrors the row every tool builds into #file-display-area, so the swap to
       the real row is a text change rather than a jump. Values come from the
       user's own filenames: textContent only, never markup. */
    function buildSkeletonRow(entry) {
      var row = document.createElement('div');
      row.setAttribute(SKELETON_ATTR, '');
      row.className =
        'flex items-center justify-between bg-gray-700 p-3 rounded-lg text-sm shift-file-skeleton';
      row.setAttribute('aria-hidden', 'true');

      var info = document.createElement('div');
      info.className = 'flex flex-col overflow-hidden';

      var name = document.createElement('div');
      name.className = 'truncate font-medium text-gray-200 text-sm mb-1';
      name.textContent = entry.name;

      var meta = document.createElement('div');
      meta.className = 'text-xs text-gray-400 shift-file-skeleton-meta';
      meta.textContent = formatBytes(entry.size);

      info.appendChild(name);
      info.appendChild(meta);

      var action = document.createElement('span');
      action.className = 'ml-4 flex-shrink-0 shift-file-skeleton-action';

      row.appendChild(info);
      row.appendChild(action);
      return row;
    }

    /* Most tools own a #file-display-area for the row. Merge and the convert hub
       build their lists inside sections that ship hidden, so there the rows take
       the slot the hidden drop zone left behind — otherwise those two cards sit
       empty at their heading until the blobs land. */
    function paintSkeleton() {
      // Once is enough per document: the placeholder is retired when the tool
      // paints its own row, and painting it again would undo that.
      if (openFilePass.painted) return true;
      if (document.querySelector('[' + SKELETON_ATTR + ']')) return true;

      var entries = readSnapshot();
      if (entries.length === 0) {
        entries = [{ name: 'Loading your file…', size: 0 }];
      }

      var area = document.getElementById('file-display-area');
      if (area) {
        if (area.children.length > 0) return true;
        for (var i = 0; i < entries.length; i++) {
          area.appendChild(buildSkeletonRow(entries[i]));
        }
        openFilePass.painted = true;
        return true;
      }

      var drop = document.getElementById('drop-zone');
      if (!drop || !drop.parentNode) return false;

      var holder = document.createElement('div');
      holder.setAttribute(SKELETON_ATTR, '');
      holder.className = 'mt-4 space-y-2';
      for (var j = 0; j < entries.length; j++) {
        holder.appendChild(buildSkeletonRow(entries[j]));
      }
      drop.parentNode.insertBefore(holder, drop.nextSibling);
      openFilePass.painted = true;
      return true;
    }

    /* The sidebar list ships empty and hidden, and main.ts cannot fill it until
       the open-file store resolves — measured tens of milliseconds after the new
       document is revealed. A cross-document view transition holds the previous,
       populated rail on screen for that gap, so it reads as the selected file
       disappearing rather than arriving late. Same snapshot and same row shape
       as renderPendingSidebarFiles in workspace-files.ts, which takes the rows
       over once it runs, so the handover changes nothing on screen.

       Unlike the tool card this also matters on My PDFs, so it sits outside
       refineOpenFileClass and its early return for the library pages. */
    function buildSidebarRow(entry) {
      var row = document.createElement('a');
      row.className = 'shift-nav-link shift-open-file-item is-selected';
      row.setAttribute(PENDING_FILE_ROW_ATTR, '');
      // No href: the row is replaced with the wired one within a few frames,
      // and a placeholder should not take a tab stop in the meantime.
      row.setAttribute('aria-hidden', 'true');

      var preview = document.createElement('span');
      preview.className = 'shift-nav-icon shift-open-file-preview is-empty';
      preview.setAttribute('aria-hidden', 'true');

      var canvas = document.createElement('canvas');
      canvas.className = 'shift-open-file-preview-canvas';
      preview.appendChild(canvas);

      var thumbnail = readThumbnail(entry);
      if (thumbnail) {
        preview.style.backgroundImage = 'url("' + thumbnail + '")';
        preview.classList.remove('is-empty');
      }

      var label = document.createElement('span');
      label.className = 'shift-nav-label';
      label.textContent = entry.name;

      var chip = document.createElement('span');
      chip.className = 'shift-open-file-selected-label';
      chip.textContent = 'Selected';

      row.appendChild(preview);
      row.appendChild(label);
      row.appendChild(chip);
      return row;
    }

    /* Cached bitmaps of the first page, written by workspace-files.ts. Session
       storage is user-writable, so only adopt what is safe inside a CSS url(). */
    function readThumbnail(entry) {
      var raw = readSession(SIDEBAR_THUMB_STORE_KEY);
      if (!raw || raw.length > MAX_STORED_LENGTH * 8) return '';
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return '';
      }
      if (!parsed || typeof parsed !== 'object') return '';
      var value = parsed[entry.name + '|' + entry.size];
      return typeof value === 'string' && SIDEBAR_THUMB_DATA_URL.test(value)
        ? value
        : '';
    }

    function paintSidebarFiles() {
      if (openFilePass.sidebarPainted) return true;

      var list = document.getElementById('shift-open-files-list');
      if (!list) return false;
      openFilePass.sidebarPainted = true;
      if (list.childElementCount > 0) return true;

      var entries = readSnapshot();
      if (entries.length === 0) return true;

      var count = Math.min(entries.length, MAX_SIDEBAR_ROWS);
      for (var i = 0; i < count; i++) {
        list.appendChild(buildSidebarRow(entries[i]));
      }
      if (entries.length > count) {
        list.appendChild(buildOverflowRow(entries.length - count));
      }
      list.hidden = false;
      return true;
    }

    function buildOverflowRow(remaining) {
      var row = document.createElement('span');
      row.className =
        'shift-nav-link shift-open-file-item shift-open-files-more';
      row.setAttribute(PENDING_FILE_ROW_ATTR, '');
      row.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      label.className = 'shift-nav-label';
      label.textContent = remaining + ' more';
      row.appendChild(label);
      return row;
    }

    /* Every tool ships its options panel with Tailwind's `hidden` and only
       drops the class from its own module, which cannot run until main.ts has
       awaited DOMContentLoaded and the IndexedDB blob. That is the pop this
       reveals away, without editing 117 pages or 111 tool modules.

       Scoped to direct children of the card on purpose: conditional sub-option
       groups and mode panels (#page-mode-panel, #visible-sig-options,
       #custom-settings-panel) are nested inside the main panel, so structure
       excludes them and the skip list stays short. */
    function revealPanels() {
      var card = document.getElementById('tool-uploader');
      if (!card) return;

      var match = new RegExp(PANEL_REVEAL_PATTERN);
      var skip = new RegExp(PANEL_REVEAL_SKIP_PATTERN);

      for (var i = 0; i < card.children.length; i++) {
        var panel = card.children[i];
        if (!panel.id || !panel.classList.contains('hidden')) continue;
        if (!match.test(panel.id) || skip.test(panel.id)) continue;
        panel.classList.remove('hidden');
        panel.setAttribute(REVEALED_PANEL_ATTR, '');
      }
    }

    /* Viewer tools open into a full-panel viewer, and tool-viewer-layout.ts can
       only switch to it once the module has run and the blob has resolved —
       around 250ms after the card has already painted, which read as the tool
       loading twice. The layout is the same in both states, so claim it here
       and let the reserved pane stand in for the viewer.

       Mirrors ensureViewerChrome + relocateDownloadButtons in
       tool-viewer-layout.ts, which take the markup over as-is. The module also
       owns the way out: it drops the pending class when the viewer arrives, and
       on a backstop if it never does. */
    function paintViewerLayout(card) {
      var hasViewer = PENDING_VIEWER_ROOT_IDS.some(function (id) {
        return !!document.getElementById(id);
      });
      if (!hasViewer) return true;
      if (!paintToolHeader()) return false;

      var bar = findToolHeaderBar(card);
      document.body.classList.add(TOOL_VIEWER_CLASS);
      document.body.classList.add(TOOL_VIEWER_PENDING_CLASS);
      relocateViewerActions(
        bar && bar.querySelector('[' + VIEWER_ACTIONS_ATTR + ']')
      );
      return true;
    }

    /* Process / Download are authored at the foot of the card and belong in the
       header row while viewing. The marker records where each came from: the
       actions row is display:none outside the viewer layout, so a button left
       behind after the fallback would disappear from the card. */
    function relocateViewerActions(actions) {
      if (!actions) return;

      for (var i = 0; i < VIEWER_ACTION_IDS.length; i++) {
        var id = VIEWER_ACTION_IDS[i];
        var button = document.getElementById(id);
        if (!button || actions.contains(button)) continue;
        if (!button.parentNode) continue;
        if (
          !document.querySelector('[' + VIEWER_SLOT_ATTR + '="' + id + '"]')
        ) {
          var slot = document.createElement('span');
          slot.setAttribute(VIEWER_SLOT_ATTR, id);
          slot.hidden = true;
          button.parentNode.insertBefore(slot, button);
        }
        actions.appendChild(button);
      }
    }

    function refineOpenFileClass() {
      var body = document.body;
      if (!body) return false;

      if (
        body.classList.contains('shift-home') ||
        document.getElementById('shift-my-pdfs')
      ) {
        document.documentElement.classList.remove(OPEN_FILE_PENDING_CLASS);
        return true;
      }

      var input = document.getElementById('file-input');
      if (!input) return false;

      document.documentElement.classList.remove(OPEN_FILE_PENDING_CLASS);
      body.classList.add(HAS_OPEN_FILE_CLASS);
      if (!acceptsPdf(input)) return true;

      body.classList.add(OPEN_FILE_IN_TOOL_CLASS);
      // Behind the accept check with the placeholder: on a tool that cannot use
      // this file, revealing #file-controls would hide the picker (see the
      // drop-zone rule in shift-theme.css) and strand the card with no way in.
      revealPanels();
      var card = document.getElementById('tool-uploader');
      var viewerDone = !card || paintViewerLayout(card);
      // The row container is parsed after #file-input, so keep watching until a
      // placeholder actually lands rather than leaving the card at its heading.
      return paintSkeleton() && viewerDone;
    }

    function stopOpenFileObserver() {
      if (openFilePass.observer) {
        openFilePass.observer.disconnect();
        openFilePass.observer = null;
      }
    }

    function pumpOpenFile() {
      // The signal can be withdrawn while the page is still parsing: the seed
      // finds the blob gone and hands the tool back its picker. Putting the
      // placeholder and panels back after that is worse than the pop.
      if (readSession(OPEN_FILE_KEY) !== '1') {
        stopOpenFileObserver();
        return true;
      }

      var sidebarDone = paintSidebarFiles();
      return refineOpenFileClass() && sidebarDone;
    }

    // The panels are parsed after the row container, so unlike the class work
    // this cannot stop at the first success: keep pumping until the parser is
    // done, then let DOMContentLoaded tear the observer down.
    if (!pumpOpenFile() || document.readyState === 'loading') {
      openFilePass.observer = new MutationObserver(pumpOpenFile);
      openFilePass.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      // Backstop for pages that never grow the elements we are waiting on.
      document.addEventListener('DOMContentLoaded', function () {
        pumpOpenFile();
        document.documentElement.classList.remove(OPEN_FILE_PENDING_CLASS);
        stopOpenFileObserver();
      });
    }
  }

  function isNonToolHeaderPage() {
    var body = document.body;
    return (
      (body && body.classList.contains('shift-home')) ||
      !!document.getElementById('shift-my-pdfs') ||
      !!document.getElementById('tool-grid') ||
      !!document.getElementById('convert-hub') ||
      !!document.getElementById('shift-pdf-viewer')
    );
  }

  function findToolHeaderBar(card) {
    var host = card && card.parentNode;
    return (
      (host && host.querySelector
        ? host.querySelector(':scope > .' + VIEWER_BAR_CLASS)
        : null) ||
      (card && card.querySelector('.' + VIEWER_BAR_CLASS))
    );
  }

  function placeToolHeaderBar(bar, card) {
    var host = card.parentNode;
    if (host && bar.parentNode !== host) {
      host.insertBefore(bar, card);
    }
  }

  /* Title + Reset/Save have to be outside the gray card on the first painted
     frame. Pages still author h1 inside #tool-uploader; this script runs from
     <head> and lifts that row while the parser is still working, so main.ts
     does not snap the heading out after paint. Mirrors ensureViewerChrome. */
  function paintToolHeader() {
    if (isNonToolHeaderPage()) return true;

    var card = document.getElementById('tool-uploader');
    if (!card) return document.readyState !== 'loading';

    var bar = findToolHeaderBar(card);
    if (!bar) {
      var heading = card.querySelector('h1');
      if (!heading) return document.readyState !== 'loading';
      if (document.readyState === 'loading' && !heading.nextElementSibling) {
        return false;
      }

      bar = document.createElement('header');
      bar.className = VIEWER_BAR_CLASS;

      var title = document.createElement('div');
      title.className = VIEWER_TITLE_CLASS;

      var subtitle =
        heading.nextElementSibling &&
        heading.nextElementSibling.tagName === 'P'
          ? heading.nextElementSibling
          : null;

      title.appendChild(heading);
      if (subtitle) {
        subtitle.setAttribute(VIEWER_FEATURE_ATTR, 'subtitle');
        title.appendChild(subtitle);
      }

      var actions = document.createElement('div');
      actions.className = VIEWER_ACTIONS_CLASS;
      actions.setAttribute(VIEWER_ACTIONS_ATTR, '');
      actions.setAttribute('role', 'toolbar');
      actions.setAttribute('aria-label', 'PDF actions');

      bar.appendChild(title);
      bar.appendChild(actions);
    }

    placeToolHeaderBar(bar, card);
    return true;
  }

  /* Every viewer tool should read as one panel: heading row and document inside
     the same card. sign-pdf and crop-pdf author their viewer as a sibling of
     #tool-uploader, so the shell moves it in. Mirrors adoptViewerIntoCard in
     tool-viewer-layout.ts, and runs here because the move has to beat the tool
     mounting its PDF.js iframe — reparenting one discards its browsing context
     and reloads the document — and because doing it after first paint would
     reintroduce the jump the pending layout above removes.

     Outside the open-file branch: the structure is the same whether or not a
     file is waiting. */
  function adoptViewerIntoCard() {
    var card = document.getElementById('tool-uploader');
    if (!card) return false;

    for (var i = 0; i < VIEWER_ROOT_IDS.length; i++) {
      var viewer = document.getElementById(VIEWER_ROOT_IDS[i]);
      if (!viewer || card.contains(viewer)) continue;
      if (viewer.querySelector('iframe')) continue;
      card.appendChild(viewer);
      // One viewer per page, so there is nothing left to watch for.
      return true;
    }
    return false;
  }

  if (!adoptViewerIntoCard()) {
    var viewerObserver = new MutationObserver(function () {
      if (adoptViewerIntoCard()) viewerObserver.disconnect();
    });
    viewerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // Backstop for the pages that never grow one.
    document.addEventListener('DOMContentLoaded', function () {
      adoptViewerIntoCard();
      viewerObserver.disconnect();
    });
  }

  if (!paintToolHeader()) {
    var headerObserver = new MutationObserver(function () {
      if (paintToolHeader()) headerObserver.disconnect();
    });
    headerObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener('DOMContentLoaded', function () {
      paintToolHeader();
      headerObserver.disconnect();
    });
  }

  var raw = read(RAIL_KEY);
  if (!raw || raw.length > MAX_STORED_LENGTH) return;

  var pins;
  try {
    pins = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(pins) || pins.length === 0) return;

  // The rail lives in <body>, so it does not exist yet. Watching for it costs
  // one observer and fires while the parser is still working, ahead of paint.
  var observer = new MutationObserver(function () {
    var rail = document.getElementById('shift-favorite-tools');
    if (!rail) return;
    observer.disconnect();
    render(rail);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  function pageId(pathname) {
    var file = pathname.replace(/\/+$/, '').split('/').pop() || '';
    var page = file.replace(/\.html$/, '');
    return page === '' || page === 'index' ? 'index' : page;
  }

  function render(rail) {
    var current = pageId(location.pathname);
    var rendered = 0;

    for (var i = 0; i < pins.length && i < MAX_PINS; i++) {
      var pin = pins[i];
      if (
        !pin ||
        typeof pin.name !== 'string' ||
        typeof pin.href !== 'string'
      ) {
        continue;
      }

      var url;
      try {
        url = new URL(pin.href, location.href);
      } catch {
        continue;
      }
      // Cached values are only ever written by this app, but a pin is a link:
      // resolve it and drop anything that is not one of our own pages, so a
      // poisoned cache cannot plant a javascript: or cross-origin target.
      if (url.origin !== location.origin || !/\.html$/.test(url.pathname)) {
        continue;
      }

      var item = document.createElement('div');
      item.className = 'shift-favorite-item';

      var link = document.createElement('a');
      link.href = url.href;
      link.className = 'shift-nav-link shift-favorite-link';
      if (pageId(url.pathname) === current) {
        link.className += ' is-active';
        link.setAttribute('aria-current', 'page');
      }

      var glyph = typeof pin.icon === 'string' ? pin.icon : '';
      var icon = document.createElement('i');
      if (glyph.indexOf('ph-') === 0) {
        icon.className =
          'ph ' + glyph + ' shift-tool-icon shift-tool-icon-ph shift-nav-icon';
      } else {
        icon.className = 'shift-tool-icon shift-tool-icon-ph shift-nav-icon';
        if (glyph) icon.setAttribute('data-lucide', glyph);
      }

      var label = document.createElement('span');
      label.className = 'shift-nav-label';
      label.textContent = pin.name;

      link.appendChild(icon);
      link.appendChild(label);
      item.appendChild(link);
      rail.appendChild(item);
      rendered++;
    }

    // No remove button here on purpose: it needs a click handler to mean
    // anything, and main.ts replaces this markup with the wired version on
    // load. A dead X would be worse than one that arrives with its handler.
    void rendered;
  }
})();
