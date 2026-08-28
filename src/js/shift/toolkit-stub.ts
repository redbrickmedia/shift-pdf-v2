export function configureToolkit(_config: {
  buildMode: string;
  name: string;
  version: string;
}): void {}

export function getToolkitConfig() {
  return {
    isOutsideShiftBrowser: true,
    webUiProxyService: {
      init() {},
      isConnected: false,
      hasError: false,
      observeStoreValue(
        _path: string,
        _property: string,
        _handler: (value: unknown) => void
      ) {},
    },
  };
}

export function trackEvent(
  _eventName: string,
  _properties: Record<string, unknown>
): void {}
