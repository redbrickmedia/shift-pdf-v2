function pathSegments(path: string): string[] {
  return path.split(/[./]/).filter(Boolean);
}

function resolvePath(path: string): Record<string, unknown> | undefined {
  if (!path) return undefined;

  let current: unknown = globalThis;
  for (const segment of pathSegments(path)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  if (current == null || typeof current !== 'object') return undefined;
  return current as Record<string, unknown>;
}

export class ChromeShiftProxy {
  constructor(private readonly path: string) {}

  hasMethod(method: string): boolean {
    const target = resolvePath(this.path);
    return typeof target?.[method] === 'function';
  }

  getValue(method: string, ...args: unknown[]): unknown {
    return this.invoke(method, args);
  }

  setValue(method: string, ...args: unknown[]): unknown {
    return this.invoke(method, args);
  }

  private invoke(method: string, args: unknown[]): unknown {
    if (!this.path) return undefined;

    try {
      const target = resolvePath(this.path);
      const fn = target?.[method];
      if (typeof fn !== 'function') return undefined;
      return fn.apply(target, args);
    } catch {
      return undefined;
    }
  }
}
