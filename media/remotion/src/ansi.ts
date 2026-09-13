// Minimal SGR parser for what picocolors emits in manni meta's output:
// 31 red, 32 green, 33 yellow, 36 cyan, 39 default fg, 1/22 bold, 2/22 dim, 0 reset.

export interface Span {
  text: string;
  fg?: string;
  dim?: boolean;
  bold?: boolean;
}

// Terminal palette on #171717. Red, green, yellow and cyan carry meaning in the
// product's output (design.md, "Reserved colours"); none of them is the accent.
export const palette = {
  31: "#f85149",
  32: "#3fb950",
  33: "#d29922",
  36: "#39c5cf",
} as const;

export function parseAnsi(input: string): Span[][] {
  const lines: Span[][] = [];
  let fg: string | undefined;
  let dim = false;
  let bold = false;
  for (const raw of input.replace(/\n$/, "").split("\n")) {
    const spans: Span[] = [];
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const push = (text: string) => {
      if (text.length > 0) spans.push({ text, fg, dim, bold });
    };
    while ((m = re.exec(raw)) !== null) {
      push(raw.slice(last, m.index));
      last = m.index + m[0].length;
      for (const code of (m[1] === "" ? "0" : m[1]).split(";")) {
        const n = Number(code);
        if (n === 0) {
          fg = undefined;
          dim = false;
          bold = false;
        } else if (n === 1) bold = true;
        else if (n === 2) dim = true;
        else if (n === 22) {
          bold = false;
          dim = false;
        } else if (n === 39) fg = undefined;
        else if (n in palette) fg = palette[n as keyof typeof palette];
      }
    }
    push(raw.slice(last));
    lines.push(spans);
  }
  return lines;
}

/** Visible length of an ANSI line, for the font-size derivation check. */
export function visibleLength(line: string): number {
  return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}
