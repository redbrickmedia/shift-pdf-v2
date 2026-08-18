"""Re-verifies the light-shell retint in src/css/shift-theme.css.

The Bento pages are authored for a dark theme, so the theme remaps Tailwind's
colour tokens rather than editing ~9000 utility usages across 131 pages. This
resolves the text and background colour each text node actually ends up with —
reading the real palette out of the compiled CSS — and flags any pair that would
be unreadable. Run from the repo root after `npm run build`.

Known remaining hit: 'Sponsor' in index.html, inside the #donation-ribbon the
theme hides outright.
"""

import glob
import math
import re
import sys
from html.parser import HTMLParser


def oklch_to_hex(L, C, H):
    """oklch() -> sRGB hex, so the audit uses Tailwind's real palette values."""
    h = math.radians(H)
    a, b = C * math.cos(h), C * math.sin(h)
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    lin = (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )
    out = '#'
    for v in lin:
        v = 1.055 * (v ** (1 / 2.4)) - 0.055 if v > 0.0031308 else 12.92 * v
        out += f'{max(0, min(255, round(v * 255))):02x}'
    return out


def load_palette(css_path):
    """Read every --color-* the build emits, then let later (unlayered
    shift-theme.css) definitions override the earlier @layer theme ones."""
    css = open(css_path, encoding='utf-8').read()
    palette = {}
    for m in re.finditer(r'--color-([a-z]+(?:-\d{2,3})?):\s*([^;}]+)', css):
        name, raw = m.group(1), m.group(2).strip()
        ok = re.match(r'oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)', raw)
        if ok:
            palette[name] = oklch_to_hex(
                float(ok.group(1)) / 100, float(ok.group(2)), float(ok.group(3))
            )
        elif re.fullmatch(r'#[0-9a-fA-F]{6}', raw):
            palette[name] = raw.lower()
        elif re.fullmatch(r'#[0-9a-fA-F]{3}', raw):
            palette[name] = '#' + ''.join(c * 2 for c in raw[1:]).lower()
    return palette

# Tailwind stock values for colours the theme leaves alone.
STOCK = {
    'white': '#ffffff',
    'black': '#000000',
    'gray-50': '#f9fafb',
    'gray-100': '#f3f4f6',
    'gray-200': '#e5e7eb',
    'indigo-500': '#6366f1',
    'indigo-600': '#4f46e5',
    'indigo-700': '#4338ca',
    'indigo-800': '#3730a3',
    'indigo-900': '#312e81',
    'red-500': '#ef4444',
    'red-600': '#dc2626',
    'red-700': '#b91c1c',
    'red-900': '#7f1d1d',
    'green-500': '#22c55e',
    'green-600': '#16a34a',
    'green-700': '#15803d',
    'green-900': '#14532d',
    'blue-500': '#3b82f6',
    'blue-600': '#2563eb',
    'blue-900': '#1e3a8a',
    'orange-600': '#ea580c',
    'orange-700': '#c2410c',
    'yellow-400': '#facc15',
    'amber-500': '#f59e0b',
    'purple-600': '#9333ea',
    'emerald-600': '#059669',
    'teal-600': '#0d9488',
}

# shift-theme.css :root remap of the Bento ramp.
REMAP = {
    'gray-900': '#ffffff',
    'gray-800': '#f9fafb',
    'gray-700': '#e6e9ef',
    'gray-600': '#d1d5db',
    'gray-500': '#6b7280',
    'gray-400': '#4b5563',
    'gray-300': '#374151',
    'indigo-300': '#3b82f6',
    'indigo-400': '#2563eb',
}

SHIFT_TEXT = '#111827'
SHIFT_TEXT_MUTED = '#374151'
SHIFT_BRAND = '#2563eb'  # .bg-indigo-500/.bg-indigo-600 button override
SHIFT_CARD_BORDER = '#d1d5db'

# Exact classes where text-white must stay white (see shift-theme.css).
SATURATED = {
    'bg-indigo-400', 'bg-indigo-500', 'bg-indigo-600', 'bg-indigo-700',
    'bg-blue-500', 'bg-blue-600', 'bg-green-600', 'bg-green-700',
    'bg-red-500', 'bg-red-600', 'bg-red-700',
    'bg-orange-600', 'bg-orange-700',
}

# Tinted alert panels flattened to light tints in shift-theme.css (all opacities).
PANEL_TINTS = {
    'red-900': '#fee2e2',
    'green-900': '#dcfce7',
    'blue-900': '#dbeafe',
    'yellow-900': '#fef9c3',
    'amber-900': '#fef9c3',
    'indigo-900': '#eff6ff',
}

# Ramp corrections: text utilities forced back to ink.
TEXT_CORRECTIONS = {
    'text-gray-800': SHIFT_TEXT_MUTED,
    'text-gray-700': SHIFT_TEXT_MUTED,
    'text-gray-600': SHIFT_TEXT_MUTED,
    'text-gray-200': SHIFT_TEXT,
}


PALETTE = load_palette(sorted(glob.glob('dist/assets/style-*.css'))[-1])


def resolve_color(token):
    if token in REMAP:
        return REMAP[token]
    return PALETTE.get(token) or STOCK.get(token)


def blend(fg, bg, alpha):
    out = '#'
    for i in (1, 3, 5):
        a, b = int(fg[i:i + 2], 16), int(bg[i:i + 2], 16)
        out += f'{round(a * alpha + b * (1 - alpha)):02x}'
    return out


def bg_for(classes, parent_bg='#ffffff'):
    """Resolved background colour an element paints, or None."""
    for c in classes:
        m = re.fullmatch(r'bg-([a-z]+-\d{2,3}|white|black)(?:/(\d+))?', c)
        if not m:
            continue
        token, alpha = m.group(1), m.group(2)
        if token in PANEL_TINTS:
            return PANEL_TINTS[token]  # flat tint, opacity ignored
        if c.startswith(('bg-indigo-500', 'bg-indigo-600')):
            base = SHIFT_BRAND  # theme button override
        else:
            base = resolve_color(token)
        if base is None:
            continue
        if alpha:
            return blend(base, parent_bg, int(alpha) / 100)
        return base
    if any(c.startswith('bg-gradient-') for c in classes):
        for c in classes:
            m = re.fullmatch(r'from-([a-z]+-\d{2,3})', c)
            if m:
                return resolve_color(m.group(1))
    return None


def is_saturated(classes):
    """Matches the descendant-capable exception list in shift-theme.css."""
    return bool(classes & SATURATED) or any(
        c.startswith('from-indigo-') for c in classes
    )


def is_black(classes):
    """`bg-black` keeps light ink, but same-element only."""
    return 'bg-black' in classes or any(c.startswith('bg-black/') for c in classes)


def fg_for(classes, ancestor_saturated=False):
    """Resolved text colour an element sets, or None."""
    white_ok = is_saturated(classes) or ancestor_saturated or is_black(classes)
    if is_black(classes) and any(c.startswith('text-gray-') for c in classes):
        return '#ffffff'
    if 'text-white' in classes:
        return '#ffffff' if white_ok else SHIFT_TEXT
    if any(re.fullmatch(r'text-white/\d+', c) for c in classes):
        return '#ffffff' if white_ok else SHIFT_TEXT_MUTED
    for c in classes:
        if c in TEXT_CORRECTIONS:
            return TEXT_CORRECTIONS[c]
    for c in classes:
        m = re.fullmatch(r'text-([a-z]+-\d{2,3}|white|black)', c)
        if m:
            return resolve_color(m.group(1))
    return None


def lum(hexcolor):
    r, g, b = (int(hexcolor[i:i + 2], 16) / 255 for i in (1, 3, 5))

    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


TEXTY = {'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'button',
         'label', 'li', 'td', 'th', 'div', 'strong', 'em', 'small'}


class Walker(HTMLParser):
    VOID = {'img', 'br', 'input', 'hr', 'meta', 'link', 'source', 'path'}

    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        # (tag, fg, bg, in_testimonial, ancestor_saturated)
        self.stack = []
        self.findings = []

    def handle_starttag(self, tag, attrs):
        classes = set((dict(attrs).get('class') or '').split())
        top = self.stack[-1] if self.stack else (None, SHIFT_TEXT, '#ffffff', False, False)
        _, pfg, pbg, ptest, psat = top
        fg = fg_for(classes, ancestor_saturated=psat)
        bg = bg_for(classes, pbg)
        frame = (
            tag,
            fg or pfg,
            bg or pbg,
            ptest or 'testimonial-card' in classes,
            psat or is_saturated(classes),
        )
        if tag not in self.VOID:
            self.stack.append(frame)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        text = data.strip()
        if not text or len(text) < 2 or not self.stack:
            return
        tag, fg, bg, in_testimonial, _ = self.stack[-1]
        if tag not in TEXTY:
            return
        # Decorative star ratings keep their gold via a scoped rule.
        if in_testimonial and set(text) <= set('★☆ '):
            return
        try:
            ratio = contrast(fg, bg)
        except Exception:
            return
        if ratio < 3.0:
            self.findings.append((round(ratio, 2), fg, bg, tag, text[:60]))


def main():
    files = sorted(glob.glob('src/pages/*.html')) + sorted(glob.glob('*.html'))
    total = 0
    by_pair = {}
    worst = []
    for f in files:
        w = Walker(f)
        try:
            w.feed(open(f, encoding='utf-8').read())
        except Exception as e:
            print(f'  ! parse {f}: {e}')
            continue
        for ratio, fg, bg, tag, text in w.findings:
            total += 1
            by_pair.setdefault((fg, bg), []).append((f, text, ratio))
            worst.append((ratio, f, fg, bg, tag, text))

    print(f'files scanned: {len(files)}')
    print(f'low-contrast text nodes (< 3.0:1): {total}\n')
    print('grouped by colour pair (fg on bg):')
    for (fg, bg), items in sorted(by_pair.items(), key=lambda kv: -len(kv[1])):
        ratio = items[0][2]
        print(f'  {fg} on {bg}  ratio {ratio}  x{len(items)}')
        for f, text, _ in items[:3]:
            print(f'      {f}: {text!r}')
    return 0


sys.exit(main())
