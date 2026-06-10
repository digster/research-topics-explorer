# Research Topics Explorer

> **Live demo:** `https://<github-username>.github.io/research-topics-explorer/` — replace `<github-username>` with the account that hosts this repo. See [Deployment](#deployment) below.

A static, no-server visualization tool for exploring 192 research topics across dataset versions v5–v8. The single source of truth is `research-topics.csv`; the original markdown files (`research-topics-v5/6/7.md`, `disciplines.md`) are kept as historical reference but are no longer read by any code.

The pipeline is **version-agnostic**: every version-dependent surface (filters, colors, stats, graph legend, roadmap overlay) derives from the versions actually present in the CSV, so adding v9/v10 rows requires no code changes — see [Adding a new version](#adding-a-new-version).

Open `index.html` directly in a browser — no install, no build, no dev server. The app is a single page with six interactive views over the same dataset.

## Views

| View        | What it shows                                                                                      |
|-------------|----------------------------------------------------------------------------------------------------|
| Graph       | Force-directed knowledge graph of all topics. Node size = in-degree.                               |
| Roadmap     | v5's 10-phase study plan as swimlanes. Topics from every other version are overlaid into their first `likely_phase` (e.g. "3 or 7" → Phase 3) as dimmed, version-striped cards. |
| Cards       | Searchable / sortable grid of every topic with figures + excerpt.                                  |
| Hubs        | Top 30 topics by in-degree, out-degree, or cross-version "bridge score."                           |
| Disciplines | Thematic column layout grouping all topics under the v5 10-phase study sequence.                   |
| Creators    | Subgraph of v7 Group A thinkers + everything they reference.                                       |

The right side panel renders the selected topic's full markdown description, key figures, outgoing connections, and incoming references — every chip is clickable to navigate.

### Mark topics as worked on

Each card on the **Cards** view has a small `✓` toggle next to its version badge. Click it to mark the topic as something you've worked on; the card picks up a soft mint pastel wash. The same wash appears on the matching tile in **Roadmap** and the matching row in **Disciplines**, so your progress reads at a glance across views. State is persisted in `localStorage` under the key `rte:markedTopics` (a JSON array of topic ids) — clearing site data resets it.

## Quick start

```sh
# Open the app — no server needed
open index.html
```

That's it.

## Deployment

The app is fully static (no build step, no server, no API), so it deploys to **GitHub Pages** as-is from the `main` branch.

### One-time setup

1. Push this repository to GitHub (any name; the URL pattern below assumes `research-topics-explorer`).
2. In the repo on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, set:
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` &nbsp;/&nbsp; folder `/ (root)`
4. **Save.** The first build runs in ~30–60 seconds.

The site will be served at:

```
https://<github-username>.github.io/<repo-name>/
```

### Subsequent deploys

Every push to `main` republishes automatically. There is no build pipeline to wait on — Pages simply serves the files at the publish root.

### Notes

- A zero-byte `.nojekyll` file at the repo root tells Pages to **skip Jekyll processing** and serve files verbatim. It's already committed; do not delete it.
- All asset references in [index.html](index.html) are relative (`data.js`) or absolute `https://` CDN URLs (`d3@7`, `marked@13`), so the app works unmodified at the project-page subpath. No `<base>` tag or rewrites needed.
- Pages has **no Node runtime**. If you edit `research-topics.csv`, regenerate `data.js` locally (`node parse.mjs`) and **commit the updated `data.js`** along with your CSV changes — otherwise the deployed site will be out of sync.
- The default `https://*.github.io` domain serves over HTTPS, so the CDN scripts won't trigger mixed-content warnings.

## Regenerating the data

The dataset lives in `research-topics.csv` (one row per topic) and is pre-processed into `data.js` because browsers block `fetch()` on `file://` URLs. If you edit the CSV, regenerate with:

```sh
node parse.mjs
```

Output:

```
✓ data.js written
  topics: 192 (v5=56, v6=35, v7=71, v8=30)
  edges: 760 resolved, 280 unresolved connection slots
  disciplines: 10
  creators: 23
```

The parser:
- Reads `research-topics.csv` (RFC 4180; multi-value cells like `key_figures` are pipe-separated)
- Fails loudly if a required column is missing, and prints `⚠` warnings for row-level problems (duplicate ids, non-numeric `phase`, misaligned connection slots, unknown discipline phases) without blocking generation
- Builds edges from `connects_to_ids`, which is positionally aligned with `connects_to_raw` — an empty slot means that connection never resolved to a topic
- Groups topics into the 10 thematic discipline columns via `discipline_phase` / `discipline_name`
- Computes in/out degree per topic and per-version counts (derived from the data, not a hardcoded version list)

### Tests

The parser has a test suite (`node:test`, no dependencies):

```sh
node --test parse.test.mjs
```

It covers the CSV grammar, the payload transform (including unknown future versions like v9/v10 flowing through untouched — the regression that once made new versions invisible), validation warnings, and structural invariants against the real CSV. `parse.mjs` is import-safe: importing it never rewrites `data.js`; only `node parse.mjs` does.

### Adding a new version

1. Append rows to `research-topics.csv` with a new `version` tag (e.g. `v9`), ids like `v9-topic-name`, and `source_file`/`source_date` filled in. Give each row a `discipline_phase`/`discipline_name` (Disciplines view) and a `likely_phase` (Roadmap overlay placement — `"3"` or `"3 or 7"`, first number wins).
2. Run `node parse.mjs` and commit both files.
3. *(Optional)* Hand-pick an accent color by adding `--accent-v9: #…;` to the `:root` block in `index.html`. Without one, the app generates a deterministic fallback hue at boot, so this is purely cosmetic.

Nothing else: filters, stats, legend, badges, hub bars, and the roadmap pick the new version up from the data.

Roughly 30% of raw connection strings have no resolved target — they reference broad fields ("biology", "economics", "AI agents") that have no dedicated topic in this dataset. Those still appear in the side panel as faded chips. To add or fix a connection, edit the `connects_to_ids` slot for that row in the CSV.

## Architecture

```
research-topics-explorer/
├── research-topics.csv       # source of truth (topics, connections, disciplines)
├── parse.mjs                 # Node parser: research-topics.csv → data.js (import-safe)
├── parse.test.mjs            # parser test suite — node --test parse.test.mjs
├── data.js                   # generated, sets window.RESEARCH_DATA
├── index.html                # single-file app (HTML + CSS + JS)
├── ARCHITECTURE.md           # big-picture data flow + project conventions
├── research-topics-v5.md     # historical source (no longer parsed)
├── research-topics-v6.md     # historical source (no longer parsed)
├── research-topics-v7.md     # historical source (no longer parsed)
├── disciplines.md            # historical overlay (no longer parsed)
├── memory/                   # per-day work logs (per repo CLAUDE.md convention)
└── README.md
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the data-flow details and the version-agnostic conventions.

External libs are loaded from `cdn.jsdelivr.net`:
- `d3@7` for the force graph + bar charts
- `marked@13` for rendering description markdown in the side panel

No npm, no package.json, no node_modules.

## URL deep-linking

Selecting a topic or switching views updates the hash:

```
index.html#view=graph&topic=v5-cybernetics-and-control-theory
```

Reload-safe and bookmarkable.

## Keyboard / mouse

- **Click** any node, card, or chip to open it in the side panel
- **Drag** graph nodes to rearrange; click empty space to clear highlight
- **Scroll** to zoom the graph; **freeze layout** locks the simulation
- **Search** matches topic names, key figures, and description text
- Filter checkboxes for version / tier-group / phase compose with search

## Known limitations

- Browsers (Chrome, Safari) cannot `fetch()` from `file://` — that's why the data ships as `data.js`, not `data.csv`
- Connections are only as good as the `connects_to_ids` column in the CSV; unresolved slots render as faded chips
- Force layout for ~200 nodes can take a few seconds to settle on first load

## License

MIT — see `LICENSE`.
