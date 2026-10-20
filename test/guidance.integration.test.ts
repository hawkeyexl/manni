/**
 * Proposal 0089 for meta, against the built `manni` bin: one finding for a
 * bad dcmi date, with what the schema asks for, in every format.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manni = resolve(root, "dist", "cli.js");

interface Run {
  stdout: string;
  stderr: string;
  status: number;
}

function run(args: string[], cwd: string = root): Run {
  const r = spawnSync("node", [manni, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? 1 };
}

const FILE = "test/fixtures/vocabulary/dcmi-bad-date.md";
const DCMI = ["meta", "validate", FILE, "-s", "dcmi:elements:1.1", "--no-config"];
const P =
  "^[0-9]{4}(-[0-9]{2}(-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2}))?)?)?$";
const D = "A point or period of time associated with an event in the lifecycle of the resource.";
const G = "https://hawkeyexl.github.io/manni/meta/reference/schemas/dcmi-elements/";
const GUIDANCE = { id: "dcmi:elements:1.1", rule: "date", description: D, guide: G };

describe("manni meta validate: a bad dcmi date (built bin)", () => {
  beforeAll(() => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("pretty prints one finding with its two guidance lines", () => {
    const r = run(DCMI);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe(
      [
        `✗ ${FILE}`,
        `    /date  must match pattern "${P}"  (line 3)  [dcmi:elements:1.1]`,
        `      dcmi:elements:1.1 date: ${D}`,
        `      Guide: ${G}`,
        "",
        "1 file checked, 0 passed, 1 failed, 1 error",
        "",
      ].join("\n"),
    );
  });

  it("json carries guidance as the error's last key", () => {
    const r = run([...DCMI, "-f", "json"]);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout) as {
      summary: { errors: number };
      results: { errors: Record<string, unknown>[] }[];
    };
    expect(report.summary.errors).toBe(1);
    const errors = report.results[0]?.errors ?? [];
    expect(errors).toHaveLength(1);
    expect(Object.keys(errors[0] ?? {}).at(-1)).toBe("guidance");
    expect(errors[0]?.guidance).toEqual(GUIDANCE);
  });

  it("github appends the lines after %0A", () => {
    const r = run([...DCMI, "-f", "github"]);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe(
      `::error file=${FILE},line=3::[dcmi:elements:1.1] /date must match pattern "${P}"%0Adcmi:elements:1.1 date: ${D}%0AGuide: ${G}`,
    );
  });

  it("sarif has one result, the guidance, and the schema's page as the rule's help", () => {
    const r = run([...DCMI, "-f", "sarif"]);
    expect(r.status).toBe(1);
    const run0 = (
      JSON.parse(r.stdout) as {
        runs: {
          tool: { driver: { rules: { id: string; helpUri: string }[] } };
          results: { message: { text: string }; properties?: { guidance?: unknown } }[];
        }[];
      }
    ).runs[0];
    expect(run0?.results).toHaveLength(1);
    expect(run0?.results[0]?.message.text).toBe(
      `/date must match pattern "${P}"\ndcmi:elements:1.1 date: ${D}\nGuide: ${G}`,
    );
    expect(run0?.results[0]?.properties?.guidance).toEqual(GUIDANCE);
    expect(run0?.tool.driver.rules).toEqual([
      expect.objectContaining({ id: "dcmi:elements:1.1/pattern", helpUri: G }),
    ]);
  });

  it("junit puts the two lines in the failure body", () => {
    const r = run([...DCMI, "-f", "junit"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      `<failure type="dcmi:elements:1.1/pattern" message="/date must match pattern &quot;${P}&quot; (line 3)">dcmi:elements:1.1 date: ${D}\nGuide: ${G}</failure>`,
    );
    expect(r.stdout.match(/<failure /g)).toHaveLength(1);
  });

  it("names the wrapper entries of a 4.13.0 baseline as stale and keeps exit 0", () => {
    const r = run([
      "meta",
      "validate",
      FILE,
      "test/fixtures/guidance/evals-bad-entry.md",
      "-s",
      "dcmi:elements:1.1",
      "-s",
      "manni:evals:1.0.0",
      "--no-config",
      "--baseline",
      "test/fixtures/guidance/baseline-4.13.json",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("2 no longer occur — run --write-baseline to prune");
  });
});

describe("manni meta schemas show, the ladder (built bin)", () => {
  const GUIDANCE = resolve(here, "fixtures", "guidance");

  beforeAll(() => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180000);

  it("1. prints a built-in's outline", () => {
    const r = run(["meta", "schemas", "show", "manni:core:1.0.0"]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("manni:core:1.0.0  manni core vocabulary v1.0.0");
    expect(r.stdout).toContain("Guide: https://hawkeyexl.github.io/manni/meta/reference/schemas/manni-core/");
    expect(r.stdout).toContain("  title  required, string, minLength 1");
  });

  it("2. answers a published URL as the id, with no request", () => {
    const url = run(["meta", "schemas", "show", "https://hawkeyexl.github.io/manni/schemas/dcmi/1.1.json"]);
    const id = run(["meta", "schemas", "show", "dcmi:elements:1.1"]);
    expect(url.status).toBe(0);
    expect(url.stdout).toBe(id.stdout);
  });

  it("3. resolves a registered id through the discovered config, with no Guide line", () => {
    const r = run(["meta", "schemas", "show", "house:page:1.0.0"], GUIDANCE);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("house:page:1.0.0  House page");
    expect(r.stdout).not.toContain("Guide:");
  });

  it("4. prints a schema file as loaded with -f json", () => {
    const r = run(["meta", "schemas", "show", "./house.schema.json", "-f", "json"], GUIDANCE);
    expect(r.status).toBe(0);
    expect((JSON.parse(r.stdout) as { $id: string }).$id).toBe("house:page:1.0.0");
  });

  it("5. writes a frontmatter skeleton with -f markdown", () => {
    const r = run(["meta", "schemas", "show", "manni:core:1.0.0", "-f", "markdown"]);
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines).toContain("title:");
    expect(lines).toContain("description:");
    expect(lines).toContain("# id:");
    expect(lines.at(-2)).toBe("---");
  });

  it("6. takes every option at once", () => {
    const r = run([
      "meta",
      "schemas",
      "show",
      "house:page:1.0.0",
      "-c",
      "test/fixtures/guidance/manni.config.yaml",
      "-f",
      "markdown",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[1]).toBe("# house:page:1.0.0, House page");
  });

  it.each([
    [["meta", "schemas", "show"], "error: missing required argument 'ref'"],
    [
      ["meta", "schemas", "show", "manni:core:1.0.0", "-f", "yaml"],
      'manni: Unknown --format "yaml". Use pretty, json, or markdown.',
    ],
    [
      ["meta", "schemas", "show", "manni:core:9.9.9"],
      'manni: Unknown schema "manni:core:9.9.9". manni meta schemas lists the built-in ids. Registered by meta.register: none.',
    ],
    [["meta", "schemas", "show", "./schemas/nope.json"], 'manni: Schema file not found: "./schemas/nope.json".'],
  ])("usage error: %j", (args, stderr) => {
    // From the repository root, whose config registers no schema.
    const r = run(args);
    expect(r.status).toBe(2);
    // The first line; commander follows its own errors with a help hint.
    expect(r.stderr.split("\n")[0]).toBe(stderr);
  });
});
