/**
 * The a11y reporters: `pretty` for a person, `json` for a script, `github`
 * for the Actions log. Every case builds a `CheckRun` by hand, so what is
 * pinned here is the rendering alone and not the crawl that produced it.
 */
import { describe, expect, it } from "vitest";
import {
  A11Y_FORMATS,
  A11Y_FORMAT_LIST,
  annotationLevel,
  isA11yFormat,
  render,
} from "../../src/a11y/reporters/index.js";
import type {
  CheckRun,
  CheckSummary,
  Severity,
  PageResult,
  Violation,
} from "../../src/a11y/types.js";
import { violation } from "../helpers/fake-analyzer.js";

const S = "https://site.example";
const SITEMAP = `${S}/sitemap.xml`;

function page(over: Partial<PageResult> & { url: string }): PageResult {
  return {
    source: "seed",
    violations: [],
    passes: 10,
    incomplete: 0,
    score: 100,
    ...over,
  };
}

/** Total the summary the way the check core does, so the fixtures stay honest. */
function summarize(
  results: PageResult[],
  over: Partial<CheckSummary> = {},
): CheckSummary {
  const bySeverity: Record<Severity, number> = { notice: 0, warning: 0, error: 0 };
  let failed = 0;
  let violations = 0;
  for (const r of results) {
    if (r.error !== undefined || r.violations.length > 0) failed += 1;
    for (const v of r.violations) {
      violations += 1;
      bySeverity[v.severity] += 1;
    }
  }
  return {
    discovered: results.length,
    checked: results.length,
    skipped: 0,
    duplicates: 0,
    failed,
    violations,
    bySeverity,
    sitemap: null,
    crawl: true,
    ...over,
  };
}

function checkRun(results: PageResult[], over: Partial<CheckSummary> = {}): CheckRun {
  return { results, summary: summarize(results, over) };
}

const imageAlt: Violation = {
  id: "image-alt",
  severity: "error",
  impact: "critical",
  help: "Images must have alternate text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
  tags: ["wcag2a"],
  nodes: [
    {
      target: "img.hero",
      html: '<img class="hero" src="x.png">',
      summary:
        "Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist or is empty",
    },
    { target: "img:nth-child(2)", html: "<img>", summary: "Fix any of the following:\n  Element does not have an alt attribute" },
  ],
};

const off = { color: false, quiet: false };

describe("A11Y_FORMATS", () => {
  it("is pretty | json | github, and the guard agrees", () => {
    expect(A11Y_FORMATS).toEqual(["pretty", "json", "github"]);
    expect(A11Y_FORMAT_LIST).toBe("pretty | json | github");
    for (const f of A11Y_FORMATS) expect(isA11yFormat(f)).toBe(true);
    expect(isA11yFormat("sarif")).toBe(false);
    expect(isA11yFormat("")).toBe(false);
  });
});

describe("render pretty", () => {
  it("names the sitemap in the header when one supplied pages", () => {
    const run = checkRun([page({ url: `${S}/` })], { sitemap: SITEMAP });
    const text = render("pretty", run, off);
    expect(text.split("\n")[0]).toBe(`Checked 1 of 1 pages (sitemap: ${SITEMAP})`);
  });

  it("says links were followed when there was no sitemap", () => {
    const run = checkRun([page({ url: `${S}/` }), page({ url: `${S}/a`, source: "link" })]);
    const text = render("pretty", run, off);
    expect(text.split("\n")[0]).toBe("Checked 2 of 2 pages (no sitemap; followed links)");
  });

  it("says no crawl when only the seeds were checked", () => {
    // `--no-crawl` never looks for a sitemap, so `sitemap` is null here too;
    // the header must not claim links were followed.
    const run = checkRun([page({ url: `${S}/` })], { crawl: false });
    const text = render("pretty", run, off);
    expect(text.split("\n")[0]).toBe("Checked 1 of 1 pages (no crawl)");
  });

  it("marks a clean page with its score", () => {
    const run = checkRun([page({ url: `${S}/`, score: 100 })]);
    expect(render("pretty", run, off)).toContain(`✓ ${S}/  score 100`);
  });

  it("lists a failing page's violations, nodes and the severity counts", () => {
    const failing = page({
      url: `${S}/about`,
      violations: [
        imageAlt,
        violation("button-name", "error", "serious"),
        violation("region", "notice"),
      ],
      passes: 7,
      score: 70,
    });
    const text = render("pretty", checkRun([failing]), off);
    const lines = text.split("\n");
    // Family levels, pluralised, most severe first, zeros omitted.
    expect(lines).toContain(`✗ ${S}/about  score 70  2 errors, 1 notice`);
    // The family level leads; axe's own word follows the rule id, so a
    // finding can still be looked up on its Deque page.
    expect(lines).toContain(
      "    error  image-alt (axe: critical)  2 nodes  Images must have alternate text  https://dequeuniversity.com/rules/axe/4.13/image-alt",
    );
    expect(lines).toContain(
      "      img.hero  → Fix any of the following: Element does not have an alt attribute; aria-label attribute does not exist or is empty",
    );
    expect(lines).toContain(
      "      img:nth-child(2)  → Fix any of the following: Element does not have an alt attribute",
    );
    expect(lines).toContain(
      "    error  button-name (axe: serious)  1 node  Rule button-name  https://dequeuniversity.com/rules/axe/4.13/button-name",
    );
    expect(lines).toContain("      html  → Fix button-name");
    expect(lines).toContain(
      "    notice  region (axe: minor)  1 node  Rule region  https://dequeuniversity.com/rules/axe/4.13/region",
    );
  });

  it("uses the singular for one finding at a level and lists warnings between", () => {
    const failing = page({
      url: `${S}/mixed`,
      violations: [
        violation("region", "notice"),
        violation("landmark-unique", "warning"),
        violation("label", "error"),
      ],
      score: 70,
    });
    const text = render("pretty", checkRun([failing]), off);
    expect(text).toContain(`✗ ${S}/mixed  score 70  1 error, 1 warning, 1 notice`);
    expect(text).toContain("    warning  landmark-unique (axe: moderate)  1 node");
  });

  it("shows the first three nodes and counts the rest", () => {
    const many: Violation = {
      ...violation("link-name", "error"),
      nodes: [1, 2, 3, 4, 5].map((n) => ({
        target: `a:nth-child(${n})`,
        html: "<a>",
        summary: `Fix link ${n}`,
      })),
    };
    const text = render("pretty", checkRun([page({ url: `${S}/`, violations: [many], score: 91 })]), off);
    expect(text).toContain("      a:nth-child(3)  → Fix link 3");
    expect(text).not.toContain("a:nth-child(4)");
    expect(text).toContain("      (+2 more)");
  });

  it("reports a page that did not load on one line", () => {
    const broken = page({
      url: `${S}/broken`,
      source: "link",
      passes: 0,
      score: null,
      error: `Could not load ${S}/broken: net::ERR_CONNECTION_REFUSED`,
    });
    const text = render("pretty", checkRun([page({ url: `${S}/` }), broken]), off);
    expect(text).toContain(
      `✗ ${S}/broken  could not load: Could not load ${S}/broken: net::ERR_CONNECTION_REFUSED`,
    );
    expect(text).toContain("0 violations on 1 of 2 pages");
  });

  it("totals violations and names the pages skipped by --max-pages", () => {
    const run = checkRun(
      [
        page({ url: `${S}/` }),
        page({ url: `${S}/a`, violations: [imageAlt], score: 91 }),
        page({ url: `${S}/b`, violations: [violation("label", "error"), violation("region", "notice")], score: 83 }),
      ],
      { discovered: 5, skipped: 2 },
    );
    const text = render("pretty", run, off);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Checked 3 of 5 pages (no sitemap; followed links)");
    expect(lines.at(-1)).toBe("3 violations on 2 of 3 pages; 2 skipped (--max-pages)");
    // A blank line separates the pages from the footer.
    expect(lines.at(-2)).toBe("");
  });

  it("names the duplicates dropped, only when there were any", () => {
    const pages = [page({ url: `${S}/` }), page({ url: `${S}/old` })];
    const none = render("pretty", checkRun(pages, { discovered: 3 }), off);
    expect(none).not.toContain("duplicate");
    const some = render("pretty", checkRun(pages, { discovered: 4, duplicates: 2 }), off);
    expect(some.split("\n").at(-1)).toBe("0 violations on 0 of 2 pages; 2 duplicates dropped");
    const one = render("pretty", checkRun(pages, { discovered: 5, skipped: 2, duplicates: 1 }), off);
    expect(one.split("\n").at(-1)).toBe(
      "0 violations on 0 of 2 pages; 2 skipped (--max-pages); 1 duplicate dropped",
    );
  });

  it("uses the singular when there is one violation", () => {
    const run = checkRun([page({ url: `${S}/`, violations: [imageAlt], score: 91 })]);
    expect(render("pretty", run, off)).toContain("1 violation on 1 of 1 pages");
  });

  it("hides clean pages under quiet but keeps header and footer", () => {
    const run = checkRun([
      page({ url: `${S}/` }),
      page({ url: `${S}/about`, violations: [imageAlt], score: 91 }),
    ]);
    const text = render("pretty", run, { color: false, quiet: true });
    expect(text).not.toContain(`✓ ${S}/`);
    expect(text).toContain(`✗ ${S}/about`);
    expect(text).toContain("Checked 2 of 2 pages");
    expect(text).toContain("1 violation on 1 of 2 pages");
  });

  it("colors only when asked", () => {
    const run = checkRun([
      page({ url: `${S}/` }),
      page({ url: `${S}/about`, violations: [imageAlt], score: 91 }),
    ]);
    const plain = render("pretty", run, off);
    const colored = render("pretty", run, { color: true, quiet: false });
    expect(plain).not.toMatch(/\[/);
    expect(colored).toMatch(/\[/);
    // Same text once the ANSI is stripped.
    expect(colored.replace(/\[[0-9;]*m/g, "")).toBe(plain);
  });
});

describe("render json", () => {
  it("round-trips the CheckRun", () => {
    const run = checkRun(
      [
        page({ url: `${S}/` }),
        page({ url: `${S}/about`, source: "sitemap", violations: [imageAlt], passes: 9, score: 90 }),
        page({ url: `${S}/broken`, source: "link", passes: 0, score: null, error: "Could not load" }),
      ],
      { sitemap: SITEMAP, discovered: 4, skipped: 1 },
    );
    const text = render("json", run, off);
    expect(JSON.parse(text)).toEqual(run);
    expect(text).toBe(JSON.stringify(run, null, 2));
  });
});

describe("render github", () => {
  it("emits one annotation per violation and per failed load", () => {
    const run = checkRun([
      page({ url: `${S}/` }),
      page({ url: `${S}/about`, violations: [imageAlt, violation("button-name", "error")], score: 80 }),
      page({ url: `${S}/broken`, source: "link", passes: 0, score: null, error: "net::ERR_CONNECTION_REFUSED" }),
    ]);
    const lines = render("github", run, off).split("\n");
    expect(lines).toEqual([
      `::error title=a11y/image-alt::Images must have alternate text — 2 nodes on ${S}/about (https://dequeuniversity.com/rules/axe/4.13/image-alt)`,
      `::error title=a11y/button-name::Rule button-name — 1 node on ${S}/about (https://dequeuniversity.com/rules/axe/4.13/button-name)`,
      `::error title=a11y/load::${S}/broken: net::ERR_CONNECTION_REFUSED`,
    ]);
  });

  it("carries the family severity through as the annotation level", () => {
    // The family scale was chosen to match GitHub's, so the map is one-to-one.
    expect(annotationLevel("error")).toBe("error");
    expect(annotationLevel("warning")).toBe("warning");
    expect(annotationLevel("notice")).toBe("notice");
  });

  it("annotates each finding at its severity's level", () => {
    const run = checkRun([
      page({
        url: `${S}/mixed`,
        violations: [
          violation("label", "error", "critical"),
          violation("color-contrast", "error", "serious"),
          violation("landmark-unique", "warning"),
          violation("region", "notice"),
        ],
        score: 60,
      }),
    ]);
    const lines = render("github", run, off).split("\n");
    expect(lines).toEqual([
      `::error title=a11y/label::Rule label — 1 node on ${S}/mixed (https://dequeuniversity.com/rules/axe/4.13/label)`,
      `::error title=a11y/color-contrast::Rule color-contrast — 1 node on ${S}/mixed (https://dequeuniversity.com/rules/axe/4.13/color-contrast)`,
      `::warning title=a11y/landmark-unique::Rule landmark-unique — 1 node on ${S}/mixed (https://dequeuniversity.com/rules/axe/4.13/landmark-unique)`,
      `::notice title=a11y/region::Rule region — 1 node on ${S}/mixed (https://dequeuniversity.com/rules/axe/4.13/region)`,
    ]);
  });

  it("keeps a failed load at error whatever the floor", () => {
    // A page that did not load has no severity to translate. It is always the
    // most serious thing in the run, so it stays `::error` beside notices.
    const run = checkRun([
      page({ url: `${S}/`, violations: [violation("region", "notice")], score: 95 }),
      page({ url: `${S}/broken`, source: "link", passes: 0, score: null, error: "net::ERR_CONNECTION_REFUSED" }),
    ]);
    const lines = render("github", run, off).split("\n");
    expect(lines[0]).toMatch(/^::notice title=a11y\/region::/);
    expect(lines[1]).toBe(`::error title=a11y/load::${S}/broken: net::ERR_CONNECTION_REFUSED`);
  });

  it("escapes the workflow-command message", () => {
    const odd: Violation = { ...imageAlt, help: "100% of images\nneed alt" };
    const run = checkRun([page({ url: `${S}/`, violations: [odd], score: 91 })]);
    const text = render("github", run, off);
    expect(text).toContain("100%25 of images%0Aneed alt");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("says nothing when the run is clean", () => {
    const run = checkRun([page({ url: `${S}/` })], { sitemap: SITEMAP });
    expect(render("github", run, off)).toBe("");
  });
});
