import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/** viewer.html loads this as a classic script, not an ES module. */
async function runLaunchpadScript() {
  const source = await readFile(
    resolve(process.cwd(), 'public/pdfjs-viewer/shift-viewer-launchpad.js'),
    'utf8'
  );
  new Function(source)();
}

/**
 * Mirrors how PDF.js nests the views manager: inside the stock toolbar, which
 * launchpad mode hides. Anything left in there lays out at zero size.
 */
function renderViewerMarkup({ withControls = true } = {}) {
  const controls = withControls
    ? `<button id="previous"></button>
       <input id="pageNumber" />
       <span id="numPages">of 4</span>
       <button id="next"></button>
       <button id="zoomOutButton"></button>
       <span id="scaleSelectContainer"><select id="scaleSelect"></select></span>
       <button id="zoomInButton"></button>`
    : '';

  document.body.innerHTML = `
    <div id="outerContainer">
      <div id="mainContainer">
        <div id="toolbarContainer">
          <div id="toolbarViewer">
            <div id="toolbarViewerLeft">
              <button id="viewsManagerToggleButton"></button>
              <div id="viewsManager" hidden>
                <div id="viewsManagerContent">
                  <div id="thumbnailsView"></div>
                </div>
              </div>
              ${controls}
            </div>
          </div>
        </div>
        <div id="viewerContainer"></div>
      </div>
    </div>
  `;
}

describe('Shift launchpad controls for the PDF.js viewer', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.shiftViewer;
    document.body.innerHTML = '';
  });

  it('moves the thumbnail rail out of the hidden stock toolbar', async () => {
    document.documentElement.dataset.shiftViewer = 'launchpad';
    renderViewerMarkup();

    await runLaunchpadScript();

    const rail = document.getElementById('viewsManager');
    expect(rail?.parentElement?.id).toBe('outerContainer');
    expect(document.querySelector('#toolbarViewer #viewsManager')).toBeNull();
  });

  it('keeps the rail reachable when the stock controls are incomplete', async () => {
    document.documentElement.dataset.shiftViewer = 'launchpad';
    renderViewerMarkup({ withControls: false });

    await runLaunchpadScript();

    expect(document.getElementById('viewsManager')?.parentElement?.id).toBe(
      'outerContainer'
    );
  });

  it('leaves other embeds untouched', async () => {
    document.documentElement.dataset.shiftViewer = 'embed';
    renderViewerMarkup();

    await runLaunchpadScript();

    expect(document.getElementById('viewsManager')?.parentElement?.id).toBe(
      'toolbarViewerLeft'
    );
    expect(document.getElementById('shiftLaunchpadControls')).toBeNull();
  });
});
