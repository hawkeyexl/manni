/**
 * The model host seam (proposal 0079, "Concurrency and the model host").
 *
 * The host is one background process per machine and user that keeps a local
 * model loaded between hooks, with a queue, leases and keep-alive. The
 * inference library owns it, and the release that carries it has not landed.
 * Until it does, everything runs in-process and these functions answer as
 * though no host is running. Every host-dependent behavior goes through this
 * module and no other, so the host arrives by changing only what is below.
 */

/** A request that waits this long in the host's queue is withdrawn. */
export const QUEUE_WAIT_MS = 120_000;

export interface ReleaseResult {
  /** Sessions whose lease was returned. */
  released: string[];
  /** Models the host unloaded. */
  unloaded: string[];
  hostStopped: boolean;
}

/** What `manni status` shows of a running host. */
export interface HostStatus {
  models: { model: string; sessions: number; idleMs: number }[];
}

/**
 * `prepare` under SessionStart: take the session's lease and load the model,
 * so the first Stop finds it warm. True when the model is now loaded.
 */
export function warmModel(_lease: {
  sessionId: string;
  model: string;
  keepAliveMs: number;
}): Promise<boolean> {
  return Promise.resolve(false);
}

/** `release`: return one session's lease, or every lease with `all`. */
export function releaseHost(
  _target: { sessionId: string } | { all: true },
): Promise<ReleaseResult> {
  return Promise.resolve({ released: [], unloaded: [], hostStopped: false });
}

/** The running host, or null when there is none. */
export function hostStatus(): Promise<HostStatus | null> {
  return Promise.resolve(null);
}

/**
 * Run a request for `model` in the host's queue. In-process there is no
 * queue, so it always runs. `busy` is the withdrawal after `QUEUE_WAIT_MS`.
 */
export async function queued<T>(
  _model: string,
  run: () => Promise<T>,
): Promise<{ busy: false; value: T } | { busy: true }> {
  return { busy: false, value: await run() };
}
