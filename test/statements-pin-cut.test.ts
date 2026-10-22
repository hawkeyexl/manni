/**
 * A statement's pin ignores every statement inside its lines (proposal 0101):
 * each one is cut out before hashing, a `<data>` carrier whole, and a line
 * the cut leaves blank is dropped. So a tool writing into a nested statement,
 * or a statement moved onto or off its own line, never changes a pin.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDerive } from "../src/meta/commands/derive.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { pinOf, pinStatements, readStatements, type PageStatement } from "../src/meta/core/statements.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The statement whose payload holds `needle`. */
function statementWith(content: string, needle: string): PageStatement | undefined {
  return readStatements(content, "xml").statements.find((s) => s.token.payload.includes(needle));
}

describe("a <steps> statement over a step statement", () => {
  /** nested.dita, unpinned, copied where derive may write it. */
  function copy(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-pin-cut-")));
    dirs.push(dir);
    copyFileSync(resolve(root, "test/fixtures/statements/dita/nested.dita"), join(dir, "install.dita"));
    return dir;
  }

  async function statementRules(dir: string): Promise<string[]> {
    const { results } = await runValidate({ inputs: ["install.dita"], cwd: dir, noConfig: true });
    return (results[0]?.errors ?? []).filter((e) => e.statement !== undefined).map((e) => `${e.keyword} ${String(e.line)}`);
  }

  it("stays current once derive pins both, and after the step statement is rewritten", async () => {
    const dir = copy();
    const page = join(dir, "install.dita");
    await runDerive({ inputs: ["install.dita"], cwd: dir, noConfig: true, sources: ["git"] });
    const pinned = readFileSync(page, "utf8");
    expect(readStatements(pinned, "xml").statements.map((s) => s.status)).toEqual(["current", "current"]);
    expect(await statementRules(dir)).toEqual([]);

    // A verifier's pass: new keys in the step statement, its pin kept.
    writeFileSync(
      page,
      pinned.replace(
        '{"verified-by":[{"tool":"doc-detective","check":"install"}]}',
        '{"verified-by":[{"tool":"doc-detective","check":"install","version":"4.27.0","passed":"2026-10-22"}],"last-verified":"2026-10-22"}',
      ),
    );
    expect(await statementRules(dir)).toEqual([]);
    expect(statementWith(readFileSync(page, "utf8"), "applies-to")?.status).toBe("current");
  });

  it("stays current while the step statement loses and regains its pin", async () => {
    const dir = copy();
    const page = join(dir, "install.dita");
    await runDerive({ inputs: ["install.dita"], cwd: dir, noConfig: true, sources: ["git"] });
    const pinned = readFileSync(page, "utf8");
    const inner = statementWith(pinned, "verified-by")?.pin ?? "";
    writeFileSync(page, pinned.replace(`${inner} `, ""));
    expect(statementWith(readFileSync(page, "utf8"), "applies-to")?.status).toBe("current");
    await runDerive({ inputs: ["install.dita"], cwd: dir, noConfig: true, sources: ["git"] });
    expect(readFileSync(page, "utf8")).toBe(pinned);
    expect(await statementRules(dir)).toEqual([]);
  });
});

describe("a <data> carrier inside an anchor", () => {
  const page = (carrier: string): string =>
    [
      "<steps>",
      "  <step>",
      '    <?manni meta {"concepts":["install"]}?>',
      "    <cmd>Run it.</cmd>",
      `    <info>${carrier}More.</info>`,
      "  </step>",
      "</steps>",
      "",
    ].join("\n");
  const value = `value='{"concepts":["a"]}'`;

  it.each([
    ["self-closing", `<data name="manni-meta" ${value}/>`],
    ["with an end tag", `<data name="manni-meta" ${value}></data>`],
    ["whose start tag spans two lines", `<data name="manni-meta"\n      ${value}/>`],
  ])("is cut whole when it is %s", (_, carrier) => {
    const pinned = pinStatements(page(carrier), "xml").content;
    expect(readStatements(pinned, "xml").statements.map((s) => s.status)).toEqual(["current", "current"]);
    // The step's pin is the pin of the same step with no carrier in it.
    const bare = pinStatements(page(""), "xml").content;
    expect(statementWith(pinned, "install")?.pin).toBe(statementWith(bare, "install")?.pin);
    // The carrier's own pin covers its element with the carrier cut out.
    expect(statementWith(pinned, '"a"')?.pin).toBe(pinOf(["    <info>More.</info>"]));
  });
});

describe("a first-child statement", () => {
  const STEP = '<?manni meta {"concepts":["install"]}?>';
  const onTagLine = ["<steps>", `  <step>${STEP}`, "    <cmd>Run it.</cmd>", "  </step>", "</steps>", ""].join("\n");
  const ownLine = ["<steps>", "  <step>", `    ${STEP}`, "    <cmd>Run it.</cmd>", "  </step>", "</steps>", ""].join("\n");
  const pinIn = (content: string): string | undefined =>
    statementWith(pinStatements(content, "xml").content, "install")?.pin;

  it("pins the same on its start tag's line and on its own line", () => {
    expect(pinIn(ownLine)).toBe(pinIn(onTagLine));
    expect(pinIn(ownLine)).toBe(pinOf(["  <step>", "    <cmd>Run it.</cmd>", "  </step>"]));
  });

  it("still hashes a line that was blank before the cut", () => {
    const blank = ownLine.replace("    <cmd>Run it.</cmd>\n", "    <cmd>Run it.</cmd>\n\n");
    expect(pinIn(blank)).toBe(pinOf(["  <step>", "    <cmd>Run it.</cmd>", "", "  </step>"]));
  });
});
