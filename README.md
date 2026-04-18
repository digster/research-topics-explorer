# Research Topics Explorer

A static, no-server visualization tool for exploring 162 research topics curated across `research-topics-v5.md`, `research-topics-v6.md`, and `research-topics-v7.md`.

Open `index.html` directly in a browser — no install, no build, no dev server. The app is a single page with five interactive views over the same dataset.

## Views

| View      | What it shows                                                                 |
|-----------|-------------------------------------------------------------------------------|
| Graph     | Force-directed knowledge graph of all topics. Node size = in-degree.           |
| Roadmap   | v5's 10-phase study plan as swimlanes, with v6 additions overlaid.            |
| Cards     | Searchable / sortable grid of every topic with figures + excerpt.              |
| Hubs      | Top 30 topics by in-degree, out-degree, or cross-version "bridge score."       |
| Creators  | Subgraph of v7 Group A thinkers + everything they reference.                   |

The right side panel renders the selected topic's full markdown description, key figures, outgoing connections, and incoming references — every chip is clickable to navigate.

## Quick start

```sh
# Open the app — no server needed
open index.html
```

That's it.

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
```

The parser:
- Extracts H3 topics from each `## Tier` / `## Group` section
- Pulls metadata (tier, phase, idCode, one-line pitch) from the master tables
- Resolves "Connects to" / "Resonates with" strings to topic IDs using token-aligned prefix/suffix matching plus a small alias table (HCI, ML, DSP, GEB, SICP, …)
- Computes in/out degree per topic

Roughly 30% of raw connection strings remain unresolved — they reference broad fields ("biology", "economics", "AI agents") that have no dedicated topic in this dataset. Those still appear in the side panel as faded chips.

## Architecture

```
research-topics-explorer/
├── research-topics-v5.md     # source (untouched)
├── research-topics-v6.md     # source (untouched)
├── research-topics-v7.md     # source (untouched)
├── parse.mjs                 # one-shot Node parser → data.js
├── data.js                   # generated, ~250KB, sets window.RESEARCH_DATA
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
