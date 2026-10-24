import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Easing, Sequence, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";
import { parseAnsi, type Span } from "./ansi";
import { FPS, SCROLL_FRAMES, TYPING_MS, beats as sidecarBeats, timeline, type Beat } from "./beats";

// docs/content-strategy/design.md, "Palette" (dark) and "Composition".
export const tokens = {
  accent: "#58a6ff",
  bg: "#171717",
  bgBand: "#0d0d0d",
  text: "#ffffff",
  textMuted: "#d5dbe3",
  dim: "#8b949e",
};

const FRAME = 1080;
const TITLE_BAND = 112;
const CAPTION_BAND = 86;
const RULE = 2;
const TERMINAL_TOP = TITLE_BAND + RULE;
const TERMINAL_HEIGHT = FRAME - TITLE_BAND - RULE - RULE - CAPTION_BAND; // 878
const TERMINAL_INSET = 20;

const mono = '"JetBrains Mono", monospace';

export interface DemoProps {
  beats: Beat[];
  /** Derived per video from the longest real line (design.md "Capture geometry"); see each script file. */
  fontPx: number;
  linePx: number;
  /**
   * Column count the replay wraps at. A line longer than this breaks at a space
   * (never inside a token) and its continuation row carries the line's own
   * indent. `Infinity` never wraps, which is what the first video used.
   */
  cols: number;
  /** Per-video typing speed (design.md: 35-70 ms). Defaults to the shared TYPING_MS. */
  typingMs?: number;
  /**
   * JetBrains Mono draws `/=` as a slashed equals and `---` as one rule. A
   * terminal prints the characters, so a video whose commands or output carry
   * those sequences turns ligatures off. Default on, as the earlier videos rendered.
   */
  ligatures?: boolean;
  /**
   * Characters a token too wide for its row may break after, such as "/" for
   * a URL under a deep gutter. Without one, such a token hard-breaks at the
   * column, as a terminal would. Default none, as the earlier videos rendered.
   */
  breakAfter?: string;
}

// ---- Screen model -----------------------------------------------------------

interface Line {
  spans: Span[];
  cursor?: boolean;
  /** Drawn on a faint accent ground; see Beat.highlight. */
  mark?: boolean;
}

const promptSpan: Span = { text: "$ ", fg: tokens.dim };

/** Beat.Command.note: chrome, drawn as an edit's marker is (src/ansi.ts, CUT). */
const noteLine = (text: string): Line => ({ spans: [{ text, fg: tokens.accent, chrome: true }] });

function finalScreen(beat: Beat, prev: Line[]): Line[] {
  const lines: Line[] = beat.continues ? [...prev] : [];
  for (const c of beat.commands) {
    lines.push({ spans: [promptSpan, { text: c.typed }] });
    if (c.note !== undefined) lines.push(noteLine(c.note));
    if (c.output !== "") for (const spans of parseAnsi(c.output)) lines.push({ spans });
    for (const m of c.more ?? []) for (const spans of parseAnsi(m.output)) lines.push({ spans });
  }
  return lines;
}

function screenAt(beat: Beat, frame: number, prev: Line[], typingMs: number): Line[] {
  const { commands } = timeline(beat, typingMs);
  const framesPerChar = (typingMs * FPS) / 1000;
  const lines: Line[] = beat.continues ? [...prev] : [];
  for (const c of commands) {
    if (frame < c.typeStart) {
      lines.push({ spans: [promptSpan], cursor: true });
      return lines;
    }
    const typedCount =
      frame < c.enterAt && !c.paste
        ? Math.min(c.typed.length, Math.floor((frame - c.typeStart) / framesPerChar) + 1)
        : c.typed.length;
    const typed = c.typed.slice(0, typedCount);
    if (frame < c.enterAt) {
      lines.push({ spans: [promptSpan, { text: typed }], cursor: true });
      return lines;
    }
    lines.push({ spans: [promptSpan, { text: typed }] });
    if (c.note !== undefined) lines.push(noteLine(c.note));
    if (frame < c.outputAt) {
      lines.push({ spans: [], cursor: true });
      return lines;
    }
    const out = c.output === "" ? [] : parseAnsi(c.output);
    const reveal = c.revealFrames ?? 0;
    if (frame < c.outputAt + reveal) {
      const shown = Math.ceil((out.length * (frame - c.outputAt + 1)) / reveal);
      for (const spans of out.slice(0, shown)) lines.push({ spans });
      return lines;
    }
    for (const spans of out) lines.push({ spans });
    let at = c.outputAt + reveal;
    for (const m of c.more ?? []) {
      at += m.afterFrames;
      if (frame < at) {
        lines.push({ spans: [], cursor: true });
        return lines;
      }
      for (const spans of parseAnsi(m.output)) lines.push({ spans });
    }
  }
  const last = commands[commands.length - 1];
  lines.push(last?.running ? { spans: [], cursor: true } : { spans: [promptSpan], cursor: true });
  return lines;
}

// ---- Wrapping ---------------------------------------------------------------

const sameStyle = (a: Span, b: Span) =>
  a.fg === b.fg && a.dim === b.dim && a.bold === b.bold && a.underline === b.underline && a.bg === b.bg && a.chrome === b.chrome;

/** Collapse a run of one-character spans back into styled runs. */
function merge(chars: Span[]): Span[] {
  const out: Span[] = [];
  for (const c of chars) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, c)) last.text += c.text;
    else out.push({ ...c });
  }
  return out;
}

/**
 * Wrap one logical line into display rows. Bytes are untouched: only row breaks are added.
 * Continuation rows carry the line's own indent, or `hang` columns when that is deeper:
 * a gutter the CLI prints its own continuation lines under.
 */
function wrapLine(line: Line, cols: number, breakAfter = "", hang = 0): Line[] {
  const text = line.spans.map((s) => s.text).join("");
  if (!Number.isFinite(cols) || text.length <= cols) return [line];
  const own = (/^ */.exec(text) ?? [""])[0];
  const indent = own.length >= hang ? own : " ".repeat(hang);
  const chars: Span[] = [];
  for (const s of line.spans) for (const ch of s.text) chars.push({ ...s, text: ch });
  const rows: Line[] = [];
  let start = 0;
  let first = true;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (text.length - start <= width) break;
    const limit = start + width;
    let k = text.lastIndexOf(" ", limit);
    // No space to break at: break after the last breakAfter character in reach,
    // or else a hard break, as a terminal would do. Kept so a line cannot
    // overflow the frame silently (media/capture-url/cols4.mjs).
    const floor = start + (first ? indent.length : 0);
    if (k <= floor) {
      const s = Math.max(-1, ...[...breakAfter].map((ch) => text.lastIndexOf(ch, limit - 1)));
      k = s > floor ? s + 1 : limit;
    }
    let end = k;
    while (end > start && text[end - 1] === " ") end--;
    const row = merge(chars.slice(start, end));
    rows.push({ spans: first ? row : [{ text: indent }, ...row], mark: line.mark });
    let next = k;
    while (text[next] === " ") next++;
    start = next;
    first = false;
  }
  const rest = merge(chars.slice(start));
  rows.push({ spans: first ? rest : [{ text: indent }, ...rest], cursor: line.cursor, mark: line.mark });
  return rows;
}

const wrapScreen = (lines: Line[], cols: number, breakAfter?: string, hang?: number): Line[] =>
  lines.flatMap((l) => wrapLine(l, cols, breakAfter, hang));

/** Mark the logical lines a beat's caption is about. Chrome only: spans are untouched. */
function markLines(lines: Line[], highlight: string[] | undefined): Line[] {
  if (!highlight || highlight.length === 0) return lines;
  return lines.map((l) => {
    const text = l.spans.map((s) => s.text).join("");
    return highlight.some((h) => text.includes(h)) ? { ...l, mark: true } : l;
  });
}

// ---- Components -------------------------------------------------------------

const TerminalLine: React.FC<{ line: Line; fontPx: number; linePx: number }> = ({ line, fontPx, linePx }) => (
  <div
    style={{
      height: linePx,
      lineHeight: `${linePx}px`,
      whiteSpace: "pre",
      background: line.mark ? "rgba(88, 166, 255, 0.16)" : "transparent",
      boxShadow: line.mark ? "-10px 0 0 rgba(88, 166, 255, 0.16), 10px 0 0 rgba(88, 166, 255, 0.16)" : "none",
    }}
  >
    {line.spans.map((s, i) => (
      <span
        key={i}
        style={{
          color: s.fg ?? (s.dim ? tokens.dim : tokens.text),
          fontWeight: s.bold ? 700 : 400,
          textDecoration: s.underline ? "underline" : "none",
          background: s.bg ?? "transparent",
          fontStyle: s.chrome ? "italic" : "normal",
        }}
      >
        {s.text}
      </span>
    ))}
    {line.cursor ? (
      <span
        style={{
          display: "inline-block",
          width: fontPx * 0.6,
          height: linePx - 4,
          verticalAlign: "text-bottom",
          background: tokens.text,
        }}
      />
    ) : null}
  </div>
);

interface BeatViewProps extends DemoProps {
  index: number;
  finals: Line[][];
}

const BeatView: React.FC<BeatViewProps> = (props) => {
  const { beats, index, finals, typingMs = TYPING_MS, ligatures = true, breakAfter } = props;
  const frame = useCurrentFrame();
  const beat = beats[index];
  const { fontPx, linePx, cols } = beat.type ?? props;
  const logical = markLines(screenAt(beat, frame, index > 0 ? finals[index - 1] : [], typingMs), beat.highlight);
  let lines = wrapScreen(logical, cols, breakAfter, beat.hang);

  // A continuing beat must not move the text block, so a chain shares one layout
  // row count: the final row count of the last beat in the chain, plus the prompt.
  let j = index;
  while (j + 1 < beats.length && beats[j + 1].continues) j++;
  const rows = wrapScreen(finals[j], cols, breakAfter, beats[j].hang).length + 1;
  let top = Math.max(TERMINAL_INSET, Math.round((TERMINAL_HEIGHT - rows * linePx) / 2));

  // Beat.follow: the window holds the last `capacity` rows, as a terminal does,
  // and a scroll-back eases up to the last line holding the anchor text.
  let clip: number | undefined; // a scrolling window's height: rows outside it are not drawn
  if (beat.follow !== undefined) {
    const capacity = Math.floor((TERMINAL_HEIGHT - 2 * TERMINAL_INSET) / linePx);
    const bottom = Math.max(0, lines.length - capacity);
    let offset = bottom;
    const anchor = beat.follow;
    if (typeof anchor === "string") {
      let at = -1;
      let row = 0;
      for (const l of logical) {
        if (l.spans.map((s) => s.text).join("").includes(anchor)) at = row;
        row += wrapLine(l, cols, breakAfter, beat.hang).length;
      }
      const { scrollAt } = timeline(beat, typingMs);
      if (at >= 0) {
        offset = interpolate(frame, [scrollAt, scrollAt + SCROLL_FRAMES], [bottom, Math.min(at, bottom)], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        });
      }
    }
    const first = Math.floor(offset);
    lines = lines.slice(first, first + capacity + 1);
    top = -Math.round((offset - first) * linePx);
    clip = capacity * linePx;
  } else if (beat.scroll) {
    // Scrollback (Beat.scroll): top-aligned, then each entry eases the view down
    // to its row, never past the last row.
    const fit = Math.floor((TERMINAL_HEIGHT - 2 * TERMINAL_INSET) / linePx);
    const whole = Math.floor((TERMINAL_HEIGHT - TERMINAL_INSET) / linePx); // rows drawn below the inset
    const maxOffset = Math.max(0, lines.length - fit);
    const text = (l: Line) => l.spans.map((x) => x.text).join("");
    let offset = 0;
    for (const s of beat.scroll) {
      let row = lines.findIndex((l) => text(l).includes(s.toRow));
      if (s.bottom && row >= 0) {
        // The line's last display row: continuation rows carry its indent, not the match.
        const logical = screenAt(beat, frame, index > 0 ? finals[index - 1] : [], typingMs).find((l) => text(l).includes(s.toRow));
        const extra = logical ? wrapLine(logical, cols, breakAfter, beat.hang).length - 1 : 0;
        row = row + extra - (whole - 1);
      }
      const target = Math.min(maxOffset, Math.max(0, row));
      offset = interpolate(frame, [s.at, s.at + 15], [offset, target], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.inOut(Easing.cubic),
      });
    }
    top = TERMINAL_INSET - Math.round(offset * linePx);
  }

  return (
    <AbsoluteFill style={{ background: tokens.bg, fontFamily: mono, fontVariantLigatures: ligatures ? "normal" : "none" }}>
      {/* Title band */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: FRAME,
          height: TITLE_BAND,
          background: tokens.bgBand,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 44px",
          boxSizing: "border-box",
          color: tokens.accent,
        }}
      >
        <div style={{ fontSize: 44, fontWeight: 700 }}>{beat.title}</div>
        <div style={{ fontSize: 28 }}>
          {index + 1} / {beats.length}
        </div>
      </div>
      <div style={{ position: "absolute", top: TITLE_BAND, left: 0, width: FRAME, height: RULE, background: tokens.accent }} />

      {/* Terminal, cropped to used rows and centred */}
      <div
        style={{
          position: "absolute",
          top: TERMINAL_TOP,
          left: 0,
          width: FRAME,
          height: TERMINAL_HEIGHT,
          background: tokens.bg,
          overflow: "hidden",
        }}
      >
        {clip === undefined ? (
          <div style={{ position: "absolute", top, left: TERMINAL_INSET, fontSize: fontPx }}>
            {lines.map((l, i) => {
              // A terminal shows whole rows: one cut by the terminal's edge is not drawn.
              const y = top + i * linePx;
              const whole = y >= 0 && y + linePx <= TERMINAL_HEIGHT;
              return whole ? (
                <TerminalLine key={i} line={l} fontPx={fontPx} linePx={linePx} />
              ) : (
                <div key={i} style={{ height: linePx }} />
              );
            })}
          </div>
        ) : (
          <div style={{ position: "absolute", top: TERMINAL_INSET, left: 0, width: FRAME, height: clip, overflow: "hidden" }}>
            <div style={{ position: "absolute", top, left: TERMINAL_INSET, fontSize: fontPx }}>
              {lines.map((l, i) => (
                <TerminalLine key={i} line={l} fontPx={fontPx} linePx={linePx} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Caption band */}
      <div
        style={{
          position: "absolute",
          top: FRAME - CAPTION_BAND - RULE,
          left: 0,
          width: FRAME,
          height: RULE,
          background: tokens.accent,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: FRAME - CAPTION_BAND,
          left: 0,
          width: FRAME,
          height: CAPTION_BAND,
          background: tokens.bgBand,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            maxWidth: FRAME - 88,
            textAlign: "center",
            color: tokens.text,
            fontSize: 30,
            lineHeight: "36px",
          }}
        >
          {/*
            One nowrap span per space-separated word. design.md's shipping check 2
            forbids a token split across a line break, and CSS breaks after a
            hyphen by default: an unguarded caption renders `--check` as `--` /
            `check`, which reads as two flags. Breaking only at the real spaces
            keeps every token whole.
          */}
          {beat.caption.split(" ").map((word, i) => (
            <React.Fragment key={i}>
              {i > 0 ? " " : null}
              <span style={{ whiteSpace: "nowrap" }}>{word}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

async function loadFonts() {
  const faces = [
    new FontFace("JetBrains Mono", `url(${staticFile("fonts/JetBrainsMono-Regular.ttf")})`, { weight: "400" }),
    new FontFace("JetBrains Mono", `url(${staticFile("fonts/JetBrainsMono-Bold.ttf")})`, { weight: "700" }),
  ];
  for (const f of faces) document.fonts.add(await f.load());
}

export const DemoView: React.FC<DemoProps> = (props) => {
  const { beats } = props;
  const [handle] = useState(() => delayRender("JetBrains Mono"));
  useEffect(() => {
    loadFonts().then(() => continueRender(handle));
  }, [handle]);

  // Screens carried into a continuing beat, computed once per beat list.
  const finals = useMemo(() => {
    const f: Line[][] = [];
    beats.forEach((b, i) => {
      f[i] = finalScreen(b, i > 0 ? f[i - 1] : []);
    });
    return f;
  }, [beats]);
  const durations = beats.map((b) => timeline(b, props.typingMs).duration);

  let from = 0;
  return (
    <AbsoluteFill style={{ background: tokens.bg }}>
      {beats.map((_, i) => {
        const start = from;
        from += durations[i];
        return (
          <Sequence key={i} from={start} durationInFrames={durations[i]} name={beats[i].title}>
            <BeatView {...props} index={i} finals={finals} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** The first sidecar video, unchanged: 16 px, no wrapping (its longest line fit). */
export const Demo: React.FC = () => <DemoView beats={sidecarBeats} fontPx={16} linePx={22} cols={Infinity} />;
