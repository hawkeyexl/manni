/** Flare targets (proposal 0125, decision 11): a condition expression and variable overrides. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { includes } from "../../../src/shared/flare/conditions.js";
import { readTarget } from "../../../src/shared/flare/target.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "flare");
const TARGETS = join(FIXTURES, "project", "Project", "Targets");

describe("readTarget", () => {
  it("reads the name, expression and slash-named variable overrides", () => {
    const file = join(TARGETS, "HTML5.fltar");
    const target = readTarget(file);
    expect(target.name).toBe("HTML5");
    expect(target.file).toBe(file);
    expect(target.variables).toEqual(new Map([["General.ProductVersion", "4.3"]]));
    expect(includes(target.expression, ["Default.PrintOnly"])).toBe(false);
    // The root's own conditions= tags the file, not the content.
    expect(includes(target.expression, ["Default.ScreenOnly"])).toBe(true);
  });

  it("reads an include-only target", () => {
    const target = readTarget(join(TARGETS, "Print.fltar"));
    expect(target.name).toBe("Print");
    expect(target.variables.size).toBe(0);
    expect(includes(target.expression, ["Default.PrintOnly"])).toBe(true);
    expect(includes(target.expression, ["Default.ScreenOnly"])).toBe(false);
  });

  it("reads an empty expression as none", () => {
    const target = readTarget(
      join(FIXTURES, "one-target", "Project", "Targets", "Web", "Online.fltar"),
    );
    expect(target.name).toBe("Online");
    expect(target.expression).toBeUndefined();
  });
});
