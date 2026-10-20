/**
 * `--format sarif`: `graph check` as SARIF 2.1.0, the log code scanning reads
 * (proposal 0089). `manni check -f sarif` carries this run as it is.
 *
 * A SHACL finding names a node of the built graph, not a line of a page. Its
 * location is each page it blames, at line 1, where the frontmatter begins.
 * A finding that blames no page has nothing code scanning can anchor, so it
 * stays out of `results`. The run counts those in one notification instead,
 * and the exit code still counts every finding.
 */
import pkg from "../../../package.json" with { type: "json" };
import type { Guidance } from "../../shared/guidance.js";
import { guidanceLines } from "../../shared/guidance.js";
import {
  artifactLocation,
  fileUri,
  normalizeRoot,
  URI_BASE_ID,
  type ArtifactLocation,
} from "../../shared/sarif-location.js";
import type { Severity } from "../../shared/severity.js";
import type { CheckReport } from "../commands/check.js";
import type { CheckFinding } from "../core/shacl.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const INFORMATION_URI = "https://github.com/hawkeyexl/manni";

type SarifLevel = "error" | "warning" | "note";

/** The family scale onto SARIF's, which spells the lowest level `note`. */
const LEVELS: Record<Severity, SarifLevel> = {
  error: "error",
  warning: "warning",
  notice: "note",
};

interface ReportingDescriptor {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: Array<{
    physicalLocation: { artifactLocation: ArtifactLocation; region: { startLine: number } };
  }>;
  properties?: { guidance: Guidance };
}

/** `manni:graph/Document-language`, or `manni:graph/shacl` when no rule is named. */
function ruleIdOf(f: CheckFinding): string {
  return `manni:graph/${f.guidance?.rule ?? "shacl"}`;
}

/** `Document-language` → `DocumentLanguage`: SARIF asks for one Pascal-case word. */
function pascalCase(rule: string): string {
  return rule
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function descriptor(f: CheckFinding): ReportingDescriptor {
  const rule = f.guidance?.rule ?? null;
  const description = f.guidance?.description ?? null;
  const guide = f.guidance?.guide ?? null;
  return {
    id: ruleIdOf(f),
    name: pascalCase(rule ?? "shacl"),
    shortDescription: {
      text: rule === null ? "A SHACL constraint in the shapes in effect." : `The ${rule} shape.`,
    },
    ...(description === null ? {} : { fullDescription: { text: description } }),
    ...(guide === null ? {} : { helpUri: guide }),
  };
}

export function renderCheckSarif(report: CheckReport): string {
  const root = normalizeRoot(report.root);
  const rules: ReportingDescriptor[] = [];
  const indexOf = new Map<string, number>();
  const results: SarifResult[] = [];
  let pageless = 0;

  for (const f of report.findings) {
    if (f.docs.length === 0) {
      pageless += 1;
      continue;
    }
    const id = ruleIdOf(f);
    let index = indexOf.get(id);
    if (index === undefined) {
      index = rules.length;
      indexOf.set(id, index);
      rules.push(descriptor(f));
    }
    results.push({
      ruleId: id,
      ruleIndex: index,
      level: LEVELS[f.severity],
      message: { text: [f.message, ...guidanceLines(f.guidance)].join("\n") },
      locations: f.docs.map((doc) => ({
        physicalLocation: {
          artifactLocation: artifactLocation(doc, root),
          region: { startLine: 1 },
        },
      })),
      ...(f.guidance === null ? {} : { properties: { guidance: f.guidance } }),
    });
  }

  const notifications =
    pageless === 0
      ? []
      : [
          {
            level: "note" as const,
            message: {
              text: `${String(pageless)} ${pageless === 1 ? "finding names" : "findings name"} no page. Run manni graph check to see them.`,
            },
          },
        ];

  return JSON.stringify(
    {
      $schema: SARIF_SCHEMA,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: "manni-graph",
              informationUri: INFORMATION_URI,
              version: pkg.version,
              rules,
            },
          },
          originalUriBaseIds: { [URI_BASE_ID]: { uri: fileUri(root) } },
          invocations: [
            {
              // Findings are the tool doing its job. A run that cannot check
              // exits 2 before any report is rendered.
              executionSuccessful: true,
              ...(notifications.length === 0 ? {} : { toolExecutionNotifications: notifications }),
            },
          ],
          results,
        },
      ],
    },
    null,
    2,
  );
}
