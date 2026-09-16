import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { hermeticEnv } from "../helpers/git-env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const corpus = join(root, "test", "kg", "fixtures", "corpus");

let graph: string;

function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [cli, "kg", ...args], {
      encoding: "utf8",
      cwd: corpus,
    });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { stdout: err.stdout ?? "", status: err.status ?? -1 };
  }
}

beforeAll(() => {
  graph = join(mkdtempSync(join(tmpdir(), "dockg-qs-")), "graph.ttl");
  execFileSync(process.execPath, [cli, "kg", "build", "--out", graph], {
    encoding: "utf8",
    cwd: corpus,
  });
});

describe("manni kg query", () => {
  it("matches by predicate with a prefixed name", () => {
    const { stdout, status } = run([
      "query",
      "-p",
      "dcterms:references",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("dcterms:references");
    expect(stdout).toContain("configuration.md");
  });

  it("matches by subject and returns JSON", () => {
    const { stdout, status } = run([
      "query",
      "-s",
      "https://example.com/kg/doc/docs/getting-started.md",
      "-f",
      "json",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { matches: unknown[] };
    expect(parsed.matches.length).toBeGreaterThan(5);
  });

  it("matches literal objects", () => {
    const { stdout } = run(["query", "-o", "python", "-g", graph]);
    expect(stdout).toContain("dockg:codeLanguage");
  });

  it("reports no matches cleanly", () => {
    const { stdout, status } = run([
      "query",
      "-p",
      "dcterms:nonexistent",
      "-g",
      graph,
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("No matches.");
  });

  it("exits 2 when the graph file is missing", () => {
    const { status } = run(["query", "-g", "nope/missing.ttl"]);
    expect(status).toBe(2);
  });

  // Result ordering is user-visible and was previously unpinned, which let a
  // separator bug hide: the sort key joined fields with NUL, and any printable
  // replacement (`|`) silently reorders results because it sorts *after* most
  // characters instead of before. These two assertions fail under such a
  // separator but pass for field-wise comparison.
  it("orders matches by subject, then predicate, then object", () => {
    const { stdout, status } = run(["query", "-f", "json", "-g", graph]);
    expect(status).toBe(0);
    const { matches } = JSON.parse(stdout) as {
      matches: { s: string; p: string; o: { kind: string; value: string } }[];
    };
    expect(matches.length).toBeGreaterThan(0);

    const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const expected = [...matches].sort(
      (a, b) =>
        by(a.s, b.s) ||
        by(a.p, b.p) ||
        by(a.o.kind, b.o.kind) ||
        by(a.o.value, b.o.value),
    );
    expect(matches).toEqual(expected);
  });

  it("sorts a subject before one that extends it", () => {
    const { stdout } = run(["query", "-f", "json", "-g", graph]);
    const { matches } = JSON.parse(stdout) as { matches: { s: string }[] };

    // configuration.md and its own section IRIs are the prefix pair that
    // exposes a mis-ordering separator: the document must come first. The
    // fragment prefix is derived from the matched subject rather than
    // hardcoded, so this survives a change of corpus baseIri.
    const doc = matches.findIndex((m) =>
      m.s.endsWith("/docs/configuration.md"),
    );
    const docMatch = matches[doc];
    if (!docMatch) throw new Error("configuration.md missing from matches");

    const frag = matches.findIndex((m) => m.s.startsWith(`${docMatch.s}#`));
    expect(frag).toBeGreaterThanOrEqual(0);
    expect(doc).toBeLessThan(frag);
  });
});

describe("manni kg stats", () => {
  it("reports counts, orphans, and broken links", () => {
    const { stdout, status } = run(["stats", "-g", graph]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Documents: {2}8/);
    expect(stdout).toContain("docs/no-frontmatter.md -> missing.md");
  });

  it("emits JSON with the expected shape", () => {
    const { stdout } = run(["stats", "-f", "json", "-g", graph]);
    const report = JSON.parse(stdout) as {
      docs: number;
      sections: number;
      concepts: number;
      orphans: string[];
      brokenLinks: Array<{ doc: string; target: string }>;
      brokenSectionRefs: Array<{ doc: string; slug: string }>;
      mostConnected: Array<{ doc: string; degree: number }>;
    };
    expect(report.docs).toBe(8);
    expect(report.sections).toBe(13);
    expect(report.concepts).toBe(6);
    // no-frontmatter.md only references an external URL and missing.md;
    // external counts as an outgoing reference, so it is not an orphan.
    // The localized pages are: an orphan here means no in/out
    // `dcterms:references`, and a translation edge is not one — the metric is
    // about the link graph, and it says exactly what it always said.
    expect(report.orphans).toEqual([
      "docs/de/getting-started.md",
      "docs/de/regional.md",
      "docs/fr/getting-started.md",
    ]);
    // Two deliberate broken targets: a body link, and the translation-of on
    // docs/de/regional.md that names a file the corpus does not have.
    expect(report.brokenLinks).toEqual([
      { doc: "docs/de/regional.md", target: "../missing.md" },
      { doc: "docs/no-frontmatter.md", target: "missing.md" },
    ]);
    // getting-started.md carries a kg.sections key naming no heading.
    expect(report.brokenSectionRefs).toEqual([
      { doc: "docs/getting-started.md", slug: "missing-heading" },
    ]);
    expect(report.mostConnected[0]).toMatchObject({
      doc: "docs/configuration.md",
    });
  });

  it("reports broken section refs in pretty output", () => {
    const { stdout } = run(["stats", "-g", graph]);
    expect(stdout).toContain("Broken section refs (1):");
    expect(stdout).toContain("docs/getting-started.md -> #missing-heading");
  });

  it("--check exits 1 when broken links or section refs exist", () => {
    const { status } = run(["stats", "--check", "-g", graph]);
    expect(status).toBe(1);
  });

  it("--check exits 1 for a broken section ref on an otherwise clean corpus", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-secref-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
    );
    writeFileSync(
      join(dir, "a.md"),
      "---\nkg:\n  sections:\n    nope:\n      type: task\n---\n\n# A\n\n## Real\n",
    );
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "g.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    const r = spawnSync(
      process.execPath,
      [cli, "kg", "stats", "-g", join(dir, "g.ttl"), "--check"],
      { encoding: "utf8", cwd: dir },
    );
    expect(r.status).toBe(1);
  });
});

describe("manni kg stats — metadata coverage", () => {
  /** A clean one-doc corpus: no broken links, so --check isolates coverage. */
  function scratch(frontmatter: string, config = ""): string {
    const dir = mkdtempSync(join(tmpdir(), "dockg-cov-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      `kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: false\n${config.replace(/^(?=.)/gm, "  ")}`,
    );
    writeFileSync(join(dir, "a.md"), `${frontmatter}# A\n\nBody.\n`);
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "g.ttl")],
      {
        encoding: "utf8",
        cwd: dir,
      },
    );
    return dir;
  }

  function statsIn(
    dir: string,
    args: string[],
  ): { stdout: string; status: number } {
    const r = spawnSync(
      process.execPath,
      [cli, "kg", "stats", "-g", join(dir, "g.ttl"), ...args],
      { encoding: "utf8", cwd: dir },
    );
    return { stdout: r.stdout, status: r.status ?? -1 };
  }

  it("reports exact per-field coverage for the corpus", () => {
    const { stdout, status } = run(["stats", "-f", "json", "-g", graph]);
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as {
      coverage: Array<{
        field: string;
        predicate: string;
        docs: number;
        pct: number;
      }>;
    };
    // 8 docs: only getting-started.md carries creator/dates; it, harvest.md
    // and the two translated pages with descriptions carry a description;
    // configuration.md alone has a kg.label. Order is the report order.
    //
    // This is the blended number ADR 01037 calls out: the three localized docs
    // pull every English-only field down without saying which audience is
    // under-served. Per-language tables are the answer, and land next.
    expect(report.coverage).toEqual([
      { field: "title", predicate: "dcterms:title", docs: 8, pct: 100 },
      {
        field: "description",
        predicate: "dcterms:description",
        docs: 4,
        pct: 50,
      },
      { field: "creator", predicate: "dcterms:creator", docs: 1, pct: 12.5 },
      { field: "created", predicate: "dcterms:created", docs: 1, pct: 12.5 },
      { field: "modified", predicate: "dcterms:modified", docs: 1, pct: 12.5 },
      { field: "subject", predicate: "dcterms:subject", docs: 3, pct: 37.5 },
      { field: "label", predicate: "foaf:primaryTopic", docs: 1, pct: 12.5 },
      // Restored by ADR 01037 after ADR 01011 dropped it: only the localized
      // tree carries a language, because the English route declares none.
      {
        field: "language",
        predicate: "dcterms:language",
        docs: 3,
        pct: 37.5,
      },
      // The iiRDS typing from Phases 2-4, which coverage did not measure until
      // ADR 01029. The two negative predicates are excluded on purpose: an
      // absent negative means "unknown", not "missing".
      { field: "type", predicate: "iirds:has-topic-type", docs: 3, pct: 37.5 },
      {
        field: "applies-to",
        predicate: "iirds:relates-to-product-variant",
        docs: 2,
        pct: 25,
      },
      {
        field: "about-product-lifecycle",
        predicate: "iirds:relates-to-product-lifecycle-phase",
        docs: 1,
        pct: 12.5,
      },
      {
        field: "about-product-aspect",
        predicate: "iirds:has-subject",
        docs: 1,
        pct: 12.5,
      },
    ]);
  });

  it("reports section coverage over the corpus's thirteen sections", () => {
    const { stdout, status } = run(["stats", "-f", "json", "-g", graph]);
    expect(status).toBe(0);
    const report = JSON.parse(stdout) as {
      sections: number;
      sectionCoverage: Array<{ field: string; docs: number; pct: number }>;
    };
    expect(report.sections).toBe(13);
    // Sections are explicit-only (ADR 01013), so one section carrying a block
    // is the whole of it. That number is the point: it says how far the corpus
    // is from the granularity the graph already models.
    expect(report.sectionCoverage).toEqual([
      { field: "type", predicate: "iirds:has-topic-type", docs: 1, pct: 7.7 },
      {
        field: "applies-to",
        predicate: "iirds:relates-to-product-variant",
        docs: 1,
        pct: 7.7,
      },
      {
        field: "about-product-lifecycle",
        predicate: "iirds:relates-to-product-lifecycle-phase",
        docs: 0,
        pct: 0,
      },
      {
        field: "about-product-aspect",
        predicate: "iirds:has-subject",
        docs: 0,
        pct: 0,
      },
      { field: "subject", predicate: "dcterms:subject", docs: 1, pct: 7.7 },
    ]);
  });

  it("renders both coverage blocks in pretty output", () => {
    const { stdout } = run(["stats", "-g", graph]);
    expect(stdout).toContain("Coverage (documents):");
    expect(stdout).toContain("Coverage (sections, not gated):");
    expect(stdout).toMatch(/title\s+8\/8\s+100\.0%/);
    expect(stdout).toMatch(/label\s+1\/8\s+12\.5%/);
    expect(stdout).toMatch(/type\s+3\/8\s+37\.5%/);
    expect(stdout).toMatch(/type\s+1\/13\s+7\.7%/);
  });

  it("never gates on section coverage, however low it is", () => {
    // Sections start at zero on every corpus that has not adopted kg.sections.
    // Gating by default would fail all of them, so the block is reported only
    // (ADR 01009: reporting on does not imply gating on).
    //
    // Gate `title` alone, which the H1 satisfies, so the only thing that could
    // fail this run is section coverage — and it must not.
    const dir = scratch("", "stats:\n  coverageThreshold:\n    title: 100\n");
    const { stdout, status } = statsIn(dir, ["--check", "-f", "json"]);
    const report = JSON.parse(stdout) as {
      sections: number;
      sectionCoverage: Array<{ pct: number }>;
      coverageFindings: unknown[];
    };
    expect(report.sections).toBeGreaterThan(0);
    expect(report.sectionCoverage.every((r) => r.pct === 0)).toBe(true);
    expect(report.coverageFindings).toEqual([]);
    expect(status).toBe(0);
  });

  it("--check gates on a uniform coverage threshold", () => {
    const dir = scratch("");
    // title comes from the H1 (100%), everything else is absent (0%).
    expect(statsIn(dir, ["--check", "--coverage-threshold", "50"]).status).toBe(
      1,
    );
    // A threshold only `title` clears still fails on the rest.
    expect(
      statsIn(dir, ["--check", "--coverage-threshold", "100"]).status,
    ).toBe(1);
    // No threshold: coverage never gates, and this corpus has no broken links.
    expect(statsIn(dir, ["--check"]).status).toBe(0);
  });

  it("--check honors a per-field threshold map from config", () => {
    // Gate only `title`, which the H1 satisfies; ignore the empty fields.
    const pass = scratch("", "stats:\n  coverageThreshold:\n    title: 100\n");
    expect(statsIn(pass, ["--check"]).status).toBe(0);

    const fail = scratch(
      "",
      "stats:\n  coverageThreshold:\n    description: 1\n",
    );
    expect(statsIn(fail, ["--check"]).status).toBe(1);
  });

  it("counts frontmatter-derived values as covered", () => {
    // description present -> 100% for a one-doc corpus.
    const dir = scratch("---\ndescription: Hi.\n---\n\n");
    const { stdout } = statsIn(dir, ["-f", "json"]);
    const report = JSON.parse(stdout) as {
      coverage: Array<{ field: string; pct: number }>;
    };
    expect(report.coverage.find((c) => c.field === "description")?.pct).toBe(
      100,
    );
  });

  it("counts git-derived dates as covered, with no frontmatter date", () => {
    // The ADR 01011 reason coverage measures the graph, not the frontmatter:
    // a doc with no `date`/`updated` still covers created/modified once git
    // provenance supplies them. Needs a real repo and provenance.git: true.
    const env = hermeticEnv();
    const dir = mkdtempSync(join(tmpdir(), "dockg-cov-git-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: true\n',
    );
    writeFileSync(join(dir, "a.md"), "# A\n\nNo frontmatter, no dates.\n");
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
    execFileSync(
      process.execPath,
      [cli, "kg", "build", "--out", join(dir, "g.ttl")],
      { encoding: "utf8", cwd: dir, env },
    );

    const r = spawnSync(
      process.execPath,
      [cli, "kg", "stats", "-g", join(dir, "g.ttl"), "-f", "json"],
      { encoding: "utf8", cwd: dir, env },
    );
    const report = JSON.parse(r.stdout) as {
      coverage: Array<{ field: string; pct: number }>;
    };
    const pctOf = (f: string) =>
      report.coverage.find((c) => c.field === f)?.pct;
    // Both dates come purely from git here.
    expect(pctOf("created")).toBe(100);
    expect(pctOf("modified")).toBe(100);
    // creator is a git author, also 100%; description was never provided.
    expect(pctOf("creator")).toBe(100);
    expect(pctOf("description")).toBe(0);
  });
});

/**
 * Per-language reporting (ADR 01037). The whole-corpus table blends every
 * locale into one number that describes no audience; these say which audience
 * is actually under-served, and what is still untranslated.
 */
describe("manni kg stats — localization", () => {
  type Localization = {
    unlabelled: number;
    languages: Array<{
      language: string;
      docs: number;
      coverage: Array<{ field: string; docs: number; pct: number }>;
      untranslated: string[];
    }>;
  };

  const localization = (): Localization =>
    (
      JSON.parse(run(["stats", "-f", "json", "-g", graph]).stdout) as {
        localization: Localization;
      }
    ).localization;

  it("measures language as a coverage field", () => {
    const { stdout } = run(["stats", "-f", "json", "-g", graph]);
    const { coverage } = JSON.parse(stdout) as {
      coverage: Array<{ field: string; predicate: string; docs: number }>;
    };
    // Three of eight corpus docs are localized; the English tree's route
    // declares no language, so they carry none.
    expect(coverage).toContainEqual({
      field: "language",
      predicate: "dcterms:language",
      docs: 3,
      pct: 37.5,
    });
  });

  it("reports one block per language, sorted, with the unlabelled count", () => {
    const l = localization();
    expect(l.languages.map((x) => x.language)).toEqual(["de", "de-AT", "fr"]);
    expect(l.languages.map((x) => x.docs)).toEqual([1, 1, 1]);
    expect(l.unlabelled).toBe(5);
  });

  it("scores each language against its own documents, not the corpus", () => {
    const l = localization();
    const de = l.languages.find((x) => x.language === "de")!;
    const deAt = l.languages.find((x) => x.language === "de-AT")!;
    const pct = (block: (typeof l.languages)[number], field: string) =>
      block.coverage.find((c) => c.field === field)!.pct;
    // The German page carries a description; the Austrian one does not. The
    // blended corpus number (50%) says neither.
    expect(pct(de, "description")).toBe(100);
    expect(pct(deAt, "description")).toBe(0);
    // Both are titled, and both are fully labelled by construction.
    expect(pct(de, "title")).toBe(100);
    expect(pct(de, "language")).toBe(100);
  });

  it("lists sources with no translation into a language", () => {
    const l = localization();
    const de = l.languages.find((x) => x.language === "de")!;
    // getting-started.md has a German translation, so it is not in the list;
    // every other source document is.
    expect(de.untranslated).not.toContain("docs/getting-started.md");
    expect(de.untranslated).toContain("docs/configuration.md");
    expect(de.untranslated).toContain("docs/harvest.md");
    // A translation is never its own backlog item: docs/de/getting-started.md
    // carries schema:translationOfWork, so it is not a source.
    expect(de.untranslated).not.toContain("docs/de/getting-started.md");
    expect(de.untranslated).toEqual([...de.untranslated].sort());
  });

  it("renders a localization block in pretty output", () => {
    const { stdout } = run(["stats", "-g", graph]);
    expect(stdout).toContain("Localization:");
    expect(stdout).toMatch(/de {2,}1 doc/);
    expect(stdout).toContain("no language: 5");
  });

  it("omits the block entirely for a corpus with no languages", () => {
    // ADR 01029's lesson: a section that cannot say anything on most corpora
    // teaches readers to skip the whole report.
    const dir = mkdtempSync(join(tmpdir(), "dockg-l10n-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'kg:\n  version: 1\n  inputs: ["*.md"]\n  provenance:\n    git: false\n',
    );
    writeFileSync(join(dir, "a.md"), "---\ntitle: A\n---\n\n# A\n");
    const opts = { encoding: "utf8" as const, cwd: dir };
    execFileSync(process.execPath, [cli, "kg", "build", "--out", "g.ttl"], opts);
    const stdout = execFileSync(
      process.execPath,
      [cli, "kg", "stats", "-g", "g.ttl"],
      opts,
    );
    expect(stdout).not.toContain("Localization:");
  });
});
