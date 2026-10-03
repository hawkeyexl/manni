import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Composition,
  OffthreadVideo,
  Sequence,
  continueRender,
  delayRender,
  registerRoot,
  staticFile,
} from "remotion";

// docs/content-strategy/design.md, "Palette" (dark). Accent is blue: red, green,
// yellow and cyan already mean something in manni's own output.
const t = {
  accent: "#58a6ff",
  bg: "#171717",
  bgBand: "#0d0d0d",
  text: "#ffffff",
  textMuted: "#d5dbe3",
};
const mono = '"JetBrains Mono", ui-monospace, Consolas, monospace';

const FPS = 30;
const FRAME = 1080;
const TITLE_BAND = 112;
const RULE = 2;
const CAPTION_BAND = 86;
const TERM_TOP = TITLE_BAND + RULE;
const TERM_H = FRAME - TITLE_BAND - CAPTION_BAND - 2 * RULE; // 878
// Captures: VHS 1200x980 at FontSize 28 (69 columns), cropped to the used
// 1160x614 (longest line is 66 columns, 16 used rows).
const CLIP_W = 1160;
const CLIP_H = 614;
const CLIP_SCALE = (FRAME - 2 * 24) / CLIP_W; // 1032px wide in frame

export interface Beat {
  src?: string;
  frames: number;
  title: string;
  caption: string;
}

export const beats: Beat[] = [
  { src: "beat1.mp4", frames: 156, title: "A page with an eval", caption: "The page's eval says it must name the CLI." },
  { src: "beat2.mp4", frames: 294, title: "Run the evals", caption: "manni docevals run fails it. Exit code 1." },
  { src: "beat3.mp4", frames: 470, title: "Fix and rerun", caption: "Fix the line, rerun: all pass. Exit code 0." },
  { frames: 90, title: "manni docevals", caption: "Evals over your docs pages." },
];
const COUNTED = beats.filter((b) => b.src).length;
export const totalFrames = beats.reduce((n, b) => n + b.frames, 0);

const useFonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("JetBrains Mono", `url(${staticFile("fonts/JetBrainsMono-Regular.ttf")})`, { weight: "400" }),
      new FontFace("JetBrains Mono", `url(${staticFile("fonts/JetBrainsMono-Bold.ttf")})`, { weight: "700" }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => {
        loaded.forEach((f) => document.fonts.add(f));
        continueRender(handle);
      })
      .catch((err: unknown) => {
        throw err;
      });
  }, [handle]);
};

const Bands: React.FC<{ beat: Beat; n: number }> = ({ beat, n }) => (
  <>
    <div
      style={{
        position: "absolute", left: 0, top: 0, width: FRAME, height: TITLE_BAND,
        background: t.bgBand, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 44px", boxSizing: "border-box", fontFamily: mono, color: t.accent,
      }}
    >
      <span style={{ fontSize: 46, fontWeight: 700 }}>{beat.title}</span>
      {beat.src ? <span style={{ fontSize: 28 }}>{`${n} / ${COUNTED}`}</span> : null}
    </div>
    <div style={{ position: "absolute", left: 0, top: TITLE_BAND, width: FRAME, height: RULE, background: t.accent }} />
    <div style={{ position: "absolute", left: 0, top: FRAME - CAPTION_BAND - RULE, width: FRAME, height: RULE, background: t.accent }} />
    <div
      style={{
        position: "absolute", left: 0, top: FRAME - CAPTION_BAND, width: FRAME, height: CAPTION_BAND,
        background: t.bgBand, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: mono, fontSize: 31, color: t.text,
      }}
    >
      {beat.caption}
    </div>
  </>
);

const Terminal: React.FC<{ src: string }> = ({ src }) => {
  const w = CLIP_W * CLIP_SCALE;
  const h = CLIP_H * CLIP_SCALE;
  return (
    <div
      style={{
        position: "absolute", left: (FRAME - w) / 2, top: TERM_TOP + (TERM_H - h) / 2, width: w, height: h,
      }}
    >
      <OffthreadVideo src={staticFile(src)} muted style={{ width: w, height: h, display: "block" }} />
    </div>
  );
};

const EndCard: React.FC = () => (
  <div
    style={{
      position: "absolute", left: 0, top: TERM_TOP, width: FRAME, height: TERM_H,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 36, fontFamily: mono, fontSize: 44, color: t.text,
    }}
  >
    <div><span style={{ color: t.textMuted }}>$ </span>npm i -D @hawkeyexl/manni</div>
    <div><span style={{ color: t.textMuted }}>$ </span>manni docevals run</div>
  </div>
);

const Demo: React.FC = () => {
  useFonts();
  let from = 0;
  return (
    <AbsoluteFill style={{ background: t.bg }}>
      {beats.map((beat, i) => {
        const start = from;
        from += beat.frames;
        return (
          <Sequence key={beat.title} from={start} durationInFrames={beat.frames}>
            {beat.src ? <Terminal src={beat.src} /> : <EndCard />}
            <Bands beat={beat} n={i + 1} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Root: React.FC = () => (
  <Composition id="DocevalsDemo" component={Demo} width={FRAME} height={FRAME} fps={FPS} durationInFrames={totalFrames} />
);

registerRoot(Root);
