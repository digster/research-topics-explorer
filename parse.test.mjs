// parse.test.mjs
// Tests for the CSV → data.js pipeline (parse.mjs).
//
// Run: node --test parse.test.mjs
//
// Importing parse.mjs is safe: main() only executes when the file is run
// directly, so these tests never rewrite data.js.
//
// The synthetic-CSV tests deliberately use versions that have never existed
// in the dataset (v9, v10) — the original bug was hardcoded v5/v6/v7
// handling, so the regression to guard against is "an unknown version flows
// through topics, stats, and edges untouched". The integration tests against
// the real CSV avoid hardcoded row counts for the same reason: they assert
// structural invariants that must hold no matter what rows get added next.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseCSV,
  csvToRecords,
  splitPipes,
  versionNum,
  buildPayload,
  REQUIRED_COLUMNS,
} from "./parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- helpers -----------------------------------------------------------------

// Build a CSV string with the full required header and the given rows, each
// row an object of column → value (unset columns default to "").
function makeCSV(rows) {
  const quote = (s) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = [REQUIRED_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(REQUIRED_COLUMNS.map((c) => quote(row[c] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

// Minimal valid topic row; override per test.
function makeRow(overrides) {
  return {
    id: "v9-test-topic",
    version: "v9",
    name: "Test Topic",
    group_code: "A",
    group_label: "Tier A",
    tier: "A",
    discipline_phase: "1",
    discipline_name: "The Meta-Frameworks",
    source_file: "research-topics.csv",
    source_date: "2026-06-10",
    ...overrides,
  };
}

// --- parseCSV ------------------------------------------------------------------

test("parseCSV: plain rows and trailing newline", () => {
  assert.deepEqual(parseCSV("a,b\nc,d\n"), [["a", "b"], ["c", "d"]]);
});

test("parseCSV: no trailing newline keeps last row", () => {
  assert.deepEqual(parseCSV("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("parseCSV: quoted field with comma", () => {
  assert.deepEqual(parseCSV('a,"b, c",d\n'), [["a", "b, c", "d"]]);
});

test("parseCSV: doubled-quote escape", () => {
  assert.deepEqual(parseCSV('"say ""hi""",x\n'), [['say "hi"', "x"]]);
});

test("parseCSV: newline inside quoted field", () => {
  assert.deepEqual(parseCSV('"line1\nline2",x\n'), [["line1\nline2", "x"]]);
});

test("parseCSV: CRLF line endings are normalized", () => {
  assert.deepEqual(parseCSV("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
});

// --- csvToRecords / splitPipes -------------------------------------------------

test("csvToRecords: maps header to keys, missing trailing fields become empty", () => {
  const recs = csvToRecords("id,name,extra\nx,Topic\n");
  assert.deepEqual(recs, [{ id: "x", name: "Topic", extra: "" }]);
});

test("splitPipes: empty cell, trimming, dropped empty slots", () => {
  assert.deepEqual(splitPipes(""), []);
  assert.deepEqual(splitPipes("a| b |c"), ["a", "b", "c"]);
  assert.deepEqual(splitPipes("a||c"), ["a", "c"]);
});

// --- versionNum -----------------------------------------------------------------

test("versionNum: natural ordering, v9 < v10, unknown tags last", () => {
  assert.ok(versionNum("v9") < versionNum("v10"));
  assert.ok(versionNum("v5") < versionNum("v8"));
  assert.equal(versionNum("weird"), Infinity);
});

// --- buildPayload: version-agnostic behavior (the v8 regression) ----------------

test("buildPayload: unknown versions flow into topics and stats", () => {
  const csv = makeCSV([
    makeRow({ id: "v9-alpha", version: "v9", name: "Alpha" }),
    makeRow({ id: "v9-beta", version: "v9", name: "Beta" }),
    makeRow({ id: "v10-gamma", version: "v10", name: "Gamma" }),
  ]);
  const { payload } = buildPayload(csvToRecords(csv));

  assert.equal(payload.stats.topicsTotal, 3);
  assert.deepEqual(payload.stats.byVersion, { v9: 2, v10: 1 });
  // Natural key order: v9 before v10 (lexicographic would flip them).
  assert.deepEqual(Object.keys(payload.stats.byVersion), ["v9", "v10"]);
});

test("buildPayload: byVersion always covers every topic and sums to total", () => {
  const csv = makeCSV([
    makeRow({ id: "v5-a", version: "v5", name: "A" }),
    makeRow({ id: "v8-b", version: "v8", name: "B" }),
    makeRow({ id: "v12-c", version: "v12", name: "C" }),
  ]);
  const { payload } = buildPayload(csvToRecords(csv));
  const sum = Object.values(payload.stats.byVersion).reduce((a, b) => a + b, 0);
  assert.equal(sum, payload.stats.topicsTotal);
  for (const t of payload.topics) {
    assert.ok(t.version in payload.stats.byVersion, `${t.version} missing from byVersion`);
  }
});

test("buildPayload: edges resolve across versions", () => {
  const csv = makeCSV([
    makeRow({ id: "v5-a", version: "v5", name: "A" }),
    makeRow({
      id: "v9-b", version: "v9", name: "B",
      connects_to_raw: "A|Nonexistent",
      connects_to_ids: "v5-a|",
    }),
  ]);
  const { payload } = buildPayload(csvToRecords(csv));
  assert.deepEqual(payload.edges, [{ source: "v9-b", target: "v5-a", raw: "A" }]);
  assert.equal(payload.stats.unresolvedConnections, 1);
  assert.equal(payload.topics.find((t) => t.id === "v5-a").inDegree, 1);
});

test("buildPayload: sourceFile and fuzzy likelyPhase pass through", () => {
  const csv = makeCSV([
    makeRow({ id: "v8-x", version: "v8", name: "X", likely_phase: "3 or 7", phase: "" }),
  ]);
  const { payload } = buildPayload(csvToRecords(csv));
  const t = payload.topics[0];
  assert.equal(t.sourceFile, "research-topics.csv");
  assert.equal(t.likelyPhase, "3 or 7");
  assert.equal(t.phase, null);
});

// --- buildPayload: validation ----------------------------------------------------

test("buildPayload: missing required column throws and names it", () => {
  const header = REQUIRED_COLUMNS.filter((c) => c !== "version").join(",");
  const records = csvToRecords(header + "\n" + "x,".repeat(REQUIRED_COLUMNS.length - 2) + "x\n");
  assert.throws(() => buildPayload(records), /missing required column.*version/);
});

test("buildPayload: duplicate ids warn but do not crash", () => {
  const csv = makeCSV([
    makeRow({ id: "v9-dup", name: "First" }),
    makeRow({ id: "v9-dup", name: "Second" }),
  ]);
  const { payload, warnings } = buildPayload(csvToRecords(csv));
  assert.equal(payload.stats.topicsTotal, 2);
  assert.ok(warnings.some((w) => w.includes('duplicate id "v9-dup"')));
});

test("buildPayload: misaligned connection slots warn, extras ignored", () => {
  const csv = makeCSV([
    makeRow({ id: "v9-a", name: "A" }),
    makeRow({
      id: "v9-m", name: "Misaligned",
      connects_to_raw: "A",
      connects_to_ids: "v9-a|v9-a|v9-a",
    }),
  ]);
  const { payload, warnings } = buildPayload(csvToRecords(csv));
  assert.ok(warnings.some((w) => w.includes("connects_to_ids has 3 slots")));
  // Only the slot paired with a raw entry produces an edge.
  assert.equal(payload.edges.length, 1);
});

test("buildPayload: non-numeric phase warns and becomes null", () => {
  const csv = makeCSV([makeRow({ id: "v9-p", name: "P", phase: "3 or 7" })]);
  const { payload, warnings } = buildPayload(csvToRecords(csv));
  assert.equal(payload.topics[0].phase, null);
  assert.ok(warnings.some((w) => w.includes("non-numeric phase")));
});

test("buildPayload: unknown discipline phase warns but still renders", () => {
  const csv = makeCSV([
    makeRow({ id: "v9-d", name: "D", discipline_phase: "11", discipline_name: "New Frontier" }),
  ]);
  const { payload, warnings } = buildPayload(csvToRecords(csv));
  const d = payload.disciplines.find((x) => x.phase === 11);
  assert.ok(d, "discipline 11 should exist");
  assert.equal(d.subtitle, "");
  assert.ok(warnings.some((w) => w.includes("discipline phase 11")));
});

test("buildPayload: missing id/name/version warns", () => {
  const csv = makeCSV([makeRow({ id: "", name: "Orphan" })]);
  const { warnings } = buildPayload(csvToRecords(csv));
  assert.ok(warnings.some((w) => w.includes("missing id/name/version")));
});

// --- integration against the real CSV --------------------------------------------
// Invariants only — no hardcoded row counts, so adding v9/v10 rows later
// keeps these green (that's the point of the pipeline being version-agnostic).

test("integration: real CSV builds a consistent payload with no warnings", async () => {
  const csv = await readFile(join(__dirname, "research-topics.csv"), "utf8");
  const records = csvToRecords(csv);
  const { payload, warnings } = buildPayload(records);

  assert.deepEqual(warnings, [], "real CSV should produce zero warnings");
  assert.equal(payload.stats.topicsTotal, records.length);

  const sum = Object.values(payload.stats.byVersion).reduce((a, b) => a + b, 0);
  assert.equal(sum, payload.stats.topicsTotal, "byVersion must sum to total");

  const versionsInData = new Set(payload.topics.map((t) => t.version));
  assert.deepEqual(
    new Set(Object.keys(payload.stats.byVersion)), versionsInData,
    "every version in the data must appear in byVersion");

  assert.ok(payload.edges.length > 0);
  for (const t of payload.topics) {
    assert.ok(t.id && t.name && t.version, `topic ${t.id} missing core fields`);
    assert.ok(t.sourceFile, `topic ${t.id} missing sourceFile`);
  }

  const ids = new Set(payload.topics.map((t) => t.id));
  assert.equal(ids.size, payload.topics.length, "ids must be unique");
  for (const e of payload.edges) {
    assert.ok(ids.has(e.source) && ids.has(e.target), "edges must reference known topics");
  }
});
