#!/usr/bin/env node
// parse.mjs
// One-shot parser: turns the three research-topics MD files into ./data.js
// for the static visualization app to load via <script src="data.js">.
//
// Run:   node parse.mjs
// Reads: research-topics-v5.md, research-topics-v6.md, research-topics-v7.md
// Writes: data.js

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  { version: "v5", path: "research-topics-v5.md" },
  { version: "v6", path: "research-topics-v6.md" },
  { version: "v7", path: "research-topics-v7.md" },
];

// --- helpers --------------------------------------------------------------

// Stable slug for topic IDs (used in URL hashes and graph node keys).
function slugify(s) {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Normalize a name for fuzzy connection-resolution. Strips parentheticals,
// punctuation, lowercases, removes "(v5)" / "(Group A)" annotations.
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\(v[567]\)/g, "")
    .replace(/\(group [a-e]\)/g, "")
    .replace(/&/g, "and")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip an outer pair of italic markers from a key-figures line.
function stripItalics(line) {
  return line.replace(/^\*+|\*+$/g, "").trim();
}

// Split a comma- or ' / '-separated list while preserving multi-word names.
function splitList(s) {
  return s
    .split(/[,;]|\s\/\s/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// --- frontmatter / section walker -----------------------------------------

function stripFrontmatter(md) {
  if (!md.startsWith("---")) return { date: null, body: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { date: null, body: md };
  const fm = md.slice(3, end);
  const dateMatch = fm.match(/^date:\s*(.+)$/m);
  return {
    date: dateMatch ? dateMatch[1].trim() : null,
    body: md.slice(end + 4).trimStart(),
  };
}

// Returns a flat list of { heading, level, body } sections split on ## / ###.
function splitSections(md, level) {
  const re = new RegExp(`^${"#".repeat(level)} (.+)$`, "gm");
  const out = [];
  const matches = [...md.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    out.push({
      heading: matches[i][1].trim(),
      level,
      body: md.slice(start, end).trim(),
    });
  }
  return out;
}

// --- per-topic parser ------------------------------------------------------

// Parses a single ### topic body into { keyFigures, description, connections }.
function parseTopicBody(body) {
  const lines = body.split("\n");
  let keyFigures = [];
  let descriptionLines = [];
  let connections = [];

  let i = 0;
  // First non-blank line is usually italicized key-figures.
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^\*[^*]+\*\s*$/.test(lines[i].trim())) {
    keyFigures = splitList(stripItalics(lines[i].trim()));
    i++;
  }

  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // v5/v6 connection line
    let m = trimmed.match(/^\*\*Connects to:\*\*\s*(.+)$/i);
    if (m) {
      connections = splitList(m[1]);
      continue;
    }
    // v7 resonance line
    m = trimmed.match(/^\*Resonates with:\*\s*(.+)$/i);
    if (m) {
      connections = splitList(m[1]);
      continue;
    }
    descriptionLines.push(line);
  }

  return {
    keyFigures,
    description: descriptionLines.join("\n").trim(),
    connections,
  };
}

// --- master-table parsers --------------------------------------------------

// v5 master table rows: | # | Topic | Tier | Phase | Key Figures | Connections |
function parseV5MasterTable(body) {
  const out = new Map(); // normalized topic name -> { tier, phase }
  const rows = body.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    // cells: ["", "#", "Topic", "Tier", "Phase", ...]
    if (cells.length < 5) continue;
    const num = cells[1];
    if (!/^\d+$/.test(num)) continue; // skip header / separator rows
    const topic = cells[2];
    const tier = cells[3];
    const phase = cells[4];
    if (!topic) continue;
    out.set(normalize(topic), {
      tier,
      phase: /^\d+$/.test(phase) ? Number(phase) : phase,
    });
  }
  return out;
}

// v6 master table rows: | # | Topic | Tier (v6) | Likely v5 Phase | Key Figures | Connections |
function parseV6MasterTable(body) {
  const out = new Map();
  const rows = body.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = cells[1]; // A1, B12, etc.
    if (!/^[ABC]\d+$/.test(id)) continue;
    const topic = cells[2];
    const tier = cells[3];
    const likelyPhase = cells[4];
    out.set(normalize(topic), { tier, likelyPhase, idCode: id });
  }
  return out;
}

// v7 master table rows: | # | Group | Topic | Primary Source | One-Line Pitch |
function parseV7MasterTable(body) {
  const out = new Map();
  const rows = body.split("\n").filter((l) => l.trim().startsWith("|"));
  for (const row of rows) {
    const cells = row.split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const id = cells[1];
    if (!/^[ABCDE]\d+$/.test(id)) continue;
    const group = cells[2];
    const topic = cells[3];
    const pitch = cells[5] || "";
    out.set(normalize(topic), { group, pitch, idCode: id });
  }
  return out;
}

// --- per-file parsers ------------------------------------------------------

// Returns an array of topic objects extracted from a v5/v6/v7 file.
function parseFile({ version, md, date }) {
  const topics = [];
  const sections = splitSections(md, 2); // ## headings

  // Pull master tables first to enrich topics with tier/phase later.
  let masterMeta = new Map();
  if (version === "v5") {
    const masterSec = sections.find((s) => /^Master Table/i.test(s.heading));
    if (masterSec) masterMeta = parseV5MasterTable(masterSec.body);
  } else if (version === "v6") {
    const masterSec = sections.find((s) => /^Master Table/i.test(s.heading));
    if (masterSec) masterMeta = parseV6MasterTable(masterSec.body);
  } else if (version === "v7") {
    const masterSec = sections.find((s) => /^Master Table/i.test(s.heading));
    if (masterSec) masterMeta = parseV7MasterTable(masterSec.body);
  }

  // Topic-bearing sections by version.
  const topicSectionRe = {
    v5: /^Tier (1|2|3|4):/i,
    v6: /^Tier ([ABC])\b/i,
    v7: /^Group ([A-E])\b/i,
  }[version];

  for (const section of sections) {
    const m = section.heading.match(topicSectionRe);
    if (!m) continue;

    // Derive a clean group code (T1/T2/T3/T4 for v5, A/B/C for v6, A/B/C/D/E for v7).
    let groupCode;
    if (version === "v5") groupCode = `T${m[1]}`;
    else groupCode = m[1].toUpperCase();

    const groupLabel = section.heading;

    const subs = splitSections(section.body, 3);
    for (const sub of subs) {
      const name = sub.heading.trim();
      const parsed = parseTopicBody(sub.body);
      const id = `${version}-${slugify(name)}`;
      const normName = normalize(name);
      let meta = masterMeta.get(normName);
      // Master tables sometimes abbreviate ("PC Revolution" vs full name) —
      // fall back to first-three-token prefix match if direct lookup misses.
      if (!meta) {
        const prefix = normName.split(" ").slice(0, 3).join(" ");
        for (const [k, v] of masterMeta) {
          if (k.startsWith(prefix)) {
            meta = v;
            break;
          }
        }
      }
      meta = meta || {};

      topics.push({
        id,
        name,
        version,
        sourceDate: date,
        group: groupCode,
        groupLabel,
        keyFigures: parsed.keyFigures,
        description: parsed.description,
        connectionsRaw: parsed.connections,
        // v5-specific
        tier: meta.tier || groupCode,
        phase: meta.phase ?? null,
        // v6-specific
        likelyPhase: meta.likelyPhase ?? null,
        // v7-specific
        pitch: meta.pitch || "",
        idCode: meta.idCode || null,
      });
    }
  }
  return topics;
}

// --- connection resolution -------------------------------------------------

// Build canonical name -> topic id map for fuzzy connection-string lookup.
function buildIndex(topics) {
  const byNorm = new Map();
  for (const t of topics) {
    byNorm.set(normalize(t.name), t.id);
  }
  // Also register a few common abbreviations / shortened forms used in the prose.
  const aliases = [
    ["dsp", "digital signal processing"],
    ["ml", "machine learning and statistical learning theory"],
    ["ai", "machine learning and statistical learning theory"], // generic "AI" usually means ML in v5 prose
    ["hci", "human computer interaction and interface design"],
    ["alife", "artificial life and self organization"],
    ["evo devo", "evolutionary developmental biology evo devo"],
    ["cogsci", "cognitive science and perception"],
    ["nlp", "linguistics and natural language structure"],
    ["ir", "knowledge graphs and semantic web"],
    ["pc revolution", "history of computing and the personal computer revolution"],
    ["plt", "compiler design and programming language theory"],
    ["geb", "godel escher bach"],
    ["ddia", "designing data intensive applications"],
    ["sicp", "structure and interpretation of computer programs"],
    ["hott", "type theory and homotopy type theory"],
    ["abm", "complexity economics and abm in economics"],
  ];
  // Don't add aliases that would shadow a real topic name.
  for (const [alias, full] of aliases) {
    const id = byNorm.get(normalize(full));
    if (id && !byNorm.has(normalize(alias))) {
      byNorm.set(normalize(alias), id);
    }
  }
  return byNorm;
}

// Resolve one raw connection string to a topic id (or null if unresolvable).
// Uses token-boundary matching to avoid silly substring hits (e.g. "Architecture"
// must not silently resolve to "Information Architecture").
function resolveConnection(raw, index) {
  const norm = normalize(raw);
  if (!norm) return null;
  if (index.has(norm)) return index.get(norm);

  const tokens = norm.split(" ");
  const candidates = [];
  for (const [cand, id] of index) {
    if (cand === norm) return id;
    // Token-aligned prefix: candidate name *begins with* the raw phrase.
    // Always allowed — "Geometry" → "Geometry, Topology & Spatial Computation".
    if (cand.startsWith(norm + " ")) {
      candidates.push([cand, id]);
      continue;
    }
    // Token-aligned suffix: only when the raw phrase is itself multi-word,
    // to avoid generic one-word matches like "Architecture" landing on
    // "Information Architecture" by accident.
    if (tokens.length >= 2 && cand.endsWith(" " + norm)) {
      candidates.push([cand, id]);
      continue;
    }
    // Reverse: the raw is *more specific* than the canonical name and starts
    // with it — e.g. "Cybernetics & Control Theory (older)" → "cybernetics ...".
    if (norm.startsWith(cand + " ")) {
      candidates.push([cand, id]);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b[0].length - a[0].length);
  return candidates[0][1];
}

// --- disciplines parser ----------------------------------------------------

// Parses disciplines.md into:
//   [{ phase, name, subtitle, topics: [{ raw, targetId }] }, ...]
// Shape of source file:
//   ## Phase N: Name
//   Optional subtitle paragraph.
//   ### Topics
//   - Topic Name
//   - Another Topic
//
// Topic names are resolved against the *same* fuzzy index used for
// "Connects to:" resolution, so v5/v6/v7 topic names are all matchable
// using their canonical form from the source markdowns.
function parseDisciplines(md, index) {
  const { body } = stripFrontmatter(md);
  const sections = splitSections(body, 2); // ## Phase N: ...
  const disciplines = [];

  for (const section of sections) {
    const m = section.heading.match(/^Phase\s+(\d+)\s*:\s*(.+)$/i);
    if (!m) continue; // skip non-phase level-2 headings (e.g. the doc title)
    const phase = Number(m[1]);
    const name = m[2].trim();

    // Subtitle = first non-empty paragraph between the ## heading and the
    // first ### sub-heading (if any). Multi-line paragraphs are preserved.
    const beforeTopics = section.body.split(/^###\s/m)[0].trim();
    const subtitle = beforeTopics.split(/\n\n+/)[0].trim();

    // Collect bullet items under the "### Topics" sub-section.
    // Only keep lines that begin with a "- " or "* " bullet marker — this
    // naturally excludes horizontal-rule separators (`---`) and blank lines
    // that live between phase sections. A final letter-character check
    // guards against any remaining punctuation-only lines.
    const topicsSec = splitSections(section.body, 3).find((s) =>
      /^Topics/i.test(s.heading)
    );
    const topicNames = (topicsSec?.body || "")
      .split("\n")
      .filter((l) => /^\s*[-*]\s+\S/.test(l)) // must be a bullet with content
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .filter((l) => l && /[A-Za-z]/.test(l));

    const resolved = topicNames.map((n) => ({
      raw: n,
      targetId: resolveConnection(n, index),
    }));

    disciplines.push({ phase, name, subtitle, topics: resolved });
  }
  return disciplines;
}

// --- main ------------------------------------------------------------------

async function main() {
  const allTopics = [];

  for (const f of FILES) {
    const md = await readFile(join(__dirname, f.path), "utf8");
    const { date, body } = stripFrontmatter(md);
    const topics = parseFile({ version: f.version, md: body, date });
    allTopics.push(...topics);
  }

  // Build resolution index AFTER all topics are collected so cross-version
  // connections (v5 ↔ v6, v7 → v5, etc.) can resolve.
  const index = buildIndex(allTopics);

  // Resolve every connection. Compute in/out degree.
  const edges = []; // { source: id, target: id, raw: string }
  const inDegree = new Map();
  const outDegree = new Map();
  let unresolved = 0;

  for (const topic of allTopics) {
    topic.connections = [];
    for (const raw of topic.connectionsRaw) {
      const targetId = resolveConnection(raw, index);
      if (!targetId || targetId === topic.id) {
        if (!targetId) unresolved++;
        topic.connections.push({ raw, targetId: null });
        continue;
      }
      topic.connections.push({ raw, targetId });
      edges.push({ source: topic.id, target: targetId, raw });
      outDegree.set(topic.id, (outDegree.get(topic.id) || 0) + 1);
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    }
  }

  for (const t of allTopics) {
    t.inDegree = inDegree.get(t.id) || 0;
    t.outDegree = outDegree.get(t.id) || 0;
    delete t.connectionsRaw; // keep payload tight
  }

  // Parse the thematic disciplines overlay, if present. This is optional —
  // the Disciplines view renders a graceful empty state when the file is
  // absent. Every discipline topic name is resolved through the shared
  // `resolveConnection` index so it matches canonical topic ids.
  let disciplines = [];
  let unresolvedDisciplines = [];
  try {
    const dMd = await readFile(join(__dirname, "disciplines.md"), "utf8");
    disciplines = parseDisciplines(dMd, index);
    for (const d of disciplines) {
      for (const t of d.topics) {
        if (!t.targetId) unresolvedDisciplines.push(`P${d.phase}/${d.name}: ${t.raw}`);
      }
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // disciplines.md simply doesn't exist — that's fine.
  }

  // Stats for the README and sanity check.
  const stats = {
    topicsTotal: allTopics.length,
    byVersion: {
      v5: allTopics.filter((t) => t.version === "v5").length,
      v6: allTopics.filter((t) => t.version === "v6").length,
      v7: allTopics.filter((t) => t.version === "v7").length,
    },
    edges: edges.length,
    unresolvedConnections: unresolved,
    disciplines: disciplines.length,
    unresolvedDisciplines: unresolvedDisciplines.length,
    generatedAt: new Date().toISOString(),
  };

  // Identify likely "people" topics from v7 Group A (used by Creators view).
  const creators = allTopics.filter((t) => t.version === "v7" && t.group === "A").map((t) => t.id);

  const payload = {
    stats,
    topics: allTopics,
    edges,
    creators,
    disciplines,
  };

  // Emit data.js
  const out =
    "// AUTO-GENERATED by parse.mjs — do not edit by hand.\n" +
    "// Regenerate with: node parse.mjs\n" +
    `window.RESEARCH_DATA = ${JSON.stringify(payload, null, 2)};\n`;

  await writeFile(join(__dirname, "data.js"), out, "utf8");

  // Console report
  console.log("✓ data.js written");
  console.log(`  topics: ${stats.topicsTotal} (v5=${stats.byVersion.v5}, v6=${stats.byVersion.v6}, v7=${stats.byVersion.v7})`);
  console.log(`  edges:  ${stats.edges}`);
  console.log(`  unresolved connections: ${stats.unresolvedConnections}`);
  console.log(`  creators (v7 Group A): ${creators.length}`);
  console.log(`  disciplines: ${stats.disciplines} (unresolved discipline topics: ${stats.unresolvedDisciplines})`);
  // Surface unresolved discipline entries so curators can fix typos quickly.
  if (unresolvedDisciplines.length) {
    console.log("  — unresolved discipline topic names:");
    for (const line of unresolvedDisciplines) console.log("      • " + line);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
