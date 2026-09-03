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
 * A classic script in public/ rather than inline markup: the shipped headers
 * set script-src 'self' with no unsafe-inline.
 */
(function () {
  var RAIL_KEY = 'shiftPdfFavoriteRail';
  var OPEN_FILE_KEY = 'shiftHasOpenFile';
  var OPEN_FILE_SNAPSHOT_KEY = 'shiftOpenFileSnapshot';
  var OPEN_FILE_PENDING_CLASS = 'shift-open-file-pending';
  var HAS_OPEN_FILE_CLASS = 'shift-has-open-file';
  var OPEN_FILE_IN_TOOL_CLASS = 'shift-open-file-in-tool';
  var SKELETON_ATTR = 'data-shift-skeleton';
  var PENDING_FILE_ROW_ATTR = 'data-shift-pending-file';
  var REVEALED_PANEL_ATTR = 'data-shift-revealed';
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
      // The row container is parsed after #file-input, so keep watching until a
      // placeholder actually lands rather than leaving the card at its heading.
      return paintSkeleton();
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
