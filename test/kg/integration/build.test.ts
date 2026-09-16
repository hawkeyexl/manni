import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DataFactory, Parser, Store } from "n3";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

import { hermeticEnv } from "../helpers/git-env.js";
import { detachedCorpus } from "../helpers/corpus.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
// A copy outside any repository: git is detected now (proposal 0051 §6), and a
// corpus built inside this checkout would carry HEAD's committer date. See
// test/kg/helpers/corpus.ts.
const corpus = detachedCorpus();
const golden = join(root, "test", "kg", "fixtures", "golden", "graph.ttl");

/**
 * What git detection owes a corpus that is not a repository: the consequence,
 * then git's own reason for it. The reason names a temp directory, so the
 * assertions match the consequence and the shape of the reason rather than a
 * fixed string.
 */
const GIT_ABSENT =
  /^manni: the graph has no revision history or commit agents: .+\n$/;
/** The same consequence, for stderr that carries other warnings too. */
const GIT_ABSENT_LINE =
  "manni: the graph has no revision history or commit agents:";

function build(outPath: string): string {
  return execFileSync(process.execPath, [cli, "kg", "build", "--out", outPath], {
    encoding: "utf8",
    cwd: corpus,
  });
}

/** The tool version is stamped into the graph; normalize it so release
 *  version bumps don't invalidate the golden. */
function normalizeVersion(ttl: string): string {
  return ttl.replace(/kg:version "[^"]+"/g, 'kg:version "X"');
}

/**
 * One identity in the output (proposal 0051 §7).
 *
 * An IRI is the part of a graph a consumer stores and links to, so the old
 * `dockg` host must not survive anywhere in what `build` writes — not in the
 * namespace, not in the prefix, not in the tool agent's IRI. A grep is the
 * right shape for this: it catches a spelling nothing else asserts on, in a
 * place a golden diff would show but nobody would necessarily read.
 */
describe("the emitted graph carries manni's identity, not dockg's", () => {
  it("names no dockg spelling anywhere, and does name the manni namespace", () => {
    const out = join(
      mkdtempSync(join(tmpdir(), "manni-kg-identity-")),
      "graph.ttl",
    );
    build(out);
    const ttl = readFileSync(out, "utf8");
    expect(ttl).not.toMatch(/dockg/i);
    expect(ttl).toContain(
      "@prefix kg: <https://hawkeyexl.github.io/manni/kg/ns#> .",
    );
  });

  it.each([
    "graph.ttl",
    "graph.jsonld",
    "metadata.rdf",
    "localizations.json",
    "traverse.json",
    "search.und.json",
    "search.de.json",
    "search.de-AT.json",
    "search.fr.json",
    // The sidecars carry a JSON header of ids and a model name, so a stale
    // IRI can hide in a binary too.
    "vectors.und.bin",
    "vectors.de.bin",
    "vectors.de-AT.bin",
    "vectors.fr.bin",
  ])("holds no dockg spelling in the %s golden", (name) => {
    const bytes = readFileSync(
      join(root, "test", "kg", "fixtures", "golden", name),
    );
    expect(bytes.toString("latin1")).not.toMatch(/dockg/i);
  });
});

describe("manni kg build (integration)", () => {
  it("matches the golden output byte-for-byte (modulo tool version)", () => {
    const out = join(mkdtempSync(join(tmpdir(), "manni-kg-build-")), "graph.ttl");
    build(out);
    expect(normalizeVersion(readFileSync(out, "utf8"))).toBe(
      normalizeVersion(readFileSync(golden, "utf8")),
    );
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-build-"));
    const a = join(dir, "a.ttl");
    const b = join(dir, "b.ttl");
    build(a);
    build(b);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("round-trips through the n3 Turtle parser (escaping/syntax gate)", () => {
    const quads = new Parser({ format: "text/turtle" }).parse(
      readFileSync(golden, "utf8"),
    );
    // must equal the triple count `build` reports for the corpus
    // (172 + 48 for the localized tree added in ADR 01037: three documents
    // with their sections, two translation edges and their inverses, and the
    // broken translation target on docs/de/regional.md)
    expect(quads.length).toBe(220);
  });

  it("stamps every document with the sha256 of its file (ADR 01036)", () => {
    // Verified against a digest computed here, from the bytes on disk, so the
    // assertion does not simply restate what the emitter did. Reading the graph
    // with a parser rather than a grep: the point is that the hash attached to
    // *this* document is the hash of *that* file, and only the subject links
    // them.
    const store = new Store(
      new Parser({ format: "text/turtle" }).parse(
        readFileSync(golden, "utf8"),
      ),
    );
    const pathOf = new Map<string, string>();
    for (const q of store.getQuads(
      null,
      DataFactory.namedNode(`${NS.kg}path`),
      null,
      null,
    )) {
      pathOf.set(q.subject.value, q.object.value);
    }

    const docs = store.getQuads(
      null,
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(`${NS.kg}Document`),
      null,
    );
    expect(docs.length).toBe(8);

    for (const { subject } of docs) {
      const hashes = store.getQuads(
        subject,
        DataFactory.namedNode(`${NS.kg}contentHash`),
        null,
        null,
      );
      const path = pathOf.get(subject.value) ?? "";
      expect(path, `${subject.value} has no kg:path`).not.toBe("");
      // Exactly one: the shape says maxCount 1, and a second would make the
      // join key ambiguous for a consumer.
      expect(hashes.length, `${path} carries ${hashes.length} hashes`).toBe(1);
      expect(hashes[0]?.object.value).toBe(
        createHash("sha256")
          .update(readFileSync(join(corpus, path)))
          .digest("hex"),
      );
    }
  });

  it("reports docs and triples on stdout", () => {
    const out = join(mkdtempSync(join(tmpdir(), "manni-kg-build-")), "graph.ttl");
    const stdout = build(out);
    expect(stdout).toMatch(/8 docs, \d+ triples/);
  });

  it("an ambient GIT_DIR cannot redirect the build", () => {
    // Running the suite from the husky pre-push hook exposed this: git exports
    // GIT_DIR to hook subprocesses, and kg inherited it, so a build outside a
    // repo silently succeeded against the *hook's* repo and emitted a
    // different graph. Git is detected rather than switched now (0051 §6), so
    // the tell is no longer exit 2: it is that the build degrades, says so,
    // and carries none of the decoy's history.
    //
    // GIT_DIR points at a throwaway decoy rather than this repository: a
    // regression here must not be able to touch real history. The decoy needs
    // a commit, or the build would fail for want of history and the test would
    // pass even while broken.
    const env = hermeticEnv();
    const decoy = mkdtempSync(join(tmpdir(), "manni-kg-decoy-"));
    writeFileSync(join(decoy, "seed.md"), "# Seed\n");
    execFileSync("git", ["init", "-q"], { cwd: decoy, env });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
      { cwd: decoy, env },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "seed",
      ],
      { cwd: decoy, env },
    );

    const dir = mkdtempSync(join(tmpdir(), "manni-kg-gitenv-"));
    writeFileSync(join(dir, "a.md"), "# A\n");

    const out = join(dir, "g.ttl");
    const r = spawnSync(
      process.execPath,
      [cli, "kg", "build", "a.md", "--out", out],
      {
        encoding: "utf8",
        cwd: dir,
        env: { ...env, GIT_DIR: join(decoy, ".git") },
      },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(GIT_ABSENT);
    expect(readFileSync(out, "utf8")).not.toMatch(/prov:endedAtTime/);
  });

  it("degrades outside a git repo, derives inside one, and stays byte-stable", () => {
    // kg ADR 01010's degradation, with the tri-state gone (0051 §6): one
    // command, one directory, and the only difference is whether git can run
    // over a repository.
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-gittime-"));
    writeFileSync(join(dir, "a.md"), "# A\n");

    const before = spawnSync(
      process.execPath,
      [cli, "kg", "build", "a.md", "--out", join(dir, "g.ttl")],
      { encoding: "utf8", cwd: dir, env: hermeticEnv() },
    );
    expect(before.status).toBe(0);
    expect(before.stdout).toContain("Wrote");
    expect(before.stderr).toMatch(GIT_ABSENT);
    expect(readFileSync(join(dir, "g.ttl"), "utf8")).not.toMatch(
      /prov:endedAtTime/,
    );

    // with a commit: endedAtTime appears and rebuilds are identical
    // hermeticEnv: without it these inherit GIT_DIR when the suite runs from
    // the pre-push hook, and operate on the manni repo instead of `dir`.
    const env = hermeticEnv();
    execFileSync("git", ["init", "-q"], { cwd: dir, env });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
      { cwd: dir, env },
    );
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "-m",
        "init",
      ],
      { cwd: dir, env },
    );
    const first = spawnSync(
      process.execPath,
      [cli, "kg", "build", "a.md", "--out", join(dir, "a.ttl")],
      { encoding: "utf8", cwd: dir, env },
    );
    expect(first.status).toBe(0);
    // Inside a repository there is nothing to warn about.
    expect(first.stderr).toBe("");
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "a.md", "--out", join(dir, "b.ttl")],
      { encoding: "utf8", cwd: dir, env },
    );
    const a = readFileSync(join(dir, "a.ttl"), "utf8");
    expect(a).toBe(readFileSync(join(dir, "b.ttl"), "utf8"));
    expect(a).toMatch(/prov:endedAtTime "[^"]+"\^\^xsd:dateTime/);
  });

  it("skips git entirely, and silently, when provenance is not derived", () => {
    // The switch is gone, and this is what is left of "skip the subprocess": a
    // corpus that derives no provenance asks git nothing, so there is nothing
    // to warn about.
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-gitoff-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n  build:\n    derive: [frontmatter, sections, links, tags, images, code]\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n");

    const r = spawnSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "g.ttl")],
      { encoding: "utf8", cwd: dir, env: hermeticEnv() },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("warns on page keys that look like harvest inputs, and still exits 0", () => {
    // The reproducer from the scope review that produced ADR 01028: a page
    // whose author declared four facts, none of which reached the graph. It
    // passed `manni kg validate` clean, because every one of those keys is a legal
    // page-level key — just not one dockg reads.
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-harvest-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n  baseIri: https://example.com/kg/\n',
    );
    writeFileSync(
      join(dir, "a.md"),
      "---\ntitle: T\ntype: how to\napplies_to: [SP-X100]\nconcept: [alpha]\nsupersede: ./other.md\n---\n\n# T\n",
    );

    const out = join(dir, "g.ttl");
    const r = spawnSync(process.execPath, [cli, "kg", "build", "--out", out], {
      encoding: "utf8",
      cwd: dir,
      env: hermeticEnv(),
    });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Wrote");
    for (const [key, meant] of [
      ["applies_to", "applies-to"],
      ["concept", "concepts"],
      ["supersede", "supersedes"],
    ] as const) {
      expect(r.stderr).toContain(`page key "${key}"`);
      expect(r.stderr).toContain(`looks like "${meant}"`);
    }
    expect(r.stderr).toContain('page type "how to"');
    // Beside them, the one line a non-repository corpus owes (0051 §6).
    expect(r.stderr).toContain(GIT_ABSENT_LINE);

    // A warning never gates and never changes the graph: the facts are still
    // absent, which is correct — dockg must not guess what the author meant.
    const ttl = readFileSync(out, "utf8");
    expect(ttl).not.toContain("iirds:relates-to-product-variant");
    expect(ttl).not.toContain("iirds:has-topic-type");
  });

  it("says nothing about a corpus that spells every harvest key correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-harvest-ok-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: c\n    paths: ["*.md"]\nkg:\n  baseIri: https://example.com/kg/\n',
    );
    writeFileSync(
      join(dir, "a.md"),
      "---\ntitle: T\ntype: how-to\napplies-to: [SP-X100]\nconcepts: [alpha]\n---\n\n# T\n",
    );

    const r = spawnSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "g.ttl")],
      { encoding: "utf8", cwd: dir, env: hermeticEnv() },
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(GIT_ABSENT);
  });

  it("exits 2 when no inputs match", () => {
    const empty = mkdtempSync(join(tmpdir(), "manni-kg-empty-"));
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, "kg", "build"], {
        encoding: "utf8",
        cwd: empty,
      });
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
