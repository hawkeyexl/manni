/**
 * Registration in the parsed-manifest cache (a leak, and the sweep it must
 * not break).
 *
 * `invalidateManifestCache` reaches every cache in the process, so every cache
 * has to be registered somewhere module-level. Registering strongly would mean
 * every instance ever built is kept alive for the process — harmless while
 * exactly one exists, and a leak the moment a second one does, which a test
 * using `vi.resetModules()` or a second tool building its own cache makes
 * real. Registration is therefore weak, and the sweep clears the dead
 * references it passes.
 *
 * Forcing a collection needs `--expose-gc`, which the suite does not run with,
 * so the flag is set here and `gc` is pulled out of a fresh context.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ManifestCache,
  invalidateManifestCache,
  registeredManifestCaches,
} from "../src/meta/core/manifest-cache.js";

setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc") as () => void;

/** A full collection, with the queues drained around it. */
async function collectGarbage(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    collect();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Build a cache, use it, and report the count while it is still alive. The
 * instance never escapes this call, so nothing outside holds it afterwards.
 */
function transient(): number {
  const cache = new ManifestCache<string>();
  cache.drop("nothing-was-cached-here");
  return registeredManifestCaches();
}

let root: string;
let file: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "manni-cache-registration-"));
  file = join(root, "meta.yaml");
  writeFileSync(file, "docs/one.md:\n  owner: alpha\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("cache registration", () => {
  it("does not retain a second cache that went out of scope", async () => {
    const base = registeredManifestCaches();

    expect(transient()).toBe(base + 1);

    await collectGarbage();
    expect(registeredManifestCaches()).toBe(base);
  });

  it("still invalidates every cache that is alive", async () => {
    const first = new ManifestCache<string>();
    const second = new ManifestCache<string>();
    let parses = 0;
    const parse = (): Promise<string> => {
      parses += 1;
      return Promise.resolve(`parse ${String(parses)}`);
    };

    await first.parse(file, "v", parse);
    await second.parse(file, "v", parse);
    expect(parses).toBe(2);

    // Both are hits now.
    await first.parse(file, "v", parse);
    await second.parse(file, "v", parse);
    expect(parses).toBe(2);

    // One sweep has to reach both, including after it has cleared whatever
    // dead references the other test left behind.
    await collectGarbage();
    invalidateManifestCache(file);

    await first.parse(file, "v", parse);
    await second.parse(file, "v", parse);
    expect(parses).toBe(4);
  });
});
