/** Chunk-0 placeholder. Every module starts as its signature; a chunk replaces the body. */
export function notImplemented(name: string, ..._args: unknown[]): never {
  throw new Error(`not implemented: ${name}`);
}
