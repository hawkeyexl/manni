/**
 * Narrowing helpers for the lint suite.
 *
 * `noUncheckedIndexedAccess` makes every `sections[0]` and every optional field
 * `T | undefined`, and the tests here index into trees they just parsed on
 * nearly every line. The tool arrived from moose-lint spelling that as `!`,
 * several hundred times, which `@typescript-eslint/no-non-null-assertion`
 * rejects and which reports nothing useful when the value really is missing:
 * `Cannot read properties of undefined (reading 'title')`, with no clue which
 * lookup returned nothing.
 *
 * These two narrow instead. When the value is absent the test fails on the
 * helper with a line that names what was being looked for, and the assertion
 * that follows is unreachable rather than misleading. They throw rather than
 * calling `expect`, so they do not inflate a suite's assertion count and read
 * the same inside and outside an `expect(...)` argument.
 */

/** `value`, or a failure naming `what` when it is `null` or `undefined`. */
export function defined<T>(value: T, what = "value"): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(`expected ${what} to be present, got ${String(value)}`);
  }
  return value;
}

/**
 * `items[index]`, or a failure naming the lookup when the slot is empty.
 *
 * A negative index fails rather than counting from the end. The `!` this
 * replaces threw on `items[-1]`, and every caller computes its index from a
 * 1-based position: `at(lines, span.start.line - 1)` on a line 0 would compare
 * the last line of the file and quietly pass.
 */
export function at<T>(
  items: readonly T[],
  index: number,
  what = "item",
): NonNullable<T> {
  if (index < 0) {
    throw new Error(`expected ${what} at index ${index}, which is not a slot`);
  }
  return defined(items[index], `${what} at index ${index}`);
}
