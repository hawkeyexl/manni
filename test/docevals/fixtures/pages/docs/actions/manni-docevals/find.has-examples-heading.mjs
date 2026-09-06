// moose-docevals generated check
// Eval: has-examples-heading
// Assertion: The page includes an Examples heading.
// Exit 0 = pass, non-zero = fail. The page path arrives as argv[2].
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? process.env.MOOSE_DOCEVALS_FILE;
if (!file) {
  console.error("No page path provided");
  process.exit(2);
}
const content = readFileSync(file, "utf8");
// Match an ATX heading (any level) whose text is exactly "Examples".
if (/^#{1,6}\s+Examples\s*$/m.test(content)) {
  process.exit(0);
}
console.error("No heading named 'Examples' found");
process.exit(1);
