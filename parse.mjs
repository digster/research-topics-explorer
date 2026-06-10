#!/usr/bin/env node
// parse.mjs
// One-shot parser: turns research-topics.csv into ./data.js for the static
// visualization app to load via <script src="data.js">.
//
// Run:    node parse.mjs
// Test:   node --test parse.test.mjs
// Reads:  research-topics.csv
// Writes: data.js
//
// The CSV is the single source of truth. Connections come pre-resolved in
// the `connects_to_ids` column (pipe-separated, positionally aligned with
// `connects_to_raw`; empty slots mark connections that never resolved to a
// topic). Discipline membership comes from `discipline_phase` /
// `discipline_name` on each row.
//
// The pipeline is version-agnostic: rows may carry any version tag (v5, v8,
// v9, …) and the stats/version list are derived from the data, so adding a
// new version to the CSV requires no changes here or in index.html.
//
// This module is import-safe: `main()` only runs when invoked directly
// (`node parse.mjs`), so tests and tooling can import the exported helpers
// without rewriting data.js.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CSV_PATH = "research-topics.csv";

// Columns buildPayload actually reads. If any is missing the CSV schema has
// drifted — fail loudly instead of emitting a silently-wrong data.js.
export const REQUIRED_COLUMNS = [
  "id",
  "version",
  "name",
  "group_code",
  "group_label",
  "tier",
  "phase",
  "likely_phase",
  "key_figures",
  "description",
  "one_line_pitch",
  "id_code",
  "connects_to_raw",
  "connects_to_ids",
  "discipline_phase",
  "discipline_name",
  "source_file",
  "source_date",
];

// Discipline subtitles are presentation copy for the Disciplines view, not
// topic data, so they live here rather than being repeated on every CSV row.
// A discipline_phase without an entry still renders — just without a subtitle
// (buildPayload emits a warning so the gap is visible at generation time).
const DISCIPLINE_SUBTITLES = {
  1: "First contact. Feedback, entropy, evidence, paradigms — the conceptual grammar every subsequent topic assumes.",
  2: "The mathematics of pattern, change, and abstraction — scaffolding for complexity, networks, dynamics, and structural thinking.",
  3: "From structure to the mind that perceives structure — cognition, experience, and the boundaries of the thinking self.",
  4: "How meaning gets made, encoded, transmitted, and shaped by the systems that carry it.",
  5: "Zoom out to civilizational context — traditions, technology's cultural role, the history of computing itself.",
  6: "From theory to artifact. The disciplines where perception, notation, interface, and aesthetics become things people actually use.",
  7: "How living systems generate form, self-organize, and coordinate — and what design can learn from 3.8 billion years of R&D.",
  8: "Formal reasoning under uncertainty — probability, strategy, causation, learning, optimization, measurement.",
  9: "Technical and perceptual infrastructure of audio, media, and simulated worlds.",
  10: "The most specialized, formally demanding, or implementation-heavy topics — maximally powerful because the foundation is in place.",
};

// --- CSV parsing (RFC 4180) -------------------------------------------------

// Minimal CSV parser: quoted fields, doubled-quote escapes, and newlines
// inside quoted fields (descriptions span multiple lines).
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Rows → array of objects keyed by the header row.
export function csvToRecords(text) {
  const rows = parseCSV(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ""; });
    return rec;
  });
}

// Pipe-separated multi-value cell → array (empty cell → []).
export function splitPipes(s) {
  return s ? s.split("|").map((x) => x.trim()).filter(Boolean) : [];
}

// Natural version ordering: "v9" < "v10" (plain string compare would say
// otherwise). Version tags that don't match v<number> sort last so they at
// least stay visible at the end rather than disappearing.
export function versionNum(v) {
  const n = Number(String(v).replace(/^v/i, ""));
  return Number.isNaN(n) ? Infinity : n;
}

// --- payload ----------------------------------------------------------------

// Pure transform: CSV records → { payload, warnings }. Throws on schema-level
// problems (missing required columns); collects row-level oddities as
// warnings so a single bad row never blocks regeneration.
export function buildPayload(records) {
  const warnings = [];

  // Schema check — every required column must exist in the header.
  const columns = new Set(records.length ? Object.keys(records[0]) : []);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.has(c));
  if (missing.length) {
    throw new Error(
      `research-topics.csv is missing required column(s): ${missing.join(", ")}`
    );
  }

  // Row-level sanity checks. rowNo is the 1-based CSV line counting the
  // header, so it matches what an editor shows (modulo multi-line fields).
  const seenIds = new Set();
  records.forEach((r, i) => {
    const rowNo = i + 2;
    const label = r.id || `row ${rowNo}`;
    if (!r.id || !r.name || !r.version) {
      warnings.push(`row ${rowNo}: missing id/name/version — row kept, but it may misrender`);
    }
    if (r.id) {
      if (seenIds.has(r.id)) warnings.push(`row ${rowNo}: duplicate id "${r.id}"`);
      seenIds.add(r.id);
    }
    if (r.phase !== "" && Number.isNaN(Number(r.phase))) {
      warnings.push(`${label}: non-numeric phase "${r.phase}" — treated as empty (use likely_phase for fuzzy placements)`);
    }
    const rawSlots = r.connects_to_raw ? r.connects_to_raw.split("|").length : 0;
    const idSlots = r.connects_to_ids ? r.connects_to_ids.split("|").length : 0;
    if (idSlots > rawSlots) {
      warnings.push(`${label}: connects_to_ids has ${idSlots} slots but connects_to_raw has ${rawSlots} — extra targets are ignored (columns are positionally aligned)`);
    }
  });

  const topics = records.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    sourceFile: r.source_file || null,
    sourceDate: r.source_date || null,
    group: r.group_code || "",
    groupLabel: r.group_label || "",
    keyFigures: splitPipes(r.key_figures),
    description: r.description || "",
    // v7 people rows have no tier of their own; fall back to the group code
    // so views that interpolate t.tier directly keep rendering "A".."E".
    tier: r.tier || r.group_code || "",
    phase: r.phase === "" || Number.isNaN(Number(r.phase)) ? null : Number(r.phase),
    likelyPhase: r.likely_phase || null,
    pitch: r.one_line_pitch || "",
    idCode: r.id_code || null,
  }));

  const knownIds = new Set(topics.map((t) => t.id));
  const byId = new Map(records.map((r) => [r.id, r]));

  // Resolve every connection. `connects_to_raw` and `connects_to_ids` are
  // positionally aligned: split both on "|" and pair slots. A slot resolves
  // only if it names a known topic other than itself; self-references are
  // dropped silently (not counted unresolved), matching prior behavior.
  const edges = []; // { source: id, target: id, raw: string }
  const inDegree = new Map();
  const outDegree = new Map();
  let unresolved = 0;

  for (const topic of topics) {
    const r = byId.get(topic.id);
    const raws = r.connects_to_raw ? r.connects_to_raw.split("|") : [];
    const targets = r.connects_to_ids ? r.connects_to_ids.split("|") : [];
    topic.connections = raws.map((rawSlot, i) => {
      const raw = rawSlot.trim();
      const targetId = (targets[i] || "").trim();
      if (!targetId || !knownIds.has(targetId)) {
        unresolved++;
        return { raw, targetId: null };
      }
      if (targetId === topic.id) return { raw, targetId: null };
      edges.push({ source: topic.id, target: targetId, raw });
      outDegree.set(topic.id, (outDegree.get(topic.id) || 0) + 1);
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
      return { raw, targetId };
    });
  }

  for (const t of topics) {
    t.inDegree = inDegree.get(t.id) || 0;
    t.outDegree = outDegree.get(t.id) || 0;
  }

  // Disciplines: group rows by discipline_phase in CSV row order. Every CSV
  // row carries its discipline assignment, so membership is always resolved.
  const disciplineMap = new Map(); // phase -> { phase, name, subtitle, topics }
  for (const r of records) {
    if (!r.discipline_phase) continue;
    const phase = Number(r.discipline_phase);
    if (Number.isNaN(phase)) {
      warnings.push(`${r.id}: non-numeric discipline_phase "${r.discipline_phase}" — row excluded from Disciplines view`);
      continue;
    }
    if (!disciplineMap.has(phase)) {
      if (!DISCIPLINE_SUBTITLES[phase]) {
        warnings.push(`discipline phase ${phase} ("${r.discipline_name}") has no entry in DISCIPLINE_SUBTITLES — it renders without a subtitle`);
      }
      disciplineMap.set(phase, {
        phase,
        name: r.discipline_name,
        subtitle: DISCIPLINE_SUBTITLES[phase] || "",
        topics: [],
      });
    }
    disciplineMap.get(phase).topics.push({ raw: r.name, targetId: r.id });
  }
  const disciplines = [...disciplineMap.values()].sort((a, b) => a.phase - b.phase);

  // Stats for the README and sanity check. byVersion is derived from the
  // data (not a hardcoded version list) in natural order, so new versions
  // are counted — and visibly reported — automatically.
  const byVersion = {};
  for (const t of topics) byVersion[t.version] = (byVersion[t.version] || 0) + 1;
  const byVersionSorted = Object.fromEntries(
    Object.keys(byVersion)
      .sort((a, b) => versionNum(a) - versionNum(b) || a.localeCompare(b))
      .map((v) => [v, byVersion[v]])
  );

  const stats = {
    topicsTotal: topics.length,
    byVersion: byVersionSorted,
    edges: edges.length,
    unresolvedConnections: unresolved,
    disciplines: disciplines.length,
    unresolvedDisciplines: 0,
    generatedAt: new Date().toISOString(),
  };

  // Identify likely "people" topics from v7 Group A (used by Creators view).
  // Intentionally version-specific: v7 is the only "creators" dataset.
  const creators = topics.filter((t) => t.version === "v7" && t.group === "A").map((t) => t.id);

  return {
    payload: { stats, topics, edges, creators, disciplines },
    warnings,
  };
}

// --- main ------------------------------------------------------------------

async function main() {
  const csv = await readFile(join(__dirname, CSV_PATH), "utf8");
  const records = csvToRecords(csv);
  const { payload, warnings } = buildPayload(records);

  for (const w of warnings) console.warn(`⚠ ${w}`);

  // Emit data.js
  const out =
    "// AUTO-GENERATED by parse.mjs from research-topics.csv — do not edit by hand.\n" +
    "// Regenerate with: node parse.mjs\n" +
    `window.RESEARCH_DATA = ${JSON.stringify(payload, null, 2)};\n`;

  await writeFile(join(__dirname, "data.js"), out, "utf8");

  // Console report
  const { stats } = payload;
  const perVersion = Object.entries(stats.byVersion)
    .map(([v, n]) => `${v}=${n}`)
    .join(", ");
  console.log("✓ data.js written");
  console.log(`  topics: ${stats.topicsTotal} (${perVersion})`);
  console.log(`  edges: ${stats.edges} resolved, ${stats.unresolvedConnections} unresolved connection slots`);
  console.log(`  disciplines: ${stats.disciplines}`);
  console.log(`  creators: ${payload.creators.length}`);
  if (warnings.length) console.log(`  warnings: ${warnings.length} (see above)`);
}

// Run only when executed directly (`node parse.mjs`). Importing this module
// (tests, future tooling) must never rewrite data.js as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
