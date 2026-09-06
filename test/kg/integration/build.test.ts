import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DataFactory, Parser, Store } from "n3";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";

const { namedNode } = DataFactory;
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const golden = join(root, "test", "kg", "fixtures", "golden", "graph.ttl");

function build(outPath: string): string {
  return execFileSync(process.execPath, [cli, "kg", "build", "--out", outPath], {
    encoding: "utf8",
    cwd: corpus,
  });
}

/** The tool version is stamped into the graph; normalize it so release
 *  version bumps don't invalidate the golden. */
function normalizeVersion(ttl: string): string {
  return ttl.replace(/dockg:version "[^"]+"/g, 'dockg:version "X"');
}

describe("manni kg build (integration)", () => {
  it("matches the golden output byte-for-byte (modulo tool version)", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    build(out);
    expect(normalizeVersion(readFileSync(out, "utf8"))).toBe(
      normalizeVersion(readFileSync(golden, "utf8")),
    );
  });

  it("is byte-identical across two runs (determinism gate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-build-"));
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
      namedNode(`${NS.dockg}path`),
      null,
      null,
    )) {
      pathOf.set(q.subject.value, q.object.value);
    }

    const docs = store.getQuads(
      null,
      namedNode(RDF_TYPE),
      namedNode(`${NS.dockg}Document`),
      null,
    );
    expect(docs.length).toBe(8);

    for (const { subject } of docs) {
      const hashes = store.getQuads(
        subject,
        namedNode(`${NS.dockg}contentHash`),
        null,
        null,
      );
      const path = pathOf.get(subject.value) ?? "";
      expect(path, `${subject.value} has no dockg:path`).not.toBe("");
      // Exactly one: the shape says maxCount 1, and a second would make the
      // join key ambiguous for a consumer.
      expect(hashes.length, `${path} carries ${hashes.length} hashes`).toBe(1);
      expect(hashes[0]!.object.value).toBe(
        createHash("sha256")
          .update(readFileSync(join(corpus, path)))
          .digest("hex"),
      );
    }
  });

  it("reports docs and triples on stdout", () => {
    const out = join(mkdtempSync(join(tmpdir(), "dockg-build-")), "graph.ttl");
    const stdout = build(out);
    expect(stdout).toMatch(/8 docs, \d+ triples/);
  });

  it("provenance.git: an ambient GIT_DIR cannot redirect the build", () => {
    // Running the suite from the husky pre-push hook exposed this: git exports
    // GIT_DIR to hook subprocesses, and dockg inherited it, so a build outside
    // a repo silently succeeded against the *hook's* repo and emitted a
    // different graph. Must still be exit 2 — not a repo is not a repo.
    //
    // GIT_DIR points at a throwaway decoy rather than this repository: a
    // regression here must not be able to touch real history. The decoy needs
    // a commit, or the build would fail for want of history and the test would
    // pass even while broken.
    const env = hermeticEnv();
    const decoy = mkdtempSync(join(tmpdir(), "dockg-decoy-"));
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

    const dir = mkdtempSync(join(tmpdir(), "dockg-gitenv-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: true\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n");

    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [cli, "kg", "build", "--out", join(dir, "g.ttl")],
        {
          encoding: "utf8",
          cwd: dir,
          env: { ...env, GIT_DIR: join(decoy, ".git") },
        },
      );
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });

  it("provenance.git: errors loudly outside a git repo, is byte-stable inside one", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-gittime-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: true\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n");

    // not a git repo -> operational error
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [cli, "kg", "build", "--out", join(dir, "g.ttl")],
        {
          encoding: "utf8",
          cwd: dir,
        },
      );
    } catch (e) {
      status = (e as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);

    // with a commit: endedAtTime appears and rebuilds are identical
    // hermeticEnv: without it these inherit GIT_DIR when the suite runs from
    // the pre-push hook, and operate on the dockg repo instead of `dir`.
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
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "a.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "b.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    const a = readFileSync(join(dir, "a.ttl"), "utf8");
    expect(a).toBe(readFileSync(join(dir, "b.ttl"), "utf8"));
    expect(a).toMatch(/prov:endedAtTime "[^"]+"\^\^xsd:dateTime/);
  });

  it("provenance.git 'auto' (the default) degrades outside a git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-gitauto-"));
    // No provenance key at all: the default must apply.
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n");

    const out = join(dir, "g.ttl");
    const r = spawnSync(process.execPath, [cli, "kg", "build", "--out", out], {
      encoding: "utf8",
      cwd: dir,
      env: hermeticEnv(),
    });

    // Degrades: build succeeds, warns on stderr, and emits no git-derived time.
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Wrote");
    expect(r.stderr).toMatch(/provenance\.git/);
    expect(readFileSync(out, "utf8")).not.toMatch(/prov:endedAtTime/);

    // Same directory, now a repo: the same default derives git provenance
    // silently. hermeticEnv keeps an ambient GIT_DIR from redirecting this.
    const env = hermeticEnv();
    execFileSync("git", ["init", "-q"], { cwd: dir, env });
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
      { cwd: dir, env },
    );
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "i"],
      { cwd: dir, env },
    );
    const inRepo = spawnSync(process.execPath, [cli, "kg", "build", "--out", out], {
      encoding: "utf8",
      cwd: dir,
      env,
    });
    expect(inRepo.status).toBe(0);
    expect(inRepo.stderr).toBe("");
    expect(readFileSync(out, "utf8")).toMatch(/prov:endedAtTime/);
  });

  it("provenance.git false stays silent and skips git entirely", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-gitoff-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
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
    const dir = mkdtempSync(join(tmpdir(), "dockg-harvest-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  baseIri: https://example.com/kg/\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
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

    // A warning never gates and never changes the graph: the facts are still
    // absent, which is correct — dockg must not guess what the author meant.
    const ttl = readFileSync(out, "utf8");
    expect(ttl).not.toContain("iirds:relates-to-product-variant");
    expect(ttl).not.toContain("iirds:has-topic-type");
  });

  it("says nothing about a corpus that spells every harvest key correctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-harvest-ok-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  baseIri: https://example.com/kg/\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
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
    expect(r.stderr).toBe("");
  });

  it("exits 2 when no inputs match", () => {
    const empty = mkdtempSync(join(tmpdir(), "dockg-empty-"));
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
