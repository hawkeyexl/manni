/**
 * Flare variable sets (proposal 0125, decision 12): the first definition is
 * the default, definitions resolve nested references, and a date and time
 * variable keeps its reference because a run reads no clock.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readVariableSets,
  resolveText,
  resolveVariable,
} from "../../../src/shared/flare/variables.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "flare");
const sets = readVariableSets(join(FIXTURES, "project"));

describe("resolveVariable", () => {
  it("takes the first definition, not EvaluatedDefinition", () => {
    expect(resolveVariable(sets, "General.ProductVersion")).toBe("4.2");
    expect(resolveVariable(sets, "General.Company")).toBe("MadCap");
  });

  it("resolves a definition that names another variable", () => {
    expect(resolveVariable(sets, "General.Copyright")).toBe("MadCap 2026");
  });

  it("leaves a cycle's reference in place", () => {
    expect(resolveVariable(sets, "General.A")).toBe("[%=General.A%]");
    expect(resolveVariable(sets, "General.B")).toBe("[%=General.B%]");
  });

  it("leaves a date and time variable unresolved", () => {
    expect(resolveVariable(sets, "General.Yr")).toBeUndefined();
  });

  it("lets an override win over the set, and resolves through it", () => {
    const version = new Map([["General.ProductVersion", "4.3"]]);
    expect(resolveVariable(sets, "General.ProductVersion", version)).toBe("4.3");
    const company = new Map([["General.Company", "Acme"]]);
    expect(resolveVariable(sets, "General.Copyright", company)).toBe("Acme 2026");
  });

  it("is undefined for a name no set defines, and for System variables", () => {
    expect(resolveVariable(sets, "General.Missing")).toBeUndefined();
    expect(resolveVariable(sets, "Other.ProductVersion")).toBeUndefined();
    expect(resolveVariable(sets, "System.Title")).toBeUndefined();
  });
});

describe("resolveText", () => {
  it("replaces every reference it can resolve and keeps the rest", () => {
    expect(
      resolveText(
        sets,
        "v[%=General.ProductVersion%] by [%=General.Company%], [%=General.Yr%] [%=System.Title%]",
      ),
    ).toBe("v4.2 by MadCap, [%=General.Yr%] [%=System.Title%]");
  });

  it("applies overrides", () => {
    const company = new Map([["General.Company", "Acme"]]);
    expect(resolveText(sets, "[%=General.Copyright%]", company)).toBe("Acme 2026");
  });
});

describe("readVariableSets", () => {
  it("reads nothing from a project with no variable sets", () => {
    const empty = readVariableSets(join(FIXTURES, "one-target"));
    expect(empty.size).toBe(0);
    expect(resolveVariable(empty, "General.ProductVersion")).toBeUndefined();
  });
});
