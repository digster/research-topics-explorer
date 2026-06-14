# Architecture

A static, no-build, no-server single-page app for exploring a research-topics
knowledge graph. Everything observable in the browser derives from one CSV
file through a two-step pipeline.

## Big picture

```
research-topics.csv ──(node parse.mjs)──► data.js ──(<script src>)──► index.html
   source of truth        generated, committed        all views render from
   hand-curated           window.RESEARCH_DATA        window.RESEARCH_DATA
```

- **`research-topics.csv`** — one row per topic. Connections are *curated
  data*, not runtime heuristics: `connects_to_ids` holds resolved target ids
  **positionally aligned** with the human-readable `connects_to_raw`
  (pipe-separated; an empty slot = "this connection never resolved to a
  topic in the dataset" and renders as a faded chip).
- **`parse.mjs`** — pure transform + validation. Exports `parseCSV`,
  `csvToRecords`, `splitPipes`, `versionNum`, `buildPayload`; `main()` runs
  **only when executed directly** (`node parse.mjs`), so importing the module
  (tests, tooling) never rewrites `data.js`.
- **`data.js`** — committed generated artifact. GitHub Pages has no Node
  runtime, so any CSV edit must be followed by `node parse.mjs` and a commit
  of *both* files (deploy = serve repo root verbatim; `.nojekyll` keeps
  Jekyll out of the way).
- **`index.html`** — the current app, "The Vault": CSS + five views (Catalog,
  Knowledge Graph, Thinkers, Reader, Hubs) + a shared slide-over detail panel,
  in a light-editorial theme. No framework; d3@7 and marked@13 come from
  jsdelivr CDN.
- **`index.v0.html`** — the previous app: six views (Graph, Roadmap, Cards,
  Hubs, Disciplines, Creators) on a dark theme. Kept verbatim and reads the
  same `data.js`; both share the `rte:markedTopics` localStorage key. A redesign
  is a new file, not an in-place rewrite, so the old surface stays runnable.

## The version-agnostic convention (load-bearing)

Topics carry a dataset version tag (`v5`…`v8` today). **No code may hardcode
a version list.** Both layers derive versions from the data:

- `parse.mjs` builds `stats.byVersion` by grouping actual `version` values,
  naturally sorted via `versionNum()` ("v9" < "v10").
- `index.html` computes `ALL_VERSIONS` from `TOPICS` and feeds it to the
  filter sidebar, stats bar, graph legend, reset handler, and sorts.
- Per-version CSS (`.badge.vN`, `.bar.vN`, `.phase-card.vN`, `--accent-vN`)
  is **generated at boot** by `injectVersionStyles()`. Hand-picked accents
  live as `--accent-vN` in the `:root` block; versions without one get a
  deterministic golden-angle HSL fallback. Injection caveat: the generated
  stylesheet sits *after* the static one, so overlay rules use
  `:not(.marked)` to keep the static `.phase-card.marked` mint stripe
  winning at equal specificity.

History: v8 rows were once invisible because the app hardcoded
`new Set(["v5","v6","v7"])` while the parser happily emitted all rows —
if you add a version-dependent feature, derive it from `ALL_VERSIONS`.

## The Vault (`index.html`): a presentation layer, no pipeline edits

The redesign re-presents the *same* `window.RESEARCH_DATA` through three new
lenses computed **at boot, in `index.html`** — deliberately not in `parse.mjs`,
to keep the data pipeline (and `data.js`) untouched:

- **`DISCIPLINE_OF`** — `topic.id → {phase, name, color}`, built by scanning
  `DATA.disciplines[].topics[].targetId`. Each topic sits in exactly one
  discipline; its phase 1–10 maps to one of ten hand-picked accent colours
  (`DISCIPLINE_COLORS`). This discipline colour is the app's *primary* visual
  encoding (Catalog stripes/tags, graph node fill, Hubs bars); version is a
  secondary badge.
- **`LANE_OF` / `laneOf()`** — a "priority lane" (Start here / Foundations /
  Deep dives / Niche & emerging / Thinkers & texts) derived by keyword-matching
  `groupLabel`. Pure presentation; used only as a Catalog filter (there is no
  Priority Board view).
- **`buildThinkerIndex()`** — aggregates `keyFigures` across the *visible*
  topics into `person → [topicId]` for the Thinkers view, so the version filter
  narrows it. ~898 people; cards feature the 50 who thread through 2+ topics.

Shared filtering still flows through `isTopicVisible()` / `visibleTopics()`
(now version + discipline + lane + progress + search), so every view honours the
version filter — editable from both the Catalog rail and the graph legend chips.
Searchable views (Catalog, Thinkers) build their chrome once (guarded by a
`data-built` flag) and only re-render the results container, so the search caret
survives typing.

## Per-view semantics worth knowing

- **Roadmap** — v5 topics anchor the 10 phase columns via their firm
  `phase`. Every *other* version overlays via `likelyPhase`: the first
  number wins (`"3 or 7"` → Phase 3, regex `^\d+`), out-of-range phases are
  silently skipped. Overlay cards are dimmed (0.78) with a version-colored
  left stripe to read as "probable placement".
- **Disciplines** — driven by `discipline_phase`/`discipline_name` columns;
  subtitles are presentation copy in `parse.mjs` (`DISCIPLINE_SUBTITLES`),
  not CSV data. An unknown phase still renders (subtitle empty + parser
  warning).
- **Creators** — `parse.mjs` emits the ids of "people" topics as
  `payload.creators`, identified by `group_label` matching
  `… Individual Thinkers & Creators` (v7 Group A, v9 Group C, …). Derived
  from the data, not a version hardcode, so new creator cohorts join the
  Creators view automatically as long as they use that group label.
- **Marked as worked on** — a binary toggle writes ids into
  `localStorage["rte:markedTopics"]` (Catalog cards in `index.html`; Cards view
  in `index.v0.html`), and the sage wash mirrors read-only elsewhere (Reader in
  the new app; Roadmap + Disciplines in v0). The key is shared across both apps.
  Topic ids are therefore a public, stable contract: they appear in URL hashes
  (`#view=…&topic=…`) and localStorage, so **never change the id slug scheme**
  without a migration.

## Workflows

```sh
node --test parse.test.mjs   # parser tests (node:test, no deps, no package.json)
node parse.mjs               # CSV → data.js (prints per-version counts + ⚠ warnings)
open index.html              # run the app — file:// works; data ships as JS, not fetched CSV
```

`parse.mjs` hard-fails on missing required columns (schema drift) and prints
non-fatal `⚠` warnings for row-level oddities: duplicate ids, missing
id/name/version, non-numeric `phase`, `connects_to_ids` slots exceeding
`connects_to_raw`, unknown discipline phases. A clean run on the real CSV
prints zero warnings — the integration test enforces that, and it avoids
hardcoded row counts so future versions keep it green.

## Conventions that differ from the obvious

- Multi-value CSV cells are **pipe-separated** (values contain commas).
- `tier` falls back to `group_code` in the parser so v7 people rows (no tier
  of their own) still render "A".."E" in tier-interpolating views.
- Self-referencing connection slots are dropped silently (not counted as
  unresolved) — historical parity choice.
- The repo intentionally has **no package.json** — keep it dependency-free;
  `node:test` covers testing without npm.
- Per-day work logs live in `memory/YYYY-MM-DD.md`; prompts are appended to
  `PROMPT.md`.
