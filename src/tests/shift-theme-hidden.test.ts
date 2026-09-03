import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readText = (path: string) =>
  readFile(resolve(process.cwd(), path), 'utf8');

/**
 * shift-theme.css is imported after Tailwind, so a component that sets its own
 * `display` outranks `.hidden` at equal specificity. Any component toggled by
 * the `hidden` class needs an explicit opt-back-in rule.
 */
const CLASS_TOGGLED_COMPONENTS = [
  'shift-convert-destination-grid',
  'shift-convert-show-more',
];

describe('shift-theme hidden overrides', () => {
  it('lets .hidden win for components that set their own display', async () => {
    const css = await readText('src/css/shift-theme.css');

    for (const component of CLASS_TOGGLED_COMPONENTS) {
      const declaresDisplay = new RegExp(
        `\\.${component}\\s*\\{[^}]*display:`
      ).test(css);
      expect(declaresDisplay, `${component} should set display`).toBe(true);
      expect(css, `${component} needs a .hidden override`).toContain(
        `.${component}.hidden`
      );
    }
  });

  it('keeps the convert secondary grid hidden until Show more is used', async () => {
    const html = await readText('pdf-converter.html');

    expect(html).toContain('class="shift-convert-destination-grid hidden"');
    expect(html).toContain('class="shift-convert-show-more hidden"');
  });
});
