/* The data block, the lookups that give it words and colours, and the layout: where every wrapper, call site, cell and test sits. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */
const SCENE = JSON.parse(document.getElementById('failwalk-data').textContent);
const MODES = SCENE.modes;
const SITES = SCENE.sites;
const TESTS = SCENE.tests;
const WRAPPERS = SCENE.wrappers;
const SITE = Object.fromEntries(SITES.map((s) => [s.id, s]));
const TEST = Object.fromEntries(TESTS.map((t) => [t.label, t]));
const WRAPPER = Object.fromEntries(WRAPPERS.map((w) => [w.name, w]));
const PROJECT = SCENE.root.split(/[\\/]/).filter(Boolean).pop() || SCENE.root;

/** The colour of each cell state, as the legend and the scene draw it. */
const STATE_COLORS = { coped: '#34d399', uncaught: '#fb7185', risk: '#fbbf24', unreached: '#475569' };
/** What each colour means, in one sentence. */
const STATE_TEXT = {
  coped: 'A test reached the call with this failure injected and the code coped: the tests passed, or a test asserted on the failure path.',
  uncaught: 'The failure was injected and nothing caught it: an unhandled error, a dead runner, or a test that waited until its own timeout.',
  risk: 'The tests passed, but a static check found a pattern that passing hides, such as a retry without an idempotency key.',
  unreached: 'No test reaches this call site, or no run has filled the cell yet. Nobody has walked this failure path.',
};
const STATE_NAMES = { coped: 'Coped', uncaught: 'Uncaught', risk: 'Risk', unreached: 'Nobody walked it' };
/** The worst state first, for sorting and for the walkthrough's order. */
const STATE_ORDER = ['uncaught', 'risk', 'unreached', 'coped'];
/** Each failure mode in plain words: what the injected call does instead of reaching the vendor. */
const MODE_TEXT = {
  timeout: 'the call never answers',
  dropped: 'the connection drops',
  500: 'the vendor answers with a 500 error',
  429: 'the vendor answers with a 429, too many requests',
  malformed: 'the vendor answers with an empty object',
  partial: 'the vendor answers with half the result',
};
const modeText = (mode) => MODE_TEXT[mode] || `the failure "${mode}" is injected`;
/** Each verdict in plain words. */
const VERDICT_TEXT = {
  PASS: 'the tests passed, so the code coped, or the tests never looked',
  FAIL: 'a test assertion failed: the code noticed and a test caught it',
  CRASH: 'nothing caught it: an unhandled error, or the runner died',
  HANG: 'the test hit its own timeout: the code waited forever',
  RISK: 'the tests passed, but a static check found a pattern that passing hides',
  UNREACHED: 'no test reaches this call site',
};
const verdictText = (verdict) => (verdict ? VERDICT_TEXT[verdict] || `the run said ${verdict}` : 'no verdict yet');
/** One colour per wrapper, in order; green is kept for coped cells. */
const WRAPPER_PALETTE = ['#5aa0ff', '#a78bfa', '#f472b6', '#7dd3fc', '#fb923c', '#2dd4bf', '#e879f9', '#facc15'];
const wrapperColor = (name) => WRAPPER_PALETTE[WRAPPERS.findIndex((w) => w.name === name) % WRAPPER_PALETTE.length];
const TEST_COLOR = '#94a3b8';
/** People who asked their system for less motion get the same picture without the pulsing, the particle and the camera glide. */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrapperOf = (name) => WRAPPER[name];
const completeCount = () => WRAPPERS.filter((w) => w.complete).length;

/*
 * What this browser saw last time for this project, so a later run can show which gaps closed.
 * Kept per root in localStorage; a storage that is blocked just means no "since last time".
 */
const MEMORY_KEY = `failwalk-ui:${SCENE.root}`;
const readSaved = () => { try { return JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null'); } catch { return null; } };
const writeSaved = (value) => { try { localStorage.setItem(MEMORY_KEY, JSON.stringify(value)); } catch { /* storage blocked: nothing to keep it in */ } };
const CURRENT_STATES = Object.fromEntries(SITES.flatMap((s) => s.cells.map((c) => [`${s.id}|${c.mode}`, c.state])));
const SAVED = readSaved();
/** A newer run than the one saved: compare the two. The same run again: show what was found the first time. */
const compareRuns = () => {
  if (SCENE.status !== 'run') return { fixed: [], newGaps: 0, previousAt: null };
  if (SAVED && SAVED.generatedAt === SCENE.generatedAt) return { fixed: SAVED.fixed || [], newGaps: SAVED.newGaps || 0, previousAt: SAVED.previousAt || null };
  const fixed = SAVED ? Object.entries(CURRENT_STATES).filter(([key, state]) => state === 'coped' && SAVED.states[key] && SAVED.states[key] !== 'coped').map(([key]) => ({ key, was: SAVED.states[key] })) : [];
  const newGaps = SAVED ? Object.entries(CURRENT_STATES).filter(([key, state]) => state !== 'coped' && SAVED.states[key] === 'coped').length : 0;
  const result = { fixed, newGaps, previousAt: SAVED ? SAVED.generatedAt : null };
  writeSaved({ generatedAt: SCENE.generatedAt, states: CURRENT_STATES, ...result });
  return result;
};
const SINCE = compareRuns();

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const worstState = (states) => STATE_ORDER.find((s) => states.includes(s)) || 'coped';
const siteWorst = (site) => worstState(site.cells.map((c) => c.state));
const wrapperSites = (name) => WRAPPER[name].sites.map((id) => SITE[id]);
const wrapperFiles = (name) => [...new Set(wrapperSites(name).map((s) => s.file))];
const stateCounts = (cells) => cells.reduce((acc, c) => ({ ...acc, [c.state]: (acc[c.state] || 0) + 1 }), {});
const countsText = (cells) => STATE_ORDER.filter((s) => stateCounts(cells)[s]).map((s) => `${stateCounts(cells)[s]} ${STATE_NAMES[s].toLowerCase()}`).join(', ');
const shortSite = (site) => `${site.wrapper}.${site.method} at ${site.file}:${site.line}`;
/** A link that opens the file at its line in VS Code. The root is absolute, so the link works on the machine the run was made on. */
const editorUrl = (site) => `vscode://file/${SCENE.root.replace(/\\/g, '/')}/${site.file}:${site.line}`;

/* ------------------------------------------------------------------ */
/* Layout: every wrapper is a block of rows; tests float behind.       */
/* ------------------------------------------------------------------ */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
/* Row and column spacing in scene units. A site's label sits to the left of its node, so each block leaves room for the labels of the next. */
const ROW_H = 3.1, FILE_GAP = 2.6, CELL_STEP = 2.0, CELL_X0 = 4.2, BLOCK_GAP = 24, TEST_Z = -22, TEST_STEP = 6;
const POS = {};
const HEADS = [];
let cursorX = 0, minY = 0;
WRAPPERS.forEach((w) => {
  const width = CELL_X0 + MODES.length * CELL_STEP;
  let y = 0;
  const sites = wrapperSites(w.name);
  wrapperFiles(w.name).forEach((file) => {
    y -= FILE_GAP;
    HEADS.push({ cls: 'file', text: file, pos: V(cursorX - 0.2, y + 0.2, 0) });
    sites.filter((s) => s.file === file).forEach((s) => {
      y -= ROW_H;
      POS['s:' + s.id] = V(cursorX, y, 0);
      MODES.forEach((m, k) => { POS[`c:${s.id}|${m}`] = V(cursorX + CELL_X0 + k * CELL_STEP, y, 0); });
    });
  });
  MODES.forEach((m, k) => HEADS.push({ cls: 'mode', text: m, pos: V(cursorX + CELL_X0 + k * CELL_STEP, 0.6, 0) }));
  POS['w:' + w.name] = V(cursorX + width / 2 - 1, 12, 0);
  minY = Math.min(minY, y);
  cursorX += width + BLOCK_GAP;
});
const TOTAL_W = Math.max(cursorX - BLOCK_GAP, 20);
const PER_ROW = Math.max(4, Math.floor(TOTAL_W / TEST_STEP));
TESTS.forEach((t, i) => {
  const row = Math.floor(i / PER_ROW), inRow = Math.min(PER_ROW, TESTS.length - row * PER_ROW), col = i % PER_ROW;
  const x = (TOTAL_W - 2) / 2 + (col - (inRow - 1) / 2) * TEST_STEP;
  /* Tests float behind the board in rows, every other one a little higher, so neighbouring labels have room. */
  POS['t:' + t.label] = V(x, 9 + row * 5 + (col % 2) * 2.2, TEST_Z - row * 5);
});
