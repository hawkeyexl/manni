/**
 * The one test that starts a real DITA Open Toolkit.
 *
 * Every other `dita-ot` test injects a stub and reads a captured log, so the
 * suite needs no JVM. That is the right default and it has one blind spot: a
 * capture can only prove the parser reads what DITA-OT once wrote. It cannot
 * notice that we are invoking the wrong command.
 *
 * Which is exactly what happened. This tool shipped its first implementation
 * against `dita validate`, on the strength of release notes calling that
 * subcommand "ideal for continuous integration scenarios". Run against a map
 * whose topic conrefs an id that does not exist, `dita validate` exits 0 and
 * prints nothing: it checks grammar and resolves no references. Every stubbed
 * test passed the whole time, because a stub answers the question it was given.
 *
 * So this test exists to pin the *invocation*, not the parsing. If someone
 * changes the arguments in `runDitaOtValidate` to something that no longer
 * reports a broken conref, nothing else in the suite will notice.
 *
 * It is skipped unless a DITA-OT is actually reachable, because most machines
 * and most CI runners have no Java. Point `DITA_HOME` at an installation to
 * run it, or put `dita` on `PATH`.
 */
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ditaOtCommandLine,
  ditaOtLauncher,
  runDitaOtValidate,
} from "../../../src/lint/tools/dita-ot.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "..", "fixtures", "dita-ot");

/**
 * `DITA_HOME` if it names one, else the `dita` on `PATH`, else nothing.
 *
 * Resolved once at module load: whether a JVM is present does not change
 * partway through a run, and probing per test would cost a process each time.
 */
function reachableHome(): string | undefined | null {
  const home = process.env["DITA_HOME"];
  if (home !== undefined && home.trim() !== "") return home;
  return null;
}

const home = reachableHome();

/**
 * Whether the launcher this home implies can actually be started.
 *
 * Through `ditaOtCommandLine`, the same way the tool starts it. Reaching for
 * `shell: true` here would be both a security smell the production path has a
 * comment refusing, and a probe that tests a code path nothing else uses.
 */
async function launcherRuns(): Promise<boolean> {
  const line = ditaOtCommandLine(ditaOtLauncher(home ?? undefined), [
    "--version",
  ]);
  return new Promise((settle) => {
    execFile(
      line.command,
      line.argv,
      { windowsHide: true, windowsVerbatimArguments: line.verbatim },
      (error) => {
        settle(error === null);
      },
    );
  });
}

const available = await launcherRuns();

describe.skipIf(!available)("dita-ot, against the real toolkit", () => {
  // A JVM start plus the preprocessing chain. Nowhere near vitest's default.
  const TIMEOUT = 300_000;

  it(
    "reports a broken conref, which is the reason this tool exists",
    async () => {
      const results = await runDitaOtValidate({
        targets: [join(fixtures, "broken-conref.ditamap")],
        cwd: fixtures,
        home: home ?? undefined,
      });

      expect(results).toHaveLength(1);
      const messages = results[0]?.messages ?? [];
      const conref = messages.find((m) => m.code === "DOTX010E");

      // The assertion that `dita validate` could never satisfy.
      expect(conref, `no DOTX010E among: ${messages.map((m) => m.code).join(", ")}`).toBeDefined();
      expect(conref?.severity).toBe("error");
      // `row` is the column, and the fixture's conref sits at 10:59.
      expect(conref?.line).toBe(10);
      expect(conref?.column).toBe(59);
      expect(conref?.file).toMatch(/broken-conref\.dita$/);
    },
    TIMEOUT,
  );

  it(
    "finds nothing in a map whose references all resolve",
    async () => {
      const results = await runDitaOtValidate({
        targets: [join(fixtures, "clean.ditamap")],
        cwd: fixtures,
        home: home ?? undefined,
      });

      // The other half of the property: the `code` filter drops a full verbose
      // log without inventing a finding from it.
      expect(results[0]?.messages ?? []).toEqual([]);
    },
    TIMEOUT,
  );
});
