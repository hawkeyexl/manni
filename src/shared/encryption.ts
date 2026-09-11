/**
 * The family's value encryption (proposal 0045).
 *
 * One ciphertext format for every tool: meta frontmatter values and cite
 * source paths encrypt the same way, under different contexts, so rotation
 * has one rule. Pure, and `node:crypto` only.
 *
 * The construction is SIV-style on AES-256-GCM, because Node has no SIV mode
 * (`aes-256-gcm-siv` and `aes-*-siv` are unknown ciphers in Node 24):
 *
 * - Three 32-byte subkeys come from the configured key with HKDF-SHA256 and an
 *   empty salt, labelled `manni/v1/encrypt`, `manni/v1/nonce` and
 *   `manni/v1/pin`. The key is expanded, not stretched: a hand-picked value is
 *   only as strong as it is random, which is why `manni key set` generates 256
 *   bits.
 * - The plaintext is the value's JSON, padded ISO/IEC 7816-4 style (`0x80`,
 *   then `0x00` up to the next multiple of 32, always at least one pad byte),
 *   so a token's length reveals a size class, not the value.
 * - The nonce is the first 12 bytes of `HMAC(nonceKey, context ‖ 0x00 ‖
 *   padded)`. Equal plaintexts give equal tokens, which is what a join needs;
 *   decryption checks the nonce is that HMAC, so every valid token is
 *   canonical.
 * - The associated data is `0x01 ‖ context`, so the same text in two contexts
 *   never reuses a nonce under different tags. The property name is not
 *   bound: a value moved between fields stays readable.
 *
 * A token is `~` then unpadded base64url of `0x01 ‖ nonce ‖ ciphertext ‖
 * tag`: 61 bytes at the smallest, so 82 characters after the `~`.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { TextDecoder } from "node:util";

/** Which kind of value a token holds. Bound as associated data. */
export type EncryptionContext = "meta" | "cite-src";

/** An encrypted value: `~` and at least 82 base64url characters. */
export const ENCRYPTED_VALUE = /^~[A-Za-z0-9_-]{82,}$/;

/** Whether `value` is shaped like a token. Says nothing about which key. */
export function isEncryptedValue(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTED_VALUE.test(value);
}

/** A configured key: hex or base64url, at least 32 characters. */
export const ENCRYPTION_KEY_SHAPE = /^[A-Za-z0-9_-]{32,}$/;

export function isValidEncryptionKey(value: unknown): value is string {
  return typeof value === "string" && ENCRYPTION_KEY_SHAPE.test(value);
}

/** 256 random bits as 64 lowercase hex characters. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

const VERSION = 0x01;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const BLOCK = 32;
/** Version byte, nonce, one padded block, tag. */
const MIN_BYTES = 1 + NONCE_BYTES + BLOCK + TAG_BYTES;

interface Subkeys {
  encrypt: Buffer;
  nonce: Buffer;
  pin: Buffer;
}

/**
 * Subkeys per configured key. A run sees one key, or two while rotating, so
 * the cache stays tiny; it saves three HKDF calls per value on a large tree.
 */
const subkeyCache = new Map<string, Subkeys>();

function subkeys(key: string): Subkeys {
  const cached = subkeyCache.get(key);
  if (cached !== undefined) return cached;
  const ikm = Buffer.from(key, "utf8");
  const derive = (info: string): Buffer =>
    Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), info, 32));
  const made: Subkeys = {
    encrypt: derive("manni/v1/encrypt"),
    nonce: derive("manni/v1/nonce"),
    pin: derive("manni/v1/pin"),
  };
  subkeyCache.set(key, made);
  return made;
}

function requireKey(key: string, caller: string): void {
  if (!isValidEncryptionKey(key)) {
    // Never echo the value: it is key material.
    throw new Error(
      `${caller}: the key must be at least 32 hex or base64url characters.`,
    );
  }
}

function pad(data: Buffer): Buffer {
  const out = Buffer.alloc((Math.floor(data.length / BLOCK) + 1) * BLOCK);
  data.copy(out);
  out[data.length] = 0x80;
  return out;
}

/** The data before the padding, or `null` when the padding is not canonical. */
function unpad(padded: Buffer): Buffer | null {
  let i = padded.length - 1;
  while (i >= 0 && padded[i] === 0) i--;
  if (i < 0 || padded[i] !== 0x80) return null;
  // Exactly the padding `pad` would have added: never a spare block.
  if (padded.length !== (Math.floor(i / BLOCK) + 1) * BLOCK) return null;
  return padded.subarray(0, i);
}

function nonceFor(keys: Subkeys, context: Buffer, padded: Buffer): Buffer {
  return createHmac("sha256", keys.nonce)
    .update(context)
    .update(Buffer.from([0x00]))
    .update(padded)
    .digest()
    .subarray(0, NONCE_BYTES);
}

function aad(context: Buffer): Buffer {
  return Buffer.concat([Buffer.from([VERSION]), context]);
}

/**
 * Encrypt any JSON value. Throws for a value that is not JSON (`undefined`, a
 * function) and for a key that is not key-shaped: both are programming
 * errors, since keys arrive through `resolveEncryptionKey`.
 */
export function encryptValue(
  value: unknown,
  key: string,
  context: EncryptionContext,
): string {
  requireKey(key, "encryptValue");
  // lib.d.ts types the result as `string`, but `undefined`, a function or a
  // symbol stringify to `undefined` at run time.
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) {
    throw new TypeError("encryptValue: the value is not JSON.");
  }
  const keys = subkeys(key);
  const ctx = Buffer.from(context, "utf8");
  const padded = pad(Buffer.from(json, "utf8"));
  const nonce = nonceFor(keys, ctx, padded);
  const cipher = createCipheriv("aes-256-gcm", keys.encrypt, nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aad(ctx));
  const sealed = Buffer.concat([cipher.update(padded), cipher.final()]);
  const tag = cipher.getAuthTag();
  const bytes = Buffer.concat([Buffer.from([VERSION]), nonce, sealed, tag]);
  return `~${bytes.toString("base64url")}`;
}

const FAILED = { ok: false } as const;

/**
 * Decrypt a token. `{ ok: false }` for anything that is not a canonical token
 * under this key and context; never throws.
 */
export function decryptValue(
  token: string,
  key: string,
  context: EncryptionContext,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return open(token, key, context);
  } catch {
    return FAILED;
  }
}

function open(
  token: string,
  key: string,
  context: EncryptionContext,
): { ok: true; value: unknown } | { ok: false } {
  if (!isEncryptedValue(token) || !isValidEncryptionKey(key)) return FAILED;
  const body = token.slice(1);
  const bytes = Buffer.from(body, "base64url");
  // Buffer's decoder ignores stray trailing bits; a token is canonical only
  // if it is exactly what the encoder writes for these bytes.
  if (bytes.toString("base64url") !== body) return FAILED;
  if (bytes.length < MIN_BYTES) return FAILED;
  if ((bytes.length - 1 - NONCE_BYTES - TAG_BYTES) % BLOCK !== 0) return FAILED;
  if (bytes[0] !== VERSION) return FAILED;

  const nonce = bytes.subarray(1, 1 + NONCE_BYTES);
  const sealed = bytes.subarray(1 + NONCE_BYTES, bytes.length - TAG_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  const keys = subkeys(key);
  const ctx = Buffer.from(context, "utf8");
  const decipher = createDecipheriv("aes-256-gcm", keys.encrypt, nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  // `final` throws on a bad tag; the caller turns that into `{ ok: false }`.
  const padded = Buffer.concat([decipher.update(sealed), decipher.final()]);

  if (!timingSafeEqual(nonceFor(keys, ctx, padded), nonce)) return FAILED;
  const data = unpad(padded);
  if (data === null) return FAILED;
  const json = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const value: unknown = JSON.parse(json);
  return { ok: true, value };
}

/**
 * A keyed fingerprint of `text`: `sha256-` and the hex HMAC-SHA256 under the
 * pin subkey. Stable per key, so it can be compared without being reversible.
 */
export function keyedPin(text: string, key: string): string {
  requireKey(key, "keyedPin");
  const mac = createHmac("sha256", subkeys(key).pin)
    .update(text, "utf8")
    .digest("hex");
  return `sha256-${mac}`;
}
