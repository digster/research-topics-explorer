# Research Topics Explorer

> **Live demo:** `https://<github-username>.github.io/research-topics-explorer/` — replace `<github-username>` with the account that hosts this repo. See [Deployment](#deployment) below.

A static, no-server visualization tool for exploring 162 research topics curated across `research-topics-v5.md`, `research-topics-v6.md`, and `research-topics-v7.md`.

Open `index.html` directly in a browser — no install, no build, no dev server. The app is a single page with six interactive views over the same dataset.

## Views

| View        | What it shows                                                                                      |
|-------------|----------------------------------------------------------------------------------------------------|
| Graph       | Force-directed knowledge graph of all topics. Node size = in-degree.                               |
| Roadmap     | v5's 10-phase study plan as swimlanes, with v6 additions overlaid.                                 |
| Cards       | Searchable / sortable grid of every topic with figures + excerpt.                                  |
| Hubs        | Top 30 topics by in-degree, out-degree, or cross-version "bridge score."                           |
| Disciplines | Thematic column layout grouping all 162 v5/v6/v7 topics under the v5 10-phase study sequence.      |
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
- Pages has **no Node runtime**. If you change any of the source markdown files, regenerate `data.js` locally (`node parse.mjs`) and **commit the updated `data.js`** along with your markdown changes — otherwise the deployed site will be out of sync.
- The default `https://*.github.io` domain serves over HTTPS, so the CDN scripts won't trigger mixed-content warnings.

## Regenerating the data

The dataset is pre-processed once into `data.js` because browsers block `fetch()` on `file://` URLs. If you edit the source markdown files, regenerate with:

```sh
node parse.mjs
```

Output:

```
✓ data.js written
  topics: 162 (v5=56, v6=35, v7=71)
  edges:  588
  unresolved connections: 278
  creators (v7 Group A): 23
  disciplines: 10 (unresolved discipline topics: 0)
```

The parser:
- Extracts H3 topics from each `## Tier` / `## Group` section
- Pulls metadata (tier, phase, idCode, one-line pitch) from the master tables
- Resolves "Connects to" / "Resonates with" strings to topic IDs using token-aligned prefix/suffix matching plus a small alias table (HCI, ML, DSP, GEB, SICP, …)
- Parses the optional `disciplines.md` overlay into phase-grouped thematic columns, resolving each bullet to a topic id via the shared index
- Computes in/out degree per topic

Roughly 30% of raw connection strings remain unresolved — they reference broad fields ("biology", "economics", "AI agents") that have no dedicated topic in this dataset. Those still appear in the side panel as faded chips.

## Architecture

```
research-topics-explorer/
├── research-topics-v5.md     # source (untouched)
├── research-topics-v6.md     # source (untouched)
├── research-topics-v7.md     # source (untouched)
├── disciplines.md            # thematic overlay (phase → topics)
├── parse.mjs                 # one-shot Node parser → data.js
├── data.js                   # generated, ~350KB, sets window.RESEARCH_DATA
├── index.html                # single-file app (HTML + CSS + JS)
├── memory/                   # per-day work logs (per repo CLAUDE.md convention)
└── README.md
```

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

- Browsers (Chrome, Safari) cannot `fetch()` from `file://` — that's why the data ships as `data.js`, not `data.json`
- Connection resolution is heuristic; abbreviations like "AI" map to the closest topic via aliases
- Force layout for 162 nodes can take a few seconds to settle on first load

## License

MIT — see `LICENSE`.
