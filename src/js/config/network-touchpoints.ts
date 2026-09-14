/**
 * Source of truth for features that contact an external processing service
 * (or otherwise send document / certificate data off-device) at use time.
 *
 * CDN / WASM / OCR language packs are NOT remote services — About already
 * states that advanced features may download processing modules. Those are
 * tracked only in NETWORK_CALL_INVENTORY as `remote-asset`.
 */

export type NetworkTouchpointId = 'timestamp-tsa' | 'digital-sign-chain-fetch';

export type NetworkTouchpoint = {
  id: NetworkTouchpointId;
  /** User-facing action / tool name */
  action: string;
  /** Tool catalog ids and related surfaces */
  toolIds: readonly string[];
  /** Remote provider / service description */
  provider: string;
  /** What leaves the device when the feature runs */
  dataLeavingDevice: string;
  purpose: string;
  /** Privacy / policy page when applicable */
  policyUrl?: string;
  /** Extra help / docs URL when applicable */
  helpUrl?: string;
  /**
   * Marker attribute value expected on static pre-use copy in tool HTML
   * (`data-network-touchpoint="<id>"`). Workflow-only surfaces may omit this
   * and rely solely on the runtime guard.
   */
  staticPagePaths?: readonly string[];
  /** Must match `requireNetworkDisclosure('<id>')` call sites */
  guardEntryPoints: readonly string[];
};

export const NETWORK_TOUCHPOINTS: Record<
  NetworkTouchpointId,
  NetworkTouchpoint
> = {
  'timestamp-tsa': {
    id: 'timestamp-tsa',
    action: 'Timestamp PDF',
    toolIds: ['timestamp-pdf', 'pdf-workflow'],
    provider: 'Selected RFC 3161 Time Stamp Authority (TSA)',
    dataLeavingDevice:
      'A cryptographic hash of the PDF (and related timestamp-query bytes). The full PDF is not uploaded as a file, but the hash is derived from your document.',
    purpose:
      'Obtain a trusted timestamp token proving the document existed at a point in time.',
    policyUrl: 'privacy.html',
    helpUrl: 'about.html',
    staticPagePaths: ['src/pages/timestamp-pdf.html'],
    guardEntryPoints: ['timestampPdf'],
  },
  'digital-sign-chain-fetch': {
    id: 'digital-sign-chain-fetch',
    action: 'Digital Sign PDF',
    toolIds: ['digital-sign-pdf', 'pdf-workflow'],
    provider:
      'Certificate issuer AIA / OCSP / CRL hosts (and optional CORS proxy when configured)',
    dataLeavingDevice:
      'Certificate chain and revocation check requests. Your private key stays in the browser. Issuer URLs come from the certificate you supply.',
    purpose:
      'Build or validate the certificate chain needed to create a verifiable digital signature.',
    policyUrl: 'privacy.html',
    helpUrl: 'about.html',
    staticPagePaths: ['src/pages/digital-sign-pdf.html'],
    guardEntryPoints: ['signPdf'],
  },
};

export const REMOTE_SERVICE_TOUCHPOINTS: readonly NetworkTouchpoint[] =
  Object.freeze(Object.values(NETWORK_TOUCHPOINTS));

export type NetworkInventoryKind =
  | 'remote-service'
  | 'remote-asset'
  | 'same-origin'
  | 'host-bridge'
  | 'ui-metadata'
  | 'external-nav';

/**
 * Audit inventory of network-related call sites / config. Every `remote-service`
 * row MUST point at a registered touchpoint. Other kinds document intentional
 * exclusions so the About “remote service” claim stays accurate.
 */
export type NetworkInventoryEntry = {
  id: string;
  kind: NetworkInventoryKind;
  description: string;
  /** Paths under the repo root used by inventory tests */
  sourcePaths: readonly string[];
  touchpointId?: NetworkTouchpointId;
};

export const NETWORK_CALL_INVENTORY: readonly NetworkInventoryEntry[] =
  Object.freeze([
    {
      id: 'timestamp-tsa',
      kind: 'remote-service',
      description:
        'RFC 3161 timestamp via TSA (tool page + workflow Timestamp node).',
      sourcePaths: [
        'src/js/logic/digital-sign-pdf.ts',
        'src/js/logic/timestamp-pdf-page.ts',
        'src/js/workflow/nodes/timestamp-node.ts',
        'src/js/config/timestamp-tsa.ts',
      ],
      touchpointId: 'timestamp-tsa',
    },
    {
      id: 'digital-sign-chain-fetch',
      kind: 'remote-service',
      description:
        'Digital signature may fetch issuer certificates / OCSP / CRL (optional CORS proxy).',
      sourcePaths: [
        'src/js/logic/digital-sign-pdf.ts',
        'src/js/logic/digital-sign-pdf-page.ts',
        'src/js/workflow/nodes/digital-sign-node.ts',
      ],
      touchpointId: 'digital-sign-chain-fetch',
    },
    {
      id: 'wasm-cdn-modules',
      kind: 'remote-asset',
      description:
        'PyMuPDF / Ghostscript / CoherentPDF WASM from CDN or env URLs — processing modules, not remote document services.',
      sourcePaths: [
        'src/js/utils/wasm-provider.ts',
        'src/js/utils/pymupdf-loader.ts',
        'src/js/utils/ghostscript-loader.ts',
      ],
    },
    {
      id: 'tesseract-ocr-assets',
      kind: 'remote-asset',
      description:
        'Tesseract worker / core / language data (CDN or VITE_TESSERACT_*).',
      sourcePaths: ['src/js/utils/tesseract-runtime.ts', 'src/js/utils/ocr.ts'],
    },
    {
      id: 'ocr-font-cdn',
      kind: 'remote-asset',
      description:
        'Optional OCR embedded fonts from CDN / VITE_OCR_FONT_BASE_URL.',
      sourcePaths: [
        'src/js/utils/font-loader.ts',
        'src/js/config/font-mappings.ts',
      ],
    },
    {
      id: 'disabled-tools-config',
      kind: 'same-origin',
      description: 'Fetches same-origin config.json for disabled tools.',
      sourcePaths: ['src/js/utils/disabled-tools.ts'],
    },
    {
      id: 'host-analytics',
      kind: 'host-bridge',
      description:
        'Optional host embed analytics via VITE_HOST_API_ROOT (tool metadata, not PDF bytes).',
      sourcePaths: ['src/js/host/analytics.ts', 'src/js/host/bridge.ts'],
    },
    {
      id: 'github-star-count',
      kind: 'ui-metadata',
      description: 'Public GitHub API star count for marketing UI only.',
      sourcePaths: ['src/js/main.ts'],
    },
  ]);

export function getNetworkTouchpoint(
  id: NetworkTouchpointId
): NetworkTouchpoint {
  return NETWORK_TOUCHPOINTS[id];
}

export function isNetworkTouchpointId(
  value: string
): value is NetworkTouchpointId {
  return Object.prototype.hasOwnProperty.call(NETWORK_TOUCHPOINTS, value);
}
