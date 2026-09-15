/**
 * `relocate` (proposal 0047): move every value to where its schema's
 * `x-manni-location` mark and the config's manifests say it belongs.
 *
 * Out of the page and into a manifest go the values a schema prefers in
 * external metadata and the values a manifest already owns. Out of a manifest
 * and into the page go the values a schema prefers on the page. The
 * collection, manifest file and config entry a value needs are created on the
 * way, and a change to a manifest's `keys:` covers every member page of its
 * collection. The planning and writing live in `core/relocation.ts`, which the
 * writers' and validate's offers share; this is the command around it.
 *
 * Two refusals come before the config is read, because each rules out the
 * whole run: stdin, which is not a document a manifest can name, and
 * `--no-config`, which leaves nowhere to declare a manifest.
 */
import { resolveRunConfig, type ConfigNotice } from "../core/config.js";
import { memberOf, retainMembers } from "../core/collections.js";
import { assertNonEmpty, gitignoreOptions, resolveTargetSet, STDIN_TOKEN } from "../core/load-files.js";
import { collectSchemaPins } from "../core/resolve-schema.js";
import { schemaLoadOptions } from "../core/schema-registry.js";
import { Validator } from "../core/validator.js";
import { extractorByName, listFormats } from "../extractors/index.js";
import { DocmetaError } from "../types.js";
import {
  applyRelocation,
  planRelocation,
  relocationContext,
  type RelocateResult,
} from "../core/relocation.js";

export type {
  RelocateConfigResult,
  RelocateFileResult,
  RelocateManifestResult,
  RelocateMove,
  RelocateMoveReason,
  RelocateResult,
  RelocateStay,
  RelocateStayReason,
  RelocateSummary,
} from "../core/relocation.js";
export { relocateFailed } from "../core/relocation.js";

export interface RelocateOptions {
  /** Files, directories and globs. Empty falls back to the configured collections. `-` is refused. */
  inputs: string[];
  /** `--fields`: only these keys. Each must carry a mark, or be manifest-owned, for some file. */
  fields?: string[];
  /** `--collection <name>`, repeatable: run over these configured collections. */
  collections?: string[];
  /** `-s/--schema`, repeatable: the schema set every page is judged by. */
  cliSchemas?: string[];
  /** `--dry-run`: report what would move and be created; write nothing. */
  dryRun?: boolean;
  /** `--as`: force an extractor. */
  as?: string;
  exts?: string[];
  exclude?: string[];
  configPath?: string;
  /** `--no-config`: refused, since relocate writes the config. */
  noConfig?: boolean;
  cwd?: string;
  allowEmpty?: boolean;
  /** `--no-gitignore` (false). Absent leaves config `respectGitignore:` in charge. */
  respectGitignore?: boolean;
  onNotice?: (message: string) => void;
  onConfigLoaded?: (info: ConfigNotice) => void;
  /** Where `MANNI_ENCRYPTION_KEY` is read, for an encrypted join field. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export async function runRelocate(opts: RelocateOptions): Promise<RelocateResult> {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.inputs.includes(STDIN_TOKEN)) {
    throw new DocmetaError(
      "relocate moves values between documents and a collection's manifest, and stdin is not a document on disk.",
    );
  }
  if (opts.noConfig === true) {
    throw new DocmetaError(
      "relocate writes collections: and externalMetadata: to the config file, and --no-config rules one out.",
    );
  }
  const run = await resolveRunConfig({
    cwd,
    ...(opts.configPath !== undefined ? { configPath: opts.configPath } : {}),
    inputs: opts.inputs,
    ...(opts.collections !== undefined ? { collections: opts.collections } : {}),
    ...(opts.onConfigLoaded !== undefined ? { onConfigLoaded: opts.onConfigLoaded } : {}),
  });
  const { config, inputs, base, configDir, collections, fromCollections } = run;
  if (inputs.length === 0) {
    throw new DocmetaError(
      "No files to relocate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  }
  const forced = opts.as !== undefined ? extractorByName(opts.as) : undefined;
  if (opts.as !== undefined && forced === undefined) {
    throw new DocmetaError(
      `Unknown format "${opts.as}". Known formats: ${listFormats()
        .map((f) => f.name)
        .join(", ")}.`,
    );
  }

  const allowEmpty = opts.allowEmpty ?? config?.allowEmpty;
  const exts = opts.exts ?? forced?.extensions;
  const exclude = opts.exclude ?? [];
  const membersFor = (label: string): string[] => memberOf(collections, configDir ?? cwd, base, label);
  const { files: walked, gitignoreSkipped } = await resolveTargetSet({
    inputs,
    ...(exts !== undefined ? { exts } : {}),
    exclude,
    cwd: base,
    ...(allowEmpty !== undefined ? { allowEmpty } : {}),
    ...gitignoreOptions({
      ...(opts.respectGitignore !== undefined ? { flag: opts.respectGitignore } : {}),
      ...(config?.respectGitignore !== undefined ? { configured: config.respectGitignore } : {}),
      ...(opts.onNotice !== undefined ? { onNotice: opts.onNotice } : {}),
    }),
  });
  const files = fromCollections ? retainMembers(walked, membersFor) : walked;
  assertNonEmpty({
    files,
    inputs,
    usingStdin: false,
    ...(allowEmpty !== undefined ? { allowEmpty } : {}),
    exclude,
    ...(exts !== undefined ? { exts } : {}),
    gitignoreSkipped,
    action: "relocated",
  });

  const validator = new Validator(
    schemaLoadOptions({
      root: configDir ?? cwd,
      fileBase: cwd,
      ttlHours: config?.schemaCache?.ttlHours,
      offline: config?.offline,
      pins: collectSchemaPins(config),
    }),
  );
  const ctx = relocationContext(run, {
    cwd,
    // A config-fallback run named no targets: its pages are already members.
    targets: fromCollections ? [] : opts.inputs,
    validator,
    ...(opts.cliSchemas !== undefined && opts.cliSchemas.length > 0 ? { cliSchemas: opts.cliSchemas } : {}),
    ...(opts.as !== undefined ? { as: opts.as } : {}),
    ...(opts.respectGitignore !== undefined ? { respectGitignore: opts.respectGitignore } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.onNotice !== undefined ? { onNotice: opts.onNotice } : {}),
  });
  const plan = await planRelocation(ctx, {
    files,
    ...(opts.fields !== undefined ? { fields: opts.fields } : {}),
  });
  if (opts.dryRun === true) return plan.result;
  return applyRelocation(ctx, plan);
}
