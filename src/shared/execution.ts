/**
 * Execution grants: what content-authored code a run may execute.
 *
 * A page or an artifact reaches a shell through a `command` eval declared in
 * its own frontmatter. Both evals domains gate that path on the same grants,
 * spelled the same way, so the values live here once (CLAUDE.md, "Shared
 * concepts use shared values").
 */

/** One capability the operator can grant to content-authored code. */
export type ExecutionGrant = "frontmatter-commands";

export const EXECUTION_GRANTS: readonly ExecutionGrant[] = [
  "frontmatter-commands",
] as const;

/** Whether `value` names a grant that exists. */
export function isExecutionGrant(value: string): value is ExecutionGrant {
  return (EXECUTION_GRANTS as readonly string[]).includes(value);
}

/**
 * The sentence for grants nobody recognizes, shared by the config key and the
 * programmatic `allowExecution` so both name the values that do exist.
 */
export function unknownGrantsMessage(unknown: readonly string[]): string {
  return (
    `unknown execution grant${unknown.length > 1 ? "s" : ""} ` +
    `${unknown.map((u) => `"${u}"`).join(", ")}; ` +
    `expected one of ${EXECUTION_GRANTS.join(" | ")}`
  );
}

/** The usage error for an `--allow-execution` value that names no grant. */
export function allowExecutionMessage(value: string): string {
  return `--allow-execution must be one of ${EXECUTION_GRANTS.join(" | ")}, got "${value}"`;
}

/**
 * Why a content-authored command did not run, as an eval's skip reason. One
 * sentence for both domains, since one grant gates both.
 */
export const NOT_GRANTED_REASON =
  "frontmatter commands not granted (execution.allow: [frontmatter-commands])";

/**
 * The grants one run holds. Everything available runs unless the operator
 * narrows it: `configured` is `execution.allow` (every grant when the key is
 * absent), `allowExecution` keeps only the named grants it already holds, and
 * `execution: false` (`--no-execution`) clears them all. Nothing here widens.
 */
export function grantsFor(
  configured: readonly ExecutionGrant[],
  flags: { allowExecution?: readonly ExecutionGrant[]; execution?: boolean } = {},
): Set<ExecutionGrant> {
  if (flags.execution === false) return new Set();
  const named = flags.allowExecution;
  return new Set(
    named === undefined ? configured : configured.filter((g) => named.includes(g)),
  );
}

/** The string values under `execution.allow`, before any schema has run. */
export function configuredGrants(section: unknown): string[] {
  if (!section || typeof section !== "object") return [];
  const execution = (section as Record<string, unknown>).execution;
  if (!execution || typeof execution !== "object") return [];
  const allow = (execution as Record<string, unknown>).allow;
  return Array.isArray(allow)
    ? allow.filter((g): g is string => typeof g === "string")
    : [];
}
