/**
 * Shared result model for manni docevals.
 *
 * Vocabulary follows the "Docs as Evals" methodology (Docs as Tests with AI):
 * every check is an *eval*; what differs is its *grader* (code-based, LLM-as-
 * judge, or human). Verdicts are binary pass/fail — aggregate rates emerge from
 * binary judgments, they are never assigned per item.
 */
import { ToolError } from "../shared/errors.js";

// The judge vocabulary is shared with the inference layer and is re-exported
// here so manni docevals code and its consumers keep one import site. A second local
// definition would be a second thing to keep in sync.
//
//   Match          — a single run's verdict; `partial` counts as fail
//   Zone           — confidence-zone routing for AI-judged evals
//   JudgeVerdict   — the structured verdict of one run (the book's shape)
//   JudgeRun       — one run within an ensemble
//   ConsensusResult — the aggregated outcome for one (page, eval) pair
import type { ConsensusResult } from "@hawkeyexl/inference";

export type {
  ConsensusResult,
  JudgeRun,
  JudgeVerdict,
  Match,
  Zone,
} from "@hawkeyexl/inference";

/**
 * Regression evals guard behavior that must keep working (~100% target pass
 * rate). Capability evals probe what the docs/system can do (~70% target).
 */
export type EvalType = "capability" | "regression";

/** Finding severity for deterministically graded evals. Only `error` affects exit codes. */
export type Severity = "error" | "warning" | "info";

/** How an eval is graded. `tool:*` kinds are built-in adapters for external tools. */
export type GraderKind = "ai" | "command" | "human" | `tool:${string}`;

/** A normalized finding from a deterministically graded eval (command or tool). */
export interface Finding {
  /** Name of the eval that produced this finding. */
  evalName: string;
  /** Repo-relative path of the page the finding applies to. */
  file: string;
  /** Tool-specific rule id (e.g. "MD013", "Vale.Spelling"), when available. */
  ruleId?: string;
  message: string;
  severity: Severity;
  /**
   * This finding is about the *grader*, not the page: the tool could not be
   * run, or its output could not be read. It fails the eval whatever severity
   * the eval is configured at, because an eval configured `severity: warning`
   * would otherwise pass while its check never executed (ADR 01022).
   *
   * A finding about the page carries the eval's severity as usual.
   */
  diagnostic?: boolean;
  line?: number;
  col?: number;
}

/** Result of one eval applied to one page. */
export interface EvalResult {
  evalName: string;
  /**
   * Suite this result reports under. Stamped centrally by the engine, which
   * already computes the mapping for the suite summaries — the alternative is
   * threading it through every one of the ~30 places a result is constructed.
   */
  suite?: string;
  type: EvalType;
  grader: GraderKind;
  file: string;
  outcome: "pass" | "fail" | "needs-review" | "skipped" | "error";
  /** Present for ai-graded evals. */
  consensus?: ConsensusResult;
  /** Present for command/tool-graded evals that produced findings. */
  findings?: Finding[];
  /** True when this run generated the eval's check script. */
  generated?: boolean;
  /** Set when a persisted human review resolved a needs-review outcome. */
  via?: "human-review";
  /**
   * Findings the baseline already recorded and this run therefore suppressed
   * (ADR 01017). Present only on a run with a baseline in effect, so its
   * absence means "no baseline", not "nothing was forgiven".
   */
  baselined?: number;
  skipReason?: string;
  /**
   * The eval's weight in its suite's pass rate. Stamped centrally by the
   * engine alongside `suite`, and for the same reason: threading it through
   * the ~30 sites that construct a result would be thirty chances to forget.
   */
  weight?: number;
  /**
   * Set when the model that judged this eval also produced what it graded.
   *
   * `content` — the page declares `generated-by: <this model>`: the judge
   * wrote the prose. `criterion` — `eval-provenance` records this model
   * proposing this assertion: the judge wrote the question. Both bias a
   * verdict without invalidating it, so this rides along with a real outcome
   * rather than replacing it, and reaches every reporter instead of stderr.
   */
  selfPreference?: { axis: "content" | "criterion"; model: string };
  durationMs: number;
}

/** Per-suite aggregate. Pass rates emerge from binary outcomes. */
export interface SuiteSummary {
  suite: string;
  total: number;
  passed: number;
  failed: number;
  needsReview: number;
  skipped: number;
  errored: number;
  /**
   * Weighted share of the graded set that passed, 1 when nothing ran.
   *
   * The graded set is pass + fail + error, as it has always been —
   * `needs-review` and `skipped` are in neither half, so a page awaiting review
   * neither helps nor hurts. Each eval contributes its `weight` (1 unless it
   * says otherwise), and an eval that belongs to a criterion contributes
   * nothing on its own: the criterion contributes once, for the group.
   */
  passRate: number;
  /** From config: ~1.0 for regression suites, ~0.7 for capability suites. */
  targetPassRate: number;
  meetsTarget: boolean;
  /**
   * Set when a selection filter (`--eval` / `--suite`) was active, meaning the
   * run measured part of this suite. `meetsTarget` is then always false and the
   * suite cannot fail the run either: it has numbers, but no verdict.
   */
  partial?: boolean;
  /**
   * Criteria scored in this suite. Present only when the suite declares any,
   * so its absence means "none", never "none passed".
   *
   * `suspended` counts criteria whose members were not all graded in this run.
   * They are out of the rate entirely rather than counted as failures — the
   * same reasoning as `partial` one level down (ADR 01018): a group measured
   * in part has numbers but no verdict.
   */
  criteria?: {
    total: number;
    passed: number;
    failed: number;
    suspended: number;
  };
}

/** Full run output consumed by reporters. */
export interface RunReport {
  pages: number;
  evalResults: EvalResult[];
  suites: SuiteSummary[];
  /**
   * Judge telemetry. Counts, not money: the dollar figure this block used to
   * carry was only as good as a price table this repo does not own, and was
   * absent entirely for `claude-cli` and self-hosted endpoints (ADR 01019).
   */
  usage: {
    totalTokens: number;
    cachedEvals: number;
    judgedEvals: number;
  };
  /** Script generations performed during this run (paths written). */
  generated: string[];
  exitCode: 0 | 1;
}

/** Operational/usage error → exit code 2. */
export class DocevalsError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "DocevalsError";
  }
}
