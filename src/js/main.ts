import { categories } from './config/tools.js';
import { dom, switchView, hideAlert } from './ui.js';
import { ShortcutsManager } from './logic/shortcuts.js';
import { createIcons, icons } from 'lucide';
import '@phosphor-icons/web/regular';

import '../css/styles.css';
import {
  escapeHtml,
  formatShortcutDisplay,
  formatStars,
} from './utils/helpers.js';
import {
  initI18n,
  applyTranslations,
  rewriteLinks,
  injectLanguageSwitcher,
  t,
} from './i18n/index.js';
import {
  loadRuntimeConfig,
  isToolDisabled,
  isCurrentPageDisabled,
} from './utils/disabled-tools.js';
import {
  applyFavoritePinTitles,
  FAVORITE_CATALOG_COPY_ATTR,
  loadFavoriteToolIds,
  placeFavoriteToolCards,
  saveFavoriteRailSnapshot,
  saveFavoriteToolIds,
  toggleFavoriteToolId,
  type FavoriteRailPin,
} from './logic/tool-favorites.js';
import { initHomeFiles } from './logic/home-files.js';
import {
  isHomeDocument,
  seedToolOpenFile,
} from './logic/seed-tool-open-file.js';
import {
  getRememberedSourceTabId,
  hasOpenFileFlag,
} from './logic/open-file-store.js';
import { getSourceTabIdFromLocation } from './embedder/shift-file-access.js';
import {
  setToolCatalogOpen,
  shouldShowCategoryGroup,
  shouldShowToolCatalog,
  toggleSelectedCategory,
} from './logic/home-catalog.js';
import {
  initWorkspaceFileIndicator,
  pickerAcceptsPdf,
} from './logic/workspace-files.js';
import {
  dismissPromiseBanner,
  markPromiseBannerSeen,
  readPromiseBannerState,
  shouldShowPromiseBanner,
} from './logic/promise-banner.js';
import { initToolBackNavigation } from './logic/tool-back.js';
import { initToolBackMenu } from './logic/tool-back-menu.js';
import { trackPdfEngineExperience } from './analytics/index.js';

declare const __BRAND_NAME__: string;

const SIDEBAR_COLLAPSED_KEY = 'shiftSidebarCollapsed';

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

// Applied at module scope so a stored collapse is set before first paint where possible.
if (typeof document !== 'undefined' && readSidebarCollapsed()) {
  document.documentElement.classList.add('shift-sidebar-collapsed-pending');
}

// At module scope rather than in init(): init() waits for `load`, and the tool
// pages bind their own back handlers on DOMContentLoaded, so the shared one has
// to be in place before that window opens.
if (typeof document !== 'undefined') {
  initToolBackNavigation();
  // After, not before: the menu hangs off the class the call above adds.
  initToolBackMenu();
}

/**
 * Element that actually scrolls. The Shift shell makes the main panel a fixed
 * height scrollport so its rounded corners stay on screen; pages without the
 * rail (and browsers without :has()) keep the document scrolling as Bento
 * shipped it. Read back from the computed style so this can't drift from the
 * conditions the stylesheet applies it under.
 */
function getShellScroller(): HTMLElement {
  return getComputedStyle(document.body).overflowY === 'auto'
    ? document.body
    : document.documentElement;
}

function getToolId(tool: { id?: string; href?: string }): string {
  if (tool.id) return tool.id;
  if (tool.href) {
    const match = tool.href.match(/\/([^/]+)\.html$/);
    return match ? match[1] : tool.href;
  }
  return 'unknown';
}

/**
 * Every tool keeps its own Phosphor/Lucide artwork, in the catalog and on the
 * rail pins alike. The Shift design-system glyphs are reserved for the chrome
 * that is hand-authored for this shell: the primary rail items in navbar.html.
 */
function createToolIcon(
  tool: { id?: string; href?: string; icon: string },
  extraClass = ''
): HTMLElement {
  const icon = document.createElement('i');
  if (tool.icon.startsWith('ph-')) {
    icon.className = `ph ${tool.icon} shift-tool-icon shift-tool-icon-ph ${extraClass}`;
  } else {
    icon.className = `shift-tool-icon shift-tool-icon-ph ${extraClass}`;
    icon.setAttribute('data-lucide', tool.icon);
  }
  return icon;
}

function createInlineIcon(pathData: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  const path = document.createElementNS(namespace, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

function initShiftShell() {
  if (
    !isHomeDocument() &&
    (hasOpenFileFlag() ||
      getSourceTabIdFromLocation() !== undefined ||
      getRememberedSourceTabId() !== undefined)
  ) {
    document.body.classList.add('shift-has-open-file');
    if (pickerAcceptsPdf()) {
      document.body.classList.add('shift-open-file-in-tool');
    }
  }

  const donationRibbon = document.getElementById('donation-ribbon');
  if (donationRibbon) {
    donationRibbon.classList.add('hidden');
    donationRibbon.style.display = 'none';
  }

  const promiseBanner = document.getElementById('shift-promise-banner');
  if (promiseBanner) {
    const until = import.meta.env.VITE_PROMISE_BANNER_UNTIL;
    const now = Date.now();
    const state = readPromiseBannerState(localStorage);
    if (shouldShowPromiseBanner(now, state, until)) {
      markPromiseBannerSeen(localStorage, now, state.firstSeenAt);
      promiseBanner.hidden = false;
      promiseBanner
        .querySelector('#shift-promise-dismiss')
        ?.addEventListener('click', () => {
          dismissPromiseBanner(localStorage);
          promiseBanner.hidden = true;
        });
    }
  }

  const collapseBtn = document.getElementById('shift-sidebar-collapse');
  if (collapseBtn) {
    const applyCollapsed = (collapsed: boolean) => {
      document.body.classList.toggle('shift-sidebar-collapsed', collapsed);
      document.documentElement.classList.remove(
        'shift-sidebar-collapsed-pending'
      );
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      collapseBtn.setAttribute(
        'title',
        collapsed ? 'Expand sidebar' : 'Collapse sidebar'
      );
      const label = collapseBtn.querySelector('.shift-nav-label');
      if (label) label.textContent = collapsed ? 'Expand' : 'Collapse';
      requestAnimationFrame(() =>
        applyFavoritePinTitles(
          document.getElementById('shift-favorites-nav') ?? document,
          collapsed
        )
      );
    };

    applyCollapsed(readSidebarCollapsed());

    collapseBtn.addEventListener('click', () => {
      const collapsed = !document.body.classList.contains(
        'shift-sidebar-collapsed'
      );
      applyCollapsed(collapsed);
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
      } catch {
        // storage unavailable (private mode) — collapse still works for the session
      }
    });
  }

  initWorkspaceFileIndicator();

  const path = window.location.pathname.replace(/\/+$/, '');
  const file = path.split('/').pop() || 'index.html';
  const navMap: Record<string, string> = {
    'index.html': 'home',
    '': 'home',
    'compress-pdf.html': 'compress',
    'merge-pdf.html': 'merge',
    'pdf-converter.html': 'convert',
    'sign-pdf.html': 'esign',
  };
  // Clean URLs without .html (Cloudflare / nginx)
  const cleanMap: Record<string, string> = {
    'compress-pdf': 'compress',
    'merge-pdf': 'merge',
    'pdf-converter': 'convert',
    'sign-pdf': 'esign',
  };
  const key =
    navMap[file] ||
    cleanMap[file.replace(/\.html$/, '')] ||
    (file === 'index' || path.endsWith('/') ? 'home' : '');
  if (key) {
    document
      .querySelectorAll(`.shift-nav-link[data-nav="${key}"]`)
      .forEach((el) => {
        el.classList.add('is-active');
        el.setAttribute('aria-current', 'page');
      });
  }

  markActiveNavLinks();
}

function navPageId(pathname: string): string {
  const file = pathname.replace(/\/+$/, '').split('/').pop() || '';
  const page = file.replace(/\.html$/, '');
  return page === '' || page === 'index' ? 'index' : page;
}

/* Primary rail items are keyed by data-nav because their hrefs are aliased —
   pdf-converter.html serves "Convert". Favourites come from the catalog and
   only have an href, so they are matched by page instead. Both routes only
   add, so neither clears what the other marked. */
function markActiveNavLinks() {
  const current = navPageId(window.location.pathname);
  document
    .querySelectorAll<HTMLAnchorElement>('.shift-nav-link[href]')
    .forEach((link) => {
      const target = navPageId(
        new URL(link.href, window.location.href).pathname
      );
      if (target !== current) return;
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    });
}

const init = async () => {
  await initI18n();
  await loadRuntimeConfig();
  injectLanguageSwitcher();
  applyTranslations();

  initShiftShell();
  initHomeFiles();
  await seedToolOpenFile();
  trackPdfEngineExperience(
    new Set(
      categories.flatMap((category) => category.tools.map((tool) => tool.id))
    )
  );

  if (isCurrentPageDisabled()) {
    document.title = t('disabledTool.title') || 'Tool Unavailable';
    const main = document.querySelector('main') || document.body;
    const heading = t('disabledTool.heading') || 'This tool has been disabled';
    const message =
      t('disabledTool.message') ||
      'This tool is not available in your deployment. Contact your administrator for more information.';
    const backHome = t('disabledTool.backHome') || 'Back to Home';
    main.innerHTML = `
      <div class="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <i class="ph ph-prohibit text-6xl text-gray-500 mb-4"></i>
        <h1 class="text-2xl font-bold text-white mb-2">${heading}</h1>
        <p class="text-gray-400 mb-6">${message}</p>
        <a href="${import.meta.env.BASE_URL}" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition">${backHome}</a>
      </div>
    `;
    return;
  }

  if (__SIMPLE_MODE__) {
    const hideBrandingSections = () => {
      const githubLink = document.querySelector(
        'a[href*="github.com/alam00000/bentopdf"]'
      );
      if (githubLink) {
        (githubLink as HTMLElement).style.display = 'none';
      }

      const securitySection = document.getElementById(
        'security-compliance-section'
      );
      if (securitySection) {
        securitySection.style.display = 'none';
      }

      const faqSection = document.getElementById('faq-accordion');
      if (faqSection) {
        faqSection.style.display = 'none';
      }

      const testimonialsSection = document.getElementById(
        'testimonials-section'
      );
      if (testimonialsSection) {
        testimonialsSection.style.display = 'none';
      }

      const supportSection = document.getElementById('support-section');
      if (supportSection) {
        supportSection.style.display = 'none';
      }

      // Hide "Used by companies" section
      const usedBySection = document.querySelector(
        '.hide-section'
      ) as HTMLElement;
      if (usedBySection) {
        usedBySection.style.display = 'none';
      }

      const sectionDividers = document.querySelectorAll('.section-divider');
      sectionDividers.forEach((divider) => {
        (divider as HTMLElement).style.display = 'none';
      });

      const brandName = __BRAND_NAME__ || 'Shift PDF';
      document.title = `${t('simpleMode.title')} | ${brandName}`;

      const toolsHeader = document.getElementById('tools-header');
      if (toolsHeader) {
        const title = toolsHeader.querySelector('h2');
        const subtitle = toolsHeader.querySelector('p');
        if (title) {
          title.textContent = t('simpleMode.title');
          title.className = 'text-4xl md:text-5xl font-bold text-white mb-3';
        }
        if (subtitle) {
          subtitle.textContent = t('simpleMode.subtitle');
          subtitle.className = 'text-lg text-gray-400';
        }
      }

      const app = document.getElementById('app');
      if (app) {
        app.style.paddingTop = '1rem';
      }
    };

    hideBrandingSections();
  }

  // Hide shortcuts buttons on mobile devices (Android/iOS)
  // exclude iPad -> users can connect keyboard and use shortcuts
  const isMobile = /Android|iPhone|iPod/i.test(navigator.userAgent);
  const keyboardShortcutBtn = document.getElementById('shortcut');
  const shortcutSettingsBtn = document.getElementById('open-shortcuts-btn');

  if (isMobile) {
    if (keyboardShortcutBtn) keyboardShortcutBtn.style.display = 'none';
    if (shortcutSettingsBtn) shortcutSettingsBtn.style.display = 'none';
  } else {
    if (keyboardShortcutBtn) {
      keyboardShortcutBtn.textContent = navigator.userAgent
        .toUpperCase()
        .includes('MAC')
        ? '⌘ + K'
        : 'Ctrl + K';
    }
  }

  const categoryTranslationKeys: Record<string, string> = {
    'Popular Tools': 'tools:categories.popularTools',
    'Edit & Annotate': 'tools:categories.editAnnotate',
    'Convert to PDF': 'tools:categories.convertToPdf',
    'Convert from PDF': 'tools:categories.convertFromPdf',
    'Organize & Manage': 'tools:categories.organizeManage',
    'Optimize & Repair': 'tools:categories.optimizeRepair',
    'Secure PDF': 'tools:categories.securePdf',
  };

  const toolTranslationKeys: Record<string, string> = {
    'PDF Workflow Builder': 'tools:pdfWorkflow',
    'PDF Multi Tool': 'tools:pdfMultiTool',
    'Merge PDF': 'tools:mergePdf',
    'Split PDF': 'tools:splitPdf',
    'Compress PDF': 'tools:compressPdf',
    'PDF Editor': 'tools:pdfEditor',
    'JPG to PDF': 'tools:jpgToPdf',
    'Sign PDF': 'tools:signPdf',
    'Crop PDF': 'tools:cropPdf',
    'Extract Pages': 'tools:extractPages',
    'Duplicate & Organize': 'tools:duplicateOrganize',
    'Delete Pages': 'tools:deletePages',
    'Edit Bookmarks': 'tools:editBookmarks',
    'Table of Contents': 'tools:tableOfContents',
    'Page Numbers': 'tools:pageNumbers',
    'Add Page Labels': 'tools:addPageLabels',
    'Add Watermark': 'tools:addWatermark',
    'Header & Footer': 'tools:headerFooter',
    'Invert Colors': 'tools:invertColors',
    'Background Color': 'tools:backgroundColor',
    'Change Text Color': 'tools:changeTextColor',
    'Add Stamps': 'tools:addStamps',
    'Bates Numbering': 'tools:batesNumbering',
    'Remove Annotations': 'tools:removeAnnotations',
    'PDF Form Filler': 'tools:pdfFormFiller',
    'Create PDF Form': 'tools:createPdfForm',
    'Remove Blank Pages': 'tools:removeBlankPages',
    'Images to PDF': 'tools:imageToPdf',
    'PNG to PDF': 'tools:pngToPdf',
    'WebP to PDF': 'tools:webpToPdf',
    'SVG to PDF': 'tools:svgToPdf',
    'BMP to PDF': 'tools:bmpToPdf',
    'HEIC to PDF': 'tools:heicToPdf',
    'TIFF to PDF': 'tools:tiffToPdf',
    'Text to PDF': 'tools:textToPdf',
    'JSON to PDF': 'tools:jsonToPdf',
    'PDF to JPG': 'tools:pdfToJpg',
    'PDF to PNG': 'tools:pdfToPng',
    'PDF to WebP': 'tools:pdfToWebp',
    'PDF to BMP': 'tools:pdfToBmp',
    'PDF to TIFF': 'tools:pdfToTiff',
    'PDF to CBZ': 'tools:pdfToCbz',
    'PDF to Greyscale': 'tools:pdfToGreyscale',
    'PDF to JSON': 'tools:pdfToJson',
    'OCR PDF': 'tools:ocrPdf',
    'Alternate & Mix Pages': 'tools:alternateMerge',
    'PDF Overlay': 'tools:pdfOverlay',
    'Organize & Duplicate': 'tools:duplicateOrganize',
    'Add Attachments': 'tools:addAttachments',
    'Extract Attachments': 'tools:extractAttachments',
    'Edit Attachments': 'tools:editAttachments',
    'Divide Pages': 'tools:dividePages',
    'Add Blank Page': 'tools:addBlankPage',
    'Reverse Pages': 'tools:reversePages',
    'Rotate PDF': 'tools:rotatePdf',
    'Rotate by Custom Degrees': 'tools:rotateCustom',
    'N-Up PDF': 'tools:nUpPdf',
    'Combine to Single Page': 'tools:combineToSinglePage',
    'View Metadata': 'tools:viewMetadata',
    'Edit Metadata': 'tools:editMetadata',
    'PDFs to ZIP': 'tools:pdfsToZip',
    'Compare PDFs': 'tools:comparePdfs',
    'Posterize PDF': 'tools:posterizePdf',
    'Fix Page Size': 'tools:fixPageSize',
    'Linearize PDF': 'tools:linearizePdf',
    'Page Dimensions': 'tools:pageDimensions',
    'Remove Restrictions': 'tools:removeRestrictions',
    'Repair PDF': 'tools:repairPdf',
    'Encrypt PDF': 'tools:encryptPdf',
    'Sanitize PDF': 'tools:sanitizePdf',
    'Decrypt PDF': 'tools:decryptPdf',
    'Flatten PDF': 'tools:flattenPdf',
    'Remove Metadata': 'tools:removeMetadata',
    'Change Permissions': 'tools:changePermissions',
    'Email to PDF': 'tools:emailToPdf',
    'Font to Outline': 'tools:fontToOutline',
    'Deskew PDF': 'tools:deskewPdf',
    'Digital Signature': 'tools:digitalSignPdf',
    'Validate Signature': 'tools:validateSignaturePdf',
    'Timestamp PDF': 'tools:timestampPdf',
    'Scanner Effect': 'tools:scannerEffect',
    'Adjust Colors': 'tools:adjustColors',
    'Markdown to PDF': 'tools:markdownToPdf',
    'PDF Booklet': 'tools:pdfBooklet',
    'Word to PDF': 'tools:wordToPdf',
    'Excel to PDF': 'tools:excelToPdf',
    'PowerPoint to PDF': 'tools:powerpointToPdf',
    'XPS to PDF': 'tools:xpsToPdf',
    'MOBI to PDF': 'tools:mobiToPdf',
    'EPUB to PDF': 'tools:epubToPdf',
    'FB2 to PDF': 'tools:fb2ToPdf',
    'CBZ to PDF': 'tools:cbzToPdf',
    'WPD to PDF': 'tools:wpdToPdf',
    'WPS to PDF': 'tools:wpsToPdf',
    'XML to PDF': 'tools:xmlToPdf',
    'Pages to PDF': 'tools:pagesToPdf',
    'ODG to PDF': 'tools:odgToPdf',
    'ODS to PDF': 'tools:odsToPdf',
    'ODP to PDF': 'tools:odpToPdf',
    'PUB to PDF': 'tools:pubToPdf',
    'VSD to PDF': 'tools:vsdToPdf',
    'PSD to PDF': 'tools:psdToPdf',
    'ODT to PDF': 'tools:odtToPdf',
    'CSV to PDF': 'tools:csvToPdf',
    'RTF to PDF': 'tools:rtfToPdf',
    'PDF to SVG': 'tools:pdfToSvg',
    'PDF to CSV': 'tools:pdfToCsv',
    'PDF to Excel': 'tools:pdfToExcel',
    'PDF to Text': 'tools:pdfToText',
    'Extract Tables': 'tools:extractTables',
    'PDF to Word': 'tools:pdfToWord',
    'Extract Images': 'tools:extractImages',
    'PDF to Markdown': 'tools:pdfToMarkdown',
    'Prepare PDF for AI': 'tools:preparePdfForAi',
    'PDF OCG': 'tools:pdfOcg',
    'PDF to PDF/A': 'tools:pdfToPdfa',
    'Rasterize PDF': 'tools:rasterizePdf',
  };

  /* The rail's own items, pinned for everyone. They are excluded from the
     favourites list and carry no star, because a control that offers to pin
     something already permanently pinned has nothing to toggle. 'pdf-converter'
     is the Convert item; it is a hub page rather than a catalog entry, so it
     never reaches the grid, but it belongs here for the rail's sake. */
  const primaryToolIds = new Set([
    'compress-pdf',
    'merge-pdf',
    'pdf-converter',
    'sign-pdf',
  ]);
  const toolsById = new Map<
    string,
    (typeof categories)[number]['tools'][number]
  >();
  categories.forEach((category) => {
    category.tools.forEach((tool) => {
      if (!isToolDisabled(tool.id) && !toolsById.has(tool.id)) {
        toolsById.set(tool.id, tool);
      }
    });
  });

  const validToolIds = new Set(toolsById.keys());
  let favoriteToolIds = loadFavoriteToolIds(validToolIds);

  const getToolName = (tool: (typeof categories)[number]['tools'][number]) => {
    const toolKey = toolTranslationKeys[tool.name];
    return toolKey ? t(`${toolKey}.name`) : tool.name;
  };

  const updateGridFavoriteControls = () => {
    document
      .querySelectorAll<HTMLButtonElement>('.shift-tool-favorite')
      .forEach((button) => {
        const toolId = button.dataset.toolId;
        const tool = toolId ? toolsById.get(toolId) : undefined;
        if (!toolId || !tool) return;

        const isFavorite = favoriteToolIds.includes(toolId);
        const toolName = getToolName(tool);
        button.setAttribute('aria-pressed', String(isFavorite));
        button.setAttribute(
          'aria-label',
          `${isFavorite ? 'Remove' : 'Add'} ${toolName} ${
            isFavorite ? 'from' : 'to'
          } favorites`
        );
        button.setAttribute(
          'title',
          `${isFavorite ? 'Remove from' : 'Add to'} favorites`
        );
      });
  };

  const renderSidebarFavorites = () => {
    const section = document.getElementById('shift-favorites');
    const nav = document.getElementById('shift-favorites-nav');
    if (!section || !nav) return;

    nav.textContent = '';
    const sidebarFavoriteIds = favoriteToolIds.filter(
      (toolId) => !primaryToolIds.has(toolId)
    );
    section.hidden = sidebarFavoriteIds.length === 0;
    const pins: FavoriteRailPin[] = [];

    sidebarFavoriteIds.forEach((toolId) => {
      const tool = toolsById.get(toolId);
      if (!tool) return;

      const item = document.createElement('div');
      item.className = 'shift-favorite-item';

      const link = document.createElement('a');
      link.href = tool.href;
      link.className = 'shift-nav-link shift-favorite-link';
      link.addEventListener('mouseenter', () => {
        applyFavoritePinTitles(
          nav,
          document.body.classList.contains('shift-sidebar-collapsed')
        );
      });

      const icon = createToolIcon(tool, 'shift-nav-icon');
      const label = document.createElement('span');
      label.className = 'shift-nav-label';
      label.textContent = getToolName(tool);
      link.append(icon, label);

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'shift-favorite-remove';
      removeButton.dataset.toolId = toolId;
      removeButton.setAttribute(
        'aria-label',
        `Remove ${getToolName(tool)} from favorites`
      );
      removeButton.title = 'Remove from favorites';
      removeButton.appendChild(createInlineIcon('m6 6 12 12M18 6 6 18'));
      removeButton.addEventListener('click', () => {
        favoriteToolIds = toggleFavoriteToolId(favoriteToolIds, toolId);
        saveFavoriteToolIds(favoriteToolIds);
        renderSidebarFavorites();
        renderGridFavorites();
        updateGridFavoriteControls();
        refreshGridSearch();
      });

      item.append(link, removeButton);
      nav.appendChild(item);
      pins.push({ name: getToolName(tool), href: tool.href, icon: tool.icon });
    });

    // Lucide glyphs arrive as <i data-lucide> placeholders, and a re-render
    // makes new ones, so they have to be materialised every time.
    createIcons({ icons });
    saveFavoriteRailSnapshot(pins);
    markActiveNavLinks();
    requestAnimationFrame(() =>
      applyFavoritePinTitles(
        nav,
        document.body.classList.contains('shift-sidebar-collapsed')
      )
    );
  };

  let renderGridFavorites = () => {};
  let refreshGridSearch = () => {};

  const toggleFavorite = (toolId: string) => {
    favoriteToolIds = toggleFavoriteToolId(favoriteToolIds, toolId);
    saveFavoriteToolIds(favoriteToolIds);
    renderSidebarFavorites();
    renderGridFavorites();
    updateGridFavoriteControls();
    refreshGridSearch();
  };

  renderSidebarFavorites();

  // Homepage-only tool grid rendering (not used on individual tool pages)
  if (dom.toolGrid) {
    dom.toolGrid.textContent = '';

    let collapsedCategories: string[] = [];
    try {
      const stored = localStorage.getItem('collapsedCategories');
      if (stored) collapsedCategories = JSON.parse(stored);
    } catch {
      localStorage.removeItem('collapsedCategories');
    }

    function saveCollapsedCategories() {
      localStorage.setItem(
        'collapsedCategories',
        JSON.stringify(collapsedCategories)
      );
    }

    const filteredCategories = categories
      .map((category) => ({
        ...category,
        tools: category.tools.filter((tool) => !isToolDisabled(tool.id)),
      }))
      .filter((category) => category.tools.length > 0);

    const toolCards = new Map<string, HTMLElement[]>();
    const originalToolContainers = new Map<HTMLElement, HTMLElement>();

    // Favorites is always the first category. It owns one card per favorited
    // tool rather than cloning it. Extra catalog copies of the same ID stay in
    // their source sections and hide only while that tool is favorited.
    const favoritesGroup = document.createElement('div');
    favoritesGroup.id = 'favorite-tools';
    favoritesGroup.className =
      'category-group shift-favorites-category col-span-full';
    favoritesGroup.dataset.categoryType = 'favorites';

    const favoritesHeader = document.createElement('button');
    favoritesHeader.className = 'category-header';
    favoritesHeader.type = 'button';

    const favoritesHeading = document.createElement('span');
    favoritesHeading.className = 'shift-favorites-heading';
    const favoritesTitle = document.createElement('span');
    favoritesTitle.textContent = t('tools:categories.favoriteTools');
    const favoritesCount = document.createElement('span');
    favoritesCount.className = 'shift-favorites-count';
    favoritesCount.setAttribute('aria-hidden', 'true');
    favoritesHeading.append(favoritesTitle, favoritesCount);

    const favoritesChevron = document.createElement('i');
    favoritesChevron.setAttribute('data-lucide', 'chevron-down');
    favoritesChevron.className =
      'category-chevron w-5 h-5 text-gray-400 transition-transform duration-300';
    favoritesHeader.append(favoritesHeading, favoritesChevron);

    const favoritesToolsContainer = document.createElement('div');
    favoritesToolsContainer.className = 'category-tools shift-tool-grid';

    const favoritesEmpty = document.createElement('div');
    favoritesEmpty.className = 'shift-favorites-empty';
    const favoritesEmptyIcon = createInlineIcon(
      'm12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z'
    );
    favoritesEmptyIcon.setAttribute('aria-hidden', 'true');
    const favoritesEmptyTitle = document.createElement('strong');
    favoritesEmptyTitle.textContent = t('tools:favorites.emptyTitle');
    const favoritesEmptyCopy = document.createElement('span');
    favoritesEmptyCopy.textContent = t('tools:favorites.emptyDescription');
    favoritesEmpty.append(
      favoritesEmptyIcon,
      favoritesEmptyTitle,
      favoritesEmptyCopy
    );
    favoritesToolsContainer.appendChild(favoritesEmpty);

    let favoritesCollapsed = false;
    try {
      const storedFavoritesCollapsed = localStorage.getItem(
        'shiftFavoritesCategoryCollapsed'
      );
      if (storedFavoritesCollapsed !== null) {
        favoritesCollapsed = storedFavoritesCollapsed === 'true';
      }
    } catch {
      // Storage can be unavailable in locked-down browser contexts.
    }

    const setFavoritesCollapsed = (
      collapsed: boolean,
      persist = true,
      animate = true
    ) => {
      favoritesCollapsed = collapsed;
      favoritesHeader.setAttribute('aria-expanded', String(!collapsed));

      if (collapsed) {
        favoritesGroup.classList.add('collapsed');
        if (animate) {
          favoritesToolsContainer.style.maxHeight =
            favoritesToolsContainer.scrollHeight + 'px';
          favoritesToolsContainer.style.overflow = 'hidden';
          requestAnimationFrame(() => {
            favoritesToolsContainer.style.maxHeight = '0px';
          });
        } else {
          favoritesToolsContainer.style.maxHeight = '0px';
          favoritesToolsContainer.style.overflow = 'hidden';
        }
      } else {
        favoritesGroup.classList.remove('collapsed');
        favoritesToolsContainer.style.overflow = animate ? 'hidden' : 'visible';
        favoritesToolsContainer.style.maxHeight = animate
          ? favoritesToolsContainer.scrollHeight + 'px'
          : 'none';
      }

      if (persist) {
        try {
          localStorage.setItem(
            'shiftFavoritesCategoryCollapsed',
            String(collapsed)
          );
        } catch {
          // The visual state still works when storage is unavailable.
        }
      }
    };

    favoritesToolsContainer.addEventListener('transitionend', (event) => {
      if ((event as TransitionEvent).propertyName !== 'max-height') return;
      if (!favoritesCollapsed) {
        favoritesToolsContainer.style.maxHeight = 'none';
        favoritesToolsContainer.style.overflow = 'visible';
      }
    });
    favoritesHeader.addEventListener('click', () => {
      setFavoritesCollapsed(!favoritesCollapsed);
    });

    favoritesGroup.append(favoritesHeader, favoritesToolsContainer);
    dom.toolGrid.appendChild(favoritesGroup);
    setFavoritesCollapsed(favoritesCollapsed, false, false);

    filteredCategories.forEach((category) => {
      const categoryGroup = document.createElement('div');
      categoryGroup.className = 'category-group col-span-full';
      categoryGroup.dataset.categoryName = category.name;

      const header = document.createElement('button');
      header.className = 'category-header';
      header.type = 'button';

      const title = document.createElement('span');
      const categoryKey = categoryTranslationKeys[category.name];
      title.textContent = categoryKey ? t(categoryKey) : category.name;

      const chevron = document.createElement('i');
      chevron.setAttribute('data-lucide', 'chevron-down');
      chevron.className =
        'category-chevron w-5 h-5 text-gray-400 transition-transform duration-300';

      header.append(title, chevron);

      const toolsContainer = document.createElement('div');
      toolsContainer.className = 'category-tools shift-tool-grid';

      const isCollapsed = collapsedCategories.includes(category.name);
      if (isCollapsed) {
        categoryGroup.classList.add('collapsed');
        toolsContainer.style.maxHeight = '0px';
      }

      toolsContainer.addEventListener('transitionend', (e) => {
        if ((e as TransitionEvent).propertyName !== 'max-height') return;
        if (!categoryGroup.classList.contains('collapsed')) {
          toolsContainer.style.maxHeight = 'none';
          toolsContainer.style.overflow = 'visible';
        }
      });

      header.addEventListener('click', () => {
        const collapsed = categoryGroup.classList.toggle('collapsed');
        if (collapsed) {
          toolsContainer.style.maxHeight = toolsContainer.scrollHeight + 'px';
          toolsContainer.style.overflow = 'hidden';
          requestAnimationFrame(() => {
            toolsContainer.style.maxHeight = '0px';
          });
          if (!collapsedCategories.includes(category.name)) {
            collapsedCategories.push(category.name);
          }
        } else {
          toolsContainer.style.overflow = 'hidden';
          toolsContainer.style.maxHeight = toolsContainer.scrollHeight + 'px';
          collapsedCategories = collapsedCategories.filter(
            (n) => n !== category.name
          );
        }
        saveCollapsedCategories();
      });

      category.tools.forEach((tool) => {
        const toolId = getToolId(tool);

        const toolCard = document.createElement('div');
        toolCard.className = 'tool-card';
        toolCard.dataset.toolId = toolId;
        const cardsForTool = toolCards.get(toolId) ?? [];
        cardsForTool.push(toolCard);
        toolCards.set(toolId, cardsForTool);
        originalToolContainers.set(toolCard, toolsContainer);

        let toolContent: HTMLDivElement | HTMLAnchorElement;

        if (tool.href) {
          toolContent = document.createElement('a');
          toolContent.href = tool.href;
          toolContent.className =
            'shift-tool-card-link no-underline transition duration-200';
        } else {
          toolContent = document.createElement('div');
          toolContent.className =
            'shift-tool-card-link cursor-pointer transition duration-200';
          toolContent.dataset.toolId = toolId;
        }

        const icon = createToolIcon(tool, 'mb-3');

        const toolName = document.createElement('h3');
        toolName.className = 'font-semibold shift-tool-name';
        const toolKey = toolTranslationKeys[tool.name];
        toolName.textContent = toolKey ? t(`${toolKey}.name`) : tool.name;

        toolContent.append(icon, toolName);

        if (tool.subtitle) {
          const toolSubtitle = document.createElement('p');
          toolSubtitle.className = 'text-xs shift-tool-subtitle mt-1 px-2';
          toolSubtitle.textContent = toolKey
            ? t(`${toolKey}.subtitle`)
            : tool.subtitle;
          toolContent.appendChild(toolSubtitle);
        }

        if (primaryToolIds.has(toolId)) {
          toolCard.appendChild(toolContent);
        } else {
          const favoriteButton = document.createElement('button');
          favoriteButton.type = 'button';
          favoriteButton.className = 'shift-tool-favorite';
          favoriteButton.dataset.toolId = toolId;
          favoriteButton.appendChild(
            createInlineIcon(
              'm12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z'
            )
          );
          favoriteButton.addEventListener('click', () =>
            toggleFavorite(toolId)
          );
          toolCard.append(toolContent, favoriteButton);
        }

        toolsContainer.appendChild(toolCard);
      });

      categoryGroup.append(header, toolsContainer);
      // Stable anchors for Shift sidebar category links
      const categoryAnchorIds: Record<string, string> = {
        'Popular Tools': 'popular-tools',
        'Edit & Annotate': 'edit-annotate',
        'Convert to PDF': 'convert-to-pdf',
        'Convert from PDF': 'convert-from-pdf',
        'Organize & Manage': 'organize-manage',
        'Optimize & Repair': 'optimize-repair',
        'Secure PDF': 'secure-pdf',
      };
      const anchorId = categoryAnchorIds[category.name];
      if (anchorId) {
        categoryGroup.id = anchorId;
      }
      dom.toolGrid.appendChild(categoryGroup);

      if (!isCollapsed) {
        toolsContainer.style.maxHeight = 'none';
        toolsContainer.style.overflow = 'visible';
      }
    });

    renderGridFavorites = () => {
      placeFavoriteToolCards(
        toolCards,
        originalToolContainers,
        favoriteToolIds,
        favoritesToolsContainer
      );

      favoritesCount.textContent = favoriteToolIds.length
        ? String(favoriteToolIds.length)
        : '';
      favoritesCount.hidden = favoriteToolIds.length === 0;
      favoritesEmpty.hidden = favoriteToolIds.length > 0;
      favoritesGroup.classList.toggle(
        'has-favorites',
        favoriteToolIds.length > 0
      );

      if (!favoritesCollapsed) {
        favoritesToolsContainer.style.maxHeight = 'none';
        favoritesToolsContainer.style.overflow = 'visible';
      }
    };

    const searchBar = document.getElementById(
      'search-bar'
    ) as HTMLInputElement | null;
    const gridView = document.getElementById('grid-view');
    const categoryGroups = dom.toolGrid.querySelectorAll('.category-group');
    const searchStatus = document.getElementById('tool-search-status');
    const searchEmpty = document.getElementById('tool-search-empty');
    const categoryChips = document.getElementById('home-category-chips');
    let selectedCategory: string | null = null;

    const syncToolCatalog = (searchFocused: boolean, searchQuery: string) => {
      setToolCatalogOpen(
        gridView,
        shouldShowToolCatalog({
          searchFocused,
          searchQuery,
          selectedCategory,
        })
      );
    };

    const syncCategoryChips = () => {
      categoryChips
        ?.querySelectorAll('.shift-category-chip')
        .forEach((chip) => {
          const isPressed =
            chip.getAttribute('data-category') === selectedCategory;
          chip.setAttribute('aria-pressed', String(isPressed));
        });
    };

    const revealSelectedCategory = () => {
      if (!selectedCategory) return;
      categoryGroups.forEach((group) => {
        const groupEl = group as HTMLElement;
        const matches = shouldShowCategoryGroup({
          isFavorites: groupEl.dataset.categoryType === 'favorites',
          categoryName: groupEl.dataset.categoryName,
          selectedCategory,
        });
        if (!matches || !groupEl.classList.contains('collapsed')) return;
        const tools = groupEl.querySelector<HTMLElement>('.category-tools');
        groupEl.classList.remove('collapsed');
        if (tools) {
          tools.style.maxHeight = 'none';
          tools.style.overflow = 'visible';
        }
      });
    };

    const applyToolSearch = (rawQuery: string) => {
      const searchTerm = rawQuery.toLowerCase().trim();
      let matchCount = 0;

      categoryGroups.forEach((group) => {
        const groupEl = group as HTMLElement;
        const isFavoritesGroup = groupEl.dataset.categoryType === 'favorites';
        const toolCards = group.querySelectorAll('.tool-card');
        let groupMatches = 0;

        toolCards.forEach((card) => {
          const cardEl = card as HTMLElement;
          if (cardEl.getAttribute(FAVORITE_CATALOG_COPY_ATTR) === 'hidden') {
            cardEl.hidden = true;
            return;
          }

          if (!searchTerm) {
            cardEl.hidden = false;
            groupMatches++;
            return;
          }

          const toolName = (
            card.querySelector('h3')?.textContent || ''
          ).toLowerCase();
          const toolSubtitle = (
            card.querySelector('p')?.textContent || ''
          ).toLowerCase();
          const isMatch =
            toolName.includes(searchTerm) || toolSubtitle.includes(searchTerm);

          cardEl.hidden = !isMatch;
          if (isMatch) groupMatches++;
        });

        const categoryVisible = shouldShowCategoryGroup({
          isFavorites: isFavoritesGroup,
          categoryName: groupEl.dataset.categoryName,
          selectedCategory,
        });
        matchCount += categoryVisible ? groupMatches : 0;
        groupEl.hidden =
          !categoryVisible || (!isFavoritesGroup && groupMatches === 0);
        groupEl.classList.toggle('is-tool-searching', Boolean(searchTerm));
      });

      favoritesEmpty.hidden = Boolean(searchTerm) || favoriteToolIds.length > 0;
      favoritesHeader.setAttribute(
        'aria-expanded',
        String(Boolean(searchTerm) || !favoritesCollapsed)
      );

      if (searchStatus) {
        if (!searchTerm) {
          searchStatus.textContent = '';
        } else if (matchCount === 0) {
          searchStatus.textContent = 'No tools match your search.';
        } else {
          searchStatus.textContent = `${matchCount} tool${
            matchCount === 1 ? '' : 's'
          } match your search.`;
        }
      }

      if (searchEmpty) {
        const showEmpty = Boolean(searchTerm) && matchCount === 0;
        searchEmpty.hidden = !showEmpty;
        searchEmpty.classList.toggle('hidden', !showEmpty);
      }

      syncToolCatalog(document.activeElement === searchBar, rawQuery);
    };
    refreshGridSearch = () => applyToolSearch(searchBar?.value ?? '');
    renderGridFavorites();
    updateGridFavoriteControls();
    refreshGridSearch();

    if (categoryChips) {
      const createChipDismissIcon = () => {
        const svg = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'svg'
        );
        svg.setAttribute('class', 'shift-category-chip-x');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'path'
        );
        path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '1.75');
        path.setAttribute('stroke-linecap', 'round');
        svg.appendChild(path);
        return svg;
      };

      const fillChipLabel = (button: HTMLButtonElement, label: string) => {
        const text = document.createElement('span');
        text.textContent = label;
        button.replaceChildren(text, createChipDismissIcon());
      };

      const applyCategorySelection = (next: string | null) => {
        selectedCategory = next;
        syncCategoryChips();
        applyToolSearch(searchBar?.value ?? '');
        revealSelectedCategory();
      };

      filteredCategories.forEach((category) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'shift-category-chip';
        button.dataset.category = category.name;
        const categoryKey = categoryTranslationKeys[category.name];
        fillChipLabel(button, categoryKey ? t(categoryKey) : category.name);
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          applyCategorySelection(
            toggleSelectedCategory(selectedCategory, category.name)
          );
        });
        categoryChips.appendChild(button);
      });
    }

    if (searchBar) {
      searchBar.addEventListener('input', () => {
        applyToolSearch(searchBar.value);
      });

      searchBar.addEventListener('focus', () => {
        syncToolCatalog(true, searchBar.value);
      });

      searchBar.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (document.activeElement === searchBar) return;
          syncToolCatalog(false, searchBar.value);
        }, 150);
      });

      window.addEventListener('keydown', function (e) {
        const key = e.key.toLowerCase();
        const isMac = navigator.userAgent.toUpperCase().includes('MAC');
        const isCtrlK = e.ctrlKey && key === 'k';
        const isCmdK = isMac && e.metaKey && key === 'k';

        if (isCtrlK || isCmdK) {
          e.preventDefault();
          searchBar.focus();
        }
      });
    }

    dom.toolGrid.addEventListener('click', () => {
      // All tools now use href and navigate directly - no modal handling needed
    });
  }

  if (dom.backToGridBtn) {
    dom.backToGridBtn.addEventListener('click', () => switchView('grid'));
  }

  if (dom.alertOkBtn) {
    dom.alertOkBtn.addEventListener('click', hideAlert);
  }

  const faqAccordion = document.getElementById('faq-accordion');
  if (faqAccordion) {
    faqAccordion.addEventListener('click', (e) => {
      // @ts-expect-error TS(2339) FIXME: Property 'closest' does not exist on type 'EventTa... Remove this comment to see the full error message
      const questionButton = e.target.closest('.faq-question');
      if (!questionButton) return;

      const faqItem = questionButton.parentElement;
      const answer = faqItem.querySelector('.faq-answer');

      faqItem.classList.toggle('open');

      if (faqItem.classList.contains('open')) {
        answer.style.maxHeight = answer.scrollHeight + 'px';
      } else {
        answer.style.maxHeight = '0px';
      }
    });
  }

  createIcons({ icons });
  console.log('Please share our tool and share the love!');

  const githubStarsElements = [
    document.getElementById('github-stars-desktop'),
    document.getElementById('github-stars-mobile'),
  ];

  if (githubStarsElements.some((el) => el) && !__SIMPLE_MODE__) {
    fetch('https://api.github.com/repos/alam00000/bentopdf')
      .then((response) => response.json())
      .then((data) => {
        if (data.stargazers_count !== undefined) {
          const formattedStars = formatStars(data.stargazers_count);
          githubStarsElements.forEach((el) => {
            if (el) el.textContent = formattedStars;
          });
        }
      })
      .catch(() => {
        githubStarsElements.forEach((el) => {
          if (el) el.textContent = '-';
        });
      });
  }

  // Initialize Shortcuts System
  ShortcutsManager.init();

  // Tab switching for settings modal
  const shortcutsTabBtn = document.getElementById('shortcuts-tab-btn');
  const preferencesTabBtn = document.getElementById('preferences-tab-btn');
  const shortcutsTabContent = document.getElementById('shortcuts-tab-content');
  const preferencesTabContent = document.getElementById(
    'preferences-tab-content'
  );
  const shortcutsTabFooter = document.getElementById('shortcuts-tab-footer');
  const preferencesTabFooter = document.getElementById(
    'preferences-tab-footer'
  );
  const resetShortcutsBtn = document.getElementById('reset-shortcuts-btn');

  if (shortcutsTabBtn && preferencesTabBtn) {
    shortcutsTabBtn.addEventListener('click', () => {
      shortcutsTabBtn.classList.add('bg-indigo-600', 'text-white');
      shortcutsTabBtn.classList.remove('text-gray-300');
      preferencesTabBtn.classList.remove('bg-indigo-600', 'text-white');
      preferencesTabBtn.classList.add('text-gray-300');
      shortcutsTabContent?.classList.remove('hidden');
      preferencesTabContent?.classList.add('hidden');
      shortcutsTabFooter?.classList.remove('hidden');
      preferencesTabFooter?.classList.add('hidden');
      resetShortcutsBtn?.classList.remove('hidden');
    });

    preferencesTabBtn.addEventListener('click', () => {
      preferencesTabBtn.classList.add('bg-indigo-600', 'text-white');
      preferencesTabBtn.classList.remove('text-gray-300');
      shortcutsTabBtn.classList.remove('bg-indigo-600', 'text-white');
      shortcutsTabBtn.classList.add('text-gray-300');
      preferencesTabContent?.classList.remove('hidden');
      shortcutsTabContent?.classList.add('hidden');
      preferencesTabFooter?.classList.remove('hidden');
      shortcutsTabFooter?.classList.add('hidden');
      resetShortcutsBtn?.classList.add('hidden');
    });
  }

  // Full-width toggle functionality
  const fullWidthToggle = document.getElementById(
    'full-width-toggle'
  ) as HTMLInputElement;
  const toolInterface = document.getElementById('tool-interface');

  const savedFullWidth = localStorage.getItem('fullWidthMode') !== 'false';
  if (fullWidthToggle) {
    fullWidthToggle.checked = savedFullWidth;
    applyFullWidthMode(savedFullWidth);
  }

  function applyFullWidthMode(enabled: boolean) {
    if (toolInterface) {
      if (enabled) {
        toolInterface.classList.remove('max-w-4xl');
      } else {
        toolInterface.classList.add('max-w-4xl');
      }
    }

    // Apply to all page uploaders
    const pageUploaders = document.querySelectorAll(
      '#tool-uploader, #signature-editor'
    );
    pageUploaders.forEach((uploader) => {
      if (enabled) {
        uploader.classList.remove('max-w-2xl', 'max-w-5xl');
      } else {
        // Restore original max-width (most are max-w-2xl, add-stamps is max-w-5xl)
        if (
          !uploader.classList.contains('max-w-2xl') &&
          !uploader.classList.contains('max-w-5xl')
        ) {
          uploader.classList.add('max-w-2xl');
        }
      }
    });
  }

  if (fullWidthToggle) {
    fullWidthToggle.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      localStorage.setItem('fullWidthMode', enabled.toString());
      applyFullWidthMode(enabled);
    });
  }

  const compactModeToggle = document.getElementById(
    'compact-mode-toggle'
  ) as HTMLInputElement;

  const savedCompactMode = localStorage.getItem('compactMode') === 'true';
  if (compactModeToggle) {
    compactModeToggle.checked = savedCompactMode;
  }
  applyCompactMode(savedCompactMode);

  function applyCompactMode(enabled: boolean) {
    if (dom.toolGrid) {
      dom.toolGrid.classList.toggle('compact-mode', enabled);
      dom.toolGrid
        .querySelectorAll('.category-group:not(.collapsed) .category-tools')
        .forEach((container) => {
          (container as HTMLElement).style.maxHeight = 'none';
        });
    }
  }

  if (compactModeToggle) {
    compactModeToggle.addEventListener('change', (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      localStorage.setItem('compactMode', enabled.toString());
      applyCompactMode(enabled);
    });
  }

  // Shortcuts UI Handlers
  if (dom.openShortcutsBtn) {
    dom.openShortcutsBtn.addEventListener('click', () => {
      renderShortcutsList();
      dom.shortcutsModal.classList.remove('hidden');
    });
  }

  if (dom.closeShortcutsModalBtn) {
    dom.closeShortcutsModalBtn.addEventListener('click', () => {
      dom.shortcutsModal.classList.add('hidden');
    });
  }

  // Close modal on outside click
  if (dom.shortcutsModal) {
    dom.shortcutsModal.addEventListener('click', (e) => {
      if (e.target === dom.shortcutsModal) {
        dom.shortcutsModal.classList.add('hidden');
      }
    });
  }

  if (dom.resetShortcutsBtn) {
    dom.resetShortcutsBtn.addEventListener('click', async () => {
      const confirmed = await showWarningModal(
        t('settings.warnings.resetTitle'),
        t('settings.warnings.resetMessage'),
        true
      );

      if (confirmed) {
        ShortcutsManager.reset();
        renderShortcutsList();
      }
    });
  }

  if (dom.exportShortcutsBtn) {
    dom.exportShortcutsBtn.addEventListener('click', () => {
      ShortcutsManager.exportSettings();
    });
  }

  if (dom.importShortcutsBtn) {
    dom.importShortcutsBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const content = e.target?.result as string;
            if (ShortcutsManager.importSettings(content)) {
              renderShortcutsList();
              await showWarningModal(
                t('settings.warnings.importSuccessTitle'),
                t('settings.warnings.importSuccessMessage'),
                false
              );
            } else {
              await showWarningModal(
                t('settings.warnings.importFailTitle'),
                t('settings.warnings.importFailMessage'),
                false
              );
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    });
  }

  if (dom.shortcutSearch) {
    dom.shortcutSearch.addEventListener('input', (e) => {
      const term = (e.target as HTMLInputElement).value.toLowerCase();
      const sections = dom.shortcutsList.querySelectorAll('.category-section');

      sections.forEach((section) => {
        const items = section.querySelectorAll('.shortcut-item');
        let visibleCount = 0;

        items.forEach((item) => {
          const text = item.textContent?.toLowerCase() || '';
          if (text.includes(term)) {
            item.classList.remove('hidden');
            visibleCount++;
          } else {
            item.classList.add('hidden');
          }
        });

        if (visibleCount === 0) {
          section.classList.add('hidden');
        } else {
          section.classList.remove('hidden');
        }
      });
    });
  }

  // Reserved shortcuts that commonly conflict with browser/OS functions
  const RESERVED_SHORTCUTS: Record<string, { mac?: string; windows?: string }> =
    {
      'mod+w': { mac: 'Closes tab', windows: 'Closes tab' },
      'mod+t': { mac: 'Opens new tab', windows: 'Opens new tab' },
      'mod+n': { mac: 'Opens new window', windows: 'Opens new window' },
      'mod+shift+n': {
        mac: 'Opens incognito window',
        windows: 'Opens incognito window',
      },
      'mod+q': { mac: 'Quits application (cannot be overridden)' },
      'mod+m': { mac: 'Minimizes window' },
      'mod+h': { mac: 'Hides window' },
      'mod+r': { mac: 'Reloads page', windows: 'Reloads page' },
      'mod+shift+r': { mac: 'Hard reloads page', windows: 'Hard reloads page' },
      'mod+l': { mac: 'Focuses address bar', windows: 'Focuses address bar' },
      'mod+d': { mac: 'Bookmarks page', windows: 'Bookmarks page' },
      'mod+shift+t': {
        mac: 'Reopens closed tab',
        windows: 'Reopens closed tab',
      },
      'mod+shift+w': { mac: 'Closes window', windows: 'Closes window' },
      'mod+tab': { mac: 'Switches tabs', windows: 'Switches apps' },
      'alt+f4': { windows: 'Closes window' },
      'ctrl+tab': { mac: 'Switches tabs', windows: 'Switches tabs' },
    };

  function getReservedShortcutWarning(
    combo: string,
    isMac: boolean
  ): string | null {
    const reserved = RESERVED_SHORTCUTS[combo];
    if (!reserved) return null;

    const description = isMac ? reserved.mac : reserved.windows;
    if (!description) return null;

    return description;
  }

  function showWarningModal(
    title: string,
    message: string,
    confirmMode: boolean = true
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (
        !dom.warningModal ||
        !dom.warningTitle ||
        !dom.warningMessage ||
        !dom.warningCancelBtn ||
        !dom.warningConfirmBtn
      ) {
        resolve(confirmMode ? confirm(message) : (alert(message), true));
        return;
      }

      dom.warningTitle.textContent = title;
      dom.warningMessage.innerHTML = message;
      dom.warningModal.classList.remove('hidden');
      dom.warningModal.classList.add('flex');

      if (confirmMode) {
        dom.warningCancelBtn.style.display = '';
        dom.warningConfirmBtn.textContent = t('warning.proceed');
      } else {
        dom.warningCancelBtn.style.display = 'none';
        dom.warningConfirmBtn.textContent = t('alert.ok');
      }

      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        dom.warningModal?.classList.add('hidden');
        dom.warningModal?.classList.remove('flex');
        dom.warningConfirmBtn?.removeEventListener('click', handleConfirm);
        dom.warningCancelBtn?.removeEventListener('click', handleCancel);
      };

      dom.warningConfirmBtn.addEventListener('click', handleConfirm);
      dom.warningCancelBtn.addEventListener('click', handleCancel);

      // Close on backdrop click
      dom.warningModal.addEventListener(
        'click',
        (e) => {
          if (e.target === dom.warningModal) {
            if (confirmMode) {
              handleCancel();
            } else {
              handleConfirm();
            }
          }
        },
        { once: true }
      );
    });
  }

  function renderShortcutsList() {
    if (!dom.shortcutsList) return;
    dom.shortcutsList.innerHTML = '';

    const allShortcuts = ShortcutsManager.getAllShortcuts();
    const isMac = navigator.userAgent.toUpperCase().includes('MAC');
    const shortcutCategories = categories
      .map((category) => ({
        ...category,
        tools: category.tools.filter((tool) => !isToolDisabled(tool.id)),
      }))
      .filter((category) => category.tools.length > 0);
    const allTools = shortcutCategories.flatMap((c) => c.tools);

    shortcutCategories.forEach((category) => {
      const section = document.createElement('div');
      section.className = 'category-section mb-6 last:mb-0';

      const header = document.createElement('h3');
      header.className =
        'text-gray-400 text-xs font-bold uppercase tracking-wider mb-3 pl-1';
      const categoryKey = categoryTranslationKeys[category.name];
      header.textContent = categoryKey ? t(categoryKey) : category.name;
      section.appendChild(header);

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'space-y-2';
      section.appendChild(itemsContainer);

      let hasTools = false;

      category.tools.forEach((tool) => {
        hasTools = true;
        const toolId = getToolId(tool);
        const currentShortcut = allShortcuts.get(toolId) || '';

        const item = document.createElement('div');
        item.className =
          'shortcut-item flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors';

        const left = document.createElement('div');
        left.className = 'flex items-center gap-3';

        const icon = createToolIcon(tool, 'shift-tool-icon-sm');

        const name = document.createElement('span');
        name.className = 'text-gray-200 font-medium';
        const toolKey = toolTranslationKeys[tool.name];
        name.textContent = toolKey ? t(`${toolKey}.name`) : tool.name;

        left.append(icon, name);

        const right = document.createElement('div');
        right.className = 'relative';

        const input = document.createElement('input');
        input.type = 'text';
        input.className =
          'shortcut-input w-32 bg-gray-800 border border-gray-600 text-white text-center text-sm rounded px-2 py-1 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all';
        input.placeholder = t('settings.clickToSet');
        input.value = formatShortcutDisplay(currentShortcut, isMac);
        input.readOnly = true;

        const clearBtn = document.createElement('button');
        clearBtn.className =
          'absolute -right-2 -top-2 bg-gray-700 hover:bg-red-600 text-white rounded-full p-0.5 hidden group-hover:block shadow-sm';
        clearBtn.innerHTML = '<i data-lucide="x" class="w-3 h-3"></i>';
        if (currentShortcut) {
          right.classList.add('group');
        }

        clearBtn.onclick = (e) => {
          e.stopPropagation();
          ShortcutsManager.setShortcut(toolId, '');
          renderShortcutsList();
        };

        input.onkeydown = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (e.key === 'Backspace' || e.key === 'Delete') {
            ShortcutsManager.setShortcut(toolId, '');
            renderShortcutsList();
            return;
          }

          const keys: string[] = [];
          // On Mac: metaKey = Command, ctrlKey = Control
          // On Windows/Linux: metaKey is rare, ctrlKey = Ctrl
          if (isMac) {
            if (e.metaKey) keys.push('mod'); // Command on Mac
            if (e.ctrlKey) keys.push('ctrl'); // Control on Mac (separate from Command)
          } else {
            if (e.ctrlKey || e.metaKey) keys.push('mod'); // Ctrl on Windows/Linux
          }
          if (e.altKey) keys.push('alt');
          if (e.shiftKey) keys.push('shift');

          let key = e.key.toLowerCase();

          if (e.altKey && e.code) {
            if (e.code.startsWith('Key')) {
              key = e.code.slice(3).toLowerCase();
            } else if (e.code.startsWith('Digit')) {
              key = e.code.slice(5);
            }
          }

          const isModifier = ['control', 'shift', 'alt', 'meta'].includes(key);
          const isDeadKey = key === 'dead' || key.startsWith('dead');

          // Ignore dead keys (used for accented characters on Mac with Option key)
          if (isDeadKey) {
            input.value = formatShortcutDisplay(
              ShortcutsManager.getShortcut(toolId) || '',
              isMac
            );
            return;
          }

          if (!isModifier) {
            keys.push(key);
          }

          const combo = keys.join('+');

          input.value = formatShortcutDisplay(combo, isMac);

          if (!isModifier) {
            const existingToolId = ShortcutsManager.findToolByShortcut(combo);

            if (existingToolId && existingToolId !== toolId) {
              const existingTool = allTools.find(
                (t) => getToolId(t) === existingToolId
              );
              const existingToolName = existingTool?.name || existingToolId;
              const displayCombo = formatShortcutDisplay(combo, isMac);

              const existingToolKey = existingTool
                ? toolTranslationKeys[existingTool.name]
                : null;
              const translatedToolName = existingToolKey
                ? t(`${existingToolKey}.name`)
                : existingToolName;

              await showWarningModal(
                t('settings.warnings.alreadyInUse'),
                `<strong>${escapeHtml(displayCombo)}</strong> ${t('settings.warnings.assignedTo')}<br><br>` +
                  `<em>"${escapeHtml(translatedToolName)}"</em><br><br>` +
                  t('settings.warnings.chooseDifferent'),
                false
              );

              input.value = formatShortcutDisplay(
                ShortcutsManager.getShortcut(toolId) || '',
                isMac
              );
              input.classList.remove('border-indigo-500', 'text-indigo-400');
              input.blur();
              return;
            }

            const reservedWarning = getReservedShortcutWarning(combo, isMac);
            if (reservedWarning) {
              const displayCombo = formatShortcutDisplay(combo, isMac);
              const shouldProceed = await showWarningModal(
                t('settings.warnings.reserved'),
                `<strong>${escapeHtml(displayCombo)}</strong> ${t('settings.warnings.commonlyUsed')}<br><br>` +
                  `"<em>${escapeHtml(reservedWarning)}</em>"<br><br>` +
                  `${t('settings.warnings.unreliable')}<br><br>` +
                  t('settings.warnings.useAnyway')
              );

              if (!shouldProceed) {
                // Revert display
                input.value = formatShortcutDisplay(
                  ShortcutsManager.getShortcut(toolId) || '',
                  isMac
                );
                input.classList.remove('border-indigo-500', 'text-indigo-400');
                input.blur();
                return;
              }
            }

            ShortcutsManager.setShortcut(toolId, combo);
            // Re-render to update all inputs (show conflicts in real-time)
            renderShortcutsList();
          }
        };

        input.onkeyup = (e) => {
          // If the user releases a modifier without pressing a main key, revert to saved
          const key = e.key.toLowerCase();
          if (['control', 'shift', 'alt', 'meta'].includes(key)) {
            const currentSaved = ShortcutsManager.getShortcut(toolId);
          }
        };

        input.onfocus = () => {
          input.value = t('settings.pressKeys');
          input.classList.add('border-indigo-500', 'text-indigo-400');
        };

        input.onblur = () => {
          input.value = formatShortcutDisplay(
            ShortcutsManager.getShortcut(toolId) || '',
            isMac
          );
          input.classList.remove('border-indigo-500', 'text-indigo-400');
        };

        right.append(input);
        if (currentShortcut) right.append(clearBtn);

        item.append(left, right);
        itemsContainer.appendChild(item);
      });

      if (hasTools) {
        dom.shortcutsList.appendChild(section);
      }
    });

    createIcons({ icons });
  }

  const scrollToTopBtn = document.getElementById('scroll-to-top-btn');

  if (scrollToTopBtn) {
    // In the Shift shell the main panel scrolls itself, so the document never
    // moves and window scroll position would always read 0.
    const scroller = getShellScroller();
    const scrollTarget: EventTarget =
      scroller === document.documentElement ? window : scroller;
    let lastScrollY = scroller.scrollTop;

    scrollTarget.addEventListener('scroll', () => {
      const currentScrollY = scroller.scrollTop;

      if (currentScrollY < lastScrollY && currentScrollY > 300) {
        scrollToTopBtn.classList.add('visible');
      } else {
        scrollToTopBtn.classList.remove('visible');
      }

      lastScrollY = currentScrollY;
    });

    scrollToTopBtn.addEventListener('click', () => {
      scroller.scrollTo({
        top: 0,
        behavior: 'instant',
      });
    });
  }

  // Rewrite links after all dynamic content is fully loaded
  rewriteLinks();
};

window.addEventListener('load', init);
