/* The render loop, the top bar, the legend, the greeting and the wiring. */
/* ------------------------------------------------------------------ */
/* Render loop                                                         */
/* ------------------------------------------------------------------ */
/** Each kind of pulse: how bright, or how big, a thing breathes. Nothing breathes under reduced motion. */
const PULSES = {
  cell: (n, t) => { n.mesh.material.emissiveIntensity = 0.55 + Math.sin(t * 2.6 + n.phase) * 0.3; },
  glow: (n, t) => { n.glow.scale.setScalar(11 + Math.sin(t * 1.8 + n.phase) * 1.6); },
};
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05); const t = clock.elapsedTime;
  Object.values(nodes).forEach((n) => {
    const lit = !view.highlight || view.highlight.has(n.id);
    const goal = n.baseOpacity * (lit ? 1 : 0.12);
    n.opacity += (goal - n.opacity) * (1 - Math.pow(0.002, dt));
    n.scale += (n.targetScale - n.scale) * (REDUCED ? 1 : 0.2);
    n.group.scale.setScalar(n.scale);
    if (n.id.startsWith('w:') && !REDUCED) n.mesh.rotation.y += dt * 0.25;
    if (n.pulse && !REDUCED && lit) PULSES[n.pulse](n, t);
    if (n.flip) { n.flip.t = Math.min(1, n.flip.t + dt / 1.2); const c = n.flip.from.clone().lerp(n.flip.to, ease(n.flip.t)); n.mesh.material.color.copy(c); n.mesh.material.emissive.copy(c); n.glow.material.color.copy(c); if (n.flip.t >= 1) n.flip = null; }
    if (n.ring) n.ring.material.opacity = n.opacity * 0.9;
    if (n.edge) n.edge.material.opacity = n.opacity * 0.8;
    n.mesh.material.opacity = n.opacity; n.glow.material.opacity = n.opacity * 0.5;
    /* A test's label shows only while the test is lit by a selection or hovered: many tests share the row, and their names are long. */
    const quiet = n.id.startsWith('t:') && !(view.highlight && lit) && view.hover !== n.id;
    if (n.label) { n.label.element.style.opacity = n.opacity > 0.3 && !quiet ? (lit ? 1 : 0.25) : 0; n.label.inner.style.pointerEvents = lit && !quiet ? 'auto' : 'none'; }
  });
  edges.forEach((e) => {
    const both = !view.highlight || (view.highlight.has(e.a) && view.highlight.has(e.b));
    const goal = view.highlight ? (both ? 0.9 : 0.04) : 0.3;
    e.line.material.opacity += (goal - e.line.material.opacity) * (1 - Math.pow(0.002, dt));
  });
  if (beamRun && beamRun.paths.length) {
    beamRun.t += dt * 0.7;
    if (beamRun.t >= 1) { beamRun.t = 0; beamRun.index = (beamRun.index + 1) % beamRun.paths.length; }
    const [a, b] = beamRun.paths[beamRun.index];
    particle.position.copy(a).lerp(b, ease(beamRun.t));
    particle.children[1].scale.setScalar(4 + Math.sin(t * 6) * 0.6);
  }
  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / 0.7); const k = ease(camTween.t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k); controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    if (camTween.t >= 1) camTween = null;
  }
  applyViewOffset(dt); controls.update();
  renderer.render(scene, camera); labelRenderer.render(scene, camera);
  requestAnimationFrame(tick);
}

/* ------------------------------------------------------------------ */
/* Chrome and the greeting                                             */
/* ------------------------------------------------------------------ */
function renderChrome() {
  $('#brand').innerHTML = `failwalk map <small>${esc(PROJECT)}</small>`;
  $('#built').textContent = SCENE.generatedAt ? `data from ${new Date(SCENE.generatedAt).toLocaleString()}` : 'inventory only';
  $('#legend').innerHTML = STATE_ORDER.map((s) => `<span><i style="background:${STATE_COLORS[s]}"></i>${esc(STATE_NAMES[s])}</span>`).join('') + `<span><i class="ring"></i>Complete service</span><span><i class="round" style="background:${TEST_COLOR}"></i>Test</span><span><i style="background:#7dd3fc;height:2px"></i>Reaches</span>`;
  const uncovered = SITES.flatMap((s) => s.cells).filter((c) => c.state !== 'coped').length;
  /* Every service at once, each either complete or showing its gap count. Before a run none is complete, and the chip says so. */
  const serviceChip = (w) => (w.complete ? `<span class="svc done"><i style="background:${STATE_COLORS.coped}"></i>${esc(w.name)} · complete</span>`
    : SCENE.status === 'run' ? `<span class="svc gappy"><i style="background:${STATE_COLORS.uncaught}"></i>${esc(w.name)} · ${plural(w.gaps, 'gap')}</span>`
    : `<span class="svc unknown"><i style="background:${STATE_COLORS.unreached}"></i>${esc(w.name)} · not walked yet</span>`);
  const since = SINCE.previousAt ? `<p class="since">Since you last looked (${new Date(SINCE.previousAt).toLocaleString()}): <b>${plural(SINCE.fixed.length, 'gap')} closed</b>${SINCE.newGaps ? `, ${plural(SINCE.newGaps, 'new gap')}` : ''}.</p>` : '';
  $('#introCard').innerHTML = `<h1>failwalk map<small>${esc(PROJECT)}</small></h1>
    <p>Every place the code calls a vendor or a database through a wrapper module, against every failure mode. Green cells coped. Red cells were injected and nothing caught them. Amber cells passed while hiding a risky pattern. Grey cells were never walked by any test.</p>
    <div class="services">${WRAPPERS.map(serviceChip).join('')}</div>
    <div class="row"><div><b>${SCENE.status === 'run' ? `${completeCount()} of ${WRAPPERS.length}` : `0 of ${WRAPPERS.length}`}</b>services fully walked</div><div><b>${TESTS.length}</b>${TESTS.length === 1 ? 'test reaches' : 'tests reach'} a call site</div><div><b>${uncovered}</b>of ${SITES.length * MODES.length} cells uncovered</div></div>
    ${since}${SCENE.notice ? `<div class="callout warn">${esc(SCENE.notice)}</div>` : ''}
    <p class="ask">Would you like to walk through everything or explore on your own?</p>
    <div class="choices"><button class="choice primary" id="startTour"><b id="startTourLabel">${esc(toTourLabel())}</b><span>The big picture, then each service, then a tour of the gaps one at a time: what breaks in production if that failure hits today.</span></button>
    <button class="choice" id="startExplore"><b>Explore on my own</b><span>Turn, pan and zoom. Click any wrapper, call site, cell or test for its file, line, tests and verdicts.</span></button></div>`;
  $('#startTour').onclick = startTour;
  $('#startExplore').onclick = () => { $('#intro').classList.add('gone'); setView('explore'); };
}
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => (t.dataset.view === 'tour' ? startTour() : (pauseTour({ offerReturn: true }), setView('explore')))));
$('#search').addEventListener('input', (e) => buildIndex(e.target.value));
$('#toggleIndex').onclick = () => { $('#index').classList.toggle('closed'); if (innerWidth < 900 && !$('#index').classList.contains('closed')) closePanel(); };
$('#helpBtn').onclick = () => $('#intro').classList.remove('gone');
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (tour.isOn && e.key === 'ArrowRight') { $('#tourNext').click(); return; }
  if (tour.isOn && e.key === 'ArrowLeft') { $('#tourPrev').click(); return; }
  if (e.key === 'Escape') { if (!$('#intro').classList.contains('gone')) $('#intro').classList.add('gone'); else { closePanel(); setHighlight(null); } }
});
if (innerWidth < 900) $('#index').classList.add('closed');

renderChrome(); buildIndex();
if (gl) {
  initScene(); frame(ALL_IDS, 1.1); tick();
} else {
  $('#nogl').style.display = 'grid';
}
/* For a headless check or a script: the page's data and the walkthrough, read-only. */
window.__failwalk = { scene: SCENE, tour: TOUR, go: showTourStep, start: startTour, since: SINCE, reduced: REDUCED };
