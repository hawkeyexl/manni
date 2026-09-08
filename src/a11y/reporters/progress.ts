/**
 * Progress on stderr, while the crawl runs.
 *
 * The browser launch alone takes seconds and a fifty-page site takes a
 * minute, and a command that says nothing for that long reads as hung. So
 * the run narrates itself on stderr, where a diagnostic belongs; stdout stays
 * the report, and `-f json | jq` keeps working.
 *
 * Two renderings. On a terminal, one status line rewritten in place
 * (`\r`, erase line, then the text, no newline) and cleared on `done`, so the
 * report on stdout is not preceded by a dangling line. Off a terminal, one
 * plain line per event, newline-terminated and prefixed the way `warn()`
 * writes, with no escape codes, since a CI log keeps every line.
 *
 * Colours keep the meanings meta gave them: ✓ green, ✗ red, URLs cyan, the
 * counter dim. They apply on a terminal only.
 */
import { palette, type Colors } from "../../shared/color.js";
import { programName } from "../../shared/program-name.js";
import type { ProgressEvent, ProgressListener } from "../types.js";

export interface ProgressOptions {
  /** Where to write: `process.stderr`, or a fake in tests. */
  stream: { write(s: string): boolean; isTTY?: boolean; columns?: number };
  /** Paint the status line. Ignored off a terminal. */
  color: boolean;
  /** Rewrite one line in place (true) or append a line per event (false). */
  tty: boolean;
}

/** Carriage return, then erase the whole line: the start of every status line. */
export const CLEAR_LINE = "\r\x1b[2K";

/** The width a status line is fitted to when the stream does not say. */
const DEFAULT_COLUMNS = 80;

/** Returns a listener that renders events to `stream`. */
export function createProgressReporter(opts: ProgressOptions): ProgressListener {
  return opts.tty ? terminalReporter(opts) : plainReporter(opts.stream);
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `[3/51]`, from the last `page` event; `checked` carries no `queued` of its own. */
function counter(index: number, queued: number): string {
  return `[${index}/${queued}]`;
}

function terminalReporter(opts: ProgressOptions): ProgressListener {
  const { stream } = opts;
  const c = palette(opts.color);
  let queued = 0;

  const show = (text: string): void => {
    stream.write(`${CLEAR_LINE}${text}`);
  };
  /** `prefix`, the URL, then `suffix`; the URL shortened in the middle to fit the line. */
  const showUrl = (prefix: string, url: string, suffix = ""): void => {
    const columns = stream.columns ?? DEFAULT_COLUMNS;
    const fitted = truncateMiddle(url, columns - visibleLength(prefix) - suffix.length);
    show(`${prefix}${c.cyan(fitted)}${suffix}`);
  };

  return (event: ProgressEvent): void => {
    switch (event.kind) {
      case "browser":
        show("Starting browser…");
        return;
      case "sitemap":
        if (event.source === null) show("No sitemap; following links");
        else showUrl("Sitemap: ", event.source, ` (${plural(event.urls, "page")})`);
        return;
      case "page":
        queued = event.queued;
        showUrl(`${c.dim(counter(event.index, queued))} `, event.url);
        return;
      case "checked":
        showUrl(`${c.dim(counter(event.index, queued))} ${outcome(event, c)}`, event.url);
        return;
      case "done":
        stream.write(CLEAR_LINE);
        return;
    }
  };
}

/** `✓ `, `✗ 2 violations  `, or `✗ could not load: …  `: what goes between the counter and the URL. */
function outcome(event: Extract<ProgressEvent, { kind: "checked" }>, c: Colors): string {
  if (event.error !== undefined) return `${c.red("✗")} could not load: ${event.error}  `;
  if (event.violations === 0) return `${c.green("✓")} `;
  return `${c.red("✗")} ${plural(event.violations, "violation")}  `;
}

function plainReporter(stream: ProgressOptions["stream"]): ProgressListener {
  let queued = 0;
  const say = (text: string): void => {
    stream.write(`${programName()}: ${text}\n`);
  };

  return (event: ProgressEvent): void => {
    switch (event.kind) {
      case "browser":
        say("starting browser");
        return;
      case "sitemap":
        if (event.source === null) say("no sitemap; following links");
        else say(`sitemap ${event.source} (${plural(event.urls, "page")})`);
        return;
      case "page":
        queued = event.queued;
        say(`${counter(event.index, queued)} ${event.url}`);
        return;
      case "checked": {
        const head = counter(event.index, queued);
        if (event.error !== undefined) say(`${head} could not load: ${event.error}`);
        else if (event.violations === 0) say(`${head} ✓`);
        else say(`${head} ✗ ${plural(event.violations, "violation")}`);
        return;
      }
      case "done":
        say(`checked ${plural(event.checked, "page")}, ${event.skipped} skipped`);
        return;
    }
  };
}

/** Length as the terminal shows it, with ANSI sequences taken out. */
function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Shorten `text` to `room` characters by replacing its middle with `…`, so
 * both the host and the page's own name survive. Never shorter than a few
 * characters, however narrow the terminal.
 */
function truncateMiddle(text: string, room: number): string {
  const max = Math.max(room, 8);
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
