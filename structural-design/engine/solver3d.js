/* engine/solver3d.js — 3D frame analysis, direct stiffness method, 6 DOF/node.
 *
 * UNITS: kgf, m, radians. E,G kg/m2; A m2; I,J m4; loads kg, kg/m, kg-m.
 *
 * LOCAL AXES (per member, x from node i to node j):
 *  - Non-vertical member: local z lies in the vertical plane containing x and global Z, pointing "up"
 *      (z = normalize(Z - (Z.x)x)), y = z cross x.   (right-handed: x cross y = z)
 *  - Vertical member (horizontal part of x < 1e-4): y = global +Y, z = x cross y.
 *      Column going up (x=+Z): z = -X.   Column going down (x=-Z): z = +X.
 *  - roll (degrees): rotation of the y,z axes about +x by right-hand rule: y' = cos*y + sin*z, z' = cos*z - sin*y.
 *  Iy = inertia about local y (bending in the x-z plane, depth along z); Iz = about local z (x-y plane).
 *  Element DOFs: [u v w rx ry rz]_i, [u v w rx ry rz]_j (local). Bending in x-z plane uses theta_y = -dw/dx,
 *  in x-y plane theta_z = +dv/dx. Euler-Bernoulli (no shear deformation).
 *
 * INTERNAL-FORCE SIGN CONVENTION (report style, reported at sections, not at nodes):
 *  N  + tension.   Vy, Vz = engineering shear, Vz = dMy/dx, Vy = dMz/dx (gravity SS beam: +wL/2 at i, -wL/2 at j; i.e. +z force
 *      on the -x face / -z force on the +x face of a cut piece).
 *  T  = torque on the +x face, + by right-hand rule about +x.
 *  My, Mz: positive = tension on the NEGATIVE local-axis face (My>0: bottom fibre (-z) in tension, i.e. sagging for
 *      a beam whose z is up; Mz>0: -y face in tension).  Equivalent: My = -(moment vector y on +x face), Mz = +(moment vector z on +x face).
 *  dy, dz = absolute local deflections (v, w, include rigid translation of end i); dyc, dzc = relative to chord i-j.
 *  Curvature relation: dz'' = My/(E Iy), dy'' = Mz/(E Iz).
 *  Reactions: force/moment the support exerts on the structure, GLOBAL axes (+Z up => gravity gives +fz).
 *  Displacements global ux,uy,uz (m), rx,ry,rz (rad).
 *  Envelopes: results.envelopes = all combinations (or all cases if none); results.envelopesByMethod = { SDM:{...}, WSD:{...} } using only
 *  the combinations whose `method` matches (design must use the right one). Warnings are added if a case/combination equilibrium error > 1e-6.
 *  Zero-shear stations are taken from every case and from the COMBINED shear of every combination, so combination peak moments are not
 *  understated between stations; all cases and combinations of a member still share one station x list.
 *  Stations: uniform `options.stations` points + point-load / trap-load ends + zero-shear points. At a point load
 *  two entries share the same x (left limit then right limit).
 *
 * MEMBER LOADS: dir 'GX','GY','GZ' (global) or 'LX','LY','LZ' (local); udl/trap w in kg/m PER UNIT MEMBER LENGTH
 *  (global-direction loads are NOT projected); point P in kg at distance a from i; trap from a to b (default 0..L).
 *  Sign: positive along the +axis of dir (gravity => negative GZ).
 *
 * RIGID DIAPHRAGM: master-slave constraint (not stiff links). Per floor (nodes with |z - zf| <= 1e-3): master = given
 *  node or the first node free in ux,uy,rz; slaves ux = ux_m - (ys-ym) rz_m, uy = uy_m + (xs-xm) rz_m, rz = rz_m.
 *  Slave nodes keep free uz, rx, ry. Nodes restrained in ux/uy/rz are left out of the diaphragm.
 *
 * SOLVER: skyline LDL^T on a reduced-DOF system (restrained DOFs removed by partitioning, constraints by
 *  transformation), nodes renumbered by reverse Cuthill-McKee. Static condensation for end releases.
 *  Rotational DOFs with zero stiffness (e.g. truss joints with all members pinned) are auto-restrained with a warning.
 */
(function (root) {
  const SD = root.SD = root.SD || {};
  if (typeof require === 'function' && typeof module !== 'undefined' && !SD.SolverError) require('./core.js');
  const SolverError = SD.SolverError;

  const DOF = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
  const FKEYS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'];
  const MKEYS = FKEYS.concat(['dy', 'dz', 'dyc', 'dzc']);
  const EPS = 1e-9;
  const err = (en, th, code, details) => new SolverError(en + ' | ' + th, code, details);

  // ------------------------------------------------------------------ geometry
  function memberAxes(a, b, rollDeg) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
    if (!(L > 1e-9)) return null;
    const ex = [dx / L, dy / L, dz / L];
    let ey, ez;
    const hor = Math.hypot(ex[0], ex[1]);
    if (hor > 1e-4) {
      ez = [-ex[2] * ex[0] / hor, -ex[2] * ex[1] / hor, hor];
      ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
    } else {
      ey = [0, 1, 0];
      ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
    }
    if (rollDeg) {
      const r = rollDeg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      const y2 = [0, 1, 2].map(k => c * ey[k] + s * ez[k]);
      const z2 = [0, 1, 2].map(k => c * ez[k] - s * ey[k]);
      ey = y2; ez = z2;
    }
    return { L, R: [ex, ey, ez] };
  }

  function rectJ(b, h) { // St Venant torsion constant for a rectangle
    const a = Math.max(b, h), c = Math.min(b, h);
    return a * Math.pow(c, 3) * (1 / 3 - 0.21 * (c / a) * (1 - Math.pow(c, 4) / (12 * Math.pow(a, 4))));
  }

  function localK(E, G, A, Iy, Iz, J, L) {
    const K = new Float64Array(144);
    const s = (i, j, v) => { K[i * 12 + j] = v; K[j * 12 + i] = v; };
    const L2 = L * L, L3 = L2 * L;
    s(0, 0, E * A / L); s(6, 6, E * A / L); s(0, 6, -E * A / L);
    s(3, 3, G * J / L); s(9, 9, G * J / L); s(3, 9, -G * J / L);
    // x-y plane (v, rz)
    s(1, 1, 12 * E * Iz / L3); s(7, 7, 12 * E * Iz / L3); s(1, 7, -12 * E * Iz / L3);
    s(1, 5, 6 * E * Iz / L2); s(1, 11, 6 * E * Iz / L2); s(5, 7, -6 * E * Iz / L2); s(7, 11, -6 * E * Iz / L2);
    s(5, 5, 4 * E * Iz / L); s(11, 11, 4 * E * Iz / L); s(5, 11, 2 * E * Iz / L);
    // x-z plane (w, ry), theta_y = -dw/dx
    s(2, 2, 12 * E * Iy / L3); s(8, 8, 12 * E * Iy / L3); s(2, 8, -12 * E * Iy / L3);
    s(2, 4, -6 * E * Iy / L2); s(2, 10, -6 * E * Iy / L2); s(4, 8, 6 * E * Iy / L2); s(8, 10, 6 * E * Iy / L2);
    s(4, 4, 4 * E * Iy / L); s(10, 10, 4 * E * Iy / L); s(4, 10, 2 * E * Iy / L);
    return K;
  }

  /** Static condensation of released local DOFs. Returns {Kc, W, KrrInv, Kra, rel, act}. */
  function condense(K, rel) {
    const act = []; for (let i = 0; i < 12; i++) if (rel.indexOf(i) < 0) act.push(i);
    const g = (i, j) => K[i * 12 + j];
    const Krr = rel.map(i => rel.map(j => g(i, j)));
    const Kar = act.map(i => rel.map(j => g(i, j)));
    const Kra = rel.map(i => act.map(j => g(i, j)));
    const KrrInv = SD.mat.inverse(Krr);
    const W = SD.mat.mul(Kar, KrrInv);          // na x nr
    const WK = SD.mat.mul(W, Kra);              // na x na
    const Kc = new Float64Array(144);
    for (let a = 0; a < act.length; a++) for (let b = 0; b < act.length; b++)
      Kc[act[a] * 12 + act[b]] = g(act[a], act[b]) - WK[a][b];
    return { Kc, W, KrrInv, Kra, rel, act };
  }

  /** Kg = T' K T with T = blockdiag(R,R,R,R); R rows are local axes in global coordinates. */
  function toGlobal(K, R) {
    const T = new Float64Array(144);
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[(3 * b + r) * 12 + 3 * b + c] = R[r][c];
    const KT = new Float64Array(144), Kg = new Float64Array(144);
    for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) { const v = K[i * 12 + k]; if (v === 0) continue; for (let j = 0; j < 12; j++) KT[i * 12 + j] += v * T[k * 12 + j]; }
    for (let i = 0; i < 12; i++) for (let k = 0; k < 12; k++) { const t = T[k * 12 + i]; if (t === 0) continue; for (let j = 0; j < 12; j++) Kg[i * 12 + j] += t * KT[k * 12 + j]; }
    return Kg;
  }
  const g2l = (R, v) => { // global 12-vector -> local
    const out = new Array(12);
    for (let b = 0; b < 4; b++) for (let r = 0; r < 3; r++) out[3 * b + r] = R[r][0] * v[3 * b] + R[r][1] * v[3 * b + 1] + R[r][2] * v[3 * b + 2];
    return out;
  };
  const l2g = (R, v) => {
    const out = new Array(12);
    for (let b = 0; b < 4; b++) for (let c = 0; c < 3; c++) out[3 * b + c] = R[0][c] * v[3 * b] + R[1][c] * v[3 * b + 1] + R[2][c] * v[3 * b + 2];
    return out;
  };

  // ------------------------------------------------------------------ member loads
  const GP = [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]]; // 3-pt Gauss on [-1,1]

  function loadPrims(ld, R, L, member) {
    const dir = String(ld.dir || 'GZ').toUpperCase();
    const axis = 'XYZ'.indexOf(dir[1]);
    if (axis < 0 || (dir[0] !== 'G' && dir[0] !== 'L')) throw err('Bad load direction "' + ld.dir + '" on member ' + member, 'ทิศทางน้ำหนักไม่ถูกต้อง', 'BAD_LOAD');
    const comp = dir[0] === 'L' ? [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0] : [R[0][axis], R[1][axis], R[2][axis]];
    const out = [];
    const kind = ld.kind || 'udl';
    for (let c = 0; c < 3; c++) {
      if (Math.abs(comp[c]) < 1e-12) continue;
      if (kind === 'point') {
        const a = ld.a === undefined ? L / 2 : ld.a;
        if (a < -EPS || a > L + EPS) throw err('Point load position a=' + a + ' outside member ' + member + ' (L=' + L.toFixed(3) + ')', 'ตำแหน่งน้ำหนักเกินความยาวชิ้นส่วน', 'BAD_LOAD');
        out.push({ t: 'p', c, P: ld.P * comp[c], a: Math.min(Math.max(a, 0), L) });
      } else if (kind === 'udl' || kind === 'trap') {
        const w1 = kind === 'udl' ? ld.w : ld.w1, w2 = kind === 'udl' ? ld.w : ld.w2;
        const a = kind === 'udl' || ld.a === undefined ? 0 : ld.a, b = kind === 'udl' || ld.b === undefined ? L : ld.b;
        if (a < -EPS || b > L + EPS || b <= a) throw err('Bad load range on member ' + member, 'ช่วงน้ำหนักไม่ถูกต้อง', 'BAD_LOAD');
        out.push({ t: 't', c, w1: w1 * comp[c], w2: w2 * comp[c], a: Math.max(a, 0), b: Math.min(b, L) });
      } else throw err('Unknown member load kind "' + kind + '" on ' + member, 'ชนิดน้ำหนักไม่รู้จัก', 'BAD_LOAD');
    }
    return out;
  }

  function addPointFEF(f, c, P, a, L) { // forces on member by the (fixed) nodes, local
    const b = L - a, L2 = L * L, L3 = L2 * L;
    if (c === 0) { f[0] += -P * b / L; f[6] += -P * a / L; return; }
    const Fi = -P * b * b * (3 * a + b) / L3, Fj = -P * a * a * (a + 3 * b) / L3;
    if (c === 1) { f[1] += Fi; f[7] += Fj; f[5] += -P * a * b * b / L2; f[11] += P * a * a * b / L2; }
    else { f[2] += Fi; f[8] += Fj; f[4] += P * a * b * b / L2; f[10] += -P * a * a * b / L2; }
  }
  function addFEF(f, pr, L) {
    if (pr.t === 'p') return addPointFEF(f, pr.c, pr.P, pr.a, L);
    const h = (pr.b - pr.a) / 2, m = (pr.b + pr.a) / 2;
    for (const [xi, wt] of GP) {
      const s = m + h * xi, w = pr.w1 + (pr.w2 - pr.w1) * (s - pr.a) / (pr.b - pr.a);
      addPointFEF(f, pr.c, w * wt * h, s, L);
    }
  }

  /** Section forces at x from end-i forces Fi (forces on member by node i) and the member loads on [0,x]. side<0 => left limit. */
  function sectionForces(Fi, prims, x, side, out) {
    let F0 = 0, F1 = 0, F2 = 0, M1 = 0, M2 = 0;
    for (let q = 0; q < prims.length; q++) {
      const pr = prims[q]; let F = 0, M = 0;
      if (pr.t === 'p') {
        if (side < 0 ? pr.a < x - EPS : pr.a <= x + EPS) { F = pr.P; M = pr.P * (x - pr.a); }
      } else if (x > pr.a) {
        const k = (pr.w2 - pr.w1) / (pr.b - pr.a);
        if (x <= pr.b) { const t = x - pr.a; F = pr.w1 * t + k * t * t / 2; M = pr.w1 * t * t / 2 + k * t * t * t / 6; }
        else { const tb = pr.b - pr.a; F = pr.w1 * tb + k * tb * tb / 2; M = (x - pr.a) * F - (pr.w1 * tb * tb / 2 + k * tb * tb * tb / 3); }
      }
      if (pr.c === 0) F0 += F; else if (pr.c === 1) { F1 += F; M1 += M; } else { F2 += F; M2 += M; }
    }
    out.N = -(Fi[0] + F0); out.Vy = Fi[1] + F1; out.Vz = Fi[2] + F2; out.T = -Fi[3];
    out.My = Fi[4] + x * Fi[2] + M2;
    out.Mz = -Fi[5] + x * Fi[1] + M1;
    return out;
  }

  // ------------------------------------------------------------------ skyline LDL^T
  function factorSkyline(n, first, rowPtr, a, diag0, onFail) {
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const fi = first[i], ri = rowPtr[i] - fi;
      for (let j = fi; j < i; j++) {
        const fj = first[j], rj = rowPtr[j] - fj;
        let s = a[ri + j];
        for (let k = Math.max(fi, fj); k < j; k++) s -= a[rj + k] * t[k];
        t[j] = s; a[ri + j] = s / a[rj + j];
      }
      let d = a[ri + i];
      for (let j = fi; j < i; j++) d -= t[j] * a[ri + j];
      if (!(d > 1e-9 * diag0[i])) { onFail(i, d); return false; }
      a[ri + i] = d;
    }
    return true;
  }
  function solveSkyline(n, first, rowPtr, a, b) {
    const x = Float64Array.from(b);
    for (let i = 0; i < n; i++) { const fi = first[i], ri = rowPtr[i] - fi; let s = x[i]; for (let k = fi; k < i; k++) s -= a[ri + k] * x[k]; x[i] = s; }
    for (let i = 0; i < n; i++) x[i] /= a[rowPtr[i] - first[i] + i];
    for (let i = n - 1; i >= 0; i--) { const fi = first[i], ri = rowPtr[i] - fi, xi = x[i]; if (xi === 0) continue; for (let k = fi; k < i; k++) x[k] -= a[ri + k] * xi; }
    return x;
  }

  function rcmOrder(nN, adj) {
    const deg = adj.map(s => s.size), seen = new Uint8Array(nN), order = [];
    const idx = Array.from({ length: nN }, (_, i) => i).sort((p, q) => deg[p] - deg[q]);
    for (const s0 of idx) {
      if (seen[s0]) continue;
      seen[s0] = 1; const queue = [s0];
      for (let h = 0; h < queue.length; h++) {
        const v = queue[h]; order.push(v);
        const nb = Array.from(adj[v]).filter(u => !seen[u]).sort((p, q) => deg[p] - deg[q]);
        for (const u of nb) { seen[u] = 1; queue.push(u); }
      }
    }
    return order.reverse();
  }

  // ------------------------------------------------------------------ analyze
  function analyze(model) {
    const warnings = [];
    if (!model || !Array.isArray(model.nodes) || !model.nodes.length) throw err('Model has no nodes', 'โมเดลไม่มีจุดต่อ', 'NO_NODES');
    if (!Array.isArray(model.members) || !model.members.length) throw err('Model has no members', 'โมเดลไม่มีชิ้นส่วน', 'NO_MEMBERS');
    if (!Array.isArray(model.supports) || !model.supports.length) throw err('No supports defined - structure is free-floating (rigid-body mechanism)', 'ไม่มีจุดรองรับ โครงสร้างไม่เสถียร', 'NO_SUPPORTS');
    const opts = model.options || {};
    const nSt = Math.max(2, Math.round(opts.stations || 11));
    const nodes = model.nodes, nN = nodes.length, nodeIdx = {};
    nodes.forEach((n, i) => {
      if (nodeIdx[n.id] !== undefined) throw err('Duplicate node id ' + n.id, 'รหัสจุดต่อซ้ำ ' + n.id, 'DUP_NODE');
      if (![n.x, n.y, n.z].every(Number.isFinite)) throw err('Node ' + n.id + ' has non-numeric coordinates', 'พิกัดจุดต่อไม่ถูกต้อง', 'BAD_NODE');
      nodeIdx[n.id] = i;
    });
    const getNode = (id, ctx) => { const i = nodeIdx[id]; if (i === undefined) throw err('Unknown node "' + id + '" in ' + ctx, 'ไม่พบจุดต่อ ' + id, 'UNKNOWN_NODE'); return i; };

    // ---- members
    const members = [], memIdx = {};
    const connected = new Uint8Array(nN);
    model.members.forEach((m, mi) => {
      if (memIdx[m.id] !== undefined) throw err('Duplicate member id ' + m.id, 'รหัสชิ้นส่วนซ้ำ', 'DUP_MEMBER');
      const iN = getNode(m.i, 'member ' + m.id), jN = getNode(m.j, 'member ' + m.id);
      const sec = (model.sections || {})[m.section], mat = (model.materials || {})[m.material];
      if (!sec) throw err('Member ' + m.id + ': unknown section "' + m.section + '"', 'ไม่พบหน้าตัด', 'UNKNOWN_SECTION');
      if (!mat) throw err('Member ' + m.id + ': unknown material "' + m.material + '"', 'ไม่พบวัสดุ', 'UNKNOWN_MATERIAL');
      const ax = memberAxes(nodes[iN], nodes[jN], m.roll || 0);
      if (!ax) throw err('Member ' + m.id + ' has zero length (nodes ' + m.i + ', ' + m.j + ')', 'ชิ้นส่วนยาวเป็นศูนย์', 'ZERO_LENGTH');
      let A = sec.A, Iy = sec.Iy, Iz = sec.Iz, J = sec.J;
      if (sec.shape === 'rect' && sec.b && sec.h) {
        if (A === undefined) A = sec.b * sec.h;
        if (Iy === undefined) Iy = sec.b * Math.pow(sec.h, 3) / 12;
        if (Iz === undefined) Iz = sec.h * Math.pow(sec.b, 3) / 12;
        if (J === undefined) J = rectJ(sec.b, sec.h);
      }
      if (![A, Iy, Iz, J, mat.E].every(v => Number.isFinite(v) && v > 0)) throw err('Member ' + m.id + ': section/material needs positive A, Iy, Iz, J, E', 'คุณสมบัติหน้าตัด/วัสดุไม่ครบ', 'BAD_SECTION');
      const mod = m.modifiers || {};
      const Am = A * (mod.A === undefined ? 1 : mod.A), Jm = J * (mod.J === undefined ? 1 : mod.J);
      const Iym = Iy * (mod.Iy !== undefined ? mod.Iy : (mod.I === undefined ? 1 : mod.I));
      const Izm = Iz * (mod.Iz !== undefined ? mod.Iz : (mod.I === undefined ? 1 : mod.I));
      const E = mat.E, G = mat.G || E / (2 * (1 + (mat.nu === undefined ? 0.2 : mat.nu)));
      const K = localK(E, G, Am, Iym, Izm, Jm, ax.L);
      const rel = [], r = m.releases || {};
      if (r.i) { if (r.i.t) rel.push(3); if (r.i.my) rel.push(4); if (r.i.mz) rel.push(5); }
      if (r.j) { if (r.j.t) rel.push(9); if (r.j.my) rel.push(10); if (r.j.mz) rel.push(11); }
      if (rel.indexOf(3) >= 0 && rel.indexOf(9) >= 0) { rel.splice(rel.indexOf(9), 1); warnings.push('Member ' + m.id + ': torsion released at both ends - j-end release ignored'); }
      let cond = null, Kuse = K;
      if (rel.length) { try { cond = condense(K, rel); } catch (e) { throw err('Member ' + m.id + ': invalid end-release combination', 'การปลดปลายชิ้นส่วนไม่ถูกต้อง', 'BAD_RELEASE'); } Kuse = cond.Kc; }
      members.push({ id: m.id, iN, jN, L: ax.L, R: ax.R, A, density: mat.density || 0, K: Kuse, Kg: toGlobal(Kuse, ax.R), cond, EIy: E * Iym, EIz: E * Izm });
      memIdx[m.id] = mi; connected[iN] = 1; connected[jN] = 1;
    });

    // ---- supports / springs
    const restrained = new Uint8Array(nN * 6), springK = new Float64Array(nN * 6), isSupportNode = new Uint8Array(nN);
    model.supports.forEach(s => {
      const n = getNode(s.node, 'support');
      DOF.forEach((d, k) => { if (s[d]) restrained[n * 6 + k] = 1; });
      isSupportNode[n] = 1;
    });
    (model.springs || []).forEach(s => {
      const n = getNode(s.node, 'spring'); isSupportNode[n] = 1; connected[n] = 1;
      ['kux', 'kuy', 'kuz', 'krx', 'kry', 'krz'].forEach((k, d) => { springK[n * 6 + d] += s[k] || 0; });
    });
    for (let n = 0; n < nN; n++) if (!connected[n]) { for (let d = 0; d < 6; d++) restrained[n * 6 + d] = 1; warnings.push('Node ' + nodes[n].id + ' is not connected to any member (ignored)'); }
    if (!restrained.some(Boolean) && !springK.some(Boolean)) throw err('No restrained DOFs', 'ไม่มีจุดรองรับ', 'NO_SUPPORTS');

    // ---- rigid diaphragms (master-slave)
    const slaveOf = new Int32Array(nN).fill(-1); // master node index
    const diaphragms = [];
    (opts.rigidDiaphragm || []).forEach(dg => {
      const tol = dg.tol || 1e-3;
      const floor = [];
      for (let n = 0; n < nN; n++) if (connected[n] && Math.abs(nodes[n].z - dg.z) <= tol) floor.push(n);
      const free3 = n => !restrained[n * 6] && !restrained[n * 6 + 1] && !restrained[n * 6 + 5];
      let master = -1;
      if (dg.master !== undefined) { master = getNode(dg.master, 'diaphragm'); if (!free3(master)) { warnings.push('Diaphragm z=' + dg.z + ': given master has restrained DOFs, skipped'); return; } }
      else { const f = floor.find(free3); master = f === undefined ? -1 : f; }
      if (master < 0 || floor.length < 2) { warnings.push('Diaphragm z=' + dg.z + ': fewer than 2 usable nodes, skipped'); return; }
      const slaves = floor.filter(n => n !== master && free3(n) && slaveOf[n] < 0);
      slaves.forEach(n => { slaveOf[n] = master; });
      diaphragms.push({ z: dg.z, master: nodes[master].id, slaves: slaves.length });
    });
    const isSlaveDof = (n, d) => slaveOf[n] >= 0 && (d === 0 || d === 1 || d === 5);

    // ---- zero-stiffness rotations -> auto restraint
    {
      const rd = new Float64Array(nN * 6);
      members.forEach(m => { for (let k = 0; k < 12; k++) { const node = k < 6 ? m.iN : m.jN; rd[node * 6 + (k % 6)] += Math.abs(m.Kg[k * 12 + k]); } });
      let mx = 0; for (let n = 0; n < nN; n++) for (let d = 3; d < 6; d++) mx = Math.max(mx, rd[n * 6 + d]);
      for (let n = 0; n < nN; n++) for (let d = 3; d < 6; d++) {
        if (restrained[n * 6 + d] || isSlaveDof(n, d)) continue;
        if (rd[n * 6 + d] + springK[n * 6 + d] <= 1e-12 * mx) { restrained[n * 6 + d] = 1; warnings.push('Node ' + nodes[n].id + ': rotation ' + DOF[d] + ' has no stiffness (all members pinned) - restrained automatically'); }
      }
    }

    // ---- RCM node order and DOF numbering
    const adj = Array.from({ length: nN }, () => new Set());
    members.forEach(m => { adj[m.iN].add(m.jN); adj[m.jN].add(m.iN); });
    for (let n = 0; n < nN; n++) if (slaveOf[n] >= 0) { adj[n].add(slaveOf[n]); adj[slaveOf[n]].add(n); }
    const order = rcmOrder(nN, adj);
    const dofNo = new Int32Array(nN * 6).fill(-1), owner = [];
    let nFree = 0;
    for (const n of order) for (let d = 0; d < 6; d++) {
      if (restrained[n * 6 + d] || isSlaveDof(n, d)) continue;
      dofNo[n * 6 + d] = nFree++; owner.push([n, d]);
    }
    // terms: full dof -> flat [p,c,p,c...]
    const terms = new Array(nN * 6);
    for (let n = 0; n < nN; n++) for (let d = 0; d < 6; d++) {
      const id = n * 6 + d;
      if (!isSlaveDof(n, d)) { terms[id] = dofNo[id] >= 0 ? [dofNo[id], 1] : []; continue; }
      const m = slaveOf[n], t = [], push = (dd, c) => { const p = dofNo[m * 6 + dd]; if (p >= 0 && c !== 0) t.push(p, c); };
      if (d === 0) { push(0, 1); push(5, -(nodes[n].y - nodes[m].y)); }
      else if (d === 1) { push(1, 1); push(5, nodes[n].x - nodes[m].x); }
      else push(5, 1);
      terms[id] = t;
    }

    // ---- profile + assembly
    const first = new Int32Array(nFree); for (let i = 0; i < nFree; i++) first[i] = i;
    const memDofs = members.map(m => { const a = []; for (let k = 0; k < 12; k++) a.push((k < 6 ? m.iN : m.jN) * 6 + (k % 6)); return a; });
    members.forEach((m, mi) => {
      let mn = Infinity; const ps = [];
      for (const id of memDofs[mi]) { const t = terms[id]; for (let q = 0; q < t.length; q += 2) { ps.push(t[q]); if (t[q] < mn) mn = t[q]; } }
      for (const p of ps) if (mn < first[p]) first[p] = mn;
    });
    const rowPtr = new Int32Array(nFree + 1);
    for (let i = 0; i < nFree; i++) rowPtr[i + 1] = rowPtr[i] + (i - first[i] + 1);
    const KA = new Float64Array(rowPtr[nFree]);
    members.forEach((m, mi) => {
      const ds = memDofs[mi], Kg = m.Kg;
      for (let a = 0; a < 12; a++) {
        const ta = terms[ds[a]]; if (!ta.length) continue;
        for (let b = 0; b < 12; b++) {
          const v = Kg[a * 12 + b]; if (v === 0) continue;
          const tb = terms[ds[b]];
          for (let qa = 0; qa < ta.length; qa += 2) for (let qb = 0; qb < tb.length; qb += 2) {
            const p = ta[qa], q = tb[qb]; if (q > p) continue;
            KA[rowPtr[p] + q - first[p]] += ta[qa + 1] * tb[qb + 1] * v;
          }
        }
      }
    });
    for (let n = 0; n < nN; n++) for (let d = 0; d < 6; d++) { const k = springK[n * 6 + d]; if (k && dofNo[n * 6 + d] >= 0) { const p = dofNo[n * 6 + d]; KA[rowPtr[p] + p - first[p]] += k; } }
    const diag0 = new Float64Array(nFree); for (let i = 0; i < nFree; i++) diag0[i] = KA[rowPtr[i] + i - first[i]];
    let bandMax = 0; for (let i = 0; i < nFree; i++) bandMax = Math.max(bandMax, i - first[i]);
    factorSkyline(nFree, first, rowPtr, KA, diag0, (i) => {
      const [n, d] = owner[i];
      const isM = diaphragms.some(dg => dg.master === nodes[n].id);
      throw err('Structure is unstable (mechanism or missing restraint) near node ' + nodes[n].id + ', DOF ' + DOF[d] + (isM ? ' (diaphragm master)' : '') +
        '. Check supports, member releases and that every part is connected.',
        'โครงสร้างไม่เสถียร (กลไก/ขาดจุดรองรับ) ใกล้จุดต่อ ' + nodes[n].id + ' องศาอิสระ ' + DOF[d] + ' ตรวจสอบจุดรองรับ การปลดปลาย และการเชื่อมต่อ',
        'MECHANISM', { node: nodes[n].id, dof: DOF[d] });
    });

    // ---- load cases
    const cases = {}, caseOrder = [], caseData = {};
    const loadCases = model.loadCases || [];
    const resultant = (R, pr, pa, F, M) => { // accumulate resultant of a primitive about the global origin
      const addF = (amount, s) => {
        const fv = [R[pr.c][0] * amount, R[pr.c][1] * amount, R[pr.c][2] * amount];
        const r = [pa.x + R[0][0] * s, pa.y + R[0][1] * s, pa.z + R[0][2] * s];
        F[0] += fv[0]; F[1] += fv[1]; F[2] += fv[2];
        M[0] += r[1] * fv[2] - r[2] * fv[1]; M[1] += r[2] * fv[0] - r[0] * fv[2]; M[2] += r[0] * fv[1] - r[1] * fv[0];
      };
      if (pr.t === 'p') addF(pr.P, pr.a);
      else { const h = (pr.b - pr.a) / 2, mid = (pr.b + pr.a) / 2; for (const [xi, wt] of GP) { const s = mid + h * xi; addF((pr.w1 + (pr.w2 - pr.w1) * (s - pr.a) / (pr.b - pr.a)) * wt * h, s); } }
    };

    loadCases.forEach(lc => {
      if (caseData[lc.id]) throw err('Duplicate load case id ' + lc.id, 'รหัสกรณีน้ำหนักซ้ำ', 'DUP_CASE');
      const P = new Float64Array(nN * 6), sumF = [0, 0, 0, 0, 0, 0];
      const prims = members.map(() => []);
      (lc.nodal || []).forEach(l => {
        const n = getNode(l.node, 'load case ' + lc.id);
        const v = [l.fx || 0, l.fy || 0, l.fz || 0, l.mx || 0, l.my || 0, l.mz || 0];
        if (!connected[n]) warnings.push('Case ' + lc.id + ': load on unconnected node ' + l.node + ' ignored');
        for (let d = 0; d < 6; d++) P[n * 6 + d] += v[d];
        const nd = nodes[n];
        sumF[0] += v[0]; sumF[1] += v[1]; sumF[2] += v[2];
        sumF[3] += v[3] + nd.y * v[2] - nd.z * v[1]; sumF[4] += v[4] + nd.z * v[0] - nd.x * v[2]; sumF[5] += v[5] + nd.x * v[1] - nd.y * v[0];
      });
      (lc.member || []).forEach(l => {
        const mi = memIdx[l.member]; if (mi === undefined) throw err('Load case ' + lc.id + ' refers to unknown member ' + l.member, 'ไม่พบชิ้นส่วน ' + l.member, 'UNKNOWN_MEMBER');
        prims[mi].push(...loadPrims(l, members[mi].R, members[mi].L, l.member));
      });
      if (lc.selfWeight) members.forEach((m, mi) => { const w = m.A * m.density; if (w) prims[mi].push(...loadPrims({ kind: 'udl', dir: 'GZ', w: -w }, m.R, m.L, m.id)); });
      const b = new Float64Array(nFree);
      const addB = (id, v) => { const t = terms[id]; for (let q = 0; q < t.length; q += 2) b[t[q]] += t[q + 1] * v; };
      for (let id = 0; id < nN * 6; id++) if (P[id]) addB(id, P[id]);
      const f0s = [], fstar = members.map((m, mi) => {
        const f = new Array(12).fill(0);
        const F3 = [0, 0, 0], M3 = [0, 0, 0];
        for (const pr of prims[mi]) { addFEF(f, pr, m.L); resultant(m.R, pr, nodes[m.iN], F3, M3); }
        sumF[0] += F3[0]; sumF[1] += F3[1]; sumF[2] += F3[2]; sumF[3] += M3[0]; sumF[4] += M3[1]; sumF[5] += M3[2];
        f0s.push(f.slice());
        if (m.cond) { const { W, rel, act } = m.cond; const corr = SD.mat.mulVec(W, rel.map(i => f[i])); act.forEach((i, k) => { f[i] -= corr[k]; }); rel.forEach(i => { f[i] = 0; }); }
        return f;
      });
      members.forEach((m, mi) => {
        const fg = l2g(m.R, fstar[mi]);
        for (let k = 0; k < 12; k++) if (fg[k]) addB(memDofs[mi][k], -fg[k]);
      });
      const x = solveSkyline(nFree, first, rowPtr, KA, b);
      const U = new Float64Array(nN * 6);
      for (let id = 0; id < nN * 6; id++) { const t = terms[id]; let s = 0; for (let q = 0; q < t.length; q += 2) s += t[q + 1] * x[t[q]]; U[id] = s; }
      const Rn = new Float64Array(nN * 6), mres = [];
      members.forEach((m, mi) => {
        const ug = []; for (let k = 0; k < 12; k++) ug.push(U[memDofs[mi][k]]);
        const ul = g2l(m.R, ug);
        const F = new Array(12).fill(0);
        for (let a = 0; a < 12; a++) { let s = fstar[mi][a]; for (let c = 0; c < 12; c++) s += m.K[a * 12 + c] * ul[c]; F[a] = s; }
        let ulf = ul;
        if (m.cond) { // recover released rotations: ur = -Krr^-1 (Kra ua + fr)
          const { rel, act, KrrInv, Kra } = m.cond;
          const t1 = SD.mat.mulVec(Kra, act.map(i => ul[i]));
          const ur = SD.mat.mulVec(KrrInv, rel.map((i, k) => t1[k] + f0s[mi][i]));
          ulf = ul.slice(); rel.forEach((i, k) => { ulf[i] = -ur[k]; });
        }
        const Fg = l2g(m.R, F);
        for (let k = 0; k < 6; k++) { Rn[m.iN * 6 + k] += Fg[k]; Rn[m.jN * 6 + k] += Fg[6 + k]; }
        mres.push({ Fi: F.slice(0, 6), ul: ulf });
      });
      const reactions = {}, sumR = [0, 0, 0, 0, 0, 0];
      for (let n = 0; n < nN; n++) {
        if (!isSupportNode[n]) continue;
        const r = []; for (let d = 0; d < 6; d++) r.push(Rn[n * 6 + d] - P[n * 6 + d]);
        reactions[nodes[n].id] = { fx: r[0], fy: r[1], fz: r[2], mx: r[3], my: r[4], mz: r[5] };
        const nd = nodes[n];
        sumR[0] += r[0]; sumR[1] += r[1]; sumR[2] += r[2];
        sumR[3] += r[3] + nd.y * r[2] - nd.z * r[1]; sumR[4] += r[4] + nd.z * r[0] - nd.x * r[2]; sumR[5] += r[5] + nd.x * r[1] - nd.y * r[0];
      }
      const disp = {};
      for (let n = 0; n < nN; n++) disp[nodes[n].id] = { ux: U[n * 6], uy: U[n * 6 + 1], uz: U[n * 6 + 2], rx: U[n * 6 + 3], ry: U[n * 6 + 4], rz: U[n * 6 + 5] };
      caseData[lc.id] = { prims, mres };
      cases[lc.id] = { displacements: disp, reactions, members: {}, equilibrium: eqCheck(sumF, sumR) };
      caseOrder.push(lc.id);
    });

    // ---- member stations (same station list for all cases => combinations are linear sums)
    const cids = caseOrder, tmp = {};
    members.forEach((m, mi) => {
      const L = m.L, list = [];
      for (let k = 0; k < nSt; k++) list.push({ x: L * k / (nSt - 1), side: 0 });
      const jumps = [];
      cids.forEach(cid => caseData[cid].prims[mi].forEach(pr => {
        if (pr.t === 'p') { if (pr.a > EPS && pr.a < L - EPS) jumps.push(pr.a); }
        else [pr.a, pr.b].forEach(x => { if (x > EPS && x < L - EPS) list.push({ x, side: 0 }); });
      }));
      jumps.sort((a, b) => a - b).filter((v, i, ar) => i === 0 || v - ar[i - 1] > 1e-7).forEach(x => {
        for (let k = list.length - 1; k >= 0; k--) if (Math.abs(list[k].x - x) < 1e-7) list.splice(k, 1);
        list.push({ x, side: -1 }, { x, side: 1 });
      });
      const sortList = () => list.sort((a, b) => a.x - b.x || a.side - b.side);
      sortList();
      // zero-shear candidates from every case AND every combination (combined shear), sampled on the initial list;
      // all cases/combos then share the single final station list.
      const roots = [], segs = [];
      for (let k = 0; k + 1 < list.length; k++) if (list[k + 1].x - list[k].x >= 1e-7) segs.push(k);
      const vAt = {};
      cids.forEach(cid => {
        const Fi = caseData[cid].mres[mi].Fi, pr = caseData[cid].prims[mi], rec = { Vz: [], Vy: [] };
        segs.forEach(k => {
          const a = sectionForces(Fi, pr, list[k].x, 1, tmp), v0z = a.Vz, v0y = a.Vy;
          const b = sectionForces(Fi, pr, list[k + 1].x, -1, tmp);
          rec.Vz.push([v0z, b.Vz]); rec.Vy.push([v0y, b.Vy]);
        });
        vAt[cid] = rec;
      });
      const addRoots = (get) => ['Vz', 'Vy'].forEach(key => segs.forEach((k, q) => {
        const [v0, v1] = get(key, q);
        if (v0 * v1 < 0) roots.push(list[k].x + (list[k + 1].x - list[k].x) * v0 / (v0 - v1));
      }));
      cids.forEach(cid => addRoots((key, q) => vAt[cid][key][q]));
      (model.combinations || []).forEach(cb => {
        const fs = Object.keys(cb.factors || {}).filter(c => vAt[c]);
        addRoots((key, q) => { let v0 = 0, v1 = 0; fs.forEach(c => { v0 += cb.factors[c] * vAt[c][key][q][0]; v1 += cb.factors[c] * vAt[c][key][q][1]; }); return [v0, v1]; });
      });
      roots.forEach(x => { if (!list.some(s => Math.abs(s.x - x) < 1e-6)) list.push({ x, side: 0 }); });
      sortList();
      const xs = list;
      cids.forEach(cid => {
        const { Fi, ul } = caseData[cid].mres[mi], pr = caseData[cid].prims[mi];
        const st = xs.map(s => { const o = { x: s.x }; sectionForces(Fi, pr, s.x, s.side, o); return o; });
        // deflection by double integration of curvature (Simpson) from end i
        let w = ul[2], vv = ul[1], sw = -ul[4], sv = ul[5];
        const kz = x => sectionForces(Fi, pr, x, 1, tmp).My / m.EIy, ky = x => sectionForces(Fi, pr, x, 1, tmp).Mz / m.EIz;
        st[0].dz = w; st[0].dy = vv;
        for (let k = 0; k + 1 < xs.length; k++) {
          const x0 = xs[k].x, x1 = xs[k + 1].x, H = x1 - x0;
          if (H < 1e-9) { st[k + 1].dz = w; st[k + 1].dy = vv; continue; }
          for (let q = 0; q < 2; q++) {
            const a = x0 + H * q / 2, h = H / 2, mid = a + h / 2, bb = a + h;
            const z0 = kz(a), zm = kz(mid), z1 = kz(bb), y0 = ky(a), ym = ky(mid), y1 = ky(bb);
            w += h * sw + h * h / 6 * (z0 + 2 * zm); sw += h / 6 * (z0 + 4 * zm + z1);
            vv += h * sv + h * h / 6 * (y0 + 2 * ym); sv += h / 6 * (y0 + 4 * ym + y1);
          }
          st[k + 1].dz = w; st[k + 1].dy = vv;
        }
        const zi = ul[2], zj = ul[8], yi = ul[1], yj = ul[7];
        st.forEach(s => { s.dzc = s.dz - (zi + (zj - zi) * s.x / L); s.dyc = s.dy - (yi + (yj - yi) * s.x / L); });
        cases[cid].members[m.id] = finishMember(st);
      });
    });

    // ---- combinations
    const combMeta = [];
    (model.combinations || []).forEach(cb => {
      const f = cb.factors || {};
      Object.keys(f).forEach(k => { if (!cases[k] || !caseData[k]) throw err('Combination ' + cb.id + ' refers to unknown load case "' + k + '"', 'ชุดน้ำหนัก ' + cb.id + ' อ้างถึงกรณีน้ำหนักที่ไม่มี', 'UNKNOWN_CASE'); });
      cases[cb.id] = combine(Object.keys(f).map(k => [f[k], cases[k]]), members);
      combMeta.push({ id: cb.id, name: cb.name, method: cb.method, set: cb.set, allowIncrease: cb.allowIncrease, factors: f });
    });

    // ---- envelopes (over combinations; over cases if there are none) + per-method envelopes
    const buildEnv = (envIds) => {
      const env = {};
      members.forEach(m => {
        const e = env[m.id] = {};
        MKEYS.forEach(k => {
          const o = { min: Infinity, max: -Infinity, comboMin: null, comboMax: null, xMin: 0, xMax: 0 };
          envIds.forEach(id => { const mx = cases[id].members[m.id].max[k]; if (mx.min < o.min) { o.min = mx.min; o.comboMin = id; o.xMin = mx.xMin; } if (mx.max > o.max) { o.max = mx.max; o.comboMax = id; o.xMax = mx.xMax; } });
          e[k] = o;
        });
      });
      return env;
    };
    const envelopes = buildEnv(combMeta.length ? combMeta.map(c => c.id) : cids);
    const envelopesByMethod = {};
    combMeta.forEach(c => { const k = c.method || 'UNSPECIFIED'; (envelopesByMethod[k] = envelopesByMethod[k] || []).push(c.id); });
    Object.keys(envelopesByMethod).forEach(k => { envelopesByMethod[k] = buildEnv(envelopesByMethod[k]); });
    Object.keys(cases).forEach(id => { if (cases[id].equilibrium.error > 1e-6) warnings.push('Global equilibrium error ' + cases[id].equilibrium.error.toExponential(2) + ' in "' + id + '" exceeds 1e-6 - check model (constraints, releases, load definitions)'); });

    return { ok: true, warnings, dofCount: nFree, halfBandwidth: bandMax + 1, diaphragms, combinations: combMeta, cases, envelopes, envelopesByMethod };
  }

  function eqCheck(sumF, sumR) {
    let sc = 1; sumF.forEach(v => { sc = Math.max(sc, Math.abs(v)); });
    let e = 0; for (let i = 0; i < 6; i++) e = Math.max(e, Math.abs(sumF[i] + sumR[i]));
    return { sumF: sumF.slice(), sumR: sumR.slice(), absError: e, error: e / sc };
  }

  function finishMember(st) {
    const max = {};
    MKEYS.forEach(k => {
      const o = { min: Infinity, max: -Infinity, xMin: 0, xMax: 0 };
      st.forEach(s => { if (s[k] < o.min) { o.min = s[k]; o.xMin = s.x; } if (s[k] > o.max) { o.max = s[k]; o.xMax = s.x; } });
      max[k] = o;
    });
    const pick = s => ({ N: s.N, Vy: s.Vy, Vz: s.Vz, T: s.T, My: s.My, Mz: s.Mz });
    return { endForces: { i: pick(st[0]), j: pick(st[st.length - 1]) }, stations: st, max };
  }

  function combine(list, members) {
    const out = { displacements: {}, reactions: {}, members: {}, equilibrium: null };
    const first = list[0] ? list[0][1] : null;
    if (!first) throw err('Empty combination', 'ชุดน้ำหนักว่าง', 'EMPTY_COMBO');
    Object.keys(first.displacements).forEach(id => {
      const o = { ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 };
      list.forEach(([f, c]) => { const d = c.displacements[id]; for (const k in o) o[k] += f * d[k]; });
      out.displacements[id] = o;
    });
    Object.keys(first.reactions).forEach(id => {
      const o = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
      list.forEach(([f, c]) => { const d = c.reactions[id]; for (const k in o) o[k] += f * d[k]; });
      out.reactions[id] = o;
    });
    members.forEach(m => {
      const n = first.members[m.id].stations.length, st = new Array(n);
      for (let s = 0; s < n; s++) {
        const o = { x: first.members[m.id].stations[s].x };
        MKEYS.forEach(k => { let v = 0; for (let q = 0; q < list.length; q++) v += list[q][0] * list[q][1].members[m.id].stations[s][k]; o[k] = v; });
        st[s] = o;
      }
      out.members[m.id] = finishMember(st);
    });
    const sF = [0, 0, 0, 0, 0, 0], sR = [0, 0, 0, 0, 0, 0];
    list.forEach(([f, c]) => { for (let i = 0; i < 6; i++) { sF[i] += f * c.equilibrium.sumF[i]; sR[i] += f * c.equilibrium.sumR[i]; } });
    out.equilibrium = eqCheck(sF, sR);
    return out;
  }

  SD.solver = { analyze, memberAxes, rectJ, version: '1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = SD.solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
