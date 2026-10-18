/**
 * A machine's local-model state, faked through the inference library's own
 * environment seams: `INFERENCE_RUNTIME_DIR` holds the runtime's loader, and
 * `INFERENCE_MODELS_DIR` the weights. Nothing is downloaded or loaded; the
 * library only looks for the files.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blobNameFor } from "@hawkeyexl/inference";

/** A concrete catalog alias, so resolving it needs no memory probe. */
export const LOCAL_MODEL = "granite-4.1-3b-q2";

export interface LocalModelEnv {
  /** The variables to hand a process, or to stub in this one. */
  env: { INFERENCE_RUNTIME_DIR: string; INFERENCE_MODELS_DIR: string };
  cleanup(): void;
}

/**
 * `downloaded: true` puts a runtime loader and `LOCAL_MODEL`'s weights on
 * "disk"; `false` leaves both directories empty.
 */
export function localModelEnv(downloaded: boolean): LocalModelEnv {
  const root = mkdtempSync(join(tmpdir(), "manni-local-model-"));
  const runtime = join(root, "runtime");
  const models = join(root, "models");
  mkdirSync(runtime);
  mkdirSync(models);
  if (downloaded) {
    writeFileSync(join(runtime, "loader.mjs"), "export {};\n");
    writeFileSync(join(models, blobNameFor(LOCAL_MODEL)), "not weights\n");
  }
  return {
    env: { INFERENCE_RUNTIME_DIR: runtime, INFERENCE_MODELS_DIR: models },
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
