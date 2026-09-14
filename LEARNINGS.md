# Learnings

Non-obvious things about this codebase, learned the hard way. Read before
editing the data pipeline.

## `research-topics.csv` has mixed line endings

The **header row is CRLF-terminated** (`…,source_date\r\n`) while the great
majority of records end with a bare `\n`, and the file's final record ends
with `\n`.

Consequences when appending or rewriting rows with a script:

- Splitting the header on `,` without stripping the trailing `\r` yields a
  last column literally named `"source_date\r"`. A row object keyed by the
  *clean* name then silently fails to match, and — if you emit fields by
  iterating the header — you write a **short or misaligned row**. Always
  `.replace(/\r$/, "")` the header line before splitting it.
- `parse.mjs` itself is immune: its character loop drops `\r` outright
  (`else if (c !== "\r") field += c;`), so a misaligned row will parse
  *cleanly* and produce a wrong `data.js` with **zero warnings**. The parser
  will not catch this for you.
- Append new records with `\n`, not `\r\n`, so the diff stays a clean
  one-line addition and the file doesn't get more mixed than it already is.

A cheap guard that catches the whole class of problem: build the row as an
object, then assert the header's column set and the object's key set match
**exactly** (no missing, no extra) before serializing in header order.

## Editing the CSV is always a two-file change

`data.js` is a committed generated artifact because GitHub Pages has no Node
runtime. Any CSV edit must be followed by `node parse.mjs`, and **both** files
committed. Editing the CSV alone changes nothing in the browser; editing
`data.js` by hand is overwritten on the next parse.

## `connects_to_raw` / `connects_to_ids` are positionally aligned

Slot *N* of one pairs with slot *N* of the other; an empty id slot is a
deliberate "never resolved to a topic" marker and renders as a faded chip.
The parser only warns when `connects_to_ids` has **more** slots than
`connects_to_raw` — a *shorter* ids list is silently treated as trailing
unresolved slots, so a dropped pipe quietly turns real links into faded
chips. Build the two lists from one array of pairs rather than typing two
parallel strings.

## The connection graph is symmetric — keep it that way

As of 2026-09-14 every relationship is stored in **both** rows (the symmetric
closure added 666 back-links across 115 of 204 rows). Nothing derives
reciprocity at runtime, so a new one-way edge silently breaks the invariant.

**Rule: when you add a connection, add the back-link on the target row too.**

Two traps when writing the back-link:

- Append to `connects_to_raw` **and** `connects_to_ids` in the same operation.
  If the target's ids list is shorter than its raw list (trailing unresolved
  slots), **pad the ids with empty slots first** — otherwise the new id lands
  in a slot belonging to an earlier raw label and silently mislabels the edge.
- Don't re-serialize the whole CSV to make a small edit. Locate the exact
  serialized `connects_to_raw,connects_to_ids` pair for the row, assert it
  occurs **exactly once**, and swap it. A full rewrite normalizes quoting and
  line endings across all 200+ rows and buries the real change in the diff.

To check the invariant:

```sh
node -e 'const fs=require("fs"),vm=require("vm");const c={window:{}};vm.createContext(c);
vm.runInContext(fs.readFileSync("data.js","utf8"),c);const D=c.window.RESEARCH_DATA;
const o=new Map(D.topics.map(t=>[t.id,new Set()]));for(const e of D.edges)o.get(e.source).add(e.target);
let n=0;for(const[s,ts]of o)for(const t of ts)if(!o.get(t).has(s))n++;console.log("one-way edges:",n);'
```

## Degree: count distinct neighbours, never in + out

Because the graph is symmetric, `inDegree` and `outDegree` (emitted by
`parse.mjs`) are the **same number**, so the old `inDegree + outDegree` idiom
double-counts every topic. Worse, both count **slots, not distinct targets**,
and 12 rows name one topic through two raw labels ("AI" *and* "machine
learning" both resolve to Machine Learning) — one relationship, two slots.

`index.html` therefore derives `NEIGHBOURS` / `DEGREE` at boot (distinct
neighbours per topic) and every view that ranks or sizes by connectedness reads
it. Don't reach for `t.inDegree` / `t.outDegree` in view code. The Hubs view is
the deliberate exception: it honours the version filter, so it recomputes
neighbours against the visible set.

## Symmetric data means the graph must dedupe its links

`renderGraph` collapses `EDGES` to one line per unordered pair. Skip that and
every relationship is drawn **twice**: the stacked strokes read heavier than a
single edge, and `d3.forceLink` applies its pull once per copy, contracting the
layout that was deliberately loosened (distance 110, strength 0.3) to spread
the hub cluster. 1520 directed edges → **754** drawn lines.

Note the dedup also absorbs the duplicate-raw-label rows, which is why 754 is
lower than `edges.length / 2` (760).

## Each version cohort has its own field dialect

Don't copy a row's shape from an arbitrary neighbour — copy from a row in the
**same version and group**. For example v9 Groups A/B leave `tier`, `phase`,
`phase_rationale`, and `primary_source` empty and place topics via
`likely_phase` (the Roadmap dims these as "probable placement"); `tier` empty
is safe only because the parser falls back to `group_code`. v9 Groups C/D/E
(people, traditions, books) carry `primary_source` and stay off the roadmap
entirely.

## A version tag is a UI facet, not just a label

Adding a row under a brand-new version tag (`v10`) is free code-wise — the
pipeline and app derive the version list from the data — but it *does* add a
new badge colour, stats-bar entry, graph legend chip, and filter checkbox for
however few rows carry it. Prefer extending the latest cohort for one-off
topic additions; reserve a new tag for an actual batch.

## Shared filter state spans every view

`isTopicVisible()` / `visibleTopics()` back all views, so a leftover Catalog
**search string** also empties the Knowledge Graph and Thinkers. When
verifying in-browser, clear the search (and `STATE.selectedId`, which
re-highlights and dims the graph on render) before concluding a view is
broken.
