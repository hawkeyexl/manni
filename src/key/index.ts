/**
 * The key domain's programmatic API, exported from the package as the `key`
 * namespace: `import { key } from "@hawkeyexl/manni"`. The command cores, and
 * the family's encryption primitives a caller needs beside them.
 */
export * from "./types.js";
export { KeyError } from "./errors.js";
export { runKeySet } from "./commands/set.js";
export { runKeyRotate } from "./commands/rotate.js";
export { decryptValue, encryptValue, isEncryptedValue } from "../shared/encryption.js";
export type { EncryptionContext } from "../shared/encryption.js";
export { resolveEncryptionKey } from "../shared/encryption-key.js";
export type { KeySource, ResolvedKey } from "../shared/encryption-key.js";
