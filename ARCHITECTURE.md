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
- **`index.html`** — the entire app: CSS + six views (Graph, Roadmap, Cards,
  Hubs, Disciplines, Creators) + a shared detail side panel. No framework;
  d3@7 and marked@13 come from jsdelivr CDN.

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

History: v8 rows were once invisible because `index.html` hardcoded
`new Set(["v5","v6","v7"])` while the parser happily emitted all rows —
if you add a version-dependent feature, derive it from `ALL_VERSIONS`.

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
- **Marked as worked on** — Cards view toggles ids into
  `localStorage["rte:markedTopics"]`; Roadmap and Disciplines mirror the
  mint wash read-only. Topic ids are therefore a public, stable contract:
  they appear in URL hashes (`#view=…&topic=…`) and localStorage, so
  **never change the id slug scheme** without a migration.

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
