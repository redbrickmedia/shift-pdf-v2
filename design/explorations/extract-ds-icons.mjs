/**
 * One-off helper: render Shift design-system icon components to static SVG so
 * the experimental (non-React) sidebar can use the real artwork.
 *
 * The design system is a private package that is not a dependency of this repo,
 * so this resolves it from a sibling checkout that already has it installed.
 *
 * Usage:
 *   node design/explorations/extract-ds-icons.mjs [pathToInstalledDesignSystemRoot]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const webUiRoot =
  process.argv[2] || '/Users/krislemieux/Shift/Repos/shift-browser/web-ui';

const nodeModules = join(webUiRoot, 'node_modules');
if (!existsSync(nodeModules)) {
  console.error(`No node_modules at ${nodeModules}`);
  process.exit(1);
}

const require = createRequire(pathToFileURL(join(webUiRoot, 'noop.js')));

const React = (await import(pathToFileURL(require.resolve('react')).href))
  .default;
const { renderToStaticMarkup } = await import(
  pathToFileURL(require.resolve('react-dom/server')).href
);
const Icons = await import(
  pathToFileURL(require.resolve('@redbrickmedia/shift-design-system/icons'))
    .href
);

const wanted = process.argv[3]
  ? process.argv[3].split(',')
  : [
      'HomeIcon',
      'CompressIcon',
      'MergeIcon',
      'ConvertIcon',
      'DrawSignatureIcon',
      'SidebarIcon',
    ];

const asJson = process.env.EMIT_JSON === '1';
const out = {};

for (const name of wanted) {
  const Component = Icons[name];
  if (!Component) {
    if (!asJson) console.log(`${name}: not exported`);
    continue;
  }
  try {
    const svg = renderToStaticMarkup(React.createElement(Component));
    if (asJson) {
      out[name] = svg;
    } else {
      console.log(`=== ${name} ===`);
      console.log(svg);
    }
  } catch (err) {
    if (!asJson) console.log(`${name}: render failed — ${err.message}`);
  }
}

if (asJson) console.log(JSON.stringify(out, null, 2));
