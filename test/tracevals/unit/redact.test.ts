import { describe, expect, it } from "vitest";
import { makeRedactor, REDACTION_PATTERNS } from "../../../src/tracevals/judge/redact.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

// Every literal below is a deliberately fake, non-resolving credential shape.
const redact = makeRedactor();

describe("makeRedactor built-ins", () => {
  it("redacts vendor API keys wherever they sit", () => {
    const out = redact(
      'curl -H "x-api-key: sk-ant-api03-NOTREALNOTREALNOTREALNOTREAL01"',
    );
    expect(out).not.toContain("sk-ant-api03");
    expect(out).toContain("[redacted:api-key]");
  });

  it("redacts bearer tokens but keeps the scheme", () => {
    const out = redact("Authorization: Bearer abcdefghijklmnop0123456789");
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).toContain("Bearer [redacted:auth-token]");
  });

  it("redacts AWS ids and any AWS_* assignment", () => {
    const out = redact(
      "AKIAIOSFODNN7EXAMPLE and AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIfake",
    );
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("wJalrXUtnFEMIfake");
    expect(out).toContain("[redacted:aws-access-key-id]");
    expect(out).toContain("AWS_SECRET_ACCESS_KEY=[redacted:secret-value]");
  });

  it("redacts a whole private key block", () => {
    const out = redact(
      "-----BEGIN RSA PRIVATE KEY-----\nZmFrZWtleQ==\n-----END RSA PRIVATE KEY-----",
    );
    expect(out).not.toContain("ZmFrZWtleQ");
    expect(out).toBe("[redacted:private-key]");
  });

  it("redacts .env-style assignments and keeps the variable name", () => {
    const out = redact("DATABASE_PASSWORD=hunter2\nPORT=3000");
    expect(out).toContain("DATABASE_PASSWORD=[redacted:secret-value]");
    // A non-secret assignment is left alone: over-redaction has a cost too.
    expect(out).toContain("PORT=3000");
  });

  it("redacts secret-shaped JSON members, which is how tool inputs render", () => {
    const out = redact(
      '{"command":"deploy","env":{"apiKey":"totally-fake-value","region":"us-east-1"}}',
    );
    expect(out).not.toContain("totally-fake-value");
    expect(out).toContain('"apiKey":"[redacted:secret-value]"');
    expect(out).toContain("us-east-1");
  });

  it("leaves ordinary prose and paths untouched", () => {
    const text = "Read src/monkey.ts and ran npm test; tokens: 4210";
    expect(redact(text)).toBe(text);
  });

  it("does not read English as an auth header", () => {
    // The reason the auth rule is not wholesale case-insensitive: `basic` and
    // `token` are ordinary words, and `Basic configuration` would otherwise
    // redact as a credential. `bearer` is not a word anyone writes by accident.
    const prose = "Reviewed the basic configuration and the token lifecycle.";
    expect(redact(prose)).toBe(prose);
    expect(redact("authorization: bearer abcdefghijklmnop")).toContain(
      "bearer [redacted:auth-token]",
    );
  });

  it("is idempotent — a placeholder is never re-redacted", () => {
    const once = redact("token=abc123def456ghi789");
    expect(redact(once)).toBe(once);
  });
});

describe("makeRedactor extra patterns", () => {
  it("applies configured patterns on top of the built-ins", () => {
    const scrub = makeRedactor(["ACME-[0-9]{4}"]);
    const out = scrub("ticket ACME-4242 and key sk-ant-api03-FAKEFAKEFAKEFAKE99");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("ACME-4242");
    // The built-ins are a floor, not a default the config replaces.
    expect(out).toContain("[redacted:api-key]");
  });

  it("rejects an unusable pattern rather than silently ignoring it", () => {
    expect(() => makeRedactor(["("])).toThrow(TracevalsError);
  });
});

describe("REDACTION_PATTERNS", () => {
  it("names every built-in so a report can say what was removed", () => {
    for (const entry of REDACTION_PATTERNS) {
      expect(entry.label).toMatch(/^[a-z0-9-]+$/);
      expect(entry.pattern.flags).toContain("g");
    }
  });
});
