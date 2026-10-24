/**
 * The shapes `manni test tasks` passes between running a synthetic user
 * (`commands/tasks.ts`) and judging what it did (`core/judge-run.ts`).
 *
 * A run is one start, one task and one persona. The run side resolves the
 * records, prepares the workspace, starts Claude Code and parses its stream;
 * the judging side turns that evidence into evals. Neither reaches into the
 * other's modules: this file is the whole contract.
 */
import type { InferenceProvider } from "@hawkeyexl/inference";
import type { EvalEntry } from "../../tracevals/evals/extract.js";
import type { Trace } from "../../tracevals/trace/types.js";
import type { ProvidersConfig } from "../../shared/providers.js";
import type { Severity } from "../../shared/severity.js";

/** Where an expectation was written. Paths are relative to the config file's directory, POSIX separators. */
export interface SourceLocation {
  file: string;
  line: number;
}

/** A persona record, as the synthetic user is told it. Never its body. */
export interface TaskPersona {
  id: string;
  /** The record's path, relative to the config file's directory. */
  file: string;
  title?: string;
  description?: string;
  role?: string;
  teamContext?: string;
  proficiency: string[];
  prerequisites: string[];
  goals: string[];
  pains: string[];
  /** Each `constraints:` item with the line it sits on. */
  constraints: { text: string; location: SourceLocation }[];
}

/** A journey record read as a task. */
export interface TaskJourney {
  id: string;
  /** The record's path, relative to the config file's directory. */
  file: string;
  /** `title:`, or the id when the record has none. */
  title: string;
  /** The `title:` line, or line 1 without one. */
  titleLocation: SourceLocation;
  trigger?: string;
  successCriteria?: { text: string; location: SourceLocation };
  /** As written; the run resolves it against the config file's directory. */
  entryPoint?: string;
  /** As written; the run resolves it against the config file's directory. */
  workspace?: string;
  personas: string[];
  /** The golden evals, validated, each with the line its entry starts on. */
  evals: { entry: EvalEntry; location: SourceLocation }[];
}

export type TaskStart =
  | { kind: "url"; url: string }
  | {
      kind: "path";
      /** As the user named it, relative to the working directory. */
      display: string;
      abs: string;
    };

/** One run: one start, one task, one persona. */
export interface TaskSpec {
  /** The `--task` text, or the journey's title. */
  task: string;
  journey: TaskJourney | null;
  persona: TaskPersona | null;
  start: TaskStart;
  /** Absolute seed directory, or null for an empty workspace. */
  workspaceSeed: string | null;
  /** As shown in output: the seed relative to the working directory, or null. */
  workspaceDisplay: string | null;
}

/** Workspace-relative POSIX paths, sorted. */
export interface WorkspaceChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

/** Everything a finished run hands the judge. */
export interface RunEvidence {
  spec: TaskSpec;
  trace: Trace;
  /** Absolute path of the saved stream. */
  tracePath: string;
  /** Absolute; still on disk until judging returns. */
  workspaceDir: string;
  /** Absolute docs copy for a path start, or null. */
  docsDir: string | null;
  /** Absolute path of the start page inside `docsDir`, or null for a URL start. */
  startCopy: string | null;
  /** The synthetic user's last message. */
  account: string;
  changes: WorkspaceChanges;
  /** The directory paths in evals and output are relative to. */
  configDir: string;
}

/**
 * `skipped` is a deterministic grader that could not apply (a `cost` eval on a
 * stream with no cost, say). It never fails a run and never counts as a pass.
 */
export type TaskEvalOutcome = "pass" | "fail" | "error" | "needs-review" | "skipped";

export interface TaskEval {
  id: string;
  grader: string;
  severity: Severity;
  outcome: TaskEvalOutcome;
  assertion?: string;
  /** A deterministic finding, a judge's reasoning, or an error. */
  message?: string;
  /** Null for a URL-start task source. */
  location: SourceLocation | null;
  consensus?: {
    votes: { pass: number; fail: number; partial: number; error: number };
    meanConfidence: number;
  };
}

export interface JudgedRun {
  /** In report order: success and golden, or completed; followed-the-docs; then each constraint. */
  evals: TaskEval[];
  /** The pages the judge read, start page first, relative to the docs root (or URLs). */
  docs: string[];
}

export interface JudgeRunOptions {
  /** `--provider`, the judge's. */
  provider?: string;
  /** `--model`, the judge's. */
  model?: string;
  /** The config file's top-level `providers:`; `{}` when absent. */
  providers: ProvidersConfig;
  /** Test seam: the judge, instead of one built from the options above. */
  judgeProvider?: InferenceProvider;
}

export type JudgeRun = (evidence: RunEvidence, options: JudgeRunOptions) => Promise<JudgedRun>;
