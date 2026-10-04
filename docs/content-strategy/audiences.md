# Target audiences

manni meta serves four distinct audiences. The **lead audience** drives the primary IA track and gets the deepest coverage. Secondary audiences have dedicated tracks, but are scoped to what they actually need from the tool.

## 1. Docs-as-code teams (lead)

Own a docs repo and its frontmatter conventions. They want those conventions enforced automatically, so that downstream systems don't break on bad metadata. Those systems are search indexes, catalogs, site nav, and knowledge graphs.

This is the lead audience. They are the ones adopting manni meta as part of their workflow, configuring it, writing schemas, and living with the CI gate every day. Everything else serves them or intersects with them.

## 2. Platform / CI engineers

Own pipelines across many repos. They want a low-maintenance metadata gate that works on whatever CI system they run. It must emit machine-readable results they can pipe into existing tooling.

They don't author docs and don't own the metadata standard. They install and plumb the gate. Their questions are about exit codes, output formats, and minimizing per-repo config.

## 3. Schema authors / information architects

Own the *metadata standard itself*. That means what fields are required, what formats values must use, and the versioning policy. They want to encode that standard as JSON Schema and evolve it without breaking everyone downstream.

This audience may overlap with docs-as-code teams, often the same person in a small org. The job is still distinct. They define correctness, not enforcement.

## 4. Doc contributors (high-volume, secondary)

Developers or writers who opened a PR and hit a red metadata check. They did not configure manni meta and don't need to understand it deeply. They need to decode one error, find the field, fix it, and move on.

This is the highest-traffic audience by page visits because every contributor who trips a check lands on the fix-it page. It is secondary in terms of depth: one targeted page (T1) serves the entire journey.

## The same four, for docevals

docevals segmented its adopters on who owns the docs and how mature the company is, and arrived at six segments. They land on these four. A docs platform team, a solo owner and a brownfield corpus are all docs-as-code teams. The solo owner differs by hours available, and the brownfield corpus is a lens on the state of the pages, not a different owner. The other three segments are the platform engineers, the owners of the quality standard (the schema authors' job, in prose), and the contributors.

Three concerns cut across every segment for docevals, which is why they get sections of their own rather than footnotes. Can a model be trusted to gate a build (`judge/`)? Can the cost surprise anyone (`ci/cost-and-caching.mdx`, counted in calls, never dollars)? And what executes when the gate runs on a stranger's pull request (`ci/untrusted-pull-requests.mdx`)? Framework was deliberately not a segment, because docevals reads frontmatter and never touches the site build.
