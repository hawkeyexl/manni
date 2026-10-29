/**
 * Proposal 0126: a relocation moves a page's external values out of a
 * `{page}.meta.yaml` sidecar and into `metadata/<id>.yaml`. The git source
 * reads the stamps a page carried at past commits, and the manifest it reads
 * today did not exist then. So at a commit whose tree lacks today's manifest,
 * it reads the manifest that commit's own config declared for the page, under
 * the page's path there, as it already follows the page across a rename.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDerive } from "../src/meta/commands/derive.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { DERIVED_STALE_SCHEMA } from "../src/meta/core/derive/types.js";
import type { FieldError } from "../src/meta/types.js";
import { hashLines } from "../src/shared/pin.js";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, git, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(here, "fixtures", "external-metadata-dir", "manifest-move", "page.schema.json");

const D1 = "2026-08-20T10:00:00+00:00";
const D2 = "2026-10-29T10:00:00+00:00";
const FABLE = "claude-fable-5";

const config = (sidecar: boolean): string =>
  [
    "collections:",
    "  - name: site",
    '    paths: ["docs/**/*.md"]',
    ...(sidecar ? ["    externalMetadata:", '      - file: "{page}.meta.yaml"'] : []),
    "meta:",
    "  defaults: false",
    "  schemas: [./page.schema.json]",
    "  derive:",
    "    fields: [created, provenance]",
    "    sources: [git]",
    '    machines: ["*[bot]", "noreply@anthropic.com"]',
    "",
  ].join("\n");

/** Body lines: 1 blank, 2 heading, 3 blank, 4 the machine's line, 5 a person's. */
const page = (fm: string): string => `---\ntitle: Guide\n${fm}---\n\n# Guide\n\nONE, by a machine\ntwo\n`;

/** The values the sidecar held, the stamp written before the page reached the base. */
const values = [
  "  created: 2026-08-01",
  "  provenance:",
  `    - generated-by: ${FABLE}`,
  "      lines: 4",
  `      integrity: ${hashLines("ONE, by a machine")}`,
  "",
].join("\n");

const dirs: string[] = [];
beforeEach(() => {
  resetWarnings();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/**
 * Commit 1: the page and its `{page}.meta.yaml` sidecar, as the config then
 * declared. The trailer names a machine for the whole commit, and the stamp
 * narrows it to line 4 (0069 rule 3), so a stamp read as empty reads line 5
 * as the machine's too.
 */
function beforeMove(): string {
  const dir = makeTempRepo({
    files: {
      "manni.config.yaml": config(true),
      "docs/guide.md": page(""),
      "docs/guide.meta.yaml": `docs/guide.md:\n${values}`,
    },
  });
  dirs.push(dir);
  cpSync(SCHEMA, join(dir, "page.schema.json"));
  commit(dir, "add the guide", {
    authorDate: D1,
    trailers: ["Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>"],
  });
  return dir;
}

/** Commit 2: what `relocate --from "{page}.meta.yaml"` leaves, with the page at `to`. */
function move(dir: string, to: string): void {
  if (to !== "docs/guide.md") git(dir, ["mv", "docs/guide.md", to]);
  writeFile(dir, "manni.config.yaml", config(false));
  writeFile(dir, to, page("id: guide\n"));
  writeFile(dir, "metadata/guide.yaml", `guide:\n${values}`);
  rmSync(join(dir, "docs/guide.meta.yaml"));
  commit(dir, "docs: keep the site's external metadata in metadata/<id>.yaml", { authorDate: D2 });
}

async function staleOf(dir: string): Promise<string[]> {
  const { results } = await runValidate({ inputs: [], cwd: dir });
  return results.flatMap((r) =>
    r.errors
      .filter((e: FieldError) => e.schema === DERIVED_STALE_SCHEMA)
      .map((e) => `${r.file}: ${e.subject ?? e.instancePath}`),
  );
}

async function derivedOf(dir: string, file: string): Promise<Record<string, unknown>> {
  const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
  const fields = run.results.find((r) => r.file === file)?.fields ?? [];
  return Object.fromEntries(fields.map((f) => [f.field, { status: f.status, derived: f.derived }]));
}

describe("derive follows a page's values across a manifest move (0126)", () => {
  it("reads each past stamp from the sidecar the config declared at that commit", async () => {
    const dir = beforeMove();
    expect(await staleOf(dir)).toEqual([]);

    move(dir, "docs/guide.md");
    expect(await staleOf(dir)).toEqual([]);
    expect(await derivedOf(dir, "docs/guide.md")).toEqual({
      created: { status: "current", derived: "2026-08-01" },
      provenance: {
        status: "current",
        derived: [{ "generated-by": FABLE, lines: 4, integrity: hashLines("ONE, by a machine") }],
      },
    });
  });

  it("follows the page's old path when the move renamed it too", async () => {
    const dir = beforeMove();
    move(dir, "docs/howto.md");
    expect(await staleOf(dir)).toEqual([]);
    expect(await derivedOf(dir, "docs/howto.md")).toEqual({
      created: { status: "current", derived: "2026-08-01" },
      provenance: {
        status: "current",
        derived: [{ "generated-by": FABLE, lines: 4, integrity: hashLines("ONE, by a machine") }],
      },
    });
  });
});
