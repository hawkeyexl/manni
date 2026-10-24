/** Remove only the empty block WebLLM prepends for a non-thinking answer. */
export function modelAnswerText(raw: string): string {
  const stripped = raw.replace(/^\s*<think>\s*<\/think>\s*/i, "");
  if (stripped !== raw) return stripped;
  const start = raw.trimStart().toLowerCase();
  if ("<think>".startsWith(start)) return "";
  if (start.startsWith("<think>")) {
    const remainder = start.slice("<think>".length).trim();
    if (remainder === "" || "</think>".startsWith(remainder)) return "";
  }
  return raw;
}

/** A nonempty leading reasoning block violates the direct-answer protocol. */
export function hasModelReasoning(raw: string): boolean {
  return /^\s*<think>/i.test(modelAnswerText(raw));
}
