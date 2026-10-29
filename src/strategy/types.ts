/**
 * The strategy domain's records, references, findings and config (proposal
 * 0102). A record is a page declaring `type: audience`, `type: persona` or
 * `type: journey`. A reference is a value of a page's `audiences:`,
 * `personas:` or `journeys:`, read through meta's merged view so a value in a
 * `{page}.meta.yaml` counts. A journey's own `personas:` is its parent field,
 * not a reference.
 */
import type { Guidance } from "../shared/guidance.js";
import type { ConfigFile } from "../shared/config-file.js";
import type { CollectionConfig } from "../shared/collections.js";
import type { Severity } from "../shared/severity.js";
import { RECORD_TYPES, type RecordField, type RecordType } from "../shared/reference-fields.js";

/** The three record types, parent first, from `src/shared/reference-fields.ts`. */
export { RECORD_TYPES, type RecordType };

/** The page field that names records of each type. Each is a key of `RECORD_FIELDS`. */
export const PAGE_FIELDS = {
  audience: "audiences",
  persona: "personas",
  journey: "journeys",
} as const satisfies Record<RecordType, RecordField>;
export type PageField = (typeof PAGE_FIELDS)[RecordType];

/**
 * The field a record names its parents in: a persona's `audience:`, a
 * journey's `personas:`. Either holds one string or a list.
 */
export const PARENTS = { persona: "audience", journey: "personas" } as const satisfies Record<
  Exclude<RecordType, "audience">,
  RecordField
>;
export type ChildType = keyof typeof PARENTS;
export type ParentField = (typeof PARENTS)[ChildType];

/** Every field whose value names a record. */
export type ReferenceField = PageField | ParentField;

/** Every rule `strategy check` reports, in the order the rules page lists them. */
export const STRATEGY_RULES = [
  "undefined-reference",
  "duplicate-id",
  "missing-parent",
  "orphan-record",
  "unserved-journey",
  "unused-record",
  "broken-step",
  "stale-step",
  "missing-journey",
  "unwritten-step",
] as const;
export type StrategyRule = (typeof STRATEGY_RULES)[number];

/** A rule's level: the family scale plus `off`, which drops the rule's findings. */
export type StrategySeverity = Severity | "off";

/** A file, and the 1-based line in it when one is known. */
export interface At {
  file: string;
  line?: number;
}

export interface StrategyRecord {
  /** `id:`, else the file stem. Compared case-folded. */
  id: string;
  type: RecordType;
  title?: string;
  description?: string;
  /** `lifecycle:`, from meta's `manni:lifecycle:1.0.0`. A `draft` or `archived` journey is exempt from `unserved-journey`. */
  lifecycle?: string;
  /** The page the record was read from, as the run labels it. */
  file: string;
  line: number;
  /** Where `id:` is declared, when the record declares one. */
  idAt?: At;
  /** The values of `audience:` on a persona or `personas:` on a journey, each where it is declared. Empty on an audience. */
  parents: (At & { value: string })[];
  /**
   * The record's metadata, its sidecars merged in. The docevals judge reads
   * a persona's descriptive fields from it (proposal 0111). No strategy
   * output prints it.
   */
  data: Record<string, unknown>;
  /** A journey's `steps:`, when it carries at least one mapping. Never set on an audience or a persona. */
  steps?: StrategyStep[];
}

/**
 * One item of a journey's `steps:` (proposal 0106). A field that is not of
 * its type reads as absent; the shape is meta's to validate.
 */
export interface StrategyStep {
  /** The step's position in `steps:`, from 1. */
  n: number;
  stage?: string;
  doc?: string;
  exists?: boolean | "partial";
  note?: string;
  /** Where the step starts. */
  file: string;
  line?: number;
  docAt?: At;
  existsAt?: At;
}

/** What `strategy` makes of a step's `doc` and `exists`. */
export type StepState = "served" | "unclaimed" | "partial" | "unwritten" | "broken" | "unchecked";

export interface ResolvedStep extends StrategyStep {
  state: StepState;
  /** The page `doc` names, as a label of the run, when it names one. */
  page?: string;
}

export interface StrategyReference {
  field: PageField;
  value: string;
  /** Where the value is declared: the page, or the manifest that supplied it. */
  file: string;
  line?: number;
  /** The page the value belongs to. */
  page: string;
  /** Whether that page is itself a record. A record's values are checked, never counted as a page naming. */
  record: boolean;
}

export interface StrategySet {
  records: StrategyRecord[];
  references: StrategyReference[];
  /** The labels of the run's inputs that are not records: what a step's `doc` may name. Absent reads as none. */
  pages?: string[];
  /** Each input's plain `id`, by label: what names its `{id}` manifest (proposal 0126). Absent reads as none. */
  ids?: Map<string, string>;
}

export interface StrategyFinding {
  rule: StrategyRule;
  /** `manni:strategy/<rule>`. */
  ruleId: string;
  severity: Severity;
  /** What happened, then what to do about it. */
  message: string;
  /** The message before its advice: the baseline's identity. Never printed. */
  key?: string;
  guidance: Guidance;
  file: string;
  line?: number;
  /** The record the finding is about, when it is about one. */
  id?: string;
  /** The field that breaks the rule, when one does. */
  field?: ReferenceField | "steps";
}

/** The `strategy:` section. Every key is optional. */
export interface StrategyConfig {
  severity?: Partial<Record<StrategyRule, StrategySeverity>>;
  baseline?: string;
  allowEmpty?: boolean;
  respectGitignore?: boolean;
}

/** What every command core resolves before touching a file. */
export interface StrategyRun {
  config: StrategyConfig | null;
  /** The positional inputs, or the selected collections' `paths:`. */
  inputs: string[];
  /** Directory `inputs` resolve from: cwd for positional inputs, the config directory for collections. */
  base: string;
  collections: CollectionConfig[];
  fromCollections: boolean;
  configDir?: string;
  configPath?: string;
  configSource?: string;
  configFile?: ConfigFile;
}
