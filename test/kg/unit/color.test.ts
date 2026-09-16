/**
 * `manni kg --no-color` (resolution).
 *
 * Colour only happens on a TTY, which a spawned bin never is, so the
 * resolution is tested in-process: parse through commander's real routing
 * with `check`'s action swapped for a no-op, then ask `colorFor` about the
 * command the action would have received, with `isTTY` forced on. The same
 * shape cite's `--no-color` test has, because the decision is the family's
 * (`shouldColor` in src/shared/color.ts) and not this domain's.
 */
import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { buildProgram as buildUmbrella } from "../../../src/cli.js";
import { buildProgram as buildKg, colorFor } from "../../../src/kg/cli.js";

function find(parent: Command, name: string): Command {
  const found = parent.commands.find((c) => c.name() === name);
  if (found === undefined) {
    throw new Error(`no ${name} command under ${parent.name()}`);
  }
  return found;
}

async function parsedCheck(
  program: Command,
  check: Command,
  argv: string[],
): Promise<Command> {
  check.action(() => undefined);
  await program.parseAsync(argv);
  return check;
}

const umbrellaCheck = (args: string[]): Promise<Command> => {
  const program = buildUmbrella();
  return parsedCheck(program, find(find(program, "kg"), "check"), [
    "node",
    "manni",
    "kg",
    ...args,
  ]);
};

const standaloneCheck = (args: string[]): Promise<Command> => {
  const program = buildKg();
  return parsedCheck(program, find(program, "check"), ["node", "kg", ...args]);
};

describe("manni kg --no-color", () => {
  it("colours a TTY when nothing turns it off (the control)", async () => {
    expect(colorFor(await umbrellaCheck(["check"]), true, {})).toBe(true);
    expect(colorFor(await standaloneCheck(["check"]), true, {})).toBe(true);
  });

  it("under the umbrella, --no-color before the verb turns colour off", async () => {
    expect(colorFor(await umbrellaCheck(["--no-color", "check"]), true, {})).toBe(
      false,
    );
  });

  it("under the umbrella, --no-color after the verb turns colour off", async () => {
    expect(colorFor(await umbrellaCheck(["check", "--no-color"]), true, {})).toBe(
      false,
    );
  });

  it("the standalone kg program honours --no-color the same way", async () => {
    expect(
      colorFor(await standaloneCheck(["--no-color", "check"]), true, {}),
    ).toBe(false);
  });

  it("NO_COLOR and a non-TTY still turn colour off", async () => {
    const check = await umbrellaCheck(["check"]);
    expect(colorFor(check, true, { NO_COLOR: "1" })).toBe(false);
    expect(colorFor(check, undefined, {})).toBe(false);
  });
});
