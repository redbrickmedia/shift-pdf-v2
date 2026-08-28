/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TESSERACT_WORKER_URL?: string;
  readonly VITE_TESSERACT_CORE_URL?: string;
  readonly VITE_TESSERACT_LANG_URL?: string;
  readonly VITE_TESSERACT_AVAILABLE_LANGUAGES?: string;
  readonly VITE_OCR_FONT_BASE_URL?: string;
  readonly VITE_PROMISE_BANNER_UNTIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __SIMPLE_MODE__: boolean;
declare const __DISABLED_TOOLS__: string[];
declare const __BRAND_NAME__: string;
declare const __APP_VERSION__: string;
