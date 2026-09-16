/**
 * The calibration labels sidecar (ADR 01022).
 *
 * A label is a human's answer for one `(trace, artifact, eval)`. It lives in
 * its own file rather than in the eval entry for two reasons: the vendored
 * `artifact-evals` vocabulary is docmeta's and `inlineEval` is closed to
 * additions (ADR 01010), and — more importantly — a label is a property of a
 * *corpus and a reviewer*, not of the artifact. Two teams calibrating the same
 * skill against different sessions hold different ground truth, and neither
 * belongs in the SKILL.md.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import labelsSchemaJson from "./labels-schema.json" with { type: "json" };
import { TracevalsError } from "../types.js";
import type { ArtifactType } from "../artifacts/types.js";

const labelsSchema = labelsSchemaJson as Record<string, unknown>;

/** Conventional location inside a project; overridable with `--labels`. */
export const DEFAULT_LABELS_FILE = "tracevals/labels.yaml";

/**
 * What a human decided. `needs-review` is a legitimate label, not a cop-out:
 * an eval you found genuinely ambiguous is the one that tells you whether the
 * review band is set sensibly, and the docs have always asked for a couple.
 */
export type LabelOutcome = "pass" | "fail" | "needs-review";

export interface EvalLabel {
  /** Path exactly as written in the file, for error messages. */
  trace: string;
  /** Resolved absolute path — the join key against the batch corpus. */
  traceFile: string;
  artifact: string;
  /** Only when the file disambiguates a name shared by two artifact kinds. */
  type?: ArtifactType;
  eval: string;
  expected: LabelOutcome;
  note?: string;
}

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(labelsSchema);

/**
 * Stable identity for one label, and the duplicate-detection key.
 *
 * The separator is written as a backslash-u escape, never as a literal NUL:
 * the runtime value is identical, but a literal one makes git call the file
 * binary — its diff renders as `Bin 0 -> N bytes` and cannot be reviewed or
 * three-way merged, and `grep` answers `Binary file … matches` and stops.
 * `test/unit/source-text-safety.test.ts` holds the whole tree to this.
 */
export const labelKey = (
  traceFile: string,
  artifact: string,
  evalName: string,
  type?: ArtifactType,
): string => `${traceFile}\u0000${type ?? ""}\u0000${artifact}\u0000${evalName}`;

/**
 * Validate a labels document and resolve its trace paths.
 *
 * `file` is the path the text came from; trace paths resolve against **its**
 * directory rather than the working directory, matching how `plugins` resolves
 * against the config file that names them. A labels file travels with its
 * corpus, so it must mean the same thing from any cwd.
 */
export function parseLabels(text: string, file: string): EvalLabel[] {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new TracevalsError(
      `could not parse ${file}: ${(err as Error).message}`,
    );
  }
  if (raw === null || raw === undefined) {
    throw new TracevalsError(`invalid labels file ${file}: it is empty`);
  }
  if (!validate(raw)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
      .join("; ");
    // The empty-list case gets its own wording: "must NOT have fewer than 1
    // items" describes the schema, not the mistake.
    const empty = (validate.errors ?? []).some(
      (e) => e.instancePath === "/labels" && e.keyword === "minItems",
    );
    throw new TracevalsError(
      empty
        ? `invalid labels file ${file}: it must carry at least one label — an empty one measures nothing`
        : `invalid labels file ${file}: ${detail}`,
    );
  }

  const base = dirname(resolve(file));
  const labels: EvalLabel[] = [];
  const seen = new Set<string>();
  for (const entry of (raw as { labels: Record<string, string>[] }).labels) {
    const traceFile = resolve(base, entry.trace as string);
    const type = entry.type as ArtifactType | undefined;
    const key = labelKey(
      traceFile,
      entry.artifact as string,
      entry.eval as string,
      type,
    );
    if (seen.has(key)) {
      // Two answers for one question is not a merge problem to resolve at run
      // time — whichever won would silently decide the measurement.
      throw new TracevalsError(
        `invalid labels file ${file}: duplicate label for ${entry.artifact ?? "?"} › ${entry.eval ?? "?"} on ${entry.trace ?? "?"}`,
      );
    }
    seen.add(key);
    labels.push({
      trace: entry.trace as string,
      traceFile,
      artifact: entry.artifact as string,
      ...(type !== undefined ? { type } : {}),
      eval: entry.eval as string,
      expected: entry.expected as LabelOutcome,
      ...(entry.note !== undefined ? { note: entry.note } : {}),
    });
  }
  return labels;
}

export async function loadLabels(file: string): Promise<EvalLabel[]> {
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch (err) {
    throw new TracevalsError(
      `could not read labels file ${file}: ${(err as Error).message}`,
    );
  }
  return parseLabels(text, file);
}
