/**
 * The family's value encryption (proposal 0045): deterministic, SIV-style
 * AES-256-GCM, so equal plaintexts give equal tokens and joins work, with the
 * plaintext padded to a size class so a token's length says little.
 */
import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_VALUE,
  ENCRYPTION_KEY_SHAPE,
  decryptValue,
  encryptValue,
  generateEncryptionKey,
  isEncryptedValue,
  isValidEncryptionKey,
  keyedPin,
} from "../src/shared/encryption.js";

const KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const OTHER = "0000000000000000000000000000000000000000000000000000000000000001";

/** Flip one base64url character of a token's body, keeping the alphabet. */
function flipAt(token: string, index: number): string {
  const ch = token.charAt(index);
  const swapped = ch === "A" ? "B" : "A";
  return token.slice(0, index) + swapped + token.slice(index + 1);
}

describe("encryptValue / decryptValue", () => {
  it.each([
    ["a string", "platform"],
    ["an empty string", ""],
    ["a number", 42.5],
    ["a boolean", false],
    ["null", null],
    ["an array", ["a", 1, true]],
    ["an object", { team: "billing", tier: 2 }],
    ["a long string", "x".repeat(300)],
  ])("round-trips %s to its own type", (_label, value) => {
    const token = encryptValue(value, KEY, "meta");
    expect(decryptValue(token, KEY, "meta")).toEqual({ ok: true, value });
  });

  it("is deterministic: the same input gives the same token", () => {
    expect(encryptValue("platform", KEY, "meta")).toBe(
      encryptValue("platform", KEY, "meta"),
    );
  });

  it("different values give different tokens", () => {
    expect(encryptValue("platform", KEY, "meta")).not.toBe(
      encryptValue("billing", KEY, "meta"),
    );
  });

  it("separates contexts: a meta token does not decrypt as cite-src", () => {
    const token = encryptValue("platform", KEY, "meta");
    expect(encryptValue("platform", KEY, "cite-src")).not.toBe(token);
    expect(decryptValue(token, KEY, "cite-src")).toEqual({ ok: false });
  });

  it("a different key does not decrypt", () => {
    const token = encryptValue("platform", KEY, "meta");
    expect(decryptValue(token, OTHER, "meta")).toEqual({ ok: false });
  });

  it("a flipped character does not decrypt, wherever it is", () => {
    const token = encryptValue("platform", KEY, "meta");
    for (const i of [1, 2, 10, 20, 40, 60, token.length - 2]) {
      expect(decryptValue(flipAt(token, i), KEY, "meta")).toEqual({ ok: false });
    }
  });

  it("the shortest token has an 82-character body, and one size class hides the value", () => {
    const shortest = encryptValue("", KEY, "meta");
    expect(shortest.startsWith("~")).toBe(true);
    expect(shortest.slice(1)).toHaveLength(82);
    expect(shortest).toHaveLength(83);
    expect(shortest).toMatch(ENCRYPTED_VALUE);
    expect(encryptValue("platform", KEY, "meta")).toHaveLength(
      encryptValue("billing", KEY, "meta").length,
    );
  });

  it("the next size class starts at 32 bytes of JSON", () => {
    // 30 characters plus two quotes is 32 bytes, which needs a second block.
    const small = encryptValue("x".repeat(29), KEY, "meta");
    const large = encryptValue("x".repeat(30), KEY, "meta");
    expect(small).toHaveLength(83);
    expect(large.length).toBeGreaterThan(small.length);
  });

  it("refuses to encrypt undefined, which is not JSON", () => {
    expect(() => encryptValue(undefined, KEY, "meta")).toThrow();
  });

  it("never throws on garbage, returning { ok: false }", () => {
    const token = encryptValue("platform", KEY, "meta");
    for (const bad of [
      "",
      "~",
      "platform",
      "~" + "A".repeat(82),
      token.slice(0, -1),
      token + "A",
      token.slice(1),
      "~" + "A".repeat(81) + "!",
    ]) {
      expect(decryptValue(bad, KEY, "meta")).toEqual({ ok: false });
    }
  });

  it("rejects a token whose version byte is not 1", () => {
    const token = encryptValue("platform", KEY, "meta");
    const bytes = Buffer.from(token.slice(1), "base64url");
    bytes[0] = 2;
    expect(decryptValue(`~${bytes.toString("base64url")}`, KEY, "meta")).toEqual({
      ok: false,
    });
  });

  it("a key that is not key-shaped does not decrypt", () => {
    const token = encryptValue("platform", KEY, "meta");
    expect(decryptValue(token, "short", "meta")).toEqual({ ok: false });
  });
});

describe("isEncryptedValue", () => {
  it("accepts a token and refuses everything else", () => {
    expect(isEncryptedValue(encryptValue("x", KEY, "meta"))).toBe(true);
    expect(isEncryptedValue("~short")).toBe(false);
    expect(isEncryptedValue("platform")).toBe(false);
    expect(isEncryptedValue(42)).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
  });
});

describe("keyedPin", () => {
  it("is sha256-prefixed lowercase hex, stable, and differs by key", () => {
    const pin = keyedPin("src/limits.ts", KEY);
    expect(pin).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(keyedPin("src/limits.ts", KEY)).toBe(pin);
    expect(keyedPin("src/limits.ts", OTHER)).not.toBe(pin);
    expect(keyedPin("src/other.ts", KEY)).not.toBe(pin);
  });
});

describe("encryption keys", () => {
  it("generates 64 lowercase hex characters, fresh each time", () => {
    const a = generateEncryptionKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(generateEncryptionKey()).not.toBe(a);
    expect(isValidEncryptionKey(a)).toBe(true);
  });

  it("accepts 64 hex and 43-character base64url", () => {
    expect(isValidEncryptionKey(KEY)).toBe(true);
    const b64 = Buffer.alloc(32, 7).toString("base64url");
    expect(b64).toHaveLength(43);
    expect(isValidEncryptionKey(b64)).toBe(true);
    expect(ENCRYPTION_KEY_SHAPE.test(b64)).toBe(true);
  });

  it("refuses 31 characters, whitespace, and non-strings", () => {
    expect(isValidEncryptionKey("a".repeat(31))).toBe(false);
    expect(isValidEncryptionKey("a".repeat(32))).toBe(true);
    expect(isValidEncryptionKey("a b")).toBe(false);
    expect(isValidEncryptionKey(`${KEY} `)).toBe(false);
    expect(isValidEncryptionKey(12345)).toBe(false);
    expect(isValidEncryptionKey(undefined)).toBe(false);
  });
});
