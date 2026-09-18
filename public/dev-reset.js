/*
 * Dev-only client wipe. Loaded only from /dev-reset.html so IndexedDB deletes
 * are not blocked by the main app's open connections (SavedPdfDatabase /
 * shift-pdf-open-file). Gated to localhost / 127.0.0.1.
 *
 * After a successful wipe the next home load re-seeds default favorites
 * (Compress / Merge / Convert / E-sign) via loadFavoriteToolIds — that is
 * intentional first-launch behaviour, not a failed clear.
 */
(function (root) {
  var KNOWN_IDB_NAMES = [
    'SavedPdfDatabase',
    'shift-pdf-open-file',
    'bentopdf-fonts',
  ];
  var DELETE_TIMEOUT_MS = 8000;

  function isDevHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function listStorageKeys(storage) {
    var keys = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        keys.push(storage.key(i));
      }
    } catch (error) {
      // private mode / blocked storage
    }
    return keys;
  }

  function clearWebStorage() {
    var localKeys = [];
    var sessionKeys = [];
    try {
      localKeys = listStorageKeys(localStorage);
      localStorage.clear();
    } catch (error) {
      console.warn('[shift-pdf reset] localStorage.clear failed', error);
    }
    try {
      sessionKeys = listStorageKeys(sessionStorage);
      sessionStorage.clear();
    } catch (error) {
      console.warn('[shift-pdf reset] sessionStorage.clear failed', error);
    }
    return { localKeys: localKeys, sessionKeys: sessionKeys };
  }

  function clearCookies() {
    try {
      document.cookie.split(';').forEach(function (part) {
        var name = part.split('=')[0] && part.split('=')[0].trim();
        if (!name) return;
        var expire = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = name + '=; ' + expire + '; path=/';
        document.cookie =
          name + '=; ' + expire + '; path=/; domain=' + location.hostname;
      });
    } catch (error) {
      console.warn('[shift-pdf reset] cookie clear failed', error);
    }
  }

  function deleteDatabase(name) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(status) {
        if (settled) return;
        settled = true;
        resolve({ name: name, status: status });
      }

      try {
        var request = indexedDB.deleteDatabase(name);
        request.onsuccess = function () {
          finish('deleted');
        };
        request.onerror = function () {
          finish('error');
        };
        // Stay pending on blocked — connections from other tabs may close.
        // A timeout prevents hanging forever when another tab keeps the DB.
        request.onblocked = function () {
          console.warn(
            '[shift-pdf reset] IndexedDB delete blocked:',
            name,
            '(close other tabs on this origin)'
          );
        };
        setTimeout(function () {
          finish('timeout');
        }, DELETE_TIMEOUT_MS);
      } catch (error) {
        console.warn('[shift-pdf reset] IndexedDB delete threw', name, error);
        finish('error');
      }
    });
  }

  async function collectDatabaseNames() {
    var names = KNOWN_IDB_NAMES.slice();
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
        var listed = await indexedDB.databases();
        for (var i = 0; i < listed.length; i++) {
          if (listed[i] && listed[i].name) names.push(listed[i].name);
        }
      }
    } catch (error) {
      console.warn(
        '[shift-pdf reset] indexedDB.databases() unavailable; using known names',
        error
      );
    }
    return Array.from(new Set(names));
  }

  async function clearCacheStorage() {
    try {
      if (typeof caches === 'undefined') return [];
      var keys = await caches.keys();
      await Promise.all(
        keys.map(function (key) {
          return caches.delete(key);
        })
      );
      return keys;
    } catch (error) {
      console.warn('[shift-pdf reset] caches clear failed', error);
      return [];
    }
  }

  async function unregisterServiceWorkers() {
    try {
      if (!('serviceWorker' in navigator)) return 0;
      var regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.map(function (registration) {
          return registration.unregister();
        })
      );
      return regs.length;
    } catch (error) {
      console.warn('[shift-pdf reset] SW unregister failed', error);
      return 0;
    }
  }

  /**
   * Wipe origin persistence. Safe to call only on a page that does not keep
   * IndexedDB connections open (this reset page).
   */
  async function resetClientPersistence() {
    clearCookies();
    var storage = clearWebStorage();
    var dbNames = await collectDatabaseNames();
    var dbResults = await Promise.all(dbNames.map(deleteDatabase));
    var cacheKeys = await clearCacheStorage();
    var swCount = await unregisterServiceWorkers();

    return {
      localKeys: storage.localKeys,
      sessionKeys: storage.sessionKeys,
      dbResults: dbResults,
      cacheKeys: cacheKeys,
      swCount: swCount,
    };
  }

  function resolveReturnPath(search) {
    try {
      var params = new URLSearchParams(search || '');
      var raw = params.get('return') || '/';
      // Same-origin path only — never bounce to an absolute external URL.
      if (raw.charAt(0) !== '/' || raw.indexOf('//') === 0) return '/';
      return raw;
    } catch (error) {
      return '/';
    }
  }

  async function runResetPage() {
    var status = document.getElementById('shift-dev-reset-status');
    function setStatus(text) {
      if (status) status.textContent = text;
    }

    if (!isDevHost(location.hostname)) {
      setStatus('Dev reset is only available on localhost / 127.0.0.1.');
      return;
    }

    setStatus('Clearing cookies, storage, IndexedDB, caches…');
    var report = await resetClientPersistence();
    console.log('[shift-pdf reset]', report);

    var blockedOrTimedOut = report.dbResults.some(function (result) {
      return result.status === 'timeout' || result.status === 'error';
    });
    if (blockedOrTimedOut) {
      setStatus(
        'Some IndexedDB deletes did not finish. Close other tabs on this origin, then reload this page.'
      );
      return;
    }

    setStatus('Done. Reloading as a first launch…');
    location.replace(resolveReturnPath(location.search));
  }

  root.shiftPdfDevReset = {
    KNOWN_IDB_NAMES: KNOWN_IDB_NAMES,
    isDevHost: isDevHost,
    resetClientPersistence: resetClientPersistence,
    resolveReturnPath: resolveReturnPath,
    runResetPage: runResetPage,
  };

  if (
    typeof document !== 'undefined' &&
    document.documentElement &&
    document.documentElement.getAttribute('data-shift-dev-reset') === '1'
  ) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        void runResetPage();
      });
    } else {
      void runResetPage();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
