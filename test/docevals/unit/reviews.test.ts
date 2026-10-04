import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  REVIEWS_PATH,
  contentHash,
  findReview,
  loadReviews,
  recordReview,
  saveReviews,
  type ReviewEntry,
} from "../../../src/docevals/core/reviews.js";

const root = () => mkdtempSync(join(tmpdir(), "manni-docevals-reviews-"));

function entry(over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    file: "docs/install.md",
    evalName: "no-future-promises",
    contentHash: contentHash("Body."),
    verdict: "pass",
    ...over,
  };
}

describe("loadReviews", () => {
  it("returns an empty list when no reviews file exists", () => {
    expect(loadReviews(root())).toEqual([]);
  });

  // A reviews file is hand-editable, so the two ways a human breaks it —
  // emptying it, or leaving a mapping where the list should be — must both
  // degrade to "no reviews" rather than throwing. A throw here would take down
  // every `run` that judges anything, not just the review lookup.
  it.each([
    ["an empty file", ""],
    ["a mapping instead of a list", "file: docs/install.md\n"],
    ["a bare scalar", "nonsense\n"],
  ])("returns an empty list for %s", (_label, body) => {
    const dir = root();
    saveReviews(dir, []);
    writeFileSync(join(dir, REVIEWS_PATH), body);
    expect(loadReviews(dir)).toEqual([]);
  });
});

describe("saveReviews", () => {
  it("creates the .manni/docevals directory when it is absent", () => {
    const dir = root();
    expect(existsSync(join(dir, REVIEWS_PATH))).toBe(false);
    saveReviews(dir, [entry()]);
    expect(existsSync(join(dir, REVIEWS_PATH))).toBe(true);
  });

  it("writes a YAML list that round-trips through loadReviews", () => {
    const dir = root();
    const e = entry({ reviewer: "priya", date: "2026-08-29", note: "Checked." });
    saveReviews(dir, [e]);
    expect(parseYaml(readFileSync(join(dir, REVIEWS_PATH), "utf8"))).toEqual([e]);
    expect(loadReviews(dir)).toEqual([e]);
  });
});

describe("recordReview", () => {
  // The load-bearing property. A reviewer who changes their mind must not end
  // up with two entries for one (file, eval) — `findReview` takes the first
  // match, so an appended correction would be silently ignored in favour of the
  // verdict it was meant to replace.
  it("replaces the entry for a (file, eval) pair rather than appending", () => {
    const dir = root();
    recordReview(dir, entry({ verdict: "pass", reviewer: "first" }));
    recordReview(dir, entry({ verdict: "fail", reviewer: "second" }));

    const reviews = loadReviews(dir);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.verdict).toBe("fail");
    expect(reviews[0]?.reviewer).toBe("second");
  });

  it("keeps entries that differ by eval or by file", () => {
    const dir = root();
    recordReview(dir, entry());
    recordReview(dir, entry({ evalName: "readable" }));
    recordReview(dir, entry({ file: "docs/other.md" }));

    expect(loadReviews(dir)).toHaveLength(3);
  });

  it("persists the optional reviewer, date and note", () => {
    const dir = root();
    recordReview(dir, entry({ reviewer: "nate", date: "2026-08-29", note: "ok" }));

    const [recorded] = loadReviews(dir);
    expect(recorded?.reviewer).toBe("nate");
    expect(recorded?.date).toBe("2026-08-29");
    expect(recorded?.note).toBe("ok");
  });
});

describe("findReview", () => {
  const body = "The page body a verdict was formed against.";
  const reviews = [
    entry({ contentHash: contentHash(body) }),
    entry({ evalName: "readable", contentHash: contentHash(body) }),
  ];

  it("returns the entry when the body still hashes to what was reviewed", () => {
    expect(findReview(reviews, "docs/install.md", "no-future-promises", body))
      .toEqual(reviews[0]);
  });

  // The staleness rule, and the reason a review is safe to persist at all: a
  // verdict is about the words a human read. Once the page changes, the entry
  // must stop applying and return the eval to needs-review — silently, because
  // the alternative is a stale human "pass" masking a real regression.
  it("returns undefined once the body has changed", () => {
    expect(
      findReview(reviews, "docs/install.md", "no-future-promises", `${body} Edited.`),
    ).toBeUndefined();
  });

  it("returns undefined when no entry matches the file or the eval", () => {
    expect(findReview(reviews, "docs/absent.md", "no-future-promises", body))
      .toBeUndefined();
    expect(findReview(reviews, "docs/install.md", "absent-eval", body))
      .toBeUndefined();
  });

  it("returns undefined for an empty review set", () => {
    expect(findReview([], "docs/install.md", "no-future-promises", body))
      .toBeUndefined();
  });
});
