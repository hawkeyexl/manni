/**
 * Integration: every docevals writer puts its keys where their location says
 * (proposal 0047), over copies of the manifest fixtures.
 *
 * The claim worth pinning end to end is that the page and the manifest never
 * both hold the evals. A `fill` that appends to a page whose manifest owns
 * `evals` leaves the corpus with an `external:owned` collision on the next
 * `meta validate`, and `generate` and `promote --write` had nowhere to put
 * their command reference at all: the page carries no eval to edit, so the
 * write was skipped without a word.
 *
 * The providers are mocked; only the routing and the files are real.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pc from "picocolors";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill, renderFill } from "../../../src/docevals/commands/fill.js";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURES = resolve(import.meta.dirname, "../../docevals/fixtures/manifest");

/** A writable copy of a fixture corpus; every test here writes. */
function copyOf(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-docevals-write-"));
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

const read = (cwd: string, rel: string): string =>
  readFileSync(join(cwd, rel), "utf8");

const PROPOSAL = {
  id: "states-the-problem",
  assertion: "The page states what problem it solves before how to solve it.",
  confidence: 0.9,
  examples: { pass: "The intro motivates the feature.", fail: "Bare syntax." },
};

/** One proposal per page the run reaches. */
const proposals = (n: number): { json: unknown }[] =>
  Array.from({ length: n }, () => ({ json: { evals: [PROPOSAL] } }));

beforeEach(() => {
  resetWarnings();
});

describe("fill, where a manifest owns the evals", () => {
  it("splices the page's entry and leaves the page and its neighbours alone", async () => {
    const cwd = copyOf("write");
    const before = read(cwd, "docs/install.md");

    const report = await runFill([], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });

    expect(report.exitCode).toBe(0);
    const install = report.results.find((r) => r.file === "docs/install.md");
    expect(install?.status).toBe("filled");
    expect(install?.wroteTo).toBe("site.metadata.yaml");

    // The page is untouched: its evals were never its own.
    expect(read(cwd, "docs/install.md")).toBe(before);

    const manifest = read(cwd, "site.metadata.yaml");
    expect(manifest).toContain("id: states-the-problem");
    // The entry it already held, and the comments around both entries.
    expect(manifest).toContain("id: mentions-prerequisites");
    expect(manifest).toContain("# Added when the page was first reviewed.");
    expect(manifest).toContain(
      "# A second entry, which a write to the first never touches.",
    );
    expect(manifest).toContain("id: has-example");
    expect(manifest).toContain(
      "# Written by hand. Every comment here, and the second entry, must survive a",
    );
  });

  it("records meta-provenance in the manifest that owns it too", async () => {
    const cwd = copyOf("write");
    const report = await runFill([], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });
    const install = report.results.find((r) => r.file === "docs/install.md");
    expect(install?.metaProvenance).toMatchObject({
      written: true,
      destination: "site.metadata.yaml",
    });
    expect(read(cwd, "site.metadata.yaml")).toContain("meta-provenance:");
    // Not on the page, which the manifest's `keys:` claims.
    expect(read(cwd, "docs/install.md")).not.toContain("meta-provenance");
  });

  it("names the manifest in the pretty report", async () => {
    const cwd = copyOf("write");
    const report = await runFill([], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });
    // picocolors decides for itself whether this process gets escapes, so the
    // expectation is built the way the line is.
    expect(renderFill(report, "pretty")).toContain(
      `    ${pc.cyan("evals")} → site.metadata.yaml`,
    );
  });

  it("reports the manifest under --dry-run and writes nothing", async () => {
    const cwd = copyOf("write");
    const manifestBefore = read(cwd, "site.metadata.yaml");

    const report = await runFill([], {
      cwd,
      dryRun: true,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });

    const install = report.results.find((r) => r.file === "docs/install.md");
    expect(install?.status).toBe("proposed");
    expect(install?.wroteTo).toBe("site.metadata.yaml");
    expect(read(cwd, "site.metadata.yaml")).toBe(manifestBefore);
  });
});

describe("fill, where the manifest has no entry for the page", () => {
  it("refuses that page in meta's sentence and fills the others", async () => {
    const cwd = copyOf("join-missing");
    const pageBefore = read(cwd, "docs/no-id.md");

    const report = await runFill([], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });

    expect(report.exitCode).toBe(1);
    const missing = report.results.find((r) => r.file === "docs/no-id.md");
    expect(missing?.status).toBe("error");
    expect(missing?.error).toBe(
      "docs/no-id.md carries no doc-id, which site.metadata.yaml joins on, " +
        "so its evals has no entry there.",
    );
    expect(missing?.wroteTo).toBeUndefined();
    // Nothing anywhere: not the page, and not a stray manifest entry.
    expect(read(cwd, "docs/no-id.md")).toBe(pageBefore);
    // No entry was invented for it: the manifest still keys one document.
    const entries = read(cwd, "site.metadata.yaml")
      .split(/\r?\n/)
      .filter((l) => /^\S/.test(l));
    expect(entries).toEqual(["install-page:"]);

    const filled = report.results.find((r) => r.file === "docs/install.md");
    expect(filled?.wroteTo).toBe("site.metadata.yaml");
  });

  it("leaves a page that carries the owned key to the collision it already is", async () => {
    // The other shape of "no entry": the page kept its own evals. That is an
    // error-level problem before any writer looks at it (chunk 1), so the
    // routing refusal above is the page that carries none.
    const cwd = copyOf("join-missing");
    const report = await runFill([], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });
    const owned = report.results.find((r) => r.file === "docs/owned.md");
    expect(owned?.status).toBe("error");
    expect(owned?.error).toContain("is owned by manifest site.metadata.yaml");
    expect(owned?.wroteTo).toBeUndefined();
  });
});

describe("fill, where nothing owns the evals", () => {
  it("writes the page and says so once for the whole run", async () => {
    const cwd = copyOf("no-manifest");
    const said: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      said.push(String(chunk));
      return true;
    };
    try {
      const report = await runFill(["docs"], {
        cwd,
        noCache: true,
        providerInstance: new MockProvider(proposals(2)),
      });
      expect(report.results.every((r) => r.wroteTo === "page")).toBe(true);
    } finally {
      process.stderr.write = write;
    }
    expect(read(cwd, "docs/install.md")).toContain("id: states-the-problem");
    expect(said.filter((l) => l.includes("wrote evals to"))).toEqual([
      "manni: wrote evals to 2 pages; the schema prefers external metadata. " +
        "Run manni meta relocate to give it a manifest.\n",
    ]);
  });
});

describe("generate, where a manifest owns the evals", () => {
  it("persists the command reference into the entry", async () => {
    const cwd = copyOf("write");
    const run = await runGenerate([], {
      cwd,
      providerInstance: new MockProvider([
        { json: { code: "process.exit(0);\n" } },
      ]),
    });

    expect(run.targets).toBe(1);
    expect(run.generatedPaths).toHaveLength(1);
    expect(run.refusals).toEqual([]);

    const manifest = read(cwd, "site.metadata.yaml");
    expect(manifest).toContain("generated-assertion-hash:");
    expect(manifest).toMatch(/command:\s*\n?\s*- node/);
    // The other entry, and the comments, are still there.
    expect(manifest).toContain("id: has-example");
    expect(manifest).toContain("# Added when the page was first reviewed.");
    // The page never grew an evals key.
    expect(read(cwd, "docs/install.md")).not.toContain("evals");
  });

});

describe("promote --write, where a manifest owns the evals", () => {
  it("rewrites the entry and reports it applied", async () => {
    const cwd = copyOf("write");
    const proposal = await runPromote([], {
      cwd,
      write: true,
      providerInstance: new MockProvider([
        {
          json: {
            promotable: true,
            rationale: "A regex checks it.",
            code: "process.exit(0);\n",
          },
        },
      ]),
    });

    const applied = proposal.filter((p) => p.applied);
    expect(applied.map((p) => p.evalName)).toEqual(["has-example"]);
    expect(applied[0]?.error).toBeUndefined();
    const manifest = read(cwd, "site.metadata.yaml");
    expect(manifest).toContain("grader: command");
    expect(manifest).toContain("generated-assertion-hash:");
    // The neighbouring entry and the comments survive.
    expect(manifest).toContain("id: mentions-prerequisites");
    expect(manifest).toContain("# Added when the page was first reviewed.");
  });

});

describe("promote --write, where nothing owns the evals", () => {
  it("still rewrites the page's own eval", async () => {
    const cwd = copyOf("no-manifest");
    // An eval to promote has to exist first; `fill` puts one on each page.
    await runFill(["docs"], {
      cwd,
      noCache: true,
      providerInstance: new MockProvider(proposals(2)),
    });
    const proposal = await runPromote(["docs/install.md"], {
      cwd,
      write: true,
      providerInstance: new MockProvider([
        {
          json: {
            promotable: true,
            rationale: "A regex checks it.",
            code: "process.exit(0);\n",
          },
        },
      ]),
    });
    expect(proposal.map((p) => p.applied)).toEqual([true]);
    expect(read(cwd, "docs/install.md")).toContain("grader: command");
  });
});
