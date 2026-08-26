/*
 * Runs synchronously from <head>, before the sidebar markup is parsed, so the
 * rail paints in the shape the visitor left it in instead of correcting itself
 * afterwards. main.ts cannot do this job: it is a deferred module and does not
 * execute until after first paint, which is what made the collapsed rail snap
 * and the favourite pins pop in a frame or two late.
 *
 * A classic script in public/ rather than inline markup: the shipped headers
 * set script-src 'self' with no unsafe-inline.
 */
(function () {
  var RAIL_KEY = 'shiftPdfFavoriteRail';
  var MAX_STORED_LENGTH = 8192;
  var MAX_PINS = 40;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  if (read('shiftSidebarCollapsed') === 'true') {
    document.documentElement.classList.add('shift-sidebar-collapsed-pending');
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
    var nav = document.getElementById('shift-favorites-nav');
    if (!nav) return;
    observer.disconnect();
    render(nav);
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

  function render(nav) {
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
      nav.appendChild(item);
      rendered++;
    }

    // No remove button here on purpose: it needs a click handler to mean
    // anything, and main.ts replaces this markup with the wired version on
    // load. A dead X would be worse than one that arrives with its handler.
    if (rendered === 0) return;
    var section = document.getElementById('shift-favorites');
    if (section) section.hidden = false;
  }
})();
