/**
 * The structure-tool descriptor table.
 *
 * The table is deliberately not a unified `run()` interface: the tools that
 * can perform the structure job take completely different inputs, so what they
 * share is what the *command* needs to know before it dispatches - the formats
 * to list, the extensions to walk, whether the tool is here, and which options
 * belong to it. `src/shared/tools.ts` records the same reasoning for `tools:`.
 *
 * manni's descriptor must answer exactly what the command answered before the
 * seam existed, which is what most of these pin.
 */
import { describe, expect, it } from "vitest";
import pkg from "../../../package.json" with { type: "json" };
import {
  registerStructureTool,
  resolveStructureTool,
  structureTool,
  structureTools,
  type StructureToolDescriptor,
} from "../../../src/lint/tools/index.js";
import {
  isLintTool,
  LINT_TOOLS,
  TOOLS_BY_JOB,
} from "../../../src/lint/core/config.js";
import {
  listFormats,
  supportedExtensions,
} from "../../../src/lint/parsers/index.js";
import { LintError } from "../../../src/lint/types.js";
import { defined } from "../helpers.js";

describe("the registry and the tool union agree", () => {
  // Two lists of the same thing drift, and this one drifts silently: a tool in
  // `LINT_TOOLS` with no descriptor is a `--tool` value the config validates
  // and the run cannot dispatch, and a descriptor nothing names is dead code.
  it("carries a descriptor for every tool the config accepts", () => {
    for (const name of LINT_TOOLS) {
      expect(defined(structureTool(name), `descriptor for ${name}`).name).toBe(
        name,
      );
    }
  });

  it("names only tools the config accepts", () => {
    for (const descriptor of structureTools()) {
      expect(isLintTool(descriptor.name)).toBe(true);
    }
  });

  it("refuses a name it does not carry, listing the ones it does", () => {
    expect(() => resolveStructureTool("vale")).toThrow(LintError);
    expect(() => resolveStructureTool("vale")).toThrow(
      `Unknown --tool "vale" for structure. Use ${TOOLS_BY_JOB.structure.join(", ")}.`,
    );
  });
});

describe("the manni descriptor", () => {
  const manni = defined(structureTool("manni"), "manni descriptor");

  it("lists the parser registry's formats", () => {
    expect(manni.formats()).toEqual(listFormats());
  });

  // The walk default was read off `supportedExtensions()` directly, which is
  // manni's parser registry. Routing it through the descriptor is what lets a
  // tool with its own input formats walk for those instead.
  it("walks the extensions the parser registry claims", () => {
    expect(manni.walkExtensions()).toEqual(supportedExtensions());
  });

  it("probes as available at this package's version", async () => {
    await expect(manni.probe({ cwd: process.cwd() })).resolves.toEqual({
      available: true,
      version: pkg.version,
    });
  });

  it("owns the options that only its engine reads", () => {
    expect([...manni.ownedOptions].sort()).toEqual(
      ["-", "--as", "--explain", "--template", "--templates"].sort(),
    );
  });
});

describe("registering a descriptor", () => {
  // The registry is mutable so a test can stand a second tool up without
  // adding a name to `LINT_TOOLS` - a name there is a `--tool` value the CLI
  // accepts, and accepting one for a tool that does not exist is the silent
  // green this whole seam exists to prevent.
  it("is reversible", () => {
    const before = structureTools().length;
    const throwaway: StructureToolDescriptor = {
      // `LINT_TOOLS` carries `manni` alone, so the name is asserted rather
      // than added to the union. The assertion stays in the test.
      name: "throwaway" as unknown as StructureToolDescriptor["name"],
      label: "Throwaway",
      formats: () => [],
      walkExtensions: () => [".md"],
      probe: () => Promise.resolve({ available: false, version: null }),
      ownedOptions: [],
    };

    const unregister = registerStructureTool(throwaway);
    expect(structureTools()).toHaveLength(before + 1);
    expect(structureTool("throwaway")).toBe(throwaway);

    unregister();
    expect(structureTools()).toHaveLength(before);
    expect(structureTool("throwaway")).toBeUndefined();
  });
});
