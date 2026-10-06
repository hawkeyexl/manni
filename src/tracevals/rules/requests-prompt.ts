/**
 * Requirements extraction prompt: asks the provider to read ONE source that
 * says what the session was asked to build or keep, and return each item as a
 * rule in 0079's shape (proposal 0080, "What the session was asked").
 *
 * The sources are the typed prompts, an approved plan, and spec files. The
 * response schema and the `when` grammar are the rules prompt's, so a
 * requirement is judged like any other rule.
 */
import { WHEN_GUIDE } from "./prompt.js";

/**
 * Part of the cache key: bump whenever the prompt changes.
 * `test/tracevals/unit/requests-prompt.test.ts` pins this to a digest of the
 * prompt surface so the pair has to move together.
 */
export const REQUIREMENTS_PROMPT_VERSION = 1;

/** The source formats that say what the session was asked, which this prompt reads. */
const REQUEST_FORMATS: ReadonlySet<string> = new Set([
  "prompt",
  "plan",
  "speckit-spec",
  "kiro-spec",
  "openspec-change",
  "plans",
]);

export function isRequestFormat(format: string): boolean {
  return REQUEST_FORMATS.has(format);
}

export const REQUIREMENTS_SYSTEM_PROMPT = [
  "You read what an AI agent working in a repository was asked to build or keep,",
  "and return each item as a rule.",
  "",
  "The source is one of three things: the prompts a person typed in the",
  "session, numbered in order; a plan the person approved; or a spec file,",
  "such as a feature spec, a design, a task list or a change proposal.",
  "",
  "A rule is something the work must deliver or keep, which a recorded session",
  "transcript could show met or broken. The transcript holds the agent's",
  "prompts, its tool calls (with their inputs), the files it read or wrote, and",
  "its replies. Nothing else is observable.",
  "",
  "Typed prompts are one sequence. Return the set that stands after the last",
  "prompt: a later prompt can add an item, change an earlier one, or drop it.",
  "A question with nothing to build yields nothing. Never return chat, such as",
  "greetings, thanks, or remarks about the work.",
  "",
  "A spec's items keep the spec's own ids, exactly as written, such as",
  "`FR-001`, `T014` or `1.2`. A task the file marks done is still a rule:",
  "ticking it says that task is done.",
  "",
  "Return nothing for background, rationale, examples, open questions, or",
  "items the source marks out of scope.",
  "",
  "Each rule has:",
  "- `id`: the source's own id for the item when it gives one, exactly as",
  "  written. Otherwise a short kebab-case identifier. Unique within this source.",
  "- `text`: one imperative sentence, faithful to the source. Do not strengthen,",
  "  soften or merge items, and do not invent ones the source lacks.",
  ...WHEN_GUIDE,
  "",
  "Return none at all when nothing qualifies.",
].join("\n");

export interface RequirementsUserOptions {
  path: string;
  format: string;
  content: string;
}

export function buildRequirementsUser(options: RequirementsUserOptions): string {
  return [
    "# Request source",
    `path: ${options.path}`,
    `format: ${options.format}`,
    "",
    "# Content",
    "",
    options.content,
  ].join("\n");
}
