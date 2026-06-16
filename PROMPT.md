# Prompt log

## 2026-04-17

> Create interesting visualizations and data exploration tools for exploring the research topics from the MD files. Make sure we don't need to run a server for this.

## 2026-04-18

> In creators, the black text on black background is not visible. (with screenshot of the Creators tab showing invisible node labels)

## 2026-04-23

> Add a new page with disciplines categorizing the topics similar to the screenshot (screenshot for example only). The screenshot showed a 3-column layout with "PHASE 1 — The Meta-Frameworks", "PHASE 2 — Structure & Connection", "PHASE 3 — Mind & Perception" each containing numbered research topics and a "SUGGESTED V6 ADDITIONS" section.

## 2026-04-26

> Prepare this repo to be deployed as a GitHub site.

## 2026-04-27

> Allow me to mark the disciplines that I've worked on, on the cards page. The cards which are marked should have a pastel colored background(suggest a color). This card background color should reflect on the cards page, roadmap and disciplines page.

## 2026-06-09

> Create a csv based schema which will be a superset of the three MD files. Then plan to migrate the data to this csv file. This file will be used as the database for the research topics exploration. Do not change anything else in the repo.

## 2026-06-10

> The parse tool is not able to handle new additions to the csv file. For example, the v8 entries added(also foolproof it for the future). Also the horizontal scrolling in the roadmap section through the bottom scroll bar is not ideal. Suggest a solution.
> *(Follow-up during planning: roadmap scrolling concern withdrawn — shift+wheel suffices. v8 should appear on the Roadmap as an overlay like v6.)*

## 2026-06-11

> Can you think of better UI ideas to explore the topics? Don't change anything yet. Just show me visually.
> *(Ideation only — visual mockups shown in chat, no app changes made.)*

## 2026-06-12

> Based on the research-topics.csv file, think of new topics that don't necessarily have to fit in the current framework.
> *(Ideation only — proposed new topics in chat across three registers: discipline-shaped gaps, new node-types, and implied people/books. No CSV or app changes made.)*

> Update the csv with the following topics (also make sure to work on the latest csv as I have removed some old topics) — [31 topics: Scaling Laws & Allometry, Chemistry/Reaction Networks, Cryptography & Coding Theory, Sociology & Social Network Analysis, Actor-Network Theory & STS, Ritual as Coordination Technology, Energy Systems/Infrastructure, Recursion & Self-Reference, Peirce, Leibniz, Poincaré, Mandelbrot, J.J. Gibson, Saussure, Baudrillard, McLuhan, Foucault, Deleuze, Lévi-Strauss, Maturana & Varela, Stafford Beer, Tufte, Margulis, Pāṇini & Generative Grammar, I Ching as combinatorial system, Ubuntu, Joseph Needham, Navya-Nyāya, The Glass Bead Game (book), Metaphors We Live By (book), A Thousand Plateaus (book)].
> *(Added all 31 as a new **v9** batch in 5 groups; generalized the Creators view to be label-based so v9 people are first-class creators; rich v9↔v9 cross-linking. Regenerated data.js → 203 topics. Asked two clarifying questions first; both answered "recommended" option.)*

## 2026-06-13

> I have attached some new design wireframes that I came up with in claude design. Rename the current index.html file to index.v0.html and then implement the new designs in a new index file. Do not copy the colors, themes and designs from the wireframes as is, just use them as a reference. Also fill in any missing information if you think it's essential. The worked on toggle feature should remain. First show me the design that you plan to implement and then start working once I give the approval. (4 wireframes attached: Constellation graph, Reader, Thinkers, Catalog.)
> *(Clarified scope across the plan: theme = "light editorial vault"; build only the **four views with screenshots** — Knowledge Graph, Catalog, Thinkers, Reader — **plus Hubs** carried over from the current app (5 total); Phase Path + Priority Board dropped (never designed); keep the **binary** worked-on toggle (not the 3-state shown in the wireframe); restore the **version filter**. Built a fresh `index.html` (old → `index.v0.html`), no data-pipeline edits — discipline colour / priority lane / thinker index all derived at boot. Verified all 5 views in-browser; parser tests 20/20.)*

## 2026-06-14

> The titles in the sidebar are getting cut, allow adjusting the sidebar width by dragging. The knowledge graph is looking too crowded, think of a solution. (2 screenshots attached: Catalog with truncated discipline labels, Knowledge Graph with overlapping labels.)
> *(Chose, via clarifying questions: graph fix = **adaptive labels by zoom** (top hubs at base zoom, more on zoom-in, hover/select reveals any) on a looser force layout; resizer applied to **both** Catalog and Reader left rails. Added a draggable 6px grid-track divider + shared `makeRailResizer` helper persisting width to `rte:catRailW` / `rte:readerRailW`; rank-based `labelMinK` (16 hubs always shown) + zoom-driven reveal with `11/k` counter-scaled font. Verified in-browser: no clipped labels at widened rail, width persists across reload + Reader phase nav, graph shows 16 labels at base zoom → 203 at max zoom, click-highlight + version-filter rebuild clean, no console errors.)*

## 2026-06-16

> When trying to select a single filter, it becomes tedious as one has to unselect all the filters manually, one by one. Add an unselect all button below the reset filters button so that all the filters can be unchecked at once. (Screenshot of the Catalog rail attached; during planning the user asked to place the button **above** Reset filters instead.)
> *(Added an **Unselect all** button above **Reset filters** in the Catalog rail. To make it actually useful, unified all four filter groups onto **faceted** semantics in `isTopicVisible` — each `STATE` Set holds the checked boxes and an empty group = "no constraint" (shows all). Verification caught that a first naive pass (strict literal AND, empty = nothing) made the feature useless — checking one discipline showed 0 because the other now-empty groups matched nothing; corrected to the `size > 0` guarded faceted model. Reset = full Sets (all checked); Unselect all = empty Sets (all unchecked, full catalog stays visible, search text left intact). Verified in-browser: default 203/all-checked → Unselect all clears every box yet still shows 203 → check only "Design & Making" → 32, only that discipline → Reset re-checks all + clears search; graph version-chip toggle still filters (406→294 circles on v5 off); no console errors.)*
