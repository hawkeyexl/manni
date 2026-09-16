/**
 * `manni kg validate` — KG-readiness check. Thin wrapper over docmeta's
 * programmatic API, validating discovered docs against the schemas in
 * config `validate.schemas` (default: the `docmeta:kg` vocabulary vendored
 * with this package at schemas/docmeta-kg-1.0.0-proposal.1.json).
 */
import { extname } from "node:path";
import {
  runValidate as docmetaValidate,
  render,
  supportedExtensions,
  type ReportFormat,
  type ValidateRun,
} from "../../meta/index.js";
import { DockgError } from "../types.js";
import { loadConfig } from "../core/config.js";
import { discoverFiles } from "../core/discover.js";
import { bundledSchemaPath } from "../core/pkg.js";

export interface ValidateOptions {
  globs?: string[];
  config?: string;
  cwd?: string;
}

export interface ValidateResult {
  run: ValidateRun;
  exitCode: 0 | 1;
}

export async function runValidate(
  opts: ValidateOptions = {},
): Promise<ValidateResult> {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadConfig(opts.config, cwd);
  const inputs =
    opts.globs && opts.globs.length > 0 ? opts.globs : config.inputs;

  // Discover with the SAME mechanism as `manni kg build`, then hand docmeta the
  // explicit file list — validate must cover exactly the corpus build ingests
  // (docmeta's own glob expansion filters extensions and merges excludes from
  // any docmeta.config.yaml, which would silently shrink the corpus).
  const files = discoverFiles(inputs, config.exclude, cwd);
  if (files.length === 0) {
    throw new DockgError(
      `No input files matched: ${inputs.join(", ")} (cwd: ${cwd})`,
    );
  }
  const supported = new Set(supportedExtensions());
  const unsupported = files.filter(
    (f) => !supported.has(extname(f).toLowerCase()),
  );
  if (unsupported.length > 0) {
    throw new DockgError(
      `manni kg build would ingest file types manni meta cannot validate: ${unsupported
        .slice(0, 5)
        .join(
          ", ",
        )}${unsupported.length > 5 ? ", …" : ""} — narrow your inputs globs.`,
    );
  }

  // dockg vendors docmeta's `kg` vocabulary rather than self-hosting a schema
  // of its own (ADR 01023); with no explicit validate.schemas, hand docmeta
  // back its own bytes by path — the draft id is not registered yet.
  const schemas =
    config.validate.schemas.length > 0
      ? config.validate.schemas
      : [bundledSchemaPath(import.meta.url)];

  let run: ValidateRun;
  try {
    run = await docmetaValidate({
      inputs: files,
      cliSchemas: schemas,
      cwd,
    });
  } catch (e) {
    // Surface docmeta operational errors as our own (exit 2).
    throw new DockgError(e instanceof Error ? e.message : String(e));
  }

  return {
    run,
    exitCode: run.summary.failed > 0 || run.summary.errors > 0 ? 1 : 0,
  };
}

export function renderValidate(
  result: ValidateResult,
  format: "pretty" | "json",
): string {
  const reportFormat: ReportFormat = format === "json" ? "json" : "pretty";
  return render(reportFormat, result.run.results, result.run.summary);
}
