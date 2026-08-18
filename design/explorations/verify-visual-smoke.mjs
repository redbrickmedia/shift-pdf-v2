/**
 * Click-through smoke test for the Shift reskin.
 *
 * The theme retints ~130 Bento pages by remapping Tailwind's colour tokens, so
 * the only reliable check is what a browser actually paints: this drives the
 * real UI and, on every page and state, resolves the computed text/background
 * pair for each text node, flags dark surfaces the remap missed, and checks the
 * fixed sidebar never covers content. It also injects Bento's hand-written CSS
 * classes, which carry literal colours the token remap cannot reach and mostly
 * only render after a file is loaded.
 *
 * Playwright is deliberately not a project dependency, so install it before use:
 *   npm run dev
 *   npm i -D playwright && npx playwright install chromium
 *   node design/explorations/verify-visual-smoke.mjs
 *
 * BASE overrides the dev-server URL, SHOTS the screenshot directory.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const SHOTS =
  process.env.SHOTS ||
  join(dirname(fileURLToPath(import.meta.url)), 'smoke-shots');
mkdirSync(SHOTS, { recursive: true });

const PAGES = [
  ['home', '/index.html', '.tool-card'],
  ['merge-pdf', '/merge-pdf.html', 'body'],
  ['compress-pdf', '/compress-pdf.html', 'body'],
  ['pdf-multi-tool', '/pdf-multi-tool.html', 'body'],
  ['pdf-workflow', '/pdf-workflow.html', 'body'],
  ['pdf-to-text', '/pdf-to-text.html', 'body'],
  ['wasm-settings', '/wasm-settings.html', 'body'],
  ['form-filler', '/form-filler.html', 'body'],
  ['digital-sign-pdf', '/digital-sign-pdf.html', 'body'],
  ['licensing', '/licensing.html', 'body'],
  ['pdf-editor', '/pdf-editor.html', 'body'],
  ['organize-pdf', '/organize-pdf.html', 'body'],
  ['pdf-layers', '/pdf-layers.html', 'body'],
  ['tools', '/tools.html', 'body'],
  ['compare-pdfs', '/compare-pdfs.html', 'body'],
];

/** Injected into the page: audit what the browser actually renders. */
const AUDIT = () => {
  // Tailwind v4 serialises its palette as oklch(), so a naive rgb-only parser
  // silently skips saturated button fills and invents white-on-white findings.
  const oklch = (L, C, H) => {
    const h = (H * Math.PI) / 180;
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const [r, g, bb] = lin.map((v) => {
      const c = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v;
      return Math.max(0, Math.min(255, Math.round(c * 255)));
    });
    return { r, g, b: bb, a: 1 };
  };

  const parse = (c) => {
    if (!c || c === 'transparent' || c === 'none') return null;
    const ok = c.match(
      /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/
    );
    if (ok) {
      const L = ok[2] === '%' ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
      const col = oklch(L, parseFloat(ok[3]), parseFloat(ok[4]));
      col.a = ok[5] === undefined ? 1 : parseFloat(ok[5]);
      return col;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    if (parseFloat(s.opacity) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  // Effective background behind an element, plus whether a gradient/image is involved.
  const bgOf = (el) => {
    let node = el;
    let hasImage = false;
    while (node && node !== document.documentElement.parentNode) {
      const s = getComputedStyle(node);
      if (s.backgroundImage && s.backgroundImage !== 'none') hasImage = true;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0.95) return { color: c, hasImage };
      if (c && c.a > 0) {
        const parent = bgOf(node.parentElement || document.body);
        return { color: over(c, parent.color), hasImage };
      }
      node = node.parentElement;
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 }, hasImage };
  };

  const results = {
    invisibleText: [],
    darkSurfaces: [],
    underSidebar: [],
    overflowRight: [],
    fonts: {},
  };

  // The shell gives the main panel its own scrollport, so the document no
  // longer reports overflow; measure whichever element actually scrolls.
  const port =
    getComputedStyle(document.body).overflowY === 'auto'
      ? document.body
      : document.documentElement;
  results.scrollWidth = port.scrollWidth;
  results.innerWidth = port.clientWidth;
  results.horizontalOverflow = port.scrollWidth > port.clientWidth + 2;

  const sidebar = document.getElementById('shift-sidebar');
  const sbRect =
    sidebar && visible(sidebar) ? sidebar.getBoundingClientRect() : null;
  const sbFixed = sidebar
    ? getComputedStyle(sidebar).position === 'fixed'
    : false;

  const label = (el) => {
    const cls = (el.className || '').toString().slice(0, 70);
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
  };

  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);

    // Track font families actually in use.
    const fam = s.fontFamily.split(',')[0].replace(/["']/g, '');
    results.fonts[fam] = (results.fonts[fam] || 0) + 1;

    const rect = el.getBoundingClientRect();

    // Text nodes owned directly by this element.
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();

    if (text.length > 1) {
      const fg = parse(s.color);
      const { color: bg, hasImage } = bgOf(el);
      if (fg && bg && !hasImage) {
        const eff = fg.a < 1 ? over(fg, bg) : fg;
        const ratio = contrast(eff, bg);
        if (ratio < 2.5) {
          results.invisibleText.push({
            el: label(el),
            text: text.slice(0, 55),
            color: s.color,
            bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
            ratio: Math.round(ratio * 100) / 100,
          });
        }
      }
    }

    // Large dark surfaces are the giveaway for a missed dark-theme override.
    const ownBg = parse(s.backgroundColor);
    if (ownBg && ownBg.a > 0.6 && rect.width * rect.height > 15000) {
      const L = lum(ownBg);
      const isScrim =
        /bg-black/.test(el.className || '') ||
        s.position === 'fixed' ||
        el.id === 'shift-sidebar';
      if (L < 0.15 && !isScrim) {
        results.darkSurfaces.push({
          el: label(el),
          bg: s.backgroundColor,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        });
      }
    }

    // Content sliding under the fixed sidebar.
    if (sbRect && sbFixed && text.length > 1 && !sidebar.contains(el)) {
      if (rect.left < sbRect.right - 2 && rect.right > sbRect.left) {
        results.underSidebar.push({
          el: label(el),
          text: text.slice(0, 40),
          left: Math.round(rect.left),
          sidebarRight: Math.round(sbRect.right),
        });
      }
    }

    // Anything pushing past the right edge of the viewport.
    if (
      rect.width > 4 &&
      rect.right > window.innerWidth + 3 &&
      s.position !== 'fixed'
    ) {
      results.overflowRight.push({
        el: label(el),
        right: Math.round(rect.right),
        viewport: window.innerWidth,
      });
    }
  }

  const dedupe = (arr, key) => {
    const seen = new Set();
    return arr.filter((x) => {
      const k = key(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  results.invisibleText = dedupe(
    results.invisibleText,
    (x) => x.el + x.text
  ).slice(0, 12);
  results.darkSurfaces = dedupe(results.darkSurfaces, (x) => x.el).slice(0, 8);
  results.underSidebar = dedupe(results.underSidebar, (x) => x.el).slice(0, 8);
  results.overflowRight = dedupe(results.overflowRight, (x) => x.el).slice(
    0,
    8
  );
  return results;
};

/**
 * Bento's hand-written CSS classes carry literal colours that the Tailwind token
 * remap can't reach, and most only render after a file is loaded. Injecting them
 * checks the retint without having to drive each tool.
 */
const PROBES = [
  { cls: 'testimonial-card', on: null },
  { cls: 'pill', on: null },
  { cls: 'feature-card', on: null },
  { cls: 'shortcut-key', on: null },
  { cls: 'pdf-panel', on: null },
  { cls: 'btn-gradient', on: null, expectWhiteInk: true },
  { cls: 'wf-card', on: 'pdf-workflow' },
  { cls: 'wf-title', on: 'pdf-workflow' },
  { cls: 'wf-desc', on: 'pdf-workflow' },
  { cls: 'layers-container', on: 'pdf-layers' },
  { cls: 'layer-name', on: 'pdf-layers' },
  { cls: 'layers-empty', on: 'pdf-layers' },
  { cls: 'category-filter', on: 'tools' },
];

const PROBE_FN = (classes) => {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  document.body.appendChild(host);
  const out = [];
  for (const cls of classes) {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = 'Sample label text';
    host.appendChild(el);
    const s = getComputedStyle(el);
    out.push({
      cls,
      color: s.color,
      bg: s.backgroundColor,
      bgImage:
        s.backgroundImage === 'none' ? null : s.backgroundImage.slice(0, 70),
      border: s.borderTopColor,
    });
    host.removeChild(el);
  }
  document.body.removeChild(host);
  return out;
};

const findings = [];
const note = (page, kind, detail) => findings.push({ page, kind, detail });

// Node-side colour helpers for probe results.
const okToRgb = (L, C, H) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => {
    const c = v > 0.0031308 ? 1.055 * v ** (1 / 2.4) - 0.055 : 12.92 * v;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  });
};
const toRgb = (c) => {
  if (!c) return null;
  const ok = c.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/);
  if (ok) {
    const L = ok[2] === '%' ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
    const [r, g, b] = okToRgb(L, parseFloat(ok[3]), parseFloat(ok[4]));
    return { r, g, b, a: 1 };
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
};
const relLum = ({ r, g, b }) => {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [relLum(a), relLum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

page.on('pageerror', (e) =>
  note(
    page.url().split('/').pop(),
    'JS ERROR',
    e.message.split('\n')[0].slice(0, 140)
  )
);
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text().slice(0, 140);
    if (!/favicon|manifest|404 \(Not Found\)/i.test(t)) {
      note(page.url().split('/').pop(), 'CONSOLE ERROR', t);
    }
  }
});

for (const [name, path, waitFor] of PAGES) {
  process.stdout.write(`\n### ${name} (${path})\n`);
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector(waitFor, { timeout: 8000 });
  } catch {
    note(name, 'RENDER', `never rendered ${waitFor}`);
  }
  await page.waitForTimeout(700);

  const r = await page.evaluate(AUDIT);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });

  const fonts = Object.entries(r.fonts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  console.log(
    `  sidebar-safe: ${r.underSidebar.length === 0 ? 'yes' : 'NO'}` +
      ` | h-overflow: ${r.horizontalOverflow ? 'YES (' + r.scrollWidth + '>' + r.innerWidth + ')' : 'no'}` +
      ` | fonts: ${fonts.map(([f, n]) => f + '(' + n + ')').join(', ')}`
  );

  if (r.invisibleText.length) {
    note(
      name,
      'LOW CONTRAST',
      r.invisibleText.map(
        (x) => `${x.ratio}:1 ${x.color} on ${x.bg} — "${x.text}" [${x.el}]`
      )
    );
  }
  if (r.darkSurfaces.length) {
    note(
      name,
      'DARK SURFACE',
      r.darkSurfaces.map((x) => `${x.bg} ${x.size} [${x.el}]`)
    );
  }
  if (r.underSidebar.length) {
    note(
      name,
      'UNDER SIDEBAR',
      r.underSidebar.map(
        (x) =>
          `left=${x.left} < sidebar=${x.sidebarRight} "${x.text}" [${x.el}]`
      )
    );
  }
  if (r.overflowRight.length) {
    note(
      name,
      'OVERFLOWS RIGHT',
      r.overflowRight.map(
        (x) => `right=${x.right} > vw=${x.viewport} [${x.el}]`
      )
    );
  }
  if (r.horizontalOverflow) {
    note(
      name,
      'H-SCROLL',
      `scrollWidth ${r.scrollWidth} vs viewport ${r.innerWidth}`
    );
  }
  const nonInter = Object.keys(r.fonts).filter(
    (f) =>
      !/Inter|ui-sans|system-ui|monospace|Menlo|Courier|inherit|Phosphor|lucide/i.test(
        f
      )
  );
  if (nonInter.length) note(name, 'FONT', `unexpected: ${nonInter.join(', ')}`);

  // Probe the hand-written Bento classes whose CSS this page loads.
  const probes = PROBES.filter((p) => p.on === null || p.on === name);
  if (probes.length) {
    const got = await page.evaluate(
      PROBE_FN,
      probes.map((p) => p.cls)
    );
    for (const g of got) {
      const spec = probes.find((p) => p.cls === g.cls);
      const bg = toRgb(g.bg);
      const fg = toRgb(g.color);
      const opaqueBg = bg && bg.a > 0.5 ? bg : { r: 255, g: 255, b: 255, a: 1 };
      const dark = bg && bg.a > 0.5 && relLum(bg) < 0.15;
      const gradient = g.bgImage && /gradient/.test(g.bgImage);
      if (dark) {
        note(name, 'PROBE DARK SURFACE', `.${g.cls} bg=${g.bg}`);
      }
      if (fg && !gradient) {
        const c = ratio(fg, opaqueBg);
        if (c < 3.0) {
          note(
            name,
            'PROBE LOW CONTRAST',
            `.${g.cls} ${Math.round(c * 100) / 100}:1 ${g.color} on ${g.bg}`
          );
        }
      }
      if (spec.expectWhiteInk && fg && relLum(fg) < 0.7) {
        note(
          name,
          'PROBE INK',
          `.${g.cls} expected a white label, got ${g.color}`
        );
      }
    }
    console.log(
      `  probed ${got.length} hand-written class(es): ${got.map((g) => '.' + g.cls).join(' ')}`
    );
  }
}

// ---------- Interactions ----------
console.log('\n### interactions');

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tool-card');
await page.waitForTimeout(500);

// 1. Live tool search
const searchSel = '#search-bar';
if (await page.locator(searchSel).count()) {
  const before = await page.locator('.tool-card:visible').count();
  await page.fill(searchSel, 'merge');
  await page.waitForTimeout(500);
  const after = await page.locator('.tool-card:visible').count();
  const status =
    (await page
      .locator('#tool-search-status')
      .textContent()
      .catch(() => '')) || '';
  console.log(
    `  search "merge": ${before} -> ${after} cards | status: "${status.trim()}"`
  );
  await page.screenshot({ path: `${SHOTS}/interact-search.png` });
  if (after === 0 || after >= before)
    note('home', 'SEARCH', `filter looks wrong: ${before} -> ${after}`);

  await page.fill(searchSel, 'zzzznomatch');
  await page.waitForTimeout(400);
  const empty = await page
    .locator('#tool-search-empty')
    .isVisible()
    .catch(() => false);
  console.log(`  search no-match empty state visible: ${empty}`);
  await page.screenshot({ path: `${SHOTS}/interact-search-empty.png` });

  await page.fill(searchSel, '');
  await page.waitForTimeout(400);
  const restored = await page.locator('.tool-card:visible').count();
  console.log(`  cleared: restored to ${restored} cards`);
  if (restored !== before)
    note('home', 'SEARCH', `clear did not restore (${before} -> ${restored})`);
} else {
  note('home', 'SEARCH', 'no #search-bar found');
}

// 2. Sidebar collapse
if (await page.locator('#shift-sidebar-collapse').count()) {
  const w1 = await page
    .locator('#shift-sidebar')
    .evaluate((e) => e.getBoundingClientRect().width);
  await page.click('#shift-sidebar-collapse');
  await page.waitForTimeout(500);
  const w2 = await page
    .locator('#shift-sidebar')
    .evaluate((e) => e.getBoundingClientRect().width);
  const collapsed = await page.evaluate(() =>
    document.body.classList.contains('shift-sidebar-collapsed')
  );
  console.log(
    `  sidebar collapse: ${Math.round(w1)}px -> ${Math.round(w2)}px (body.collapsed=${collapsed})`
  );
  await page.screenshot({ path: `${SHOTS}/interact-sidebar-collapsed.png` });
  const r = await page.evaluate(AUDIT);
  if (r.underSidebar.length)
    note(
      'home(collapsed)',
      'UNDER SIDEBAR',
      r.underSidebar.map((x) => `left=${x.left} "${x.text}"`)
    );
  if (w2 >= w1) note('home', 'SIDEBAR', 'collapse did not shrink the sidebar');
  await page.click('#shift-sidebar-collapse');
  await page.waitForTimeout(400);
}

// 2b. Compact mode (its hover state used a hardcoded dark fill)
if (await page.locator('#compact-mode-toggle').count()) {
  // Styled toggle: the real input is sr-only, so click it in the page.
  await page.evaluate(() =>
    document.getElementById('compact-mode-toggle').click()
  );
  await page.waitForTimeout(500);
  const on = await page.evaluate(
    () =>
      document
        .querySelector('#tool-grid, [id*="tool-grid"]')
        ?.classList.contains('compact-mode') ?? null
  );
  const hover = await page.evaluate(() => {
    const card = document.querySelector('.compact-mode .tool-card');
    if (!card) return null;
    // Hover styling can't be forced from JS, so read the rule itself.
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule.selectorText === '.compact-mode .tool-card:hover') {
          return rule.style.backgroundColor;
        }
      }
    }
    return 'rule not found';
  });
  console.log(
    `  compact mode on=${on} | :hover background resolves to "${hover}"`
  );
  await page.screenshot({ path: `${SHOTS}/interact-compact.png` });
  const cmAudit = await page.evaluate(AUDIT);
  if (cmAudit.darkSurfaces.length)
    note(
      'home(compact)',
      'DARK SURFACE',
      cmAudit.darkSurfaces.map((x) => `${x.bg} [${x.el}]`)
    );
  if (cmAudit.invisibleText.length)
    note(
      'home(compact)',
      'LOW CONTRAST',
      cmAudit.invisibleText.map((x) => `${x.ratio}:1 "${x.text}"`)
    );
  await page.evaluate(() =>
    document.getElementById('compact-mode-toggle').click()
  );
  await page.waitForTimeout(300);
}

// 2c. Keyboard-shortcuts modal (its keycaps were a hardcoded dark fill).
// #shortcut is the "⌘ + K" hint badge in the search field, not the trigger.
if (await page.locator('#open-shortcuts-btn').count()) {
  await page.click('#open-shortcuts-btn', { force: true }).catch(() => {});
  await page.waitForTimeout(700);
  const open = await page
    .locator('#shortcuts-modal')
    .isVisible()
    .catch(() => false);
  console.log(`  shortcuts modal open: ${open}`);
  if (open) {
    const panel = await page.evaluate(() => {
      const m = document.getElementById('shortcuts-modal');
      const p = m.querySelector('div');
      const key = m.querySelector('.shortcut-key, kbd');
      const cs = (el) =>
        el
          ? {
              bg: getComputedStyle(el).backgroundColor,
              color: getComputedStyle(el).color,
            }
          : null;
      return {
        scrim: getComputedStyle(m).backgroundColor,
        panel: cs(p),
        keycap: cs(key),
      };
    });
    console.log(
      `    scrim=${panel.scrim} panel=${JSON.stringify(panel.panel)} keycap=${JSON.stringify(panel.keycap)}`
    );
    await page.screenshot({ path: `${SHOTS}/interact-shortcuts-modal.png` });
    const mAudit = await page.evaluate(AUDIT);
    if (mAudit.invisibleText.length)
      note(
        'shortcuts modal',
        'LOW CONTRAST',
        mAudit.invisibleText.map(
          (x) => `${x.ratio}:1 ${x.color} on ${x.bg} "${x.text}"`
        )
      );
    if (mAudit.darkSurfaces.length)
      note(
        'shortcuts modal',
        'DARK SURFACE',
        mAudit.darkSurfaces.map((x) => `${x.bg} ${x.size} [${x.el}]`)
      );
    await page.click('#close-shortcuts-modal').catch(() => {});
    await page.waitForTimeout(300);
  }
}

// 3. Navigate by clicking a tool card
await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tool-card');
const card = page.locator('.tool-card').first();
const cardName =
  (await card
    .locator('h3')
    .textContent()
    .catch(() => '')) || '';
await card.click();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(700);
console.log(
  `  clicked card "${cardName.trim()}" -> ${page.url().replace(BASE, '')}`
);
await page.screenshot({ path: `${SHOTS}/interact-card-nav.png` });
const navAudit = await page.evaluate(AUDIT);
if (navAudit.underSidebar.length)
  note(
    'card-nav',
    'UNDER SIDEBAR',
    navAudit.underSidebar.map((x) => `"${x.text}"`)
  );

// 4. Sidebar nav links from a tool page
for (const nav of ['compress', 'merge', 'convert', 'esign', 'home']) {
  const link = page.locator(`.shift-nav-link[data-nav="${nav}"]`);
  if (!(await link.count())) {
    note('sidebar', 'NAV', `missing data-nav="${nav}"`);
    continue;
  }
  await link.click();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  const state = await page.evaluate((n) => {
    const el = document.querySelector(`.shift-nav-link[data-nav="${n}"]`);
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      active: el.classList.contains('is-active'),
      color: s.color,
      bg: s.backgroundColor,
      weight: s.fontWeight,
    };
  }, nav);
  console.log(
    `  nav "${nav}" -> ${page.url().replace(BASE, '')} (is-active=${state?.active}` +
      ` color=${state?.color} bg=${state?.bg} weight=${state?.weight})`
  );
  if (state && !state.active)
    note(
      'sidebar',
      'ACTIVE STATE',
      `"${nav}" not highlighted on ${page.url().replace(BASE, '')}`
    );
}

// 5. Mobile viewport + hamburger
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '/merge-pdf.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
const togglePresent = await page
  .locator('#shift-sidebar-toggle')
  .isVisible()
  .catch(() => false);
console.log(`  mobile hamburger visible: ${togglePresent}`);
await page.screenshot({ path: `${SHOTS}/mobile-closed.png` });
if (togglePresent) {
  await page.click('#shift-sidebar-toggle');
  await page.waitForTimeout(500);
  const open = await page.evaluate(() =>
    document.body.classList.contains('shift-sidebar-open')
  );
  const sbVisible = await page.locator('#shift-sidebar').isVisible();
  console.log(
    `  mobile sidebar opened: body.open=${open} visible=${sbVisible}`
  );
  await page.screenshot({ path: `${SHOTS}/mobile-open.png` });
  if (!open) note('mobile', 'SIDEBAR', 'hamburger did not open the sidebar');

  // The toggle must not float over the open drawer's own header.
  const layer = await page.evaluate(() => {
    const sb = document.getElementById('shift-sidebar');
    const tg = document.getElementById('shift-sidebar-toggle');
    const bd = document.getElementById('shift-sidebar-backdrop');
    const z = (el) =>
      el ? parseInt(getComputedStyle(el).zIndex || '0', 10) : null;
    const logo = document.getElementById('nav-logo');
    const lr = logo ? logo.getBoundingClientRect() : null;
    const tr = tg ? tg.getBoundingClientRect() : null;
    const overlap =
      lr &&
      tr &&
      tr.left < lr.right &&
      tr.right > lr.left &&
      tr.top < lr.bottom &&
      tr.bottom > lr.top;
    return {
      sidebarZ: z(sb),
      toggleZ: z(tg),
      backdrop: bd ? getComputedStyle(bd).display : 'MISSING',
      backdropZ: z(bd),
      toggleOverlapsLogo: !!overlap,
      toggleAbove: z(tg) > z(sb),
    };
  });
  console.log(
    `    drawer z=${layer.sidebarZ} toggle z=${layer.toggleZ} backdrop=${layer.backdrop} (z=${layer.backdropZ})`
  );
  if (layer.backdrop !== 'block')
    note(
      'mobile',
      'DRAWER',
      `no backdrop behind open drawer (display=${layer.backdrop})`
    );
  if (layer.toggleAbove && layer.toggleOverlapsLogo) {
    note('mobile', 'DRAWER', 'hamburger paints over the open drawer header');
  }

  // Tapping the scrim should close it.
  await page
    .click('#shift-sidebar-backdrop', { position: { x: 350, y: 600 } })
    .catch(() => {});
  await page.waitForTimeout(400);
  const closed = await page.evaluate(
    () => !document.body.classList.contains('shift-sidebar-open')
  );
  console.log(`  scrim tap closes drawer: ${closed}`);
  if (!closed)
    note('mobile', 'DRAWER', 'tapping the scrim did not close the drawer');
}
const mobileAudit = await page.evaluate(AUDIT);
if (mobileAudit.horizontalOverflow) {
  note(
    'mobile',
    'H-SCROLL',
    `scrollWidth ${mobileAudit.scrollWidth} vs ${mobileAudit.innerWidth}`
  );
}
if (mobileAudit.invisibleText.length) {
  note(
    'mobile',
    'LOW CONTRAST',
    mobileAudit.invisibleText.map((x) => `${x.ratio}:1 "${x.text}"`)
  );
}

await browser.close();

// ---------- Report ----------
console.log('\n\n================ FINDINGS ================');
if (!findings.length) {
  console.log('none — all checks clean');
} else {
  const byKind = {};
  for (const f of findings) (byKind[f.kind] ||= []).push(f);
  for (const [kind, items] of Object.entries(byKind)) {
    console.log(`\n${kind} (${items.length}):`);
    for (const it of items) {
      const d = Array.isArray(it.detail) ? it.detail : [it.detail];
      console.log(`  [${it.page}]`);
      for (const line of d.slice(0, 6)) console.log(`      ${line}`);
    }
  }
}
console.log(`\nscreenshots: ${SHOTS}`);
