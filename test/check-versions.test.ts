/**
 * Guard for `scripts/check-versions.mjs`, `scripts/sync-versions.mjs` and the
 * release plugin `scripts/release-sync-versions.mjs`.
 *
 * The bug they exist for: every version a reader copies out of the docs was
 * stale, and nothing kept any of them current. `hawkeyexl/manni@v0` sat in 16
 * snippets while npm served 2.0.0, `rev:` named tags from another package's
 * history, and the third-party pins lagged the repo's own workflows by three
 * majors. Each was typed by hand, and a hand-typed version is wrong from the
 * next release on.
 *
 * Driven as subprocesses over a copy of `test/fixtures/versions/`: the exit
 * code and the `file:line` lines are the contract, since the check runs as a
 * CI step and the sync is what its message tells a person to run. The plugin
 * is imported, because semantic-release imports it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const checkScript = join(repoRoot, "scripts", "check-versions.mjs");
const syncScript = join(repoRoot, "scripts", "sync-versions.mjs");
const pluginPath = join(repoRoot, "scripts", "release-sync-versions.mjs");
const fixtures = join(repoRoot, "test", "fixtures", "versions");

const FIX = "run npm run docs:sync-versions";
const GUIDE = "docs/src/content/docs/guide.mdx";

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(script: string, root: string): Run {
  const r = spawnSync("node", [script, root], { encoding: "utf8", cwd: repoRoot });
  // A null status means the process never exited on its own (a signal, or it
  // could not be spawned). Say so, rather than let an assertion compare null
  // with an exit code.
  if (r.status === null) {
    const why = r.error?.message ?? `killed by ${r.signal ?? "an unknown signal"}`;
    throw new Error(`node ${script} did not exit: ${why}`);
  }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const lines = (s: string): string[] => s.split(/\r?\n/).filter((l) => l !== "");

let root: string;
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/** The fixture's original bytes, before any command touched the copy. */
const originals = new Map<string, string>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "manni-versions-"));
  cpSync(fixtures, root, { recursive: true });
  // `.gitattributes` stores every text file as LF, so a committed CRLF fixture
  // would arrive as LF. The CRLF case is made here instead.
  const crlf = join(root, "examples", "crlf.yml");
  writeFileSync(crlf, readFileSync(crlf, "utf8").replace(/\r?\n/g, "\r\n"));
  originals.clear();
  for (const rel of [
    "README.md",
    GUIDE,
    "examples/crlf.yml",
    "CHANGELOG.md",
    "docs/proposals/0001-a-record.md",
  ]) {
    originals.set(rel, read(rel));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Rewrites the temp copy's package.json with `engines.node` set to `range`. */
const setEnginesNode = (range: string): void => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "versions-fixture", version: "2.0.1", engines: { node: range } }),
  );
};

/** Rewrites the temp copy's package.json with `version` set to `version`. */
const setVersion = (version: string): void => {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "versions-fixture", version, engines: { node: ">=24" } }),
  );
};

const original = (rel: string): string => {
  const text = originals.get(rel);
  if (text === undefined) throw new Error(`no original for ${rel}`);
  return text;
};

describe("docs:check-versions", () => {
  it("reports every stale pin by file and line, and exits 1", () => {
    const { stderr, stdout, status } = run(checkScript, root);
    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(lines(stderr)).toEqual([
      `README.md:3: hawkeyexl/manni@v0 — package.json major is 2; ${FIX}`,
      `README.md:4: hawkeyexl/manni@v1.0.0 — package.json is 2.0.1; ${FIX}`,
      `README.md:5: @hawkeyexl/manni@0 — package.json major is 2; ${FIX}`,
      `README.md:6: @hawkeyexl/manni@1.2.3 — package.json is 2.0.1; ${FIX}`,
      `README.md:12: rev: v0.1.0 — package.json is 2.0.1; ${FIX}`,
      `${GUIDE}:8: actions/checkout@v4 — .github/workflows use v7; ${FIX}`,
      `${GUIDE}:9: actions/setup-node@v4 — .github/workflows use v6; ${FIX}`,
      `${GUIDE}:11: node-version: '22' — package.json engines.node is >=24; ${FIX}`,
      `${GUIDE}:19: rev: v2 — package.json is 2.0.1; ${FIX}`,
      `examples/crlf.yml:9: node-version: 20 — package.json engines.node is >=24; ${FIX}`,
      `examples/crlf.yml:10: @hawkeyexl/manni@1 — package.json major is 2; ${FIX}`,
      `examples/crlf.yml:13: rev: v1.0.0 — package.json is 2.0.1; ${FIX}`,
      "versions: 15 pins checked, 12 stale",
    ]);
  });

  it("writes nothing", () => {
    run(checkScript, root);
    for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
  });

  // `.releaserc.json` makes `feat/**` a prerelease channel, so the first
  // release from such a branch commits `2.9.0-cite-marker-ids.1` into
  // package.json. The sync refuses to write a prerelease into the docs, which
  // left this check demanding a rewrite that nothing would ever make: every
  // feat branch went permanently red through no fault of its author.
  it("skips the comparison when package.json is a prerelease, and writes nothing", () => {
    setVersion("2.9.0-cite-marker-ids.1");
    const { stdout, stderr, status } = run(checkScript, root);
    expect(status).toBe(0);
    expect(stderr).toBe("");
    expect(lines(stdout)).toEqual([
      "versions: skipped, package.json is the prerelease 2.9.0-cite-marker-ids.1; the release syncs pins to stable versions only",
    ]);
    for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
  });

  it("still reports stale pins once the version is stable again", () => {
    setVersion("2.0.1");
    const { stderr, status } = run(checkScript, root);
    expect(status).toBe(1);
    expect(lines(stderr)).toContain("versions: 15 pins checked, 12 stale");
  });

  it("uses the highest major any workflow uses for an action", () => {
    // lagging.yml is still on checkout@v4. If the lowest major won, the docs'
    // checkout@v4 would pass and the check would pull them back from v7.
    const { stderr } = run(checkScript, root);
    expect(stderr).toContain(`${GUIDE}:8: actions/checkout@v4 — .github/workflows use v7`);
  });

  it("leaves alone @latest, an unpinned package, another repo's rev, and an action no workflow uses", () => {
    const { stderr } = run(checkScript, root);
    expect(stderr).not.toContain("@latest");
    expect(stderr).not.toContain("README.md:7:");
    expect(stderr).not.toContain("README.md:16:");
    expect(stderr).not.toContain("upload-sarif");
    // A comment in a workflow is not a pin: checkout@v9 there must not raise the bar.
    expect(stderr).not.toContain("use v9");
  });

  it("never reads the proposals or the changelog", () => {
    const { stderr } = run(checkScript, root);
    expect(stderr).not.toContain("CHANGELOG.md");
    expect(stderr).not.toContain("docs/proposals");
  });

  it("exits 2 when package.json has no engines.node", () => {
    const pkg = join(root, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "versions-fixture", version: "2.0.1" }));
    const { stderr, status } = run(checkScript, root);
    expect(status).toBe(2);
    expect(lines(stderr)).toEqual([
      "versions: package.json has no engines.node to check node-version against",
    ]);
  });

  // `>=20.9.0 || >=22` once read as 20: the first digit run won, and every
  // node-version pin was judged against a major the range does not require.
  it.each([">=20.9.0 || >=22", ">=20 <25", "20 - 24", "*", "24.x", "<=24"])(
    "exits 2 on engines.node %j, which is not a single lower bound, and writes nothing",
    (range) => {
      setEnginesNode(range);
      const { stderr, status } = run(checkScript, root);
      expect(status).toBe(2);
      expect(lines(stderr)).toEqual([
        `versions: package.json engines.node "${range}" is not a single lower bound; node-version pins cannot be checked against it`,
      ]);
      for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
    },
  );

  it.each([">=24.1.0", "^24", "24", "~24.2", " >=24 "])(
    "takes engines.node %j as major 24",
    (range) => {
      setEnginesNode(range);
      const { stdout, status } = run(syncScript, root);
      expect(status).toBe(0);
      expect(lines(stdout)).toContain(`${GUIDE}:11: node-version: '22' -> node-version: '24'`);
      expect(lines(stdout)).toContain("examples/crlf.yml:9: node-version: 20 -> node-version: 24");
    },
  );
});

describe("docs:sync-versions", () => {
  it("reports one line per edit and a summary, and exits 0", () => {
    const { stdout, status } = run(syncScript, root);
    expect(status).toBe(0);
    expect(lines(stdout)).toEqual([
      "README.md:3: hawkeyexl/manni@v0 -> hawkeyexl/manni@v2",
      "README.md:4: hawkeyexl/manni@v1.0.0 -> hawkeyexl/manni@v2.0.1",
      "README.md:5: @hawkeyexl/manni@0 -> @hawkeyexl/manni@2",
      "README.md:6: @hawkeyexl/manni@1.2.3 -> @hawkeyexl/manni@2.0.1",
      "README.md:12: rev: v0.1.0 -> rev: v2.0.1",
      `${GUIDE}:8: actions/checkout@v4 -> actions/checkout@v7`,
      `${GUIDE}:9: actions/setup-node@v4 -> actions/setup-node@v6`,
      `${GUIDE}:11: node-version: '22' -> node-version: '24'`,
      `${GUIDE}:19: rev: v2 -> rev: v2.0.1`,
      "examples/crlf.yml:9: node-version: 20 -> node-version: 24",
      "examples/crlf.yml:10: @hawkeyexl/manni@1 -> @hawkeyexl/manni@2",
      "examples/crlf.yml:13: rev: v1.0.0 -> rev: v2.0.1",
      "versions: 12 pins updated in 3 files",
    ]);
  });

  it("changes only the version text, keeping comments, quotes and CRLF", () => {
    run(syncScript, root);
    // Each expected file is the original with exactly these substrings
    // swapped. Anything else that moved fails the byte comparison.
    const swap = (rel: string, pairs: [string, string][]): string =>
      pairs.reduce((text, [from, to]) => {
        expect(text, `${rel} should contain ${from}`).toContain(from);
        return text.replace(from, to);
      }, original(rel));

    expect(read("README.md")).toBe(
      swap("README.md", [
        ["manni@v0`", "manni@v2`"],
        ["manni@v1.0.0`", "manni@v2.0.1`"],
        ["manni@0 meta", "manni@2 meta"],
        ["manni@1.2.3`", "manni@2.0.1`"],
        ["rev: v0.1.0 # the hook definition", "rev: v2.0.1 # the hook definition"],
      ]),
    );
    expect(read(GUIDE)).toBe(
      swap(GUIDE, [
        ["checkout@v4 # a trailing comment stays", "checkout@v7 # a trailing comment stays"],
        ["setup-node@v4", "setup-node@v6"],
        ["node-version: '22'", "node-version: '24'"],
        ["rev: v2\n", "rev: v2.0.1\n"],
      ]),
    );

    const crlf = read("examples/crlf.yml");
    expect(crlf).toBe(
      swap("examples/crlf.yml", [
        ["node-version: 20\r\n", "node-version: 24\r\n"],
        ["manni@1 meta", "manni@2 meta"],
        // A rev in a CRLF file: its `repo:` line ends in a CR that must not
        // stop the item from being recognised as hawkeyexl/manni.
        ["rev: v1.0.0\r\n", "rev: v2.0.1\r\n"],
      ]),
    );
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");

    expect(read("CHANGELOG.md")).toBe(original("CHANGELOG.md"));
    expect(read("docs/proposals/0001-a-record.md")).toBe(original("docs/proposals/0001-a-record.md"));
  });

  it("leaves the check passing, and has nothing left to do on a second run", () => {
    run(syncScript, root);

    const check = run(checkScript, root);
    expect(check.status).toBe(0);
    expect(check.stderr).toBe("");
    expect(lines(check.stdout)).toEqual(["versions: 15 pins checked, all current"]);

    const again = run(syncScript, root);
    expect(again.status).toBe(0);
    expect(lines(again.stdout)).toEqual(["versions: all pins current"]);
  });

  it("exits 2 when package.json has no engines.node, and writes nothing", () => {
    const pkg = join(root, "package.json");
    writeFileSync(pkg, JSON.stringify({ name: "versions-fixture", version: "2.0.1" }));
    const { stderr, status } = run(syncScript, root);
    expect(status).toBe(2);
    expect(lines(stderr)).toEqual([
      "versions: package.json has no engines.node to check node-version against",
    ]);
    for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
  });
});

describe("the release plugin", () => {
  interface Plugin {
    prepare: (pluginConfig: object, context: object) => Promise<void>;
  }
  const load = async (): Promise<Plugin> =>
    (await import(pathToFileURL(pluginPath).href)) as Plugin;

  const context = (version: string, channel: string | null) => {
    const logged: string[] = [];
    return {
      logged,
      value: {
        cwd: root,
        nextRelease: { version, channel },
        logger: { log: (msg: string) => logged.push(msg) },
      },
    };
  };

  it("exports prepare and nothing else semantic-release would call", async () => {
    const plugin = await load();
    expect(Object.keys(plugin).sort()).toEqual(["prepare"]);
  });

  it("skips a prerelease, so a channel build never rewrites stable docs", async () => {
    const { prepare } = await load();
    const ctx = context("2.1.0-next.1", "next");
    await prepare({}, ctx.value);
    expect(ctx.logged).toEqual(["Skipped version sync for prerelease 2.1.0-next.1"]);
    for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
  });

  it("syncs a stable release to the release's own version", async () => {
    const { prepare } = await load();
    // 3.0.0, not package.json's 2.0.1: the plugin follows nextRelease.version.
    // Thirteen rather than the sync's twelve, because the guide's
    // hawkeyexl/manni@v2 is current for 2.0.1 and stale for 3.0.0.
    const ctx = context("3.0.0", null);
    await prepare({}, ctx.value);
    expect(ctx.logged).toEqual(["Synced 13 version pins in 3 files for 3.0.0"]);
    expect(read(GUIDE)).toContain("uses: hawkeyexl/manni@v3\n");
    expect(read("README.md")).toContain("`uses: hawkeyexl/manni@v3`");
    expect(read("README.md")).toContain("rev: v3.0.0 # the hook definition");
    expect(read(GUIDE)).toContain("actions/checkout@v7");
  });

  it("fails the release step with one clear line when the sources are missing", async () => {
    const { prepare } = await load();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "versions-fixture", version: "2.0.1" }),
    );
    const ctx = context("3.0.0", null);
    const failure: unknown = await prepare({}, ctx.value).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(Error);
    const { message, constructor } = failure as Error;
    expect(constructor).toBe(Error);
    expect(message).toBe(
      "Version sync could not run: package.json has no engines.node to check node-version against",
    );
    expect(message).not.toContain("\n");
    for (const [rel, text] of originals) expect(read(rel), rel).toBe(text);
  });
});
