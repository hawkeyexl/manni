import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender, staticFile, useCurrentFrame } from "remotion";
import { parseAnsi, type Span } from "./ansi";
import { FPS, TYPING_MS, beats as sidecarBeats, timeline, type Beat } from "./beats";

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
}

// ---- Screen model -----------------------------------------------------------

interface Line {
  spans: Span[];
  cursor?: boolean;
  /** Drawn on a faint accent ground; see Beat.highlight. */
  mark?: boolean;
}

const promptSpan: Span = { text: "$ ", fg: tokens.dim };

function finalScreen(beat: Beat, prev: Line[]): Line[] {
  const lines: Line[] = beat.continues ? [...prev] : [];
  for (const c of beat.commands) {
    lines.push({ spans: [promptSpan, { text: c.typed }] });
    if (c.output !== "") for (const spans of parseAnsi(c.output)) lines.push({ spans });
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
      frame < c.enterAt ? Math.min(c.typed.length, Math.floor((frame - c.typeStart) / framesPerChar) + 1) : c.typed.length;
    const typed = c.typed.slice(0, typedCount);
    if (frame < c.enterAt) {
      lines.push({ spans: [promptSpan, { text: typed }], cursor: true });
      return lines;
    }
    lines.push({ spans: [promptSpan, { text: typed }] });
    if (frame < c.outputAt) {
      lines.push({ spans: [], cursor: true });
      return lines;
    }
    if (c.output !== "") for (const spans of parseAnsi(c.output)) lines.push({ spans });
  }
  lines.push({ spans: [promptSpan], cursor: true });
  return lines;
}

// ---- Wrapping ---------------------------------------------------------------

const sameStyle = (a: Span, b: Span) => a.fg === b.fg && a.dim === b.dim && a.bold === b.bold;

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

/** Wrap one logical line into display rows. Bytes are untouched: only row breaks are added. */
function wrapLine(line: Line, cols: number): Line[] {
  const text = line.spans.map((s) => s.text).join("");
  if (!Number.isFinite(cols) || text.length <= cols) return [line];
  const indent = (/^ */.exec(text) ?? [""])[0];
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
    // No space to break at: a hard break, as a terminal would do. Not reached by
    // these captures (checked in media/capture-url/cols4.mjs); kept so a future
    // line cannot overflow the frame silently.
    if (k <= start + (first ? indent.length : 0)) k = limit;
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

const wrapScreen = (lines: Line[], cols: number): Line[] => lines.flatMap((l) => wrapLine(l, cols));

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

const BeatView: React.FC<BeatViewProps> = ({ beats, index, finals, fontPx, linePx, cols, typingMs = TYPING_MS }) => {
  const frame = useCurrentFrame();
  const beat = beats[index];
  const lines = wrapScreen(markLines(screenAt(beat, frame, index > 0 ? finals[index - 1] : [], typingMs), beat.highlight), cols);

  // A continuing beat must not move the text block, so a chain shares one layout
  // row count: the final row count of the last beat in the chain, plus the prompt.
  let j = index;
  while (j + 1 < beats.length && beats[j + 1].continues) j++;
  const rows = wrapScreen(finals[j], cols).length + 1;
  const top = Math.max(TERMINAL_INSET, Math.round((TERMINAL_HEIGHT - rows * linePx) / 2));

  return (
    <AbsoluteFill style={{ background: tokens.bg, fontFamily: mono }}>
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
        <div style={{ position: "absolute", top, left: TERMINAL_INSET, fontSize: fontPx }}>
          {lines.map((l, i) => (
            <TerminalLine key={i} line={l} fontPx={fontPx} linePx={linePx} />
          ))}
        </div>
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
          {beat.caption}
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
