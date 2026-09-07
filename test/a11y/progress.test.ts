/**
 * The progress reporter: what a crawl says on stderr while it runs. On a
 * terminal it is one status line rewritten in place and cleared at the end,
 * so the report on stdout is not preceded by a dangling line. Off a terminal
 * it is one plain, prefixed line per event, with no escape codes, the way
 * `warn()` writes.
 */
import { describe, expect, it } from "vitest";
import { createProgressReporter } from "../../src/a11y/reporters/progress.js";
import type { ProgressEvent } from "../../src/a11y/types.js";

const CLEAR = "\r\x1b[2K";
const S = "https://site.example";

interface FakeStream {
  write(s: string): boolean;
  columns?: number;
  out: string[];
}

/** A stream that records every write. */
function stream(columns?: number): FakeStream {
  const out: string[] = [];
  return {
    out,
    columns,
    write(s: string) {
      out.push(s);
      return true;
    },
  };
}

const TWO_PAGES: ProgressEvent[] = [
  { kind: "browser" },
  { kind: "page", index: 1, queued: 1, url: `${S}/` },
  { kind: "checked", index: 1, url: `${S}/`, violations: 0 },
  { kind: "page", index: 2, queued: 2, url: `${S}/a` },
  { kind: "checked", index: 2, url: `${S}/a`, violations: 2 },
  { kind: "done", checked: 2, skipped: 0 },
];

describe("progress reporter on a terminal", () => {
  it("rewrites one status line in place, without a newline", () => {
    const s = stream(80);
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    report({ kind: "browser" });
    expect(s.out).toEqual([`${CLEAR}Starting browser…`]);
    report({ kind: "page", index: 3, queued: 51, url: `${S}/meta/fix/` });
    expect(s.out[1]).toBe(`${CLEAR}[3/51] ${S}/meta/fix/`);
    for (const chunk of s.out) expect(chunk).not.toContain("\n");
  });

  it("names the sitemap, or says there was none", () => {
    const s = stream(80);
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    report({ kind: "sitemap", source: `${S}/sitemap-index.xml`, urls: 50 });
    expect(s.out[0]).toBe(`${CLEAR}Sitemap: ${S}/sitemap-index.xml (50 pages)`);
    report({ kind: "sitemap", source: null, urls: 0 });
    expect(s.out[1]).toBe(`${CLEAR}No sitemap; following links`);
  });

  it("shows the outcome of a page in place, with the counter it ran under", () => {
    const s = stream(80);
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    report({ kind: "page", index: 2, queued: 3, url: `${S}/a` });
    report({ kind: "checked", index: 2, url: `${S}/a`, violations: 2 });
    expect(s.out[1]).toBe(`${CLEAR}[2/3] ✗ 2 violations  ${S}/a`);
    report({ kind: "checked", index: 2, url: `${S}/a`, violations: 0 });
    expect(s.out[2]).toBe(`${CLEAR}[2/3] ✓ ${S}/a`);
    report({ kind: "checked", index: 2, url: `${S}/a`, violations: 0, error: "timeout" });
    expect(s.out[3]).toBe(`${CLEAR}[2/3] ✗ could not load: timeout  ${S}/a`);
  });

  it("clears the line on done so the report starts clean", () => {
    const s = stream(80);
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    for (const event of TWO_PAGES) report(event);
    expect(s.out.at(-1)).toBe(CLEAR);
    expect(s.out.join("")).not.toContain("\n");
  });

  it("truncates a long URL in the middle to fit the columns", () => {
    const s = stream(40);
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    const url = `${S}/a/very/long/path/that/keeps/on/going/until/the/end.html`;
    report({ kind: "page", index: 1, queued: 1, url });
    const line = s.out[0]?.slice(CLEAR.length) ?? "";
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line).toMatch(/^\[1\/1\] https:\/\/site\.ex.*….*end\.html$/);
  });

  it("falls back to 80 columns when the stream has none", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: false, tty: true });
    const url = `${S}/${"x".repeat(120)}`;
    report({ kind: "page", index: 1, queued: 1, url });
    const line = s.out[0]?.slice(CLEAR.length) ?? "";
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).toContain("…");
  });

  it("paints only when color is on", () => {
    const plain = stream(80);
    createProgressReporter({ stream: plain, color: false, tty: true })({
      kind: "page",
      index: 1,
      queued: 1,
      url: `${S}/`,
    });
    expect(plain.out[0]).not.toContain("\x1b[36m");
    const painted = stream(80);
    createProgressReporter({ stream: painted, color: true, tty: true })({
      kind: "page",
      index: 1,
      queued: 1,
      url: `${S}/`,
    });
    // cyan, the colour meta gives a path or a URL
    expect(painted.out[0]).toContain("\x1b[36m");
  });
});

describe("progress reporter off a terminal", () => {
  it("writes one prefixed, newline-terminated line per event, with no escape codes", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: false, tty: false });
    for (const event of TWO_PAGES) report(event);
    expect(s.out).toEqual([
      "manni: starting browser\n",
      `manni: [1/1] ${S}/\n`,
      "manni: [1/1] ✓\n",
      `manni: [2/2] ${S}/a\n`,
      "manni: [2/2] ✗ 2 violations\n",
      "manni: checked 2 pages, 0 skipped\n",
    ]);
    expect(s.out.join("")).not.toContain("\x1b");
  });

  it("names the sitemap, or says there was none", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: false, tty: false });
    report({ kind: "sitemap", source: `${S}/sitemap.xml`, urls: 50 });
    report({ kind: "sitemap", source: null, urls: 0 });
    expect(s.out).toEqual([
      `manni: sitemap ${S}/sitemap.xml (50 pages)\n`,
      "manni: no sitemap; following links\n",
    ]);
  });

  it("reports a page that could not load", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: false, tty: false });
    report({ kind: "page", index: 2, queued: 3, url: `${S}/broken` });
    report({ kind: "checked", index: 2, url: `${S}/broken`, violations: 0, error: "timeout" });
    expect(s.out[1]).toBe("manni: [2/3] could not load: timeout\n");
  });

  it("uses singular forms for one violation and one page", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: false, tty: false });
    report({ kind: "sitemap", source: `${S}/sitemap.xml`, urls: 1 });
    report({ kind: "page", index: 1, queued: 1, url: `${S}/` });
    report({ kind: "checked", index: 1, url: `${S}/`, violations: 1 });
    report({ kind: "done", checked: 1, skipped: 1 });
    expect(s.out).toEqual([
      `manni: sitemap ${S}/sitemap.xml (1 page)\n`,
      `manni: [1/1] ${S}/\n`,
      "manni: [1/1] ✗ 1 violation\n",
      "manni: checked 1 page, 1 skipped\n",
    ]);
  });

  it("never truncates a URL, since nothing is rewriting the line", () => {
    const s = stream(40);
    const report = createProgressReporter({ stream: s, color: false, tty: false });
    const url = `${S}/${"x".repeat(120)}`;
    report({ kind: "page", index: 1, queued: 1, url });
    expect(s.out[0]).toBe(`manni: [1/1] ${url}\n`);
  });

  it("ignores color off a terminal", () => {
    const s = stream();
    const report = createProgressReporter({ stream: s, color: true, tty: false });
    report({ kind: "page", index: 1, queued: 1, url: `${S}/` });
    expect(s.out[0]).not.toContain("\x1b");
  });
});
