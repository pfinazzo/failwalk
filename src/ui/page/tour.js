/* The guided walkthrough: its steps, what each one shows, and the motion that pays off a stop. */
/* ------------------------------------------------------------------ */
/* The walkthrough                                                     */
/* ------------------------------------------------------------------ */
/** Every step of the tour, in order, built from the data: the big picture, each wrapper, then every uncovered cell. */
function buildTour() {
  const steps = [];
  const add = (chapter, step) => steps.push({ chapter, ...step });
  const big = 'The big picture';
  const uncoveredCells = SITES.flatMap((s) => s.cells.filter((c) => c.state !== 'coped').map((c) => ({ s, c })));
  const done = completeCount();
  add(big, { kind: 'start', say: `This is the failure map of ${PROJECT}: ${SCENE.status === 'run' ? `${done} of ${WRAPPERS.length} services fully walked.` : `${WRAPPERS.length} services, none walked yet.`}`,
    more: `${SCENE.headline ? SCENE.headline + ' ' : ''}Each service (a wrapper module) is a group, green-ringed once every call into it has been walked under every failure mode and coped, red-badged with its gap count until then. Each call is a node, placed by file. Each test that reaches a call is a beam. Each failure mode is a column, so a call site is a row of cells. Press Next, or the → key, to go on.` });
  add(big, { kind: 'colours', say: 'Green means the code coped. Red, amber and grey are the point.',
    more: `Red: the failure was injected and nothing caught it. Amber: the tests passed, but a static check found a pattern that passing hides. Grey: no test reaches the call, so nobody has walked that path. ${uncoveredCells.length ? `${plural(uncoveredCells.length, 'cell')} of ${SITES.length * MODES.length} need a look.` : 'Every cell here is green.'}` });
  WRAPPERS.forEach((w, i) => {
    const sites = wrapperSites(w.name); const cells = sites.flatMap((s) => s.cells);
    add(`${i + 1}. ${w.name}`, { kind: 'wrapper', id: w.name, say: `Wrapper ${i + 1} of ${WRAPPERS.length}: ${w.name}`,
      more: `${plural(sites.length, 'call site')} in ${plural(wrapperFiles(w.name).length, 'file')}, ${cells.length} cells: ${countsText(cells)}.` });
  });
  const closed = 'Closed since last time';
  SINCE.fixed.forEach(({ key, was }, i) => {
    const [siteId, mode] = key.split('|'); const s = SITE[siteId]; const c = s && s.cells.find((x) => x.mode === mode);
    if (!c) return;
    add(closed, { kind: 'fixed', id: key, was, state: 'fixed', say: `Closed ${i + 1} of ${SINCE.fixed.length}: ${s.wrapper}.${s.method} under ${mode}, at ${s.file}:${s.line}.`,
      more: `Last time this cell was ${STATE_NAMES[was].toLowerCase()}. This run it is green: ${c.production} ${c.note}` });
  });
  const gap = 'Uncovered failure paths';
  if (SCENE.status !== 'run') {
    add(gap, { kind: 'notice', say: 'Every cell is grey, because no run has filled it yet.', more: SCENE.notice });
  }
  const reds = uncoveredCells.filter(({ c }) => c.state === 'uncaught');
  const ambers = uncoveredCells.filter(({ c }) => c.state === 'risk');
  const greys = SITES.filter((s) => s.cells.some((c) => c.state === 'unreached'));
  const gapTotal = reds.length + ambers.length + greys.length;
  const gapStep = (step, index) => ({ ...step, gapIndex: index + 1, gapTotal });
  reds.forEach(({ s, c }, i) => add(gap, gapStep({ kind: 'cell', id: `${s.id}|${c.mode}`, state: 'uncaught', say: `Uncaught ${i + 1} of ${reds.length}: ${s.wrapper}.${s.method} under ${c.mode}, at ${s.file}:${s.line}.`,
    more: `${c.production} In the run: when ${modeText(c.mode)}, ${verdictText(c.verdict)}. ${c.note}` }, i)));
  ambers.forEach(({ s, c }, i) => add(gap, gapStep({ kind: 'cell', id: `${s.id}|${c.mode}`, state: 'risk', say: `Risk ${i + 1} of ${ambers.length}: ${s.wrapper}.${s.method} under ${c.mode}, at ${s.file}:${s.line}.`,
    more: `${c.production} In the run: when ${modeText(c.mode)}, ${verdictText(c.verdict)}. ${c.note}` }, reds.length + i)));
  greys.forEach((s, i) => add(gap, gapStep({ kind: 'site', id: s.id, state: 'unreached', say: `Nobody walks ${s.wrapper}.${s.method} at ${s.file}:${s.line}${greys.length > 1 ? ` (${i + 1} of ${greys.length})` : ''}.`,
    more: `${s.cells.find((c) => c.state === 'unreached').production} ${s.tests.length ? `${plural(s.tests.length, 'test')} reach it, but ${s.cells.filter((c) => c.state === 'unreached').length} of its ${MODES.length} cells have no verdict yet. ${s.cells.find((c) => c.state === 'unreached').note}` : `No test reaches this call site, so none of the ${MODES.length} failure modes has been tried here.`}` }, reds.length + ambers.length + i)));
  if (SCENE.status === 'run' && !uncoveredCells.length) add(gap, { kind: 'notice', say: 'Every cell is green.', more: 'Every call site is reached by a test, and the code coped with every failure mode injected. There is nothing uncovered to show.' });
  add('The end', { kind: 'end', say: SCENE.status === 'run' && done === WRAPPERS.length ? 'Every service is complete.' : `That is every gap: ${gapTotal} to close across ${WRAPPERS.length - done} of ${WRAPPERS.length} services.`,
    more: 'Red and amber cells name the exact file and line to fix. Grey sites need a test that reaches them. Run failwalk again after a fix and open the map: the cells that turned green are the first chapter. Explore, in the top bar, is the way back in any time.' });
  return steps;
}
const TOUR = buildTour();
const TOUR_CHAPTERS = TOUR.map((s) => s.chapter).filter((c, i, all) => all.indexOf(c) === i);
/** Lights up what a step is about and frames it. */
function tourShow(highlightId, ids, extra = 1.2) {
  view.highlight = highlightId ? neighbourhood(highlightId) : null; view.focus = highlightId; markIndex();
  frame(ids, extra);
}
/** What the map does at each kind of step. */
const TOUR_SHOW = {
  start: () => { tourShow(null, ALL_IDS, 1.1); renderWaysInPanel('The whole picture', `${plural(WRAPPERS.length, 'wrapper')}, ${plural(SITES.length, 'call site')}, ${plural(MODES.length, 'failure mode')}, ${plural(TESTS.length, 'test')} that reach a call site.`); },
  colours: () => { tourShow(null, ALL_IDS, 1.1); renderWaysInPanel('What the colours mean', 'Every cell is one call site under one failure mode.'); },
  wrapper: (s) => { tourShow('w:' + s.id, goFrame('w:' + s.id), 1.25); showWrapper(s.id); },
  notice: () => { tourShow(null, ALL_IDS, 1.1); renderWaysInPanel('Nothing has run yet', SCENE.notice); },
  cell: (s) => { tourShow('c:' + s.id, goFrame('c:' + s.id), 1.6); const [siteId, mode] = s.id.split('|'); showSite(siteId, mode); payOff({ siteId, cellId: 'c:' + s.id }); },
  site: (s) => { tourShow('s:' + s.id, goFrame('s:' + s.id), 1.6); showSite(s.id); payOff({ siteId: s.id, cellId: null }); },
  fixed: (s) => { tourShow('c:' + s.id, goFrame('c:' + s.id), 1.6); const [siteId, mode] = s.id.split('|'); showSite(siteId, mode); payOff({ siteId, cellId: 'c:' + s.id, from: STATE_COLORS[s.was] }); },
  end: () => { tourShow(null, ALL_IDS, 1.1); renderWaysInPanel('That is every failure path', 'Every wrapper, every call site, every mode, and who walks each.'); },
};
/**
 * The motion that pays off a stop on the tour: the camera has moved, now the beams of the tests that reach the gap
 * carry a particle into it, the cell pops, and a cell that closed since last time turns from its old colour to green.
 * With reduced motion the beams light and the colour switches, with nothing moving.
 */
function payOff({ siteId, cellId, from = null }) {
  const site = SITE[siteId];
  beamRun = REDUCED ? null : { paths: testIds(site).map((id) => [POS[id], POS['s:' + siteId]]), index: 0, t: 0 };
  if (particle) particle.visible = !!(beamRun && beamRun.paths.length);
  const cell = cellId && nodes[cellId];
  if (!cell) return;
  cell.scale = REDUCED ? 1.15 : 1.9; cell.targetScale = 1.15;
  if (from) cell.flip = { from: new THREE.Color(from), to: new THREE.Color(STATE_COLORS.coped), t: REDUCED ? 1 : 0 };
}
/** Stops the particle, resets the grown cell and finishes any colour fade when the tour moves on or stops. */
function endPayOff() {
  beamRun = null; if (particle) particle.visible = false;
  Object.values(nodes).forEach((n) => { if (n.targetScale === 1.15) n.targetScale = 1; if (n.flip) n.flip.t = 1; });
}
/** The running count beside the chapter menu: which gap this is, and how many closed since the last run. */
const tourCountText = (s) => [s.gapIndex ? `Gap ${s.gapIndex} of ${s.gapTotal}` : '', SINCE.fixed.length ? `<b>${plural(SINCE.fixed.length, 'gap')} closed</b> since the last run` : ''].filter(Boolean).join(' · ');

/** Shows one step: moves the map, fills the panel, and updates the player. */
function showTourStep(i) {
  tour.step = Math.max(0, Math.min(i, TOUR.length - 1));
  const s = TOUR[tour.step];
  tour.isSteering = true;
  endPayOff();
  try { TOUR_SHOW[s.kind](s); } finally { tour.isSteering = false; }
  markTourTab();
  $('#tourTag').className = `tourtag ${s.state || ''}`; $('#tourTag').textContent = s.state === 'fixed' ? 'Closed' : s.state ? STATE_NAMES[s.state] : '';
  $('#tourCount').innerHTML = tourCountText(s);
  $('#tourChapter').value = s.chapter;
  $('#tourSay').textContent = s.say; $('#tourMore').textContent = s.more;
  $('#tourNum').textContent = `Step ${tour.step + 1} of ${TOUR.length}`;
  $('#tourBar').style.width = `${((tour.step + 1) / TOUR.length) * 100}%`;
  /* No Back on the first step and no Next on the last. */
  $('#tourPrev').hidden = tour.step === 0;
  $('#tourNext').hidden = tour.step === TOUR.length - 1;
}
const toTourLabel = () => {
  if (tour.step === 0) return 'Walk me through everything';
  if (tour.step === TOUR.length - 1) return 'Walk me through everything again';
  return `Continue the walkthrough (step ${tour.step + 1} of ${TOUR.length})`;
};
function markTourTab() {
  const active = tour.isOn ? 'tour' : view.name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === active));
  if ($('#startTourLabel')) $('#startTourLabel').textContent = toTourLabel();
}
function startTour() {
  $('#intro').classList.add('gone');
  $('#tourResume').hidden = true;
  if (!tour.isOn && tour.step === TOUR.length - 1) tour.step = 0;
  tour.isOn = true;
  $('#tour').classList.add('on'); document.body.classList.add('touring');
  showTourStep(tour.step);
}
/** Puts the tour aside when the person goes their own way, keeping its place. Moves the tour makes itself don't count. */
function pauseTour({ offerReturn = true } = {}) {
  if (!tour.isOn || tour.isSteering) return;
  tour.isOn = false; endPayOff();
  $('#tour').classList.remove('on'); document.body.classList.remove('touring');
  $('#tourResumeStep').textContent = `step ${tour.step + 1} of ${TOUR.length}`;
  $('#tourResume').hidden = !offerReturn;
  markTourTab();
}
$('#tourChapter').innerHTML = TOUR_CHAPTERS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
$('#tourChapter').onchange = (e) => showTourStep(TOUR.findIndex((s) => s.chapter === e.target.value));
$('#tourNext').onclick = () => showTourStep(tour.step + 1);
$('#tourPrev').onclick = () => showTourStep(tour.step - 1);
$('#tourExit').onclick = () => { pauseTour({ offerReturn: false }); setView('explore'); };
$('#tourResume').onclick = startTour;
