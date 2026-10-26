/* viewer3d.js - three.js viewer for the structural model (ES module). Exposes window.SDViewer.
 * API:  const v = SDViewer.create(containerEl, { onSelect(id) })
 *   v.setModel(model)                       nodes/members/supports (analysis schema, Z up, metres)
 *   v.setLabels({ nodes:bool, members:bool })
 *   v.setDiagram(null | { kind:'My', members:{ id:[{x,v}] }, members2?:{ id:[{x,v}] }, mult:1 })
 *   v.setDeformed(null | { nodes:{id:{ux,uy,uz}}, members:{id:[{x,dy,dz}]}, mult:1 })
 *   v.highlight(id) ; v.fit() ; v.resize() ; v.dispose()
 * Labels use textContent only (safe against untrusted ids).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const KIND_COLOR = { beam: 0x2f6db5, column: 0x4a5560, brace: 0xd9822b };

function localAxes(a, b, rollDeg) {
  const x = new THREE.Vector3().subVectors(b, a);
  const L = x.length() || 1;
  x.divideScalar(L);
  let y, z;
  if (Math.abs(x.z) > 0.9999) {            // vertical member: y = global Y, z = x * y
    y = new THREE.Vector3(0, 1, 0);
    z = new THREE.Vector3().crossVectors(x, y).normalize();
  } else {                                  // z in vertical plane (up), y = z * x
    const up = new THREE.Vector3(0, 0, 1);
    z = up.clone().sub(x.clone().multiplyScalar(up.dot(x))).normalize();
    y = new THREE.Vector3().crossVectors(z, x).normalize();
  }
  const r = (rollDeg || 0) * Math.PI / 180;
  if (r) {
    const c = Math.cos(r), s = Math.sin(r);
    const y2 = y.clone().multiplyScalar(c).add(z.clone().multiplyScalar(s));
    const z2 = z.clone().multiplyScalar(c).sub(y.clone().multiplyScalar(s));
    y = y2; z = z2;
  }
  return { x, y, z, L };
}

// which local axis the diagram is drawn along, and sign (moments on tension side for My)
const DIAG_AXIS = { N: ['y', 1], Vy: ['y', 1], Vz: ['z', 1], T: ['z', 1], My: ['z', -1], Mz: ['y', 1] };

class Viewer {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.model = null;
    this.labels = { nodes: false, members: false };
    this.memberMeshes = new Map();
    this.selected = null;
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f6f9);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(20, -20, 15);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
    container.appendChild(this.labelRenderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.render());
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dl = new THREE.DirectionalLight(0xffffff, 0.6); dl.position.set(10, -15, 25); this.scene.add(dl);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.diagGroup = new THREE.Group(); this.scene.add(this.diagGroup);
    this.defGroup = new THREE.Group(); this.scene.add(this.defGroup);
    this.labelGroup = new THREE.Group(); this.scene.add(this.labelGroup);
    this.ray = new THREE.Raycaster();
    this._down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!this._down) return;
      const moved = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]);
      this._down = null;
      if (moved < 4) this._pick(e);
    });
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.render();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.render();
  }
  dispose() { this._ro.disconnect(); this.renderer.dispose(); this.container.textContent = ''; }

  _clear(g) {
    while (g.children.length) {
      const c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => m.dispose());
      if (c.element) c.element.remove();
      if (c.children && c.children.length) this._clear(c);
    }
  }

  setModel(model) {
    this.model = model || null;
    this._clear(this.root); this._clear(this.labelGroup); this.memberMeshes.clear();
    this._clear(this.diagGroup); this._clear(this.defGroup);
    this.pos = new Map();
    if (!model || !model.nodes || !model.nodes.length) { this.size = 10; this.render(); return; }
    const box = new THREE.Box3();
    for (const n of model.nodes) { const p = new THREE.Vector3(+n.x || 0, +n.y || 0, +n.z || 0); this.pos.set(n.id, p); box.expandByPoint(p); }
    const sz = new THREE.Vector3(); box.getSize(sz);
    this.size = Math.max(sz.x, sz.y, sz.z, 1);
    this.box = box;
    const r = this.size * 0.005;
    for (const m of model.members || []) {
      const a = this.pos.get(m.i), b = this.pos.get(m.j);
      if (!a || !b) continue;
      const len = a.distanceTo(b); if (len < 1e-9) continue;
      const geo = new THREE.CylinderGeometry(r, r, len, 6, 1);
      const mat = new THREE.MeshLambertMaterial({ color: KIND_COLOR[m.kind] || KIND_COLOR.beam });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
      mesh.userData.id = m.id;
      this.root.add(mesh); this.memberMeshes.set(m.id, mesh);
    }
    const pg = new THREE.BufferGeometry();
    pg.setFromPoints([...this.pos.values()]);
    this.root.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: 0x222222, size: 5, sizeAttenuation: false })));
    // supports
    const cone = new THREE.ConeGeometry(this.size * 0.015, this.size * 0.03, 4);
    const smat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    for (const s of model.supports || []) {
      const p = this.pos.get(s.node); if (!p) continue;
      const c = new THREE.Mesh(cone, smat.clone());
      c.rotation.x = Math.PI / 2; c.position.set(p.x, p.y, p.z - this.size * 0.015);
      this.root.add(c);
    }
    // ground grid at lowest z
    const grid = new THREE.GridHelper(this.size * 1.6, 16, 0xbfc7d1, 0xdde2e8);
    grid.rotation.x = Math.PI / 2;
    grid.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z - this.size * 0.03);
    this.root.add(grid);
    this._buildLabels();
    this.fit();
  }

  _label(text, pos, cls) {
    const d = document.createElement('div');
    d.className = 'v3d-label ' + cls; d.textContent = String(text);
    const o = new CSS2DObject(d); o.position.copy(pos); return o;
  }
  _buildLabels() {
    this._clear(this.labelGroup);
    if (!this.model) return;
    if (this.labels.nodes) for (const [id, p] of this.pos) this.labelGroup.add(this._label(id, p, 'v3d-node'));
    if (this.labels.members) for (const m of this.model.members || []) {
      const a = this.pos.get(m.i), b = this.pos.get(m.j); if (!a || !b) continue;
      this.labelGroup.add(this._label(m.id, a.clone().add(b).multiplyScalar(0.5), 'v3d-member'));
    }
  }
  setLabels(l) { this.labels = Object.assign({}, this.labels, l); this._buildLabels(); this.render(); }

  fit() {
    if (!this.box) { this.render(); return; }
    const c = new THREE.Vector3(); this.box.getCenter(c);
    const d = this.size * 1.7;
    this.camera.position.set(c.x + d * 0.8, c.y - d * 1.0, c.z + d * 0.7);
    this.controls.target.copy(c);
    this.camera.near = this.size / 1000; this.camera.far = this.size * 100; this.camera.updateProjectionMatrix();
    this.controls.update(); this.render();
  }

  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects([...this.memberMeshes.values()], false);
    if (hits.length) {
      const id = hits[0].object.userData.id;
      this.highlight(id);
      if (this.opts.onSelect) this.opts.onSelect(id);
    }
  }
  highlight(id) {
    if (this.selected && this.memberMeshes.has(this.selected)) {
      const m = this.memberMeshes.get(this.selected);
      m.material.emissive.setHex(0x000000); m.scale.set(1, 1, 1);
    }
    this.selected = id;
    if (id && this.memberMeshes.has(id)) {
      const m = this.memberMeshes.get(id);
      m.material.emissive.setHex(0xcc2222); m.scale.set(2.2, 1, 2.2);
    }
    this.render();
  }

  _memberFrame(m) {
    const a = this.pos.get(m.i), b = this.pos.get(m.j);
    if (!a || !b) return null;
    return Object.assign({ a, b }, localAxes(a, b, m.roll));
  }

  setDiagram(d) {
    this._clear(this.diagGroup);
    if (!d || !this.model) { this.render(); return; }
    const [axis, sign] = DIAG_AXIS[d.kind] || ['z', 1];
    let maxAbs = 0;
    for (const set of [d.members, d.members2]) if (set) for (const id in set) for (const s of set[id]) maxAbs = Math.max(maxAbs, Math.abs(s.v));
    if (!(maxAbs > 0)) { this.render(); return; }
    const k = (this.size * 0.08 / maxAbs) * (d.mult || 1);
    const pts = [], cols = [];
    const pushSeg = (p, q, c) => { pts.push(p.x, p.y, p.z, q.x, q.y, q.z); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    const pos = new THREE.Color(0xd23b3b), neg = new THREE.Color(0x2b6cc4);
    for (const m of this.model.members || []) {
      const fr = this._memberFrame(m); if (!fr) continue;
      for (const set of [d.members, d.members2]) {
        const arr = set && set[m.id]; if (!arr || arr.length < 2) continue;
        const dir = fr[axis];
        let prev = null;
        arr.forEach((s, idx) => {
          const base = fr.a.clone().add(fr.x.clone().multiplyScalar(s.x));
          const tip = base.clone().add(dir.clone().multiplyScalar(sign * s.v * k));
          const c = s.v >= 0 ? pos : neg;
          if (prev) pushSeg(prev, tip, c);
          if (idx === 0 || idx === arr.length - 1 || idx % 2 === 0) pushSeg(base, tip, c);
          prev = tip;
        });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.diagGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true })));
    this.render();
  }

  setDeformed(d) {
    this._clear(this.defGroup);
    if (!d || !this.model) { this.render(); return; }
    let maxU = 0;
    for (const id in d.nodes) { const u = d.nodes[id]; maxU = Math.max(maxU, Math.hypot(u.ux || 0, u.uy || 0, u.uz || 0)); }
    if (!(maxU > 0)) { this.render(); return; }
    const k = (this.size * 0.06 / maxU) * (d.mult || 1);
    this.lastDeformScale = k / (d.mult || 1);
    const pts = [];
    for (const m of this.model.members || []) {
      const fr = this._memberFrame(m); if (!fr) continue;
      const ui = d.nodes[m.i] || {}, uj = d.nodes[m.j] || {};
      const vi = new THREE.Vector3(ui.ux || 0, ui.uy || 0, ui.uz || 0), vj = new THREE.Vector3(uj.ux || 0, uj.uy || 0, uj.uz || 0);
      const st = d.members && d.members[m.id];
      const n = st && st.length > 1 ? st.length : 8;
      let prev = null;
      for (let q = 0; q < n; q++) {
        const t = st && st.length > 1 ? st[q].x / fr.L : q / (n - 1);
        let p = fr.a.clone().add(fr.x.clone().multiplyScalar(t * fr.L));
        p.add(vi.clone().lerp(vj, t).multiplyScalar(k));
        if (st && st.length > 1) {
          const s0 = st[0], s1 = st[st.length - 1], s = st[q];
          const tt = fr.L > 0 ? s.x / fr.L : 0;
          const devY = (s.dy || 0) - ((s0.dy || 0) * (1 - tt) + (s1.dy || 0) * tt);
          const devZ = (s.dz || 0) - ((s0.dz || 0) * (1 - tt) + (s1.dz || 0) * tt);
          p.add(fr.y.clone().multiplyScalar(devY * k)).add(fr.z.clone().multiplyScalar(devZ * k));
        }
        if (prev) pts.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.defGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe07b00 })));
    this.render();
  }
}

window.SDViewer = {
  create(container, opts) { return new Viewer(container, opts); },
  localAxes,
  ready: true
};
window.dispatchEvent(new Event('sdviewer-ready'));
