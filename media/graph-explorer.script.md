# Graph explorer demo in 35 seconds

The recording skills prescribed by CLAUDE.md are not installed in this session.
They are writing-toolkit video-script-writing, video-recording, video-editing
and closed-caption-creation. This is the beat sheet and executable preparation
recipe, not a claim that a video was recorded. Use the approved recording skills
when available; preserve their capture sources, captions and thumbnail here.

## Prepare

Run from the graph-explorer worktree in PowerShell:

```powershell
npm run build
node dist/cli.js graph publish --collection site
node dist/cli.js graph publish --collection site --collection strategy --out docs/public/explorer-data
node scripts/export-explorer-metadata.mjs
node dist/cli.js graph check --graph docs/public/explorer-data/graph.ttl
node dist/cli.js site start
```

Open the printed URL at `/manni/graph/explore/`. For repeatable screenshots and
browser QA in a second terminal, use its actual printed port:

```powershell
$env:EXPLORER_URL = 'http://127.0.0.1:4321/manni/graph/explore/'
node scripts/check-explorer-browser.mjs
```

## Capture

1080×1080, 30fps, 35 seconds. Blue chrome, JetBrains Mono, light or dark
palette per `docs/content-strategy/design.md`. Every beat has an on-screen
caption. Use a separate native-width cut for embedding in the docs.

| Time | Action | Caption |
| --- | --- | --- |
| 0–5s | Terminal: run the authoring graph publish command; show its page and strategy-record counts. | Your docs already connect to people and journeys. |
| 5–10s | Browser: the explorer opens on the whole graph; choose 🎲 Random node. | Start anywhere and follow a connection. |
| 10–17s | Show whole graph, search Devin, select the Persona result. | Follow the reader's journey. |
| 17–23s | Set depth to 2; select a journey and open Connections. | Follow incoming and outgoing relationships. |
| 23–28s | Open Metadata on a page: show its personas, journeys and a citation entry. | Keep the authoring context in view. |
| 28–35s | Phone portrait: List, select a result, show the bottom sheet. | The same graph, usable on your phone. |

Review the captions at phone size. Record actual counts from the run; do not
hard-code the fixture corpus's numbers into a caption. Deliver the MP4 without
committing it. No publishing or social posting is part of this task.
