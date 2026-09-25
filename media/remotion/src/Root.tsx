import React from "react";
import { Composition } from "remotion";
import { Demo, DemoView } from "./Demo";
import { FPS, totalFrames } from "./beats";
import { beats as urlBeats, totalFrames as urlTotalFrames } from "./url/beats";
import { beats as joinBeats, totalFrames as joinTotalFrames, TYPING_MS as joinTypingMs } from "./join/beats";
import { beats as provenanceBeats, totalFrames as provenanceTotalFrames, TYPING_MS as provenanceTypingMs } from "./provenance/beats";
import { beats as collectionsBeats, totalFrames as collectionsTotalFrames } from "./collections/beats";
import { beats as locationBeats, totalFrames as locationTotalFrames, TYPING_MS as locationTypingMs } from "./location/beats";
import { beats as termBeats, totalFrames as termTotalFrames, TYPING_MS as termTypingMs } from "./term/beats";
import { beats as a11yBeats, totalFrames as a11yTotalFrames, TYPING_MS as a11yTypingMs } from "./a11y/beats";
import { beats as lintBeats, totalFrames as lintTotalFrames, TYPING_MS as lintTypingMs } from "./lint/beats";
import { beats as graphBeats, totalFrames as graphTotalFrames, TYPING_MS as graphTypingMs } from "./graph/beats";

/** sidecar-url-1x1: 23 px / 75 columns, derived in media/sidecar-url-1x1.script.md. */
const DemoUrl: React.FC = () => <DemoView beats={urlBeats} fontPx={23} linePx={32} cols={75} />;

/** sidecar-join-1x1: 26 px / 66 columns, derived in media/sidecar-join-1x1.script.md (media/capture-join/cols.mjs). */
const DemoJoin: React.FC = () => <DemoView beats={joinBeats} fontPx={26} linePx={36} cols={66} typingMs={joinTypingMs} />;

/** collections-1x1: 22 px / 78 columns, derived in media/collections-1x1.script.md (media/capture-collections/cols.mjs). */
const DemoCollections: React.FC = () => <DemoView beats={collectionsBeats} fontPx={22} linePx={31} cols={78} />;

/** provenance-pins-1x1: 23 px / 75 columns, derived in media/provenance-pins-1x1.script.md (media/capture-provenance/cols.mjs). */
const DemoProvenance: React.FC = () => <DemoView beats={provenanceBeats} fontPx={23} linePx={32} cols={75} typingMs={provenanceTypingMs} />;

/** field-location-1x1: 28 px / 61 columns, derived in media/field-location-1x1.script.md (media/capture-location/cols.mjs). */
const DemoLocation: React.FC = () => <DemoView beats={locationBeats} fontPx={28} linePx={39} cols={61} typingMs={locationTypingMs} />;

/** term-vale-1x1: 21 px / 82 columns, derived in media/term-vale-1x1.script.md (media/capture-term/cols.mjs). */
const DemoTerm: React.FC = () => <DemoView beats={termBeats} fontPx={21} linePx={32} cols={82} typingMs={termTypingMs} ligatures={false} />;

/** a11y-exclude-1x1: 32 px / 54 columns, derived in media/a11y-exclude-1x1.script.md (media/capture-a11y/cols.mjs). */
const DemoA11y: React.FC = () => <DemoView beats={a11yBeats} fontPx={32} linePx={45} cols={54} typingMs={a11yTypingMs} ligatures={false} />;

/**
 * lint-templates-infer-1x1: 22 px / 78 columns, derived in
 * media/lint-templates-infer-1x1.script.md
 * (media/capture-lint/cols.mjs).
 * Ligatures off: the page's `---` frontmatter fences would draw as one rule.
 */
const DemoLint: React.FC = () => <DemoView beats={lintBeats} fontPx={22} linePx={31} cols={78} typingMs={lintTypingMs} ligatures={false} />;

/**
 * graph-vocabulary-1x1: 22 px / 78 columns, derived in media/graph/graph-vocabulary-1x1.script.md
 * (media/graph/capture/cols.mjs). Ligatures off: the frontmatter fences are `---`.
 */
const DemoGraph: React.FC = () => <DemoView beats={graphBeats} fontPx={22} linePx={31} cols={78} typingMs={graphTypingMs} ligatures={false} />;

export const Root: React.FC = () => (
  <>
    <Composition
      id="SidecarDemo"
      component={Demo}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={totalFrames}
    />
    <Composition
      id="SidecarUrlDemo"
      component={DemoUrl}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={urlTotalFrames}
    />
    <Composition
      id="SidecarJoinDemo"
      component={DemoJoin}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={joinTotalFrames}
    />
    <Composition
      id="CollectionsDemo"
      component={DemoCollections}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={collectionsTotalFrames}
    />
    <Composition
      id="ProvenanceDemo"
      component={DemoProvenance}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={provenanceTotalFrames}
    />
    <Composition
      id="LocationDemo"
      component={DemoLocation}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={locationTotalFrames}
    />
    <Composition
      id="TermDemo"
      component={DemoTerm}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={termTotalFrames}
    />
    <Composition
      id="A11yExcludeDemo"
      component={DemoA11y}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={a11yTotalFrames}
    />
    <Composition
      id="LintDemo"
      component={DemoLint}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={lintTotalFrames}
    />
    <Composition
      id="GraphVocabularyDemo"
      component={DemoGraph}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={graphTotalFrames}
    />
  </>
);
