import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('scales PDF.js thumbnail boxes from the 126px canvas to the 156px design size', async () => {
    document.documentElement.dataset.shiftViewer = 'launchpad';
    renderViewerMarkup();

    await runLaunchpadScript();

    const view = document.getElementById('thumbnailsView');
    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';
    const image = document.createElement('div');
    image.className = 'thumbnailImageContainer';
    // PDF.js writes the unscaled canvas height inline.
    image.style.height = '163px';
    thumb.append(image);
    view.append(thumb);

    // MutationObserver callbacks run as microtasks after the DOM change.
    await Promise.resolve();
    await Promise.resolve();

    expect(image.style.width).toBe('156px');
    // Content scale 152/126, plus 4px for the 2px border on each side.
    expect(parseFloat(image.style.height)).toBeCloseTo(
      (163 * 152) / 126 + 4,
      1
    );
  });

  it('waits for every page view before printing from the viewer header', async () => {
    document.documentElement.dataset.shiftViewer = 'launchpad';
    renderViewerMarkup();
    const printButton = document.createElement('button');
    printButton.id = 'printButton';
    const printed = vi.fn();
    printButton.addEventListener('click', printed);
    document.body.append(printButton);

    const pdfViewer = { pageViewsReady: false };
    (window as unknown as Record<string, unknown>).PDFViewerApplication = {
      pdfViewer,
    };

    await runLaunchpadScript();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'shift-pdf-viewer', action: 'print' },
        origin: window.location.origin,
        source: window,
      })
    );

    await new Promise((resolve) => window.setTimeout(resolve, 80));
    expect(printed).not.toHaveBeenCalled();

    pdfViewer.pageViewsReady = true;
    await vi.waitFor(() => expect(printed).toHaveBeenCalled());

    delete (window as unknown as Record<string, unknown>).PDFViewerApplication;
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
