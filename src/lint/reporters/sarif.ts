/**
 * SARIF 2.1.0, the format GitHub code scanning ingests.
 *
 * `github` annotations live and die with one check run: no history, nothing to
 * query, and nothing outside GitHub Actions reads them at all. SARIF is the
 * same findings as a durable artifact - uploaded once, tracked across commits,
 * and understood by every dashboard that speaks the standard.
 *
 * The format's failure mode is silence. A SARIF file with a malformed URI, or
 * with results whose `ruleId` names no declared rule, uploads successfully and
 * then annotates nothing: a green check and an empty dashboard. So the two
 * things most likely to be wrong are the two things this module is most
 * careful about - rule descriptors, and URIs.
 */
import type { Finding, Position, Severity, SkipReason } from "../types.js";
import type { LintFileResult, LintRun } from "../commands/lint.js";
import { ruleId, ruleName } from "../core/rule-id.js";
import pkg from "../../../package.json" with { type: "json" };
import {
  artifactLocation,
  fileUri,
  normalizeRoot,
  URI_BASE_ID,
  type ArtifactLocation,
} from "../../shared/sarif-location.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA =
  "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json";
/**
 * Where code scanning sends someone who clicks "more information" on an alert.
 *
 * Deliberately the post-rename URL, which 404s until `doc-structure-lint` is
 * renamed on GitHub - a manual step outside this repo. Pointing it at the
 * current name instead would mean every SARIF report published from the day of
 * the rename onward links somewhere that has moved, and reports outlive the
 * rename; a link that is briefly wrong beats one that is permanently wrong.
 * `package.json`'s `repository` and `bugs` URLs are forward-looking for the
 * same reason, so all three flip together or not at all.
 */
const INFORMATION_URI = "https://github.com/hawkeyexl/manni";

type SarifLevel = "error" | "warning" | "note" | "none";

interface SarifMessage {
  text: string;
}

interface ReportingDescriptor {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  defaultConfiguration?: { level: SarifLevel };
}

interface Region {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface SarifLocation {
  physicalLocation: { artifactLocation: ArtifactLocation; region?: Region };
}

interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
  properties?: { heading: string };
}

interface SarifNotification {
  descriptor: { id: string; index: number };
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
}

interface SarifInvocation {
  executionSuccessful: boolean;
  toolExecutionNotifications?: SarifNotification[];
}

interface SarifDriver {
  name: string;
  informationUri: string;
  version: string;
  rules: ReportingDescriptor[];
  notifications?: ReportingDescriptor[];
}

interface SarifLog {
  $schema: string;
  version: string;
  runs: {
    tool: { driver: SarifDriver };
    originalUriBaseIds: Record<string, { uri: string }>;
    invocations: SarifInvocation[];
    results: SarifResult[];
  }[];
}

export interface SarifOptions {
  /**
   * Directory the relative paths in `LintRun` are relative to - the lint run's
   * `cwd`. Defaults to the process cwd, which is what `runLint` itself
   * defaults to. It is a parameter rather than a bare read of `process.cwd()`
   * so the URI mapping, the part most likely to be silently wrong, is testable
   * without moving the whole process into a fixture directory.
   */
  root?: string;
}

/**
 * The family scale -> SARIF `level`. A total map rather than a ternary, so a
 * fourth severity fails to compile here instead of quietly becoming `error`.
 *
 * The family's three values were chosen to be GitHub's, and SARIF agrees on
 * two of them; it spells the lowest one `note`. meta's reporter folds
 * `notice` onto `note` the same way, so a repository uploading both tools'
 * reports sees one scale. SARIF's `none` has no `Severity` that means it.
 */
const LEVELS: Record<Severity, SarifLevel> = {
  notice: "note",
  warning: "warning",
  error: "error",
};

/**
 * Why a file went unlinted, in words. `Record<SkipReason, ...>` on purpose: a
 * new skip reason should fail to compile until someone has decided what the
 * report says about it.
 */
const SKIP_DESCRIPTIONS: Record<SkipReason, string> = {
  "no-template": "File was not linted: no template resolved for it.",
  "unsupported-format": "File was not linted: no parser handles its format.",
  unreadable: "File was not linted: it could not be read.",
};

/**
 * Positions map straight across, with no arithmetic.
 *
 * Both sides are 1-based in line and column. Both also treat the end column as
 * exclusive: SARIF defines `endColumn` as "the column number of the character
 * following the end of the region", and `Position` in types.ts is documented
 * as a half-open span with `end` exclusive. Checked against what the parser
 * actually emits rather than taken on trust - remark gives `# Hi`, four
 * characters on line 1, an `end.column` of 5, one past the last character,
 * which is precisely SARIF's convention. So no +1 and no -1 in either
 * direction. A zero-width span (`origin()`, used by findings with nowhere
 * better to point) becomes a zero-length region, which SARIF allows.
 */
function region(position: Position): Region {
  return {
    startLine: position.start.line,
    startColumn: position.start.column,
    endLine: position.end.line,
    endColumn: position.end.column,
  };
}

function location(
  file: string,
  root: string,
  position?: Position,
): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: artifactLocation(file, root),
      region: position ? region(position) : undefined,
    },
  };
}

/**
 * The heading goes in the message *and* in `properties`.
 *
 * In the message because most SARIF viewers show the message and nothing else
 * beside the line: "Expected at least 2 paragraphs, found 1" is a different
 * sentence depending on which section it is about, and dropping the heading
 * would make the SARIF annotation less informative than the `github` one for
 * the very same finding. In `properties.heading` because a message is prose
 * and nothing can group or filter on it - a consumer asking for "every finding
 * under Prerequisites" should not have to parse English back out.
 *
 * Unlike `renderGithub`, newlines are left intact. A workflow command is one
 * line by definition; a SARIF message is a JSON string with no such limit.
 */
function messageText(finding: Finding): string {
  return finding.heading != null
    ? `${finding.heading}: ${finding.message}`
    : finding.message;
}

function words(id: string): string[] {
  return id.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/**
 * `missing_section` -> `MissingSection`. SARIF asks a descriptor `name` to be
 * a single Pascal-case identifier, and GitHub shows it in the rule list.
 */
function pascalCase(id: string): string {
  return words(id)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * `missing_section` -> `Missing section`. Derived from the id, not authored:
 * there is no rule catalog to draw a real description from, and the first
 * finding's message describes one occurrence rather than the rule. Restating
 * the id in prose says nothing new, but it beats an empty column in GitHub's
 * rule list and it can never drift out of step with the rule it describes.
 */
function humanize(id: string): string {
  const text = words(id).join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface RuleIndex {
  descriptors: ReportingDescriptor[];
  indexOf: Map<string, number>;
}

/**
 * One `reportingDescriptor` per distinct finding type, in order of first
 * appearance.
 *
 * This is not optional decoration. A result carrying a `ruleId` that matches
 * no descriptor is accepted by GitHub code scanning and then rendered without
 * a rule name, a description, or a working filter - the alert arrives stripped
 * of everything that makes a dashboard usable, and with no error to explain
 * why.
 */
function buildRules(run: LintRun): RuleIndex {
  const indexOf = new Map<string, number>();
  const order: string[] = [];
  const severities = new Map<string, Set<Severity>>();

  for (const result of run.results) {
    for (const finding of result.findings) {
      let seen = severities.get(finding.type);
      if (!seen) {
        seen = new Set<Severity>();
        severities.set(finding.type, seen);
        indexOf.set(finding.type, order.length);
        order.push(finding.type);
      }
      seen.add(finding.severity);
    }
  }

  const descriptors = order.map((type) => {
    // The descriptor id is the **family** rule id, not the internal `type`:
    // it is what an alert is filed and de-duplicated under, and it has to be
    // the string every other reporter uses for the same finding. `name` and
    // `shortDescription` are derived from the rule half alone, so GitHub's
    // rule list reads "MissingSection", not "ManniLintStructureMissingSection".
    const rule = ruleName(type);
    const descriptor: ReportingDescriptor = {
      id: ruleId(type),
      name: pascalCase(rule),
      shortDescription: { text: humanize(rule) },
    };
    // Only when every finding of this type agreed on a severity. Severity is
    // per finding, not per rule, so a type that appeared as both an error and
    // a warning has no honest default - and every result states its own
    // `level` regardless, which is what a consumer actually reads.
    const [only, ...rest] = [...(severities.get(type) ?? [])];
    if (only !== undefined && rest.length === 0) {
      descriptor.defaultConfiguration = { level: LEVELS[only] };
    }
    return descriptor;
  });

  return { descriptors, indexOf };
}

function toResult(
  finding: Finding,
  file: string,
  rules: RuleIndex,
  root: string,
): SarifResult {
  return {
    ruleId: ruleId(finding.type),
    // Always populated in practice, since the index is built from these same
    // findings. Omitted rather than faked if it ever is not: a wrong index
    // points the alert at somebody else's rule, which is worse than none.
    ruleIndex: rules.indexOf.get(finding.type),
    level: LEVELS[finding.severity],
    message: { text: messageText(finding) },
    locations: [location(file, root, finding.position)],
    properties:
      finding.heading != null ? { heading: finding.heading } : undefined,
  };
}

interface SkipReport {
  descriptors: ReportingDescriptor[];
  notifications: SarifNotification[];
}

/**
 * Skipped files become `toolExecutionNotifications`, not results.
 *
 * They cannot simply be dropped - the pretty reporter's rule applies here too:
 * a file that leaves no trace in the report is indistinguishable from a file
 * that passed, and a docset mid-onboarding is mostly unrouted pages. Reading
 * that as a clean bill of health is the exact failure this format exists to
 * prevent.
 *
 * They are not results either. A result is a statement about the content of a
 * document; a skip is a statement about the tool, which declined to look. As
 * results they would open code-scanning alerts against files nothing has
 * examined, and each of those would then have to be triaged and dismissed by
 * hand. `toolExecutionNotifications` is the slot SARIF defines for "the tool
 * has something to say about its own execution", which is what a skip is.
 *
 * Level `note` rather than SARIF's default of `warning`: on a repository that
 * has not adopted doctypes yet nearly every page is skipped, and a warning
 * stream that long is one nobody reads.
 */
function buildSkips(run: LintRun, root: string): SkipReport {
  const indexOf = new Map<string, number>();
  const descriptors: ReportingDescriptor[] = [];
  const notifications: SarifNotification[] = [];

  for (const result of run.results) {
    const reason = result.skipped;
    if (reason == null) continue;

    let index = indexOf.get(reason);
    if (index === undefined) {
      index = descriptors.length;
      indexOf.set(reason, index);
      descriptors.push({
        id: reason,
        name: pascalCase(reason),
        shortDescription: { text: SKIP_DESCRIPTIONS[reason] },
      });
    }

    notifications.push({
      // Declared in `tool.driver.notifications` and referenced by id *and*
      // index, for the same reason results reference their rules both ways.
      descriptor: { id: reason, index },
      level: "note",
      message: { text: skipMessage(result, reason) },
      locations: [location(result.file, root)],
    });
  }

  return { descriptors, notifications };
}

/** The specific reason when the run recorded one, the generic one otherwise. */
function skipMessage(result: LintFileResult, reason: SkipReason): string {
  return result.reason ?? SKIP_DESCRIPTIONS[reason];
}

export function renderSarif(run: LintRun, opts: SarifOptions = {}): string {
  const root = normalizeRoot(opts.root ?? process.cwd());
  const rules = buildRules(run);
  const skips = buildSkips(run, root);

  const results = run.results.flatMap((result) =>
    result.findings.map((finding) =>
      toResult(finding, result.file, rules, root),
    ),
  );

  const driver: SarifDriver = {
    name: "manni-lint",
    informationUri: INFORMATION_URI,
    version: pkg.version,
    // Emitted even when empty: results point into this array, so a consumer
    // always looks here, and a stable shape is cheaper than a special case.
    rules: rules.descriptors,
    notifications: skips.descriptors.length > 0 ? skips.descriptors : undefined,
  };

  const invocation: SarifInvocation = {
    // Findings are the tool doing its job, not failing at it. This would only
    // be false if manni lint itself could not run, and that path exits 2
    // before any report is rendered.
    executionSuccessful: true,
    toolExecutionNotifications:
      skips.notifications.length > 0 ? skips.notifications : undefined,
  };

  const log: SarifLog = {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: { driver },
        // Declared unconditionally: it is what makes every relative `uri` in
        // this report mean anything, and a reader should not have to infer the
        // base from whether some result happened to use it.
        originalUriBaseIds: { [URI_BASE_ID]: { uri: fileUri(root) } },
        invocations: [invocation],
        results,
      },
    ],
  };

  return JSON.stringify(log, null, 2);
}
