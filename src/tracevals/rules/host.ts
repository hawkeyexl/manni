/**
 * The model host seam (proposal 0079, "Concurrency and the model host").
 *
 * The host is one background process per machine and user that keeps a local
 * model loaded between hooks, with a queue, leases and keep-alive. The
 * inference library owns it. Every host-dependent behavior goes through this
 * module and no other, and the library's three calls are injectable so a test
 * never starts a real host.
 */
import {
  leaseModelHost,
  ModelHostBusyError,
  modelHostStatus,
  releaseModelHost,
  type LlamaCppProviderOptions,
} from "@hawkeyexl/inference";
import { DEFAULT_KEEP_ALIVE_MS } from "../../shared/providers.js";

/** A request that waits this long in the host's queue is withdrawn. */
export const QUEUE_WAIT_MS = 120_000;

/** The library's host calls, as this module uses them. */
export interface HostApi {
  lease: typeof leaseModelHost;
  status: typeof modelHostStatus;
  release: typeof releaseModelHost;
}

const library: HostApi = {
  lease: leaseModelHost,
  status: modelHostStatus,
  release: releaseModelHost,
};

export interface ReleaseResult {
  /** Sessions whose lease was returned. */
  released: string[];
  /** Models the host unloaded. */
  unloaded: string[];
  hostStopped: boolean;
}

/** What `manni status` shows of a running host. */
export interface HostStatus {
  pid: number;
  models: { model: string; sessions: number; idleMs: number; queued: number }[];
}

/** The host fields of a `llama-cpp` provider spec. */
export type HostSetting = Pick<
  LlamaCppProviderOptions,
  "host" | "session" | "keepAlive" | "hostWaitMs"
>;

/**
 * How a provider reaches the host. Inside a hook it starts one if none runs,
 * under the session's lease. By hand it uses a running host and never starts
 * one.
 */
export function hostSetting(
  inLoop: boolean,
  sessionId: string | undefined,
  keepAliveMs: number | undefined,
): HostSetting {
  if (!inLoop || sessionId === undefined) return { host: "connect" };
  return {
    host: "spawn",
    session: sessionId,
    keepAlive: keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS,
    hostWaitMs: QUEUE_WAIT_MS,
  };
}

/**
 * `prepare` under SessionStart: take the session's lease and load the model,
 * so the first Stop finds it warm. True when the model is now loaded. A host
 * that cannot start or load leaves the model cold, which the first Stop
 * handles, so it never fails `prepare`.
 */
export async function warmModel(
  lease: {
    sessionId: string;
    model: string;
    keepAliveMs: number;
    modelsDirectory?: string;
  },
  api: HostApi = library,
): Promise<boolean> {
  try {
    const held = await api.lease({
      model: lease.model,
      session: lease.sessionId,
      keepAlive: lease.keepAliveMs,
      spawn: true,
      hostWaitMs: QUEUE_WAIT_MS,
      ...(lease.modelsDirectory !== undefined ? { modelsDirectory: lease.modelsDirectory } : {}),
    });
    return held !== null;
  } catch {
    return false;
  }
}

/** `release`: return one session's lease, or every lease with `all`. */
export function releaseHost(
  target: { sessionId: string } | { all: true },
  api: HostApi = library,
): Promise<ReleaseResult> {
  return api.release("all" in target ? { all: true } : { session: target.sessionId });
}

/** The running host, or null when there is none. */
export async function hostStatus(api: HostApi = library): Promise<HostStatus | null> {
  const status = await api.status();
  if (status === null) return null;
  return {
    pid: status.pid,
    models: status.models.map(({ model, sessions, idleMs, queued }) => ({
      model,
      sessions,
      idleMs,
      queued,
    })),
  };
}

/**
 * Whether the host already holds `model` loaded. A host that cannot be
 * reached, or that errors, holds nothing as far as a caller can tell.
 */
export async function hostHolds(model: string, api: HostApi = library): Promise<boolean> {
  try {
    return (await hostStatus(api))?.models.some((m) => m.model === model) ?? false;
  } catch {
    return false;
  }
}

/**
 * Run a request for `model`. The host's queue lives inside the provider, so
 * `busy` is its `ModelHostBusyError`: the call waited `QUEUE_WAIT_MS` and
 * nothing ran.
 */
export async function queued<T>(
  _model: string,
  run: () => Promise<T>,
): Promise<{ busy: false; value: T } | { busy: true }> {
  try {
    return { busy: false, value: await run() };
  } catch (err) {
    if (err instanceof ModelHostBusyError || (err instanceof Error && err.name === "ModelHostBusyError")) {
      return { busy: true };
    }
    throw err;
  }
}
