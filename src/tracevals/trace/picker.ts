/**
 * Interactive trace picker (TTY only). The prompt function is injectable so
 * tests never touch a real terminal.
 */
import { TracevalsError } from "../types.js";
import {
  discoverTraces,
  type DiscoverOptions,
  type TraceListing,
} from "./discover.js";

export interface PickerChoice {
  name: string;
  value: string;
  description?: string;
}

export type PromptFn = (params: {
  message: string;
  choices: PickerChoice[];
}) => Promise<string>;

async function inquirerPrompt(params: {
  message: string;
  choices: PickerChoice[];
}): Promise<string> {
  const { select } = await import("@inquirer/prompts");
  return select<string>(params);
}

export function choiceFor(listing: TraceListing): PickerChoice {
  const when = new Date(listing.mtimeMs)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  return {
    name: `${when}  ${listing.firstPrompt ?? "(no prompt)"}`,
    value: listing.file,
    description: `${listing.project ?? "unknown project"} · ${listing.sessionId ?? "?"}`,
  };
}

export async function pickTrace(
  options: DiscoverOptions = {},
  prompt: PromptFn = inquirerPrompt,
): Promise<string> {
  let listings = await discoverTraces({ limit: 25, ...options });
  if (listings.length === 0 && !options.allProjects) {
    // Nothing for this project — offer everything rather than a dead end.
    listings = await discoverTraces({ limit: 25, ...options, allProjects: true });
  }
  if (listings.length === 0) {
    throw new TracevalsError(
      "no traces found in the session store; pass a trace file instead",
    );
  }
  return prompt({
    message: "Pick a trace to evaluate",
    choices: listings.map(choiceFor),
  });
}
