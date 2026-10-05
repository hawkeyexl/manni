/**
 * XML text escaping, shared by every reporter that writes XML.
 *
 * Moved here from meta's JUnit writer when tracevals needed it too, so the
 * family keeps one escaping rule rather than one per tool.
 */

const XML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Escape every XML metacharacter, and drop the control characters XML 1.0
 * forbids outright.
 *
 * `>` and `'` do not strictly need escaping in every position, but escaping all
 * five unconditionally means no caller has to know which position it is in —
 * which is precisely the reasoning a partial escaper gets wrong. The control
 * character strip is separate: those cannot be represented in XML 1.0 at all,
 * escaped or not, so a stray one makes the whole document unparseable rather
 * than merely mis-rendered. Tab, newline, and carriage return are legal, and
 * kept.
 */
/**
 * XML 1.0's `Char` production, in full:
 *
 *   #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
 *
 * C0 controls are the familiar exclusion, but they are not the only one: a lone
 * surrogate half and the noncharacters U+FFFE/U+FFFF are equally illegal, and
 * both sit in a JavaScript string quite happily — a schema-authored `pattern`
 * or a filename can carry either. Iterating with `for…of` yields whole code
 * points, so a *well-formed* surrogate pair arrives as one astral character
 * (>= U+10000) and is kept; only an unpaired half falls in the D800-DFFF gap
 * and is dropped.
 */
function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

export function xmlEscape(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isXmlChar(code)) continue;
    out += XML_ENTITIES[ch] ?? ch;
  }
  return out;
}
