export function get(url: string) {
  return retry(() => fetch(url), { attempts: 3 });
}

// Declared here so the fixture type-checks; the cited line is line 2.
declare function retry<T>(fn: () => T, opts: { attempts: number }): T;
