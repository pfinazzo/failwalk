/* The Three.js scene: nodes, beams, labels, the camera and what a click picks. */
/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */
const gl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
let scene, camera, renderer, labelRenderer, controls, glowTex, camTween = null, particle = null;
/** The beams the walkthrough is running its particle along: the tests of the gap on screen, in turn. */
let beamRun = null;
const nodes = {};
const edges = [];
const haloLabels = [];
const clock = new THREE.Clock();
const view = { name: 'explore', focus: null, highlight: null, hover: null };
const tour = { isOn: false, step: 0, isSteering: false };

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function makeLabel(html, cls) {
  const wrap = document.createElement('div'); wrap.className = 'lw';
  const el = document.createElement('div'); el.className = `lab ${cls}`; el.innerHTML = html;
  wrap.appendChild(el); const obj = new CSS2DObject(wrap); obj.inner = el; return obj;
}
/** One node: a mesh, its glow, its label, and the opacity the highlight drives. */
function addNode({ id, mesh, color, glowScale, label, pos, baseOpacity = 1 }) {
  const group = new THREE.Group();
  mesh.userData.id = id; group.add(mesh);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(glowScale); group.add(glow);
  if (label) {
    group.add(label);
    label.inner.addEventListener('click', (e) => { e.stopPropagation(); onPick(id); });
    label.inner.addEventListener('mouseenter', () => hover(id)); label.inner.addEventListener('mouseleave', () => hover(null));
  }
  group.position.copy(pos); scene.add(group);
  nodes[id] = { id, group, mesh, glow, label, pos, opacity: 1, baseOpacity, scale: 1, targetScale: 1 };
  return nodes[id];
}
function initScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x070b14, 1);
  $('#stage').appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer({ element: $('#labels') });
  labelRenderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070b14, 0.0025);
  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(TOTAL_W / 2, 10, 90);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.zoomSpeed = 2.5; controls.zoomToCursor = true; controls.minDistance = 4; controls.maxDistance = 400;
  controls.target.set(TOTAL_W / 2, minY / 2, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.0); d.position.set(30, 60, 80); scene.add(d);
  const d2 = new THREE.DirectionalLight(0x88aaff, 0.5); d2.position.set(-60, -30, -40); scene.add(d2);

  const sg = new THREE.BufferGeometry(); const N = 1400; const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const r = 260 + Math.random() * 500; const t = Math.random() * Math.PI * 2; const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(t); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(t); pos[i * 3 + 2] = r * Math.cos(ph); }
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x8aa0c8, size: 1.1, transparent: true, opacity: 0.5, fog: false })));
  glowTex = makeGlowTexture();

  WRAPPERS.forEach((w) => {
    const color = new THREE.Color(wrapperColor(w.name));
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.1, transparent: true, flatShading: true }));
    const badge = w.complete ? `<span class="badge done">✓ complete</span>` : SCENE.status === 'run' ? `<span class="badge gap">${plural(w.gaps, 'gap')}</span>` : `<span class="badge">${w.sites.length}</span>`;
    const label = makeLabel(`${esc(w.name)}${badge}<span class="sub">${plural(w.sites.length, 'call site')} in ${plural(wrapperFiles(w.name).length, 'file')}</span>`, `wrapper ${w.complete ? 'done' : w.gaps ? 'gappy' : ''}`);
    label.position.set(0, -3, 0);
    /* A complete service wears a calm green ring. One with gaps breathes red, as loud as the cells it is missing. */
    const node = addNode({ id: 'w:' + w.name, mesh, color: w.complete ? new THREE.Color(STATE_COLORS.coped) : w.gaps ? new THREE.Color(STATE_COLORS.uncaught) : color, glowScale: w.gaps ? 11 : 9, label, pos: POS['w:' + w.name] });
    if (w.complete) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.09, 8, 64), new THREE.MeshBasicMaterial({ color: STATE_COLORS.coped, transparent: true, opacity: 0.9 }));
      ring.rotation.x = Math.PI / 2; node.group.add(ring); node.ring = ring;
    }
    if (w.gaps) { node.pulse = 'glow'; node.phase = Math.random() * Math.PI * 2; }
  });
  const cellGeo = new THREE.BoxGeometry(1.5, 1.5, 0.5);
  SITES.forEach((s) => {
    const color = new THREE.Color(wrapperColor(s.wrapper));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 28, 18), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.35, metalness: 0.1, transparent: true }));
    const label = makeLabel(`${esc(s.method)}<span class="sub">${esc(s.file)}:${s.line}</span>`, 'site');
    label.position.set(-1, 0, 0);
    addNode({ id: 's:' + s.id, mesh, color, glowScale: 4.5, label, pos: POS['s:' + s.id] });
    s.cells.forEach((c) => {
      const cc = new THREE.Color(STATE_COLORS[c.state]);
      const grey = c.state === 'unreached';
      const m = new THREE.Mesh(cellGeo, new THREE.MeshStandardMaterial({ color: cc, emissive: cc, emissiveIntensity: grey ? 0.1 : 0.55, roughness: 0.5, transparent: true }));
      const node = addNode({ id: `c:${s.id}|${c.mode}`, mesh: m, color: cc, glowScale: grey ? 0 : 3.2, label: null, pos: POS[`c:${s.id}|${c.mode}`], baseOpacity: grey ? 0.7 : 1 });
      /* Red and amber cells breathe; grey cells wear a bright outline so they read as holes, not as background. Green stays calm. */
      if (c.state === 'uncaught' || c.state === 'risk') { node.pulse = 'cell'; node.phase = Math.random() * Math.PI * 2; }
      if (grey) { const edge = new THREE.LineSegments(new THREE.EdgesGeometry(cellGeo), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8 })); node.group.add(edge); node.edge = edge; }
    });
  });
  TESTS.forEach((t) => {
    const color = new THREE.Color(TEST_COLOR);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, transparent: true }));
    const label = makeLabel(esc(t.name), 'test');
    label.position.set(0, 0.6, 0);
    addNode({ id: 't:' + t.label, mesh, color, glowScale: 4, label, pos: POS['t:' + t.label] });
    t.sites.filter((id) => SITE[id]).forEach((id) => {
      const geo = new THREE.BufferGeometry().setFromPoints([POS['t:' + t.label], POS['s:' + id]]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.3 }));
      scene.add(line); edges.push({ a: 't:' + t.label, b: 's:' + id, line });
    });
  });
  HEADS.forEach((h) => { const lab = makeLabel(esc(h.text), `halo ${h.cls}`); lab.position.copy(h.pos); scene.add(lab); haloLabels.push(lab); });

  /* The particle that runs a test's beam into a gap during the walkthrough. */
  particle = new THREE.Group();
  particle.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff })));
  const pg = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x7dd3fc, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  pg.scale.setScalar(4); particle.add(pg); particle.visible = false; scene.add(particle);

  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight); });
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */
const sideWidths = () => ({
  left: !$('#index').classList.contains('closed') && innerWidth >= 900 ? 290 : 0,
  right: $('#panel').classList.contains('open') && innerWidth >= 900 ? $('#panel').offsetWidth : 0,
  footer: $('#tour').classList.contains('on') ? $('#tour').offsetHeight + 34 : 70,
});
function frame(ids, extra = 1.2) {
  const pts = ids.map((id) => POS[id]).filter(Boolean);
  if (!pts.length) return;
  const box = new THREE.Box3().setFromPoints(pts); const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()); const halfW = Math.max(size.x / 2, 5) * extra, halfH = Math.max(size.y / 2, 4) * extra;
  const { left, right, footer } = sideWidths(); const t = Math.tan((camera.fov * Math.PI) / 360);
  const freeW = Math.max(innerWidth - left - right - 160, 300), freeH = Math.max(innerHeight - 70 - footer - 90, 200);
  const dist = Math.max(halfH * innerHeight / (freeH * t), halfW * innerWidth / (freeW * t * camera.aspect)) + size.z / 2 + 6;
  const dir = V(0, 0.18, 1).normalize();
  camTween = { t: REDUCED ? 1 : 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toTarget: center, toPos: center.clone().add(dir.multiplyScalar(dist)) };
}
let viewShift = 0, viewLift = 0;
function applyViewOffset(dt) {
  const { left, right, footer } = sideWidths(); const k = dt ? 1 - Math.pow(0.004, dt) : 1;
  viewShift += ((left - right) / 2 - viewShift) * k; viewLift += ((footer - 70) / 2 - viewLift) * k;
  camera.setViewOffset(innerWidth, innerHeight, -viewShift, viewLift, innerWidth, innerHeight); camera.updateProjectionMatrix();
  const rs = document.documentElement.style;
  rs.setProperty('--free-left', left + 'px'); rs.setProperty('--free-right', right + 'px');
  rs.setProperty('--mid', (left + (innerWidth - left - right) / 2) + 'px');
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ALL_IDS = Object.keys(POS);

/* ------------------------------------------------------------------ */
/* Highlight and picking                                               */
/* ------------------------------------------------------------------ */
const cellIds = (site) => site.cells.map((c) => `c:${site.id}|${c.mode}`);
const testIds = (site) => site.tests.filter((l) => TEST[l]).map((l) => 't:' + l);
/** Everything that belongs with one thing: a site with its cells, tests and wrapper; a test with its sites; a wrapper with all of it. */
const NEIGHBOURS = {
  s: (key) => { const s = SITE[key]; return ['s:' + key, 'w:' + s.wrapper, ...cellIds(s), ...testIds(s)]; },
  c: (key) => { const [siteId, mode] = key.split('|'); const s = SITE[siteId]; return ['c:' + key, 's:' + siteId, 'w:' + s.wrapper, ...testIds(s), ...cellIds(s)]; },
  t: (key) => { const t = TEST[key]; return ['t:' + key, ...t.sites.filter((id) => SITE[id]).flatMap((id) => ['s:' + id, ...cellIds(SITE[id])])]; },
  w: (key) => ['w:' + key, ...wrapperSites(key).flatMap((s) => ['s:' + s.id, ...cellIds(s), ...testIds(s)])],
};
const neighbourhood = (id) => new Set(NEIGHBOURS[id[0]](id.slice(2)));
const raycaster = new THREE.Raycaster();
function pickAt(e) {
  const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const meshes = Object.values(nodes).filter((n) => n.opacity > 0.2).map((n) => n.mesh);
  const hit = raycaster.intersectObjects(meshes, false)[0];
  return hit ? hit.object.userData.id : null;
}
const nameOf = (id) => ({ s: (k) => `${SITE[k].wrapper}.${SITE[k].method}`, c: (k) => { const [siteId, mode] = k.split('|'); return `${SITE[siteId].method} under ${mode}`; }, t: (k) => TEST[k].name, w: (k) => k })[id[0]](id.slice(2));
const tipOf = (id) => ({
  s: (k) => `${SITE[k].file}:${SITE[k].line} · ${countsText(SITE[k].cells)}`,
  c: (k) => { const [siteId, mode] = k.split('|'); return SITE[siteId].cells.find((c) => c.mode === mode).note; },
  t: (k) => `${TEST[k].file} · reaches ${plural(TEST[k].sites.length, 'call site')}`,
  w: (k) => countsText(wrapperSites(k).flatMap((s) => s.cells)),
})[id[0]](id.slice(2));
function onMove(e) {
  const id = pickAt(e); hover(id);
  const tip = $('#tip');
  if (!id) { tip.style.display = 'none'; return; }
  tip.innerHTML = `${esc(nameOf(id))}<small>${esc(tipOf(id))}</small>`;
  tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 14, innerWidth - 350) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
}
function hover(id) {
  if (view.hover && nodes[view.hover]) nodes[view.hover].targetScale = 1;
  view.hover = id;
  if (id && nodes[id]) nodes[id].targetScale = 1.3;
  renderer.domElement.style.cursor = id ? 'pointer' : '';
}
function onClick(e) { const id = pickAt(e); if (id) onPick(id); else { setHighlight(null); closePanel(); } }
/** A click on anything: the panel for it, the things around it lit, and the walkthrough put aside. */
function onPick(id) {
  pauseTour();
  setHighlight(id);
  SHOW[id[0]](id.slice(2));
}
function setHighlight(id) { view.highlight = id ? neighbourhood(id) : null; view.focus = id; markIndex(); }
