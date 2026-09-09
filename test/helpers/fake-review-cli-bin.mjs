/**
 * A stand-in for `gh` and `glab`.
 *
 * The review sources never speak HTTP: they spawn the vendor's CLI, whose auth
 * store is the trust boundary. So the seam the tests need is the *process*,
 * not a fetch. This script is run as `node fake-review-cli-bin.mjs <args...>`
 * (the client takes `bin: process.execPath, prefixArgs: [this file]`) and
 * answers from a scenario file named by `FAKE_REVIEW_SCENARIO`:
 *
 *   {
 *     "log": "<path>",            // optional; every call appended as one JSON line:
 *                                 //   { "argv": [...], "cwd": "<process.cwd()>" }
 *     "responses": [
 *       { "includes": ["api", "repos/o/r/pulls/18/reviews"],
 *         "stdout": [...] | "text", "stderr": "text", "exit": 0, "sleepMs": 0 }
 *     ]
 *   }
 *
 * The first response whose `includes` tokens each appear as a substring of
 * some argv element wins, so a scenario can name a path fragment rather than
 * the whole endpoint; list the more specific response first when one
 * fragment is a prefix of another call's path. No match exits 1 with a
 * message, which is what a real CLI does for an endpoint it cannot serve.
 * `stdout` that is not a string is JSON-encoded.
 *
 * Exit is via `process.exitCode`, never `process.exit()`: on Windows a pipe
 * is written asynchronously, and `process.exit()` can truncate the answer
 * mid-JSON, which would read as a malformed reply rather than a fake bug.
 */
import { appendFileSync, readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const scenarioPath = process.env.FAKE_REVIEW_SCENARIO;
if (!scenarioPath) {
  process.stderr.write("fake-review-cli: FAKE_REVIEW_SCENARIO is not set\n");
  process.exitCode = 3;
} else {
  const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  if (typeof scenario.log === "string") {
    appendFileSync(
      scenario.log,
      `${JSON.stringify({ argv, cwd: process.cwd() })}\n`,
    );
  }
  const responses = Array.isArray(scenario.responses) ? scenario.responses : [];
  const hit = responses.find(
    (r) =>
      Array.isArray(r.includes) &&
      r.includes.every((t) => argv.some((a) => a.includes(t))),
  );
  if (!hit) {
    process.stderr.write(`fake-review-cli: no response for ${argv.join(" ")}\n`);
    process.exitCode = 1;
  } else {
    if (typeof hit.sleepMs === "number" && hit.sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, hit.sleepMs));
    }
    if (typeof hit.stderr === "string") process.stderr.write(hit.stderr);
    if (hit.stdout !== undefined) {
      process.stdout.write(
        typeof hit.stdout === "string" ? hit.stdout : JSON.stringify(hit.stdout),
      );
    }
    process.exitCode = typeof hit.exit === "number" ? hit.exit : 0;
  }
}
