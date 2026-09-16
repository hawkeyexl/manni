import React from "react";
import { Composition } from "remotion";
import { Demo, DemoView } from "./Demo";
import { FPS, totalFrames } from "./beats";
import { beats as urlBeats, totalFrames as urlTotalFrames } from "./url/beats";
import { beats as joinBeats, totalFrames as joinTotalFrames, TYPING_MS as joinTypingMs } from "./join/beats";
import { beats as provenanceBeats, totalFrames as provenanceTotalFrames, TYPING_MS as provenanceTypingMs } from "./provenance/beats";
import { beats as collectionsBeats, totalFrames as collectionsTotalFrames } from "./collections/beats";
import { beats as locationBeats, totalFrames as locationTotalFrames, TYPING_MS as locationTypingMs } from "./location/beats";
import { beats as tracevalsBeats, totalFrames as tracevalsTotalFrames, TYPING_MS as tracevalsTypingMs } from "./tracevals/beats";

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

/** tracevals-1x1: 26 px / 66 columns, derived in media/tracevals-1x1.script.md (media/capture-tracevals/cols.mjs). */
const DemoTracevals: React.FC = () => <DemoView beats={tracevalsBeats} fontPx={26} linePx={36} cols={66} typingMs={tracevalsTypingMs} />;

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
      id="TracevalsDemo"
      component={DemoTracevals}
      width={1080}
      height={1080}
      fps={FPS}
      durationInFrames={tracevalsTotalFrames}
    />
  </>
);
