// Preloaded with `node --import` by test/cli-startup.integration.test.ts.
// Records every module the run loads and, on exit, prints the npm packages
// among them as one `MANNI_LOADED <json>` line on stderr.
import { registerHooks } from "node:module";
import { writeSync } from "node:fs";

const packages = new Set();
registerHooks({
  load(url, context, next) {
    const path = decodeURIComponent(url).replaceAll("\\", "/");
    const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(path);
    if (m) packages.add(m[1]);
    return next(url, context);
  },
});
process.on("exit", () => {
  writeSync(2, `\nMANNI_LOADED ${JSON.stringify([...packages].sort())}\n`);
});
