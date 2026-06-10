#!/usr/bin/env node
// parse.mjs
// One-shot parser: turns research-topics.csv into ./data.js for the static
// visualization app to load via <script src="data.js">.
//
// Run:    node parse.mjs
// Reads:  research-topics.csv
// Writes: data.js
//
// The CSV is the single source of truth. Connections come pre-resolved in
// the `connects_to_ids` column (pipe-separated, positionally aligned with
// `connects_to_raw`; empty slots mark connections that never resolved to a
// topic). Discipline membership comes from `discipline_phase` /
// `discipline_name` on each row.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CSV_PATH = "research-topics.csv";

// Discipline subtitles are presentation copy for the Disciplines view, not
// topic data, so they live here rather than being repeated on every CSV row.
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
function parseCSV(text) {
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
function csvToRecords(text) {
  const rows = parseCSV(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const rec = {};
    header.forEach((h, i) => { rec[h] = r[i] ?? ""; });
    return rec;
  });
}

// Pipe-separated multi-value cell → array (empty cell → []).
function splitPipes(s) {
  return s ? s.split("|").map((x) => x.trim()).filter(Boolean) : [];
}

// --- main ------------------------------------------------------------------

async function main() {
  const csv = await readFile(join(__dirname, CSV_PATH), "utf8");
  const records = csvToRecords(csv);

  const topics = records.map((r) => ({
    id: r.id,
    name: r.name,
    version: r.version,
    sourceDate: r.source_date || null,
    group: r.group_code || "",
    groupLabel: r.group_label || "",
    keyFigures: splitPipes(r.key_figures),
    description: r.description || "",
    // v7 people rows have no tier of their own; fall back to the group code
    // so views that interpolate t.tier directly keep rendering "A".."E".
    tier: r.tier || r.group_code || "",
    phase: r.phase === "" ? null : Number(r.phase),
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
    if (!disciplineMap.has(phase)) {
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

  // Stats for the README and sanity check.
  const stats = {
    topicsTotal: topics.length,
    byVersion: {
      v5: topics.filter((t) => t.version === "v5").length,
      v6: topics.filter((t) => t.version === "v6").length,
      v7: topics.filter((t) => t.version === "v7").length,
    },
    edges: edges.length,
    unresolvedConnections: unresolved,
    disciplines: disciplines.length,
    unresolvedDisciplines: 0,
    generatedAt: new Date().toISOString(),
  };

  // Identify likely "people" topics from v7 Group A (used by Creators view).
  const creators = topics.filter((t) => t.version === "v7" && t.group === "A").map((t) => t.id);

  const payload = {
    stats,
    topics,
    edges,
    creators,
    disciplines,
  };

  // Emit data.js
  const out =
    "// AUTO-GENERATED by parse.mjs from research-topics.csv — do not edit by hand.\n" +
    "// Regenerate with: node parse.mjs\n" +
    `window.RESEARCH_DATA = ${JSON.stringify(payload, null, 2)};\n`;

  await writeFile(join(__dirname, "data.js"), out, "utf8");

  // Console report
  console.log("✓ data.js written");
  console.log(`  topics: ${stats.topicsTotal} (v5=${stats.byVersion.v5}, v6=${stats.byVersion.v6}, v7=${stats.byVersion.v7})`);
  console.log(`  edges: ${stats.edges} resolved, ${stats.unresolvedConnections} unresolved connection slots`);
  console.log(`  disciplines: ${stats.disciplines}`);
  console.log(`  creators: ${creators.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
