/**
 * validate's offer to move misplaced values (proposal 0047, prompt P2).
 *
 * After the report is printed, on a terminal, each collection with an
 * unsuppressed `location:external` or `location:page` finding gets one
 * question. A yes runs relocate for the files and keys of those findings (a
 * `keys:` change still reaches every member page, as relocate's does) and
 * prints relocate's pretty output. A no does nothing: the findings already
 * said it.
 *
 * Everything the user reads goes to `output`, which the CLI makes stderr so
 * the report on stdout stays machine-readable. The exit code is never this
 * module's to change: it is the report's.
 *
 * No question is put without a `Confirm` (off a terminal, or a run reading
 * stdin), under `--no-config`, for stdin's own findings, or for a page with no
 * possible home. A baselined finding never reaches here, so a baseline is how
 * someone stops being asked.
 */
import type { Confirm } from "../../shared/prompt.js";
import { programName } from "../../shared/program-name.js";
import { resolveRunConfig } from "../core/config.js";
import { STDIN_LABEL } from "../core/load-files.js";
import { LOCATION_EXTERNAL_SCHEMA, LOCATION_PAGE_SCHEMA } from "../core/location.js";
import {
  applyRelocation,
  keyHome,
  offerPrompt,
  planRelocation,
  relocationContext,
  type RelocateResult,
  type RelocationContext,
} from "../core/relocation.js";
import { collectSchemaPins } from "../core/resolve-schema.js";
import { schemaLoadOptions } from "../core/schema-registry.js";
import { Validator } from "../core/validator.js";
import { renderRelocatePretty } from "../reporters/relocate.js";
import { DocmetaError, type ValidationResult } from "../types.js";

export interface ValidateOfferOptions {
  /** The results as reported: after the baseline, so a suppressed finding is not offered. */
  results: readonly ValidationResult[];
  /** The run's inputs as validate got them, for the config and a created collection's `paths:`. */
  inputs: string[];
  cwd?: string;
  configPath?: string;
  noConfig?: boolean;
  collections?: string[];
  cliSchemas?: string[];
  as?: string;
  respectGitignore?: boolean;
  offline?: boolean;
  env?: NodeJS.ProcessEnv;
  /** The terminal's `Confirm`; absent means no question is put. */
  confirm?: Confirm;
  /** Where the notice and relocate's output go: stderr, from the CLI. */
  output: { write: (chunk: string) => unknown };
  color?: boolean;
}

/** The files and keys of one collection's findings. */
interface Group {
  files: Set<string>;
  keys: Set<string>;
}

/**
 * Put P2 once per collection with a location finding, and run relocate for
 * each yes. Returns the applied results, in the order they ran.
 */
export async function offerRelocation(opts: ValidateOfferOptions): Promise<RelocateResult[]> {
  const { confirm, output } = opts;
  if (confirm === undefined || opts.noConfig === true) return [];
  const findings = opts.results.flatMap((r) =>
    r.file === STDIN_LABEL
      ? []
      : r.errors
          .filter((e) => e.schema === LOCATION_EXTERNAL_SCHEMA || e.schema === LOCATION_PAGE_SCHEMA)
          .flatMap((e) => (e.subject === undefined ? [] : [{ file: r.file, key: e.subject, schema: e.schema }])),
  );
  if (findings.length === 0) return [];

  const cwd = opts.cwd ?? process.cwd();
  const run = await resolveRunConfig({
    cwd,
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    inputs: opts.inputs,
    ...(opts.collections !== undefined ? { collections: opts.collections } : {}),
  });
  const validator = new Validator(
    schemaLoadOptions({
      root: run.configDir ?? cwd,
      fileBase: cwd,
      ttlHours: run.config?.schemaCache?.ttlHours,
      offline: opts.offline ?? run.config?.offline,
      pins: collectSchemaPins(run.config),
    }),
  );
  const ctx: RelocationContext = relocationContext(run, {
    cwd,
    targets: run.fromCollections ? [] : opts.inputs,
    validator,
    ...(opts.cliSchemas !== undefined && opts.cliSchemas.length > 0 ? { cliSchemas: opts.cliSchemas } : {}),
    ...(opts.as !== undefined ? { as: opts.as } : {}),
    ...(opts.respectGitignore !== undefined ? { respectGitignore: opts.respectGitignore } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
  });

  // The collection each finding's value would move within: the one whose
  // manifest holds a `location:page` value, or the home §3 picks for a
  // `location:external` one. A page with no possible home is not offered.
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const home = keyHome(ctx, f.file, {}, f.key);
    let collection: string | undefined;
    if (f.schema === LOCATION_PAGE_SCHEMA) {
      if (home.kind === "manifest") collection = home.collection;
    } else if (home.kind === "unowned" && home.home.kind === "collection") {
      collection = home.home.collection;
    }
    if (collection === undefined) continue;
    const group = groups.get(collection) ?? { files: new Set<string>(), keys: new Set<string>() };
    group.files.add(f.file);
    group.keys.add(f.key);
    groups.set(collection, group);
  }

  const applied: RelocateResult[] = [];
  const say = (message: string): void => {
    output.write(`${programName()}: ${message}\n`);
  };
  for (const [collection, group] of groups) {
    let plan;
    try {
      plan = await planRelocation(ctx, { files: [...group.files], fields: [...group.keys] });
    } catch (err) {
      // A plan that cannot be made (a manifest path that exists undeclared, a
      // single-tool config) is reported and not offered. The report already
      // stands, and its exit code is not this offer's to change.
      if (!(err instanceof DocmetaError)) throw err;
      say(err.message);
      continue;
    }
    if (plan.writes.length === 0) continue;
    // Only this collection's offer: another's would word changes this question does not cover.
    const offer = plan.offers.find((o) => o.collection === collection);
    if (offer === undefined) continue;
    const { notice, question } = offerPrompt(offer, "validate");
    say(notice);
    if (!(await confirm(question))) continue;
    const result = await applyRelocation(ctx, plan);
    output.write(`${renderRelocatePretty(result, { color: opts.color ?? false })}\n`);
    applied.push(result);
  }
  return applied;
}
