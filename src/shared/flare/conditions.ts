/**
 * Flare condition expressions (proposal 0125, decision 12).
 *
 * A target stores its expression as up to two clauses, `include[…]` and
 * `exclude[…]`, in either order, separated by a comma, whitespace or nothing.
 * `@media name[…]` clauses pick responsive styles and are skipped. Inside a
 * clause is a boolean expression over `Set.Tag` names: Flare's Basic editor
 * writes `A.x or B.y`, and its Advanced editor writes `AND`, `OR`, `NOT` and
 * parentheses.
 */

/** A boolean expression over condition tags. */
export type TagExpression =
  | { op: "tag"; tag: string }
  | { op: "not"; operand: TagExpression }
  | { op: "and" | "or"; left: TagExpression; right: TagExpression };

/** A target's expression. Neither clause means no expression. */
export interface ConditionExpression {
  include?: TagExpression;
  exclude?: TagExpression;
}

const CLAUSE = /(include|exclude|@media[^[]*)\s*\[([^\]]*)\]/gi;

export function parseConditionExpression(text: string): ConditionExpression {
  const out: ConditionExpression = {};
  for (const match of text.matchAll(CLAUSE)) {
    const kind = (match[1] ?? "").toLowerCase();
    if (kind !== "include" && kind !== "exclude") continue;
    const expr = parseClause(match[2] ?? "");
    if (expr !== undefined) out[kind] = expr;
  }
  return out;
}

/**
 * The words of a clause: parentheses, operators, and the tag names between
 * them. A tag name may hold spaces, so consecutive non-operator words join
 * back into one name.
 */
function tokenize(body: string): string[] {
  const tokens: string[] = [];
  let name: string[] = [];
  const flush = (): void => {
    if (name.length > 0) tokens.push(name.join(" "));
    name = [];
  };
  for (const word of body.split(/([()]|\s+)/)) {
    if (word.trim() === "") continue;
    if (word === "(" || word === ")" || isOperator(word)) {
      flush();
      tokens.push(word);
    } else {
      name.push(word);
    }
  }
  flush();
  return tokens;
}

function isOperator(word: string): boolean {
  return /^(and|or|not)$/i.test(word);
}

/**
 * Recursive descent: `not` binds tightest, then `and`, then `or`. A clause
 * that does not parse is dropped, so it neither keeps nor drops content.
 */
// ponytail: a malformed clause is silently ignored; report it if Flare ever writes one.
function parseClause(body: string): TagExpression | undefined {
  const tokens = tokenize(body);
  if (tokens.length === 0) return undefined;
  let pos = 0;
  const peek = (): string | undefined => tokens[pos]?.toLowerCase();

  const parseOr = (): TagExpression | undefined => {
    let left = parseAnd();
    while (left !== undefined && peek() === "or") {
      pos++;
      const right = parseAnd();
      left = right === undefined ? undefined : { op: "or", left, right };
    }
    return left;
  };
  const parseAnd = (): TagExpression | undefined => {
    let left = parseNot();
    while (left !== undefined && peek() === "and") {
      pos++;
      const right = parseNot();
      left = right === undefined ? undefined : { op: "and", left, right };
    }
    return left;
  };
  const parseNot = (): TagExpression | undefined => {
    const token = tokens[pos];
    if (token === undefined) return undefined;
    pos++;
    if (token.toLowerCase() === "not") {
      const operand = parseNot();
      return operand === undefined ? undefined : { op: "not", operand };
    }
    if (token === "(") {
      const inner = parseOr();
      if (tokens[pos] !== ")") return undefined;
      pos++;
      return inner;
    }
    if (token === ")" || isOperator(token)) return undefined;
    return { op: "tag", tag: token };
  };

  const expr = parseOr();
  return pos === tokens.length ? expr : undefined;
}

function evaluate(expr: TagExpression, tags: readonly string[]): boolean {
  switch (expr.op) {
    case "tag":
      return tags.includes(expr.tag);
    case "not":
      return !evaluate(expr.operand, tags);
    case "and":
      return evaluate(expr.left, tags) && evaluate(expr.right, tags);
    case "or":
      return evaluate(expr.left, tags) || evaluate(expr.right, tags);
  }
}

/**
 * Whether content carrying `tags` stays under `expr`. Untagged content always
 * stays. A true `include` keeps it, which is how an explicit include beats an
 * exclude. A true `exclude` drops it. Content neither clause speaks to stays,
 * unless the expression is include-only: then everything unlisted is
 * excluded.
 */
export function includes(expr: ConditionExpression | undefined, tags: readonly string[]): boolean {
  if (expr === undefined || tags.length === 0) return true;
  const { include, exclude } = expr;
  if (include !== undefined && evaluate(include, tags)) return true;
  if (exclude !== undefined) return !evaluate(exclude, tags);
  return include === undefined;
}

/** The tags of a `MadCap:conditions="A.x,B.y"` value. */
export function parseConditionTags(attr: string | null | undefined): string[] {
  if (attr === null || attr === undefined) return [];
  return attr
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
}
