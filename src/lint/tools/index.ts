/**
 * The tools that can perform a lint job, one descriptor each.
 *
 * Deliberately **not** a unified `run()` interface. The tools take completely
 * different inputs: manni's engine needs the templates, the doctype index and
 * the parser registry, and a tool outside the package needs none of them. A
 * lowest-common-denominator `run(files, options)` would either lie about what
 * it accepts or grow a passthrough blob nobody can type. `src/shared/tools.ts`
 * records the same decision for `tools:`, and for the same reason.
 *
 * What the tools genuinely share is what the *command* has to know before it
 * dispatches: the formats to list, the extensions a directory walk collects,
 * whether the tool can run here, and which options belong to the tool rather
 * than to the job. That is this table, and nothing more. Running a tool stays
 * with the branch that runs it.
 */
import pkg from "../../../package.json" with { type: "json" };
import { listFormats, supportedExtensions } from "../parsers/index.js";
import type { FormatInfo } from "../commands/tools.js";
import { TOOLS_BY_JOB, type LintTool } from "../core/config.js";
import type { ToolsConfig } from "../../shared/tools.js";
import { LintError } from "../types.js";
import { ditaOt } from "./dita-ot.js";

/** What a probe is allowed to look at. A tool outside the package shells out. */
export interface ToolProbeContext {
  /** The directory the run resolves from. */
  cwd: string;
  /**
   * The family's top-level `tools:`, when a config declared one.
   *
   * A tool outside the package is found where its own `tools.<tool>` says it
   * is, so a probe that could not read it would report "not available" over an
   * installation the run itself goes on to use. manni's own probe ignores it.
   */
  tools?: ToolsConfig;
  /** The directory the config that declared `tools:` sits in. */
  configDir?: string;
}

/** Whether a tool can run here, and at what version. */
export interface ToolProbe {
  available: boolean;
  /** The version the tool reported, or null when it reported none. */
  version: string | null;
}

export interface StructureToolDescriptor {
  name: LintTool;
  label: string;
  /** Formats for `manni lint tools`' formats column. */
  formats: () => FormatInfo[];
  /** Extensions a directory walk collects when this tool runs. */
  walkExtensions: () => string[];
  /** Whether this tool can run here, and at what version. */
  probe: (ctx: ToolProbeContext) => Promise<ToolProbe>;
  /**
   * Options that belong to this tool alone, spelled as a user types them.
   *
   * `-` is in the list because stdin is one of them: a tool that reads a
   * document off a pipe is answering the same question as one that reads
   * `--template`, and deriving both from one list is what keeps the next tool
   * from having to remember to refuse either.
   */
  ownedOptions: readonly string[];
}

/**
 * manni's own engine, which ships in this package.
 *
 * `formats` and `walkExtensions` forward to the parser registry rather than
 * restating it: a format added there is listed and walked here the moment it
 * is registered, which is the property `parsers/index.ts` exists to have.
 */
const manni: StructureToolDescriptor = {
  name: "manni",
  label: "manni's own structure engine",
  formats: () => listFormats(),
  walkExtensions: () => supportedExtensions(),
  // Nothing to look for: the engine is this package, so it is available
  // wherever the CLI is. A tool that shells out answers this by looking.
  probe: () => Promise.resolve({ available: true, version: pkg.version }),
  // `-` is stdin, and it is in this list so the derivation in `lint.ts` has
  // one place to learn that manni owns it. The refusal itself is not shaped
  // like the others, because "option" is the wrong word for a positional:
  // `assertOptionsOwned` special-cases it to say "cannot read stdin" instead.
  // A tool that copies this list without reading that guard gets the right
  // ownership and the wrong sentence.
  ownedOptions: ["--template", "--templates", "--explain", "--as", "-"],
};

/**
 * Registered statically rather than through `registerStructureTool` at import
 * time, so the table and `LINT_TOOLS` agree whatever order the modules load
 * in: a name in `LINT_TOOLS` with no descriptor is a `--tool` value the config
 * validates and the run cannot dispatch.
 */
const descriptors = new Map<string, StructureToolDescriptor>([
  [manni.name, manni],
  [ditaOt.name, ditaOt],
]);

/**
 * Add a descriptor, and hand back the undo.
 *
 * The registry is mutable so a second tool can be stood up without a name
 * being added to `LINT_TOOLS` first. A name there is a `--tool` value the CLI
 * accepts and the config validates, so adding one for a tool that cannot run
 * is the silent green this seam exists to prevent.
 */
export function registerStructureTool(
  descriptor: StructureToolDescriptor,
): () => void {
  const previous = descriptors.get(descriptor.name);
  descriptors.set(descriptor.name, descriptor);
  return () => {
    if (previous === undefined) descriptors.delete(descriptor.name);
    else descriptors.set(descriptor.name, previous);
  };
}

/** The descriptor registered under `name`, if there is one. */
export function structureTool(
  name: string,
): StructureToolDescriptor | undefined {
  return descriptors.get(name);
}

/** Every registered descriptor, in registration order. */
export function structureTools(): StructureToolDescriptor[] {
  return [...descriptors.values()];
}

/**
 * The descriptor for a named tool, or the refusal a user reads.
 *
 * The message is the one the CLI's own `--tool` guard produced before the
 * registry existed, because `runLint` is exported from `src/index.ts` and
 * called in process: a caller that never touches commander owes the same
 * sentence.
 */
export function resolveStructureTool(name: string): StructureToolDescriptor {
  const descriptor = descriptors.get(name);
  if (descriptor) return descriptor;
  throw new LintError(
    `Unknown --tool "${name}" for structure. Use ${TOOLS_BY_JOB.structure.join(", ")}.`,
  );
}
