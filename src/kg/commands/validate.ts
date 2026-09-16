/**
 * `manni kg validate` — KG-readiness check. Thin wrapper over the metadata
 * tool's programmatic API, validating discovered docs against the schemas in
 * config `validate.schemas` (default: the `kg` page vocabulary,
 * `manni:kg:1.0.0-proposal.3`, imported from proposal 0023's draft and inlined
 * by the build).
 */
import { extname } from "node:path";
import {
  runValidate as docmetaValidate,
  render,
  supportedExtensions,
  type ReportFormat,
  type ValidateRun,
} from "../../meta/index.js";
import { errorMessage } from "../../shared/errors.js";
import { KgError } from "../types.js";
import { loadRunConfig } from "../core/config.js";
import {
  documentSetPatterns,
  resolveDocumentSet,
  type DocumentInputOptions,
} from "../core/discover.js";
import { frontmatterSchema, FRONTMATTER_SCHEMA_ID } from "../schema.js";

export interface ValidateOptions extends DocumentInputOptions {
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
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
      ...(opts.paths === undefined ? {} : { paths: opts.paths }),
      ...(opts.collection === undefined ? {} : { collection: opts.collection }),
    },
    cwd,
  );

  // Discover with the SAME mechanism as `manni kg build`, then hand docmeta the
  // explicit file list — validate must cover exactly the corpus build ingests
  // (docmeta's own glob expansion filters extensions and merges excludes from
  // any docmeta.config.yaml, which would silently shrink the corpus).
  const files = resolveDocumentSet(config, opts, "validate", cwd);
  if (files.length === 0) {
    throw new KgError(
      `No input files matched: ${documentSetPatterns(config, opts).join(", ")} (cwd: ${cwd})`,
    );
  }
  const supported = new Set(supportedExtensions());
  const unsupported = files.filter(
    (f) => !supported.has(extname(f).toLowerCase()),
  );
  if (unsupported.length > 0) {
    throw new KgError(
      `manni kg build would ingest file types manni meta cannot validate: ${unsupported
        .slice(0, 5)
        .join(
          ", ",
        )}${unsupported.length > 5 ? ", …" : ""} — narrow your inputs globs.`,
    );
  }

  // kg implements the family's `kg` vocabulary rather than self-hosting one
  // (ADR 01023); with no explicit validate.schemas, name the draft by its `$id`
  // and hand the object over inline. Proposal 0023 is still under review, so
  // the id is deliberately not registered as a built-in — `inlineSchemas` is
  // the seam that lets findings say `manni:kg:1.0.0-proposal.3` anyway, instead
  // of an absolute path to a copy this package no longer ships (0051 §4).
  const schemas =
    config.validate.schemas.length > 0
      ? config.validate.schemas
      : [FRONTMATTER_SCHEMA_ID];

  let run: ValidateRun;
  try {
    run = await docmetaValidate({
      inputs: files,
      cliSchemas: schemas,
      // Passed unconditionally: an unused entry costs a map lookup that never
      // hits, and the alternative is a branch that has to stay in step with the
      // one above.
      inlineSchemas: new Map([[FRONTMATTER_SCHEMA_ID, frontmatterSchema]]),
      cwd,
    });
  } catch (e) {
    // Surface docmeta operational errors as our own (exit 2).
    throw new KgError(errorMessage(e));
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
