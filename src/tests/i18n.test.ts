import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18next from 'i18next';
import { applyTranslations, getLanguageFromUrl } from '@/js/i18n/i18n';

describe('getLanguageFromUrl', () => {
  const originalLocation = window.location;
  const originalNavigator = window.navigator;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/' },
      writable: true,
      configurable: true,
    });

    localStorage.clear();

    // Reset navigator
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window.navigator, 'languages', {
      value: [],
      configurable: true,
    });

    // Reset import.meta.env
    vi.stubEnv('BASE_URL', '/');
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'en');
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.unstubAllEnvs();
  });

  it('should return language from URL path', () => {
    window.location.pathname = '/de/about';
    expect(getLanguageFromUrl()).toBe('de');
  });

  it('should prioritize URL path over localStorage', () => {
    window.location.pathname = '/fr/';
    localStorage.setItem('i18nextLng', 'es');
    expect(getLanguageFromUrl()).toBe('fr');
  });

  it('should return language from localStorage if URL has no language', () => {
    window.location.pathname = '/about';
    localStorage.setItem('i18nextLng', 'it');
    expect(getLanguageFromUrl()).toBe('it');
  });

  it('should return exact match from navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['zh-TW', 'en-US', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('zh-TW');
  });

  it('should return primary language match from navigator.languages', () => {
    window.location.pathname = '/';
    // 'de-AT' is not in supportedLanguages, but we should match its primary 'de'
    Object.defineProperty(window.navigator, 'languages', {
      value: ['de-AT', 'en-US', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('de');
  });

  it('should return first matched language from navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['fr-CA', 'de-DE', 'en'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('fr');
  });

  it('should ignore unsupported languages in navigator.languages', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['xx-XX', 'es-ES'],
      configurable: true,
    });
    expect(getLanguageFromUrl()).toBe('es');
  });

  it('should fallback to env variable if no earlier match', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: ['xx'],
      configurable: true,
    }); // unsupported
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', 'vi');
    expect(getLanguageFromUrl()).toBe('vi');
  });

  it('should fallback to en if everything else fails', () => {
    window.location.pathname = '/';
    Object.defineProperty(window.navigator, 'languages', {
      value: [],
      configurable: true,
    });
    vi.stubEnv('VITE_DEFAULT_LANGUAGE', '');
    expect(getLanguageFromUrl()).toBe('en');
  });

  it('should handle missing navigator object gracefully', () => {
    window.location.pathname = '/';
    Object.defineProperty(window, 'navigator', {
      value: undefined,
      writable: true,
    });
    expect(getLanguageFromUrl()).toBe('en');
  });
});

describe('applyTranslations', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          translation: {
            sample: 'Already here',
            other: 'Replacement',
          },
        },
      },
      interpolation: { escapeValue: false },
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  it('does not replace textContent when the node already shows the translation', () => {
    document.body.innerHTML = `<p data-i18n="sample">
      Already here
    </p>`;
    const element = document.querySelector('p');
    if (!element) throw new Error('missing sample node');
    const textNode = element.firstChild;
    document.documentElement.classList.add('shift-i18n-pending');

    applyTranslations();

    expect(element.firstChild).toBe(textNode);
    expect(element.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Already here'
    );
    expect(
      document.documentElement.classList.contains('shift-i18n-pending')
    ).toBe(false);
  });

  it('replaces textContent when the visible text differs', () => {
    document.body.innerHTML = `<p data-i18n="other">Old copy</p>`;
    const element = document.querySelector('p');
    if (!element) throw new Error('missing other node');
    const textNode = element.firstChild;

    applyTranslations();

    expect(element.firstChild).not.toBe(textNode);
    expect(element.textContent).toBe('Replacement');
  });
});
