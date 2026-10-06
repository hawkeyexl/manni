/**
 * The Claude Code hook envelope, detected rather than switched.
 *
 * A hook command gets one JSON object on stdin, and Claude Code closes the
 * stream after it. When stdin is not a terminal and parses as an object with a
 * string `hook_event_name`, `manni check` and `manni status` speak the hook
 * protocol. Anything else is a run by hand, and stdin is left unread beyond
 * that one look. The look never hangs: `readStdin` gives up on a stream that
 * stays silent, which is what an inherited pipe nobody writes to looks like.
 */
import { readStdin } from "../../tracevals/capture/hook.js";

export interface Envelope {
  /** `hook_event_name`: `PostToolUse`, `Stop`, `SessionStart`, … */
  event: string;
  /** The directory the hook fired in; relative paths resolve from it. */
  cwd?: string;
  /** `tool_name`, on a tool event. */
  toolName?: string;
  /** `tool_input.file_path`, or `tool_input.notebook_path` for a notebook. */
  filePath?: string;
  /** `stop_hook_active`: this stop already follows one repair pass. */
  stopHookActive: boolean;
  /** `model`, on `SessionStart`: a string, or an object carrying `id`. */
  model?: string;
  /** `session_id`. */
  sessionId?: string;
  /** `transcript_path`: the session's own transcript. */
  transcriptPath?: string;
  /** `agent_transcript_path`, on `SubagentStop`: the subagent's own transcript. */
  agentTranscriptPath?: string;
  /** `agent_id`, on `SubagentStop`. */
  agentId?: string;
  /** `agent_type`, on `SubagentStop`. */
  agentType?: string;
  /** `last_assistant_message`, on `Stop` and `SubagentStop`. */
  lastAssistantMessage?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The envelope in `text`, or `undefined` when `text` is not one. */
export function parseEnvelope(text: string): Envelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const doc = record(parsed);
  const event = str(doc?.hook_event_name);
  if (doc === undefined || event === undefined) return undefined;
  const input = record(doc.tool_input);
  const filePath = str(input?.file_path) ?? str(input?.notebook_path);
  const cwd = str(doc.cwd);
  const toolName = str(doc.tool_name);
  const model = str(doc.model) ?? str(record(doc.model)?.id);
  const strings = {
    sessionId: str(doc.session_id),
    transcriptPath: str(doc.transcript_path),
    agentTranscriptPath: str(doc.agent_transcript_path),
    agentId: str(doc.agent_id),
    agentType: str(doc.agent_type),
    lastAssistantMessage: str(doc.last_assistant_message),
  };
  const given = Object.fromEntries(Object.entries(strings).filter(([, v]) => v !== undefined)) as Partial<
    Record<keyof typeof strings, string>
  >;
  return {
    event,
    stopHookActive: doc.stop_hook_active === true,
    ...(cwd === undefined ? {} : { cwd }),
    ...(toolName === undefined ? {} : { toolName }),
    ...(filePath === undefined ? {} : { filePath }),
    ...(model === undefined ? {} : { model }),
    ...given,
  };
}

/** The envelope on stdin, or `undefined` for a run by hand. */
export async function readEnvelope(
  stream: NodeJS.ReadStream = process.stdin,
): Promise<Envelope | undefined> {
  if (stream.isTTY) return undefined;
  try {
    return parseEnvelope(await readStdin(stream));
  } catch {
    // Too large to be an envelope: a run by hand with something piped in.
    return undefined;
  }
}
