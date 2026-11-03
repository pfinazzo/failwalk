/* The detail panel, the index on the left and the two views. */
/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */
function openPanel() { $('#panel').classList.add('open'); if (innerWidth < 900) $('#index').classList.add('closed'); }
function closePanel() { $('#panel').classList.remove('open'); }
function wirePanel() {
  $('#closeP').onclick = () => { closePanel(); setHighlight(null); };
  document.querySelectorAll('#panel [data-go]').forEach((el) => (el.onclick = () => { onPick(el.dataset.go); frame(goFrame(el.dataset.go)); }));
}
const sq = (state) => `<span class="sq" style="background:${STATE_COLORS[state]}"></span>`;
const siteChip = (s) => `<button class="chip" data-go="s:${esc(s.id)}">${sq(siteWorst(s))}${esc(s.method)} <span class="code">${esc(s.file)}:${s.line}</span></button>`;
const testChip = (label) => `<button class="chip" data-go="t:${esc(label)}"><span class="sw" style="background:${TEST_COLOR}"></span>${esc(label)}</button>`;
const checkChip = (name) => `<span class="chip check">⚠ ${esc(name)}</span>`;
const noticeBlock = () => (SCENE.notice ? `<div class="callout warn">${esc(SCENE.notice)}</div>` : '');
const cellRow = (s, c, on) => `<div class="cellrow ${c.state}${on ? ' on' : ''}" data-go="c:${esc(s.id)}|${esc(c.mode)}">${sq(c.state)}<span class="mode">${esc(c.mode)}</span><span class="note"><b>${esc(STATE_NAMES[c.state])}.</b> ${esc(c.note)}<i class="prod">${esc(c.production)}</i></span></div>`;
const serviceLine = (w) => (w.complete ? 'Complete: every call site walked under every failure mode, and the code coped each time.' : SCENE.status === 'run' ? `${plural(w.gaps, 'gap')}: cells that are red, amber or grey. Each one is listed below, worst first.` : 'Not walked yet: nothing is complete until a run fills the cells.');
function showSite(id, mode = null) {
  const s = SITE[id];
  const tests = s.tests.length ? `<div class="chips">${s.tests.map(testChip).join('')}</div>` : `<p>No test reaches this call site. Nothing can be injected here until one does.</p>`;
  $('#panelHead').innerHTML = `<button class="iconbtn close" id="closeP">✕</button><div class="kind"><span class="sw" style="background:${wrapperColor(s.wrapper)}"></span>Call site · ${esc(s.wrapper)}</div><h2>${esc(s.wrapper)}.${esc(s.method)}</h2><p class="simple"><span class="code">${esc(s.file)}:${s.line}</span> · a ${esc(s.kind)}${s.checks.length ? ` · ${plural(s.checks.length, 'check')} fired` : ''}</p>`;
  $('#panelBody').innerHTML = `${noticeBlock()}${s.checks.length ? `<h3>Static checks that fired</h3><div class="chips">${s.checks.map(checkChip).join('')}</div>` : ''}
    <h3>Tests that reach it</h3>${tests}
    <h3>Each failure mode</h3>${s.cells.map((c) => cellRow(s, c, c.mode === mode)).join('')}`;
  openPanel(); wirePanel();
}
function showTest(label) {
  const t = TEST[label];
  const sites = t.sites.filter((id) => SITE[id]).map((id) => SITE[id]);
  $('#panelHead').innerHTML = `<button class="iconbtn close" id="closeP">✕</button><div class="kind"><span class="sw" style="background:${TEST_COLOR}"></span>Test</div><h2>${esc(t.name)}</h2><p class="simple"><span class="code">${esc(t.file)}</span></p>`;
  $('#panelBody').innerHTML = `<h3>Call sites it reaches</h3><div class="chips">${sites.map(siteChip).join('')}</div>
    <p style="margin-top:12px">Each beam in the scene runs from this test to a call site it reached in the traced baseline run. With a failure injected at that site, this is one of the tests that runs.</p>`;
  openPanel(); wirePanel();
}
function showWrapper(name) {
  const sites = wrapperSites(name);
  const cells = sites.flatMap((s) => s.cells);
  $('#panelHead').innerHTML = `<button class="iconbtn close" id="closeP">✕</button><div class="kind"><span class="sw" style="background:${wrapperColor(name)}"></span>Wrapper module</div><h2>${esc(name)}</h2><p class="simple">${plural(sites.length, 'call site')} in ${plural(wrapperFiles(name).length, 'file')}. ${cells.length} cells: ${esc(countsText(cells))}.</p>`;
  $('#panelBody').innerHTML = `${noticeBlock()}<div class="callout${wrapperOf(name).complete ? '' : ' warn'}">${esc(serviceLine(wrapperOf(name)))}</div><h3>Call sites, worst first</h3><div class="chips">${[...sites].sort((a, b) => STATE_ORDER.indexOf(siteWorst(a)) - STATE_ORDER.indexOf(siteWorst(b))).map(siteChip).join('')}</div>`;
  openPanel(); wirePanel();
}
const SHOW = { s: (k) => showSite(k), c: (k) => { const [siteId, mode] = k.split('|'); showSite(siteId, mode); }, t: (k) => showTest(k), w: (k) => showWrapper(k) };
/** What to frame when something is chosen from the panel or the index. */
const goFrame = (id) => ({ s: (k) => ['s:' + k, ...cellIds(SITE[k])], c: (k) => ['s:' + k.split('|')[0], ...cellIds(SITE[k.split('|')[0]])], t: (k) => ['t:' + k, ...TEST[k].sites.filter((x) => SITE[x]).map((x) => 's:' + x)], w: (k) => NEIGHBOURS.w(k).filter((x) => !x.startsWith('t:')) })[id[0]](id.slice(2));
const legendList = () => `<ul class="legendlist">${STATE_ORDER.map((s) => `<li>${sq(s)}<span><b>${esc(STATE_NAMES[s])}.</b> ${esc(STATE_TEXT[s])}</span></li>`).join('')}</ul>`;
function renderWaysInPanel(title, lead) {
  $('#panelHead').innerHTML = `<button class="iconbtn close" id="closeP">✕</button><div class="kind">Walkthrough</div><h2>${esc(title)}</h2><p class="simple">${esc(lead)}</p>`;
  $('#panelBody').innerHTML = `${noticeBlock()}<h3>What the colours mean</h3>${legendList()}<h3>Another way in</h3><div class="dcard" data-way="explore"><div class="t">Explore on your own</div><div class="w">Turn, pan and zoom the whole picture. Click any wrapper, call site, cell or test for its details.</div></div>`;
  openPanel(); wirePanel();
  document.querySelectorAll('#panelBody [data-way]').forEach((el) => (el.onclick = () => { pauseTour({ offerReturn: false }); setView('explore'); }));
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */
function buildIndex(filter = '') {
  const q = filter.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);
  const blocks = WRAPPERS.map((w) => {
    const sites = wrapperSites(w.name).filter((s) => match(`${s.wrapper}.${s.method} ${s.file}`));
    if (!sites.length && !match(w.name)) return '';
    return `<button class="item" data-go="w:${esc(w.name)}"><span class="sw" style="background:${wrapperColor(w.name)}"></span><span class="name">${esc(w.name)}</span><span class="count">${w.sites.length}</span></button>` +
      sites.map((s) => `<button class="item l1" data-go="s:${esc(s.id)}" title="${esc(s.file)}:${s.line}"><span class="sq" style="background:${STATE_COLORS[siteWorst(s)]}"></span><span class="name">${esc(s.method)} <span style="color:var(--faint)">${esc(s.file)}:${s.line}</span></span></button>`).join('');
  }).join('');
  const tests = TESTS.filter((t) => match(t.label)).map((t) => `<button class="item l1" data-go="t:${esc(t.label)}" title="${esc(t.label)}"><span class="sw" style="background:${TEST_COLOR}"></span><span class="name">${esc(t.name)}</span><span class="count">${t.sites.length}</span></button>`).join('');
  $('#indexList').innerHTML = `<div class="sec">Wrappers and call sites</div>${blocks || '<p class="item">Nothing matches.</p>'}<div class="sec">Tests that reach a call site</div>${tests || `<p class="item">${TESTS.length ? 'Nothing matches.' : 'None yet.'}</p>`}`;
  document.querySelectorAll('#indexList [data-go]').forEach((el) => (el.onclick = () => { onPick(el.dataset.go); frame(goFrame(el.dataset.go)); }));
  markIndex();
}
function markIndex() { document.querySelectorAll('#indexList [data-go]').forEach((el) => el.classList.toggle('on', el.dataset.go === view.focus)); }

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */
function setView(name) {
  view.name = name; closePanel(); setHighlight(null); frame(ALL_IDS, 1.1); markTourTab();
}
