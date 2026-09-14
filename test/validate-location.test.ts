/**
 * `manni meta validate` and `x-manni-location` (proposal 0047): the
 * `location:external` and `location:page` warnings, how each reporter shows
 * them, and the P2 offer that runs relocate after the report on a terminal.
 * Offer cases run on a private copy of their fixture.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runValidate } from "../src/meta/commands/validate.js";
import { offerRelocation } from "../src/meta/commands/validate-offer.js";
import { render } from "../src/meta/reporters/index.js";
import { RESERVED_RULES, ruleIdFor } from "../src/meta/reporters/rule-id.js";
import type { ValidationResult } from "../src/meta/types.js";
import { startSchemaServer } from "./helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "location");
const fixture = (name: string): string => join(fixtures, name);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A private copy of one fixture directory. */
function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-${name}-`));
  dirs.push(dir);
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), "utf8");
const noKey: NodeJS.ProcessEnv = {};

const V1 = (key: string): string =>
  `"${key}" is stored in the page; steward.schema.json prefers external metadata. Run manni meta relocate.`;
const V3 = (key: string, manifest: string): string =>
  `"${key}" is stored in manifest ${manifest}; steward.schema.json prefers the page. Run manni meta relocate.`;

const errorsOf = (results: ValidationResult[], file: string): ValidationResult["errors"] =>
  results.find((r) => r.file === file)?.errors ?? [];

describe("validate: location findings", () => {
  it("warns location:external at the page line and location:page at the manifest line", async () => {
    const { results, summary } = await runValidate({ inputs: [], cwd: fixture("validate-both"), env: noKey });
    expect(results.map((r) => [r.file, r.ok])).toEqual([
      ["docs/faq.md", true],
      ["docs/install.md", true],
    ]);
    expect(errorsOf(results, "docs/faq.md")).toEqual([
      {
        schema: "location:page",
        keyword: "location",
        subject: "title",
        instancePath: "/title",
        message: V3("title", "docs-meta.yaml"),
        severity: "warning",
        file: "docs-meta.yaml",
        line: 3,
      },
    ]);
    expect(errorsOf(results, "docs/install.md")).toEqual([
      {
        schema: "location:external",
        keyword: "location",
        subject: "owner",
        instancePath: "/owner",
        message: V1("owner"),
        severity: "warning",
        line: 2,
      },
      {
        schema: "location:page",
        keyword: "location",
        subject: "title",
        instancePath: "/title",
        message: V3("title", "docs-meta.yaml"),
        severity: "warning",
        file: "docs-meta.yaml",
        line: 5,
      },
    ]);
    // Warnings never fail a file, so the exit code stays 0.
    expect(summary.failed).toBe(0);
    expect(summary.errors).toBe(0);
    expect(summary.warnings).toBe(3);
  });

  it("skips a manifest-owned key (external:owned errors instead) and a field join's own field", async () => {
    const { results } = await runValidate({ inputs: [], cwd: fixture("validate-skips"), env: noKey });
    expect(errorsOf(results, "api/joined.md")).toEqual([]);
    expect(errorsOf(results, "docs/owned.md").map((e) => e.schema)).toEqual(["external:owned"]);
  });

  it("says V2 for a page in none of several collections, and V1 for one in a collection", async () => {
    const { results, summary } = await runValidate({
      inputs: ["docs/page.md", "notes/stray.md"],
      cwd: fixture("validate-homeless"),
      env: noKey,
    });
    expect(errorsOf(results, "docs/page.md").map((e) => e.message)).toEqual([V1("owner")]);
    expect(errorsOf(results, "notes/stray.md").map((e) => [e.message, e.line])).toEqual([
      [
        '"owner" is stored in the page; steward.schema.json prefers external metadata, and this document is in none of the 2 collections.',
        2,
      ],
    ]);
    expect(summary.failed).toBe(0);
  });

  it("says V1 with no collections, since relocate can create one", async () => {
    const { results } = await runValidate({ inputs: ["docs/"], cwd: fixture("validate-default"), env: noKey });
    expect(errorsOf(results, "docs/install.md")).toEqual([
      {
        schema: "location:external",
        keyword: "location",
        subject: "owner",
        instancePath: "/owner",
        message: V1("owner"),
        severity: "warning",
        line: 3,
      },
    ]);
  });

  it("under --no-config, says no manifest can hold it rather than pointing at relocate", async () => {
    const dir = fixture("validate-default");
    const { results } = await runValidate({
      inputs: ["docs/install.md"],
      cwd: dir,
      noConfig: true,
      cliSchemas: [join(dir, "steward.schema.json")],
      env: noKey,
    });
    expect(errorsOf(results, "docs/install.md").map((e) => e.message)).toEqual([
      '"owner" is stored in the page; steward.schema.json prefers external metadata, and --no-config leaves it no manifest.',
    ]);
  });

  it("reports a stdin page's external-preferring key too", async () => {
    const dir = fixture("validate-default");
    const { results } = await runValidate({
      inputs: ["-"],
      as: "markdown",
      stdinContent: "---\nowner: platform\n---\n",
      cwd: dir,
      env: noKey,
    });
    expect(errorsOf(results, "<stdin>").map((e) => [e.schema, e.line])).toEqual([["location:external", 2]]);
  });

  it("says a fetched manifest cannot be written when a URL manifest holds a page-preferring value", async () => {
    const dir = copy("validate-both");
    const server = await startSchemaServer({
      "/docs-meta.yaml": { body: read(dir, "docs-meta.yaml"), contentType: "text/plain" },
    });
    try {
      const url = `${server.url}/docs-meta.yaml`;
      writeFileSync(
        join(dir, "manni.config.yaml"),
        [
          "meta:",
          "  schemas: [./steward.schema.json]",
          "collections:",
          "  - name: site",
          '    paths: ["docs/**/*.md"]',
          "    externalMetadata:",
          `      - file: ${url}`,
          "        keys: [title]",
          "",
        ].join("\n"),
      );
      const { results, summary } = await runValidate({ inputs: [], cwd: dir, env: noKey });
      expect(errorsOf(results, "docs/faq.md")).toEqual([
        {
          schema: "location:page",
          keyword: "location",
          subject: "title",
          instancePath: "/title",
          message: `"title" is stored in manifest ${url}; steward.schema.json prefers the page, and a fetched manifest cannot be written. Move it in that repository.`,
          severity: "warning",
          file: url,
          line: 3,
        },
      ]);
      expect(summary.failed).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("rides the baseline like any other finding", async () => {
    const dir = copy("validate-both");
    await runValidate({ inputs: [], cwd: dir, writeBaseline: true, env: noKey });
    const { results, summary } = await runValidate({ inputs: [], cwd: dir, baseline: true, env: noKey });
    expect(results.flatMap((r) => r.errors)).toEqual([]);
    expect(summary.baseline?.suppressed).toBe(3);
  });
});

describe("validate: location findings in each reporter", () => {
  const runBoth = () => runValidate({ inputs: [], cwd: fixture("validate-both"), env: noKey });

  it("reserves both rule ids", async () => {
    const { results } = await runBoth();
    const [external, page] = errorsOf(results, "docs/install.md");
    if (external === undefined || page === undefined) throw new Error("missing findings");
    expect(ruleIdFor(external)).toBe("location:external/location");
    expect(ruleIdFor(page)).toBe("location:page/location");
    expect(RESERVED_RULES["location:external/location"]).toMatch(/prefers external metadata/);
    expect(RESERVED_RULES["location:page/location"]).toMatch(/prefers the page/);
  });

  it("pretty: a warning under a ⚠ file", async () => {
    const { results, summary, frame } = await runBoth();
    const text = render("pretty", results, summary, { color: false, frame });
    expect(text).toContain(
      [
        "⚠ docs/install.md",
        `    /owner  warning ${V1("owner")}  (line 2)  [location:external]`,
        `    /title  warning ${V3("title", "docs-meta.yaml")}  (docs-meta.yaml:5)  [location:page]`,
      ].join("\n"),
    );
    expect(text).toContain("2 files checked, 2 passed, 0 failed, 0 errors, 3 warnings");
  });

  it("json: severity warning", async () => {
    const { results, summary, frame } = await runBoth();
    const parsed = JSON.parse(render("json", results, summary, { frame })) as {
      results: { errors: { schema: string; severity?: string; keyword: string }[] }[];
    };
    const all = parsed.results.flatMap((r) => r.errors);
    expect(all.map((e) => [e.schema, e.keyword, e.severity])).toEqual([
      ["location:page", "location", "warning"],
      ["location:external", "location", "warning"],
      ["location:page", "location", "warning"],
    ]);
  });

  it("github: ::warning at the page line, or at the manifest line", async () => {
    const { results, summary, frame } = await runBoth();
    const lines = render("github", results, summary, { frame }).split("\n");
    expect(lines).toContain(`::warning file=docs/install.md,line=2::[location:external] /owner ${V1("owner")}`);
    expect(lines).toContain(
      `::warning file=docs-meta.yaml,line=5::[location:page] /title ${V3("title", "docs-meta.yaml")}`,
    );
  });

  it("sarif: level warning with the reserved rule id and its description", async () => {
    const { results, summary, frame } = await runBoth();
    const sarif = JSON.parse(render("sarif", results, summary, { frame })) as {
      runs: {
        tool: { driver: { rules: { id: string; shortDescription?: { text: string } }[] } };
        results: { ruleId: string; level: string }[];
      }[];
    };
    const [run] = sarif.runs;
    expect(run?.results.map((r) => [r.ruleId, r.level])).toEqual([
      ["location:page/location", "warning"],
      ["location:external/location", "warning"],
      ["location:page/location", "warning"],
    ]);
    const ids = run?.tool.driver.rules.map((r) => r.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining(["location:external/location", "location:page/location"]));
  });

  it("junit: a warning is not a failure", async () => {
    const { results, summary, frame } = await runBoth();
    expect(render("junit", results, summary, { frame })).not.toContain("<failure");
  });
});

/** A stream that keeps what it is given. */
function sink(): { write: (chunk: string) => boolean; text: () => string } {
  let out = "";
  return {
    write: (chunk: string) => {
      out += chunk;
      return true;
    },
    text: () => out,
  };
}

describe("validate: the P2 offer", () => {
  it("on yes, moves both directions and prints relocate's pretty output to the stream", async () => {
    const dir = copy("validate-both");
    const { results } = await runValidate({ inputs: [], cwd: dir, env: noKey });
    const asked: string[] = [];
    const output = sink();
    await offerRelocation({
      results,
      inputs: [],
      cwd: dir,
      env: noKey,
      confirm: (q) => {
        asked.push(q);
        return Promise.resolve(true);
      },
      output,
    });
    expect(asked).toEqual([
      "Move them (remove title from docs-meta.yaml's keys, add owner to docs-meta.yaml's keys)? ",
    ]);
    expect(output.text()).toBe(
      [
        "manni: in collection site, 1 value in 1 page prefers external metadata and 2 values in docs-meta.yaml prefer the page.",
        "Removing title from docs-meta.yaml's keys moves it into every page in collection site.",
        "Adding owner to docs-meta.yaml's keys moves it out of every page in collection site.",
        "docs/faq.md",
        "    title    ← docs-meta.yaml",
        "docs/install.md",
        "    title    ← docs-meta.yaml",
        "    owner    → docs-meta.yaml:3",
        "2 files, 3 values moved: 2 into pages, 1 into 1 manifest",
        "",
      ].join("\n"),
    );
    expect(read(dir, "docs/install.md")).not.toContain("owner:");
    expect(read(dir, "docs/install.md")).toContain("title: Install");
    expect(parseYaml(read(dir, "docs-meta.yaml"))).toEqual({ "docs/install.md": { owner: "platform" } });

    const again = await runValidate({ inputs: [], cwd: dir, env: noKey });
    expect(again.results.flatMap((r) => r.errors)).toEqual([]);
  });

  it("on no, prints only the notice and changes nothing", async () => {
    const dir = copy("validate-both");
    const before = [read(dir, "docs/install.md"), read(dir, "docs-meta.yaml"), read(dir, "manni.config.yaml")];
    const { results } = await runValidate({ inputs: [], cwd: dir, env: noKey });
    const output = sink();
    let asked = 0;
    await offerRelocation({
      results,
      inputs: [],
      cwd: dir,
      env: noKey,
      confirm: () => {
        asked++;
        return Promise.resolve(false);
      },
      output,
    });
    expect(asked).toBe(1);
    expect(output.text()).toBe(
      "manni: in collection site, 1 value in 1 page prefers external metadata and 2 values in docs-meta.yaml prefer the page.\n",
    );
    expect([read(dir, "docs/install.md"), read(dir, "docs-meta.yaml"), read(dir, "manni.config.yaml")]).toEqual(
      before,
    );
  });

  it("offers to create collection default when there are no collections", async () => {
    const dir = copy("validate-default");
    const { results } = await runValidate({ inputs: ["docs/"], cwd: dir, env: noKey });
    const asked: string[] = [];
    const output = sink();
    await offerRelocation({
      results,
      inputs: ["docs/"],
      cwd: dir,
      env: noKey,
      confirm: (q) => {
        asked.push(q);
        return Promise.resolve(true);
      },
      output,
    });
    expect(asked).toEqual(["Move them (create collection default (paths: docs/**), create default.metadata.yaml)? "]);
    expect(existsSync(join(dir, "default.metadata.yaml"))).toBe(true);
    expect(parseYaml(read(dir, "manni.config.yaml"))).toEqual({
      meta: { schemas: ["./steward.schema.json"] },
      collections: [
        {
          name: "default",
          paths: ["docs/**"],
          externalMetadata: [{ file: "./default.metadata.yaml", keys: ["owner"] }],
        },
      ],
    });
  });

  it("asks nothing off a terminal, under --no-config, for a homeless page, or for a baselined finding", async () => {
    const neverAsk = (): Promise<boolean> => Promise.reject(new Error("asked"));

    // Off a terminal: no Confirm at all.
    const both = copy("validate-both");
    const offTerminal = await runValidate({ inputs: [], cwd: both, env: noKey });
    const quiet = sink();
    await offerRelocation({ results: offTerminal.results, inputs: [], cwd: both, env: noKey, output: quiet });
    expect(quiet.text()).toBe("");

    // --no-config: nowhere to declare a manifest.
    const dflt = copy("validate-default");
    const noConfig = await runValidate({
      inputs: ["docs/install.md"],
      cwd: dflt,
      noConfig: true,
      cliSchemas: [join(dflt, "steward.schema.json")],
      env: noKey,
    });
    await offerRelocation({
      results: noConfig.results,
      inputs: ["docs/install.md"],
      cwd: dflt,
      noConfig: true,
      cliSchemas: [join(dflt, "steward.schema.json")],
      env: noKey,
      confirm: neverAsk,
      output: quiet,
    });

    // A page in none of several collections has no home.
    const homeless = copy("validate-homeless");
    const stray = await runValidate({ inputs: ["notes/stray.md"], cwd: homeless, env: noKey });
    await offerRelocation({
      results: stray.results,
      inputs: ["notes/stray.md"],
      cwd: homeless,
      env: noKey,
      confirm: neverAsk,
      output: quiet,
    });

    // Stdin is not a page on disk.
    const piped = await runValidate({
      inputs: ["-"],
      as: "markdown",
      stdinContent: "---\nowner: platform\n---\n",
      cwd: dflt,
      env: noKey,
    });
    await offerRelocation({ results: piped.results, inputs: ["-"], cwd: dflt, env: noKey, confirm: neverAsk, output: quiet });

    // A baseline is how someone stops being asked.
    await runValidate({ inputs: [], cwd: both, writeBaseline: true, env: noKey });
    const baselined = await runValidate({ inputs: [], cwd: both, baseline: true, env: noKey });
    await offerRelocation({ results: baselined.results, inputs: [], cwd: both, env: noKey, confirm: neverAsk, output: quiet });

    expect(quiet.text()).toBe("");
    expect(existsSync(join(dflt, "manni.config.yaml"))).toBe(true);
    expect(existsSync(join(dflt, "default.metadata.yaml"))).toBe(false);
  });
});
