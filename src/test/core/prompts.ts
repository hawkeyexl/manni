/**
 * What the synthetic user is told (plan §4.5): the role prompt, appended to
 * Claude Code's system prompt, and the task brief, its first message. A
 * persona's fields go in, one line each when set; its body never does.
 */
import type { TaskPersona, TaskSpec } from "./task-types.js";

const NEWCOMER = "Someone new to this product, with the task below and no other context.";

const HOW_TO_WORK = [
  "How to work:",
  "- Use what the documentation tells you, and what this person would already know.",
  "- Nobody is available to answer questions. When stuck, do what this person",
  "  would do, or give up.",
  "- The current directory is yours. Treat the documentation as read-only.",
  "- When you finish or give up, end with a short account in this person's voice:",
  "  whether you got it done, where you got stuck, and what in the docs helped or",
  "  confused you.",
];

/** A label and its items, one per line, or nothing when there are none. */
function items(label: string, values: string[]): string[] {
  return values.length === 0 ? [] : [`${label}:`, ...values.map((v) => `- ${v}`)];
}

function whoYouAre(persona: TaskPersona | null): string[] {
  if (persona === null) return [NEWCOMER];
  const lines = [[persona.title ?? persona.id, persona.description].filter((v) => v !== undefined).join(". ")];
  if (persona.role !== undefined) lines.push(`Role: ${persona.role}`);
  if (persona.teamContext !== undefined) lines.push(`Team: ${persona.teamContext}`);
  lines.push(
    ...items("Already good at", persona.proficiency),
    ...items("Knows before starting", persona.prerequisites),
    ...items("Wants", persona.goals),
    ...items("Frustrated by", persona.pains),
    ...items(
      "Your constraints",
      persona.constraints.map((c) => c.text),
    ),
  );
  return lines;
}

export function rolePrompt(persona: TaskPersona | null): string {
  return [
    "You are taking part in a usability test of some documentation. You are playing",
    "a person, not an assistant. Stay in that person's shoes for the whole session.",
    "",
    "Who you are:",
    ...whoYouAre(persona),
    "",
    ...HOW_TO_WORK,
    "",
  ].join("\n");
}

/**
 * The task, what started it and when it is done (a journey's, when set), and
 * where to start: the URL, or the start page's copy as seen from the workspace.
 */
export function taskBriefFor(spec: TaskSpec, startFromWorkspace: string | null): string {
  const lines = [spec.task];
  if (spec.journey?.trigger !== undefined) lines.push(`What started this: ${spec.journey.trigger}`);
  if (spec.journey?.successCriteria !== undefined) {
    lines.push(`You're done when: ${spec.journey.successCriteria.text}`);
  }
  const start = spec.start.kind === "url" ? spec.start.url : (startFromWorkspace ?? spec.start.display);
  lines.push(`Start here: ${start}`);
  return `${lines.join("\n")}\n`;
}
