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
