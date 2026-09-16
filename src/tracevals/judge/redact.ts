/**
 * Redaction for the judge digest (ADR 01020).
 *
 * `renderTrace` builds the only trace-derived text that leaves this machine,
 * and a session transcript routinely carries credentials: a `Bash` input with
 * an `Authorization` header, an `.env` file echoed into a message, a key pasted
 * into a prompt. Every block that enters the digest is filtered through here
 * first.
 *
 * This is **best-effort pattern matching, not a guarantee.** It recognizes
 * shapes — vendor key prefixes, auth schemes, secret-looking assignment names —
 * so it catches the common accidents and cannot catch an arbitrary secret that
 * looks like ordinary prose. `--deterministic-only` is the only setting that
 * guarantees nothing leaves the machine.
 *
 * Two properties the rest of the system leans on:
 *
 *  - **Stable output.** A given input always redacts to the same text, so
 *    `sha256(renderedTrace)` stays a usable judge cache key.
 *  - **Idempotent.** Placeholders contain no `=`, no `:` inside quotes, and no
 *    vendor prefix, so redacting redacted text is a no-op.
 */
import { TracevalsError } from "../types.js";

export interface RedactionPattern {
  /** Kebab name; appears in the placeholder so a reader knows what went. */
  label: string;
  pattern: RegExp;
  /** Replacement template; `$1`-style references into `pattern` are allowed. */
  replacement: string;
}

/**
 * Names that mark a value as secret, in the shapes they appear in shell
 * assignments and in JSON object members (tool inputs render as JSON).
 *
 * The whole name must match, which is what keeps `monkey` out of the `key`
 * alternative: the `(?:[A-Za-z0-9]+[_\-.])*` prefix only consumes segments that
 * end in a separator. `api[_\-.]?key` covers `apiKey` and `API_KEY` alike under
 * the `i` flag.
 */
const SECRET_NAME =
  "(?:(?:[A-Za-z0-9]+[_\\-.])*(?:api[_\\-.]?key|access[_\\-.]?key|secret[_\\-.]?key|auth[_\\-.]?token|access[_\\-.]?token|refresh[_\\-.]?token|client[_\\-.]?secret|session[_\\-.]?token|key|token|secret|password|passwd|passphrase|credentials?|authorization)|AWS_[A-Za-z0-9_]+)";

/**
 * Applied in order. Broad structural shapes first (a private key block spans
 * lines and would otherwise be chewed up by the narrower rules), then vendor
 * prefixes, then name-driven assignment forms.
 */
export const REDACTION_PATTERNS: readonly RedactionPattern[] = [
  {
    label: "private-key",
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement: "[redacted:private-key]",
  },
  {
    // `sk-`, `sk-ant-…`, `pk-`, `rk-`: the OpenAI/Anthropic/Stripe family.
    label: "api-key",
    pattern: /\b[sprk]k-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_-]{16,}/g,
    replacement: "[redacted:api-key]",
  },
  {
    label: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g,
    replacement: "[redacted:aws-access-key-id]",
  },
  {
    label: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    replacement: "[redacted:github-token]",
  },
  {
    label: "slack-token",
    pattern: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/g,
    replacement: "[redacted:slack-token]",
  },
  {
    label: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "[redacted:google-api-key]",
  },
  {
    label: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: "[redacted:jwt]",
  },
  {
    // `Authorization: Bearer …`, `Basic …`, `Token …`. The scheme is kept so
    // the judge can still see that authentication happened.
    //
    // Deliberately *not* case-insensitive as a whole: `basic` and `token` are
    // ordinary English words, and `/i` would redact "basic configuration" as an
    // auth header. `bearer` is not, so it gets both spellings.
    label: "auth-token",
    pattern: /\b([Bb]earer|Basic|Token)\s+[A-Za-z0-9\-._~+/]{12,}={0,2}/g,
    replacement: "$1 [redacted:auth-token]",
  },
  {
    // JSON member — the shape a tool input renders as.
    label: "secret-member",
    pattern: new RegExp(`("${SECRET_NAME}"\\s*:\\s*)"[^"]*"`, "gi"),
    replacement: '$1"[redacted:secret-value]"',
  },
  {
    // Shell / `.env` assignment. The variable name is kept: knowing that a
    // secret was set, and which one, is often the adherence question.
    label: "secret-assignment",
    pattern: new RegExp(
      `\\b(${SECRET_NAME})(\\s*=\\s*)(?:"[^"\\n]*"|'[^'\\n]*'|[^\\s"'\\n]+)`,
      "gi",
    ),
    replacement: "$1$2[redacted:secret-value]",
  },
];

/** Placeholder used for a pattern the config supplied; it has no label. */
export const CUSTOM_PLACEHOLDER = "[redacted]";

export type Redactor = (text: string) => string;

/**
 * Build the redactor for a run. Configured patterns are applied **after** the
 * built-ins and never replace them: a project adding one pattern of its own
 * must not silently lose the whole floor, which is the same reasoning that
 * makes `--require` additive (ADR 01017).
 *
 * A pattern that will not compile is an operational error raised here, not a
 * throw from inside the judge and never a silent skip — a dropped pattern is a
 * silent leak.
 */
export function makeRedactor(extra: readonly string[] = []): Redactor {
  // Compiled once and reused across every block of a render. Safe with a `g`
  // regex because `String.prototype.replace` sets `lastIndex` to 0 before it
  // starts and leaves it at 0 — unlike `exec`/`test`, where the shared instance
  // state would make a reused pattern skip matches.
  const custom = compileRedactPatterns(extra).map(
    (pattern) => [pattern, CUSTOM_PLACEHOLDER] as const,
  );
  const all: ReadonlyArray<readonly [RegExp, string]> = [
    ...REDACTION_PATTERNS.map(
      ({ pattern, replacement }) => [pattern, replacement] as const,
    ),
    ...custom,
  ];
  return (text) => {
    let out = text;
    for (const [pattern, replacement] of all) {
      out = out.replace(pattern, replacement);
    }
    return out;
  };
}

/**
 * Compile configured pattern sources, or say which one is unusable. Exported so
 * `parseConfig()` can reject a bad pattern at load time rather than at the
 * moment a digest is about to be sent.
 */
export function compileRedactPatterns(sources: readonly string[]): RegExp[] {
  return sources.map((source) => {
    try {
      return new RegExp(source, "g");
    } catch (err) {
      throw new TracevalsError(
        `invalid config: judge.redact pattern ${JSON.stringify(source)} is not a valid regular expression: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });
}
