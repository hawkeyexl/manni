/**
 * `x-manni-encrypt` through the built `manni` bin (proposal 0045): the
 * `encrypted:plain` finding in SARIF, and the refusal a write gives off a
 * terminal when it needs a key and none is available.
 *
 * `spawnSync` with piped stdio is exactly "off a terminal", so the CLI's
 * `terminalConfirm()` is `undefined` here and no question is ever put. The
 * child's `MANNI_ENCRYPTION_KEY` is set empty, which counts as unset: the
 * developer's own key is never read.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnText } from "./helpers/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const manni = resolve(root, "dist", "cli.js");
const fixtures = join(here, "fixtures", "encrypted");

let dir: string;

beforeAll(() => {
  if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
}, 180000);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "manni-encrypted-bin-"));
  writeFileSync(join(dir, "encrypted.schema.json"), readFileSync(join(fixtures, "encrypted.schema.json")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnText(
    spawnSync("node", [manni, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", MANNI_ENCRYPTION_KEY: "" },
    }),
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

describe("x-manni-encrypt (built bin)", () => {
  it("files encrypted:plain/encrypted in -f sarif, exit 1", () => {
    writeFileSync(join(dir, "auth.md"), readFileSync(join(fixtures, "plain-owner.md")));
    const r = run([
      "meta", "validate", "auth.md", "-s", "encrypted.schema.json", "--no-config", "-f", "sarif",
    ]);
    expect(r.status).toBe(1);
    const sarif = JSON.parse(r.stdout) as {
      runs: {
        results: { ruleId: string; message: { text: string } }[];
        tool: { driver: { rules?: { id: string }[] } };
      }[];
    };
    const [first] = sarif.runs;
    expect(first?.results.map((x) => x.ruleId)).toEqual(["encrypted:plain/encrypted"]);
    expect(first?.results[0]?.message.text).toContain(
      "/owner holds a plain value; its schema marks it x-manni-encrypt.",
    );
  });

  it("refuses a fill that needs a key, off a terminal, before any model request", () => {
    writeFileSync(join(dir, "auth.md"), "---\ntitle: Auth\n---\n\n# Auth\n");
    const before = readFileSync(join(dir, "auth.md"), "utf8");
    const r = run([
      "meta", "fill", "auth.md", "-s", "encrypted.schema.json", "--no-config",
      "--fields", "owner", "--provider", "mock", "--no-cache",
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(
      "manni: /owner must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.",
    );
    // No question is put off a terminal, and nothing is written.
    expect(r.stderr).not.toContain("Generate a key");
    expect(readFileSync(join(dir, "auth.md"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "manni.config.yaml"))).toBe(false);
  });
});
