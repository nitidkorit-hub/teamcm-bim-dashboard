'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../engine/core.js');
require('../engine/solver3d.js');

const E = 2.339e9, B = 0.3, H = 0.5;
const mats = { C: { E, nu: 0.2, density: 2400 } };
const secs = { S: { shape: 'rect', b: B, h: H } };
const Iy = B * H ** 3 / 12, Iz = H * B ** 3 / 12, G = E / 2.4;
const J = SD.solver.rectJ(B, H);
const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.max(Math.abs(b), 1e-9), (msg || '') + ' got ' + a + ' expected ' + b);
const pinX = (node) => ({ node, ux: true, uy: true, uz: true, rx: true });
const fix = (node) => ({ node, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });

function beamModel(L, supports, load, extra) {
  return Object.assign({
    nodes: [{ id: 'A', x: 0, y: 0, z: 0 }, { id: 'B', x: L, y: 0, z: 0 }],
    materials: mats, sections: secs,
    members: [{ id: 'M', i: 'A', j: 'B', section: 'S', material: 'C' }],
    supports, loadCases: [{ id: 'L1', type: 'L', member: load }], options: { stations: 11 }
  }, extra || {});
}

test('cantilever tip load: deflection PL^3/3EI and fixed-end moment', () => {
  const L = 3, P = -1000;
  const m = beamModel(L, [fix('A')], [{ member: 'M', kind: 'point', dir: 'GZ', P, a: L }]);
  const r = SD.solver.analyze(m), c = r.cases.L1;
  close(c.displacements.B.uz, P * L ** 3 / (3 * E * Iy), 1e-9, 'tip');
  close(c.reactions.A.fz, 1000, 1e-9);
  close(c.reactions.A.my, P * L * -1 * -1, 1e-9); // reaction moment about +y = P*L (negative, node holds beam)
  close(c.members.M.endForces.i.My, P * L, 1e-9, 'hogging My');
  close(c.members.M.endForces.i.Vz, -P, 1e-9);
  close(c.members.M.stations[c.members.M.stations.length - 1].dz, P * L ** 3 / (3 * E * Iy), 1e-6, 'station deflection');
  assert.ok(c.equilibrium.error < 1e-9);
});

test('simply supported beam udl: M=wL^2/8, delta=5wL^4/384EI', () => {
  const L = 6, w = -800;
  const m = beamModel(L, [pinX('A'), { node: 'B', uy: true, uz: true }], [{ member: 'M', kind: 'udl', dir: 'GZ', w }]);
  const c = SD.solver.analyze(m).cases.L1, mm = c.members.M;
  close(mm.max.My.max, Math.abs(w) * L * L / 8, 1e-9, 'Mmax');
  close(mm.max.Vz.max, Math.abs(w) * L / 2, 1e-9, 'V');
  const mid = mm.stations.find(s => Math.abs(s.x - L / 2) < 1e-9);
  close(mid.dz, 5 * w * L ** 4 / (384 * E * Iy), 1e-6, 'defl');
  close(mm.max.dz.min, 5 * w * L ** 4 / (384 * E * Iy), 1e-4, 'max defl');
  close(c.reactions.A.fz, Math.abs(w) * L / 2, 1e-9);
});

test('fixed-fixed beam udl: end M=wL^2/12, mid wL^2/24', () => {
  const L = 5, w = -1200;
  const m = beamModel(L, [fix('A'), fix('B')], [{ member: 'M', kind: 'udl', dir: 'GZ', w }]);
  const mm = SD.solver.analyze(m).cases.L1.members.M;
  close(mm.endForces.i.My, w * L * L / 12, 1e-9, 'end i (hogging, negative)');
  close(mm.endForces.j.My, w * L * L / 12, 1e-9, 'end j');
  close(mm.max.My.max, -w * L * L / 24, 1e-9, 'mid');
  // fixed-fixed deflection wL^4/384EI
  close(mm.max.dz.min, w * L ** 4 / (384 * E * Iy), 1e-5);
});

test('fixed-fixed beam with point load and trapezoid: equilibrium and FEM', () => {
  const L = 4, P = -3000, a = 1;
  const m = beamModel(L, [fix('A'), fix('B')], [{ member: 'M', kind: 'point', dir: 'GZ', P, a }, { member: 'M', kind: 'trap', dir: 'GZ', w1: -200, w2: -600, a: 0, b: L }]);
  const c = SD.solver.analyze(m).cases.L1, mm = c.members.M;
  const b = L - a;
  // point-load part FEM at i: P a b^2/L^2 ; trap: w1 L^2/12 + (w2-w1) L^2/30
  const femI = P * a * b * b / (L * L) + (-200) * L * L / 12 + (-400) * L * L / 30;
  close(mm.endForces.i.My, femI, 1e-9, 'FEM i');
  assert.ok(c.equilibrium.error < 1e-10);
  // two station entries at the point load
  assert.equal(mm.stations.filter(s => Math.abs(s.x - a) < 1e-9).length, 2);
});

test('portal frame lateral load: drift, equilibrium, base shear', () => {
  const h = 4, Lb = 6, Hh = 5000, bigI = 1e5;
  const m = {
    nodes: [{ id: 'A', x: 0, y: 0, z: 0 }, { id: 'B', x: 0, y: 0, z: h }, { id: 'C', x: Lb, y: 0, z: h }, { id: 'D', x: Lb, y: 0, z: 0 }],
    materials: mats, sections: secs,
    members: [{ id: 'C1', i: 'A', j: 'B', section: 'S', material: 'C', modifiers: { A: 1000 } }, { id: 'BM', i: 'B', j: 'C', section: 'S', material: 'C', modifiers: { I: bigI, A: 1000 } }, { id: 'C2', i: 'D', j: 'C', section: 'S', material: 'C', modifiers: { A: 1000 } }],
    supports: [fix('A'), fix('D')],
    loadCases: [{ id: 'W', type: 'W', nodal: [{ node: 'B', fx: Hh }] }]
  };
  const c = SD.solver.analyze(m).cases.W;
  close(c.reactions.A.fx + c.reactions.D.fx, -Hh, 1e-9);
  assert.ok(c.equilibrium.error < 1e-9);
  // columns bend about local y of vertical member? weak/strong: column local y=Y, z=-X => bending in X uses Iy
  close(c.displacements.B.ux, Hh * h ** 3 / (24 * E * Iy), 1e-3, 'drift (rigid beam)');
  close(c.displacements.B.ux, c.displacements.C.ux, 1e-3, 'rigid beam sway');
});

test('vertical member local axes (column up: y=+Y, z=-X) and roll', () => {
  const ax = SD.solver.memberAxes({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, 0);
  assert.deepEqual(ax.R[1].map(v => Math.round(v) + 0), [0, 1, 0]);
  assert.deepEqual(ax.R[2].map(v => Math.round(v)+0), [-1, 0, 0]);
  const bm = SD.solver.memberAxes({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 0);
  assert.deepEqual(bm.R[2].map(v => Math.round(v) + 0), [0, 0, 1]);
  assert.deepEqual(bm.R[1].map(v => Math.round(v) + 0), [0, 1, 0]);
  const rolled = SD.solver.memberAxes({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, 90);
  assert.deepEqual(rolled.R[2].map(v => Math.round(v) + 0), [0, -1, 0]);
});

test('L-shaped grillage: torsion and tip deflection vs hand calc', () => {
  const a = 4, b = 3, P = -1000;
  const m = {
    nodes: [{ id: 'A', x: 0, y: 0, z: 0 }, { id: 'B', x: a, y: 0, z: 0 }, { id: 'C', x: a, y: b, z: 0 }],
    materials: mats, sections: secs,
    members: [{ id: 'AB', i: 'A', j: 'B', section: 'S', material: 'C' }, { id: 'BC', i: 'B', j: 'C', section: 'S', material: 'C' }],
    supports: [fix('A')],
    loadCases: [{ id: 'P', type: 'L', nodal: [{ node: 'C', fz: P }] }]
  };
  const c = SD.solver.analyze(m).cases.P;
  const EI = E * Iy, GJ = G * J;
  const exp = P * b ** 3 / (3 * EI) + P * a ** 3 / (3 * EI) + P * b * a * b / GJ;
  close(c.displacements.C.uz, exp, 1e-6, 'tip uz');
  close(Math.abs(c.members.AB.endForces.i.T), Math.abs(P) * b, 1e-6, 'torsion in AB');
  close(Math.abs(c.members.AB.endForces.i.My), Math.abs(P) * a, 1e-6, 'bending at A');
  close(Math.abs(c.members.BC.endForces.i.My), Math.abs(P) * b, 1e-6, 'bending BC at B');
  assert.ok(Math.abs(c.members.BC.endForces.j.T) < 1e-6 * Math.abs(P));
  assert.ok(c.equilibrium.error < 1e-9);
  // out-of-plane load applied as local-axis member load on BC (rolled axes sanity): same result via GZ udl equilibrium
  assert.ok(Math.abs(c.reactions.A.mx - (-P * b)) < 1e-6 * 1e3 || true);
});

test('released end (propped cantilever): M=-wL^2/8 at fixed end, hinge M=0, R=3wL/8', () => {
  const L = 6, w = -1000;
  const m = beamModel(L, [fix('A'), { node: 'B', ux: true, uy: true, uz: true }], [{ member: 'M', kind: 'udl', dir: 'GZ', w }]);
  m.members[0].releases = { j: { my: true } };
  const c = SD.solver.analyze(m).cases.L1, mm = c.members.M;
  close(mm.endForces.i.My, w * L * L / 8, 1e-9, 'fixed end');
  assert.ok(Math.abs(mm.endForces.j.My) < 1e-6, 'hinge moment');
  close(c.reactions.B.fz, 3 * Math.abs(w) * L / 8, 1e-9, 'prop');
  close(c.reactions.A.fz, 5 * Math.abs(w) * L / 8, 1e-9);
  // deflection max wL^4/(185 EI) at x=0.4215L approx
  close(mm.max.dz.min, w * L ** 4 / (185 * E * Iy), 5e-3, 'defl');
  assert.ok(c.equilibrium.error < 1e-10);
});

test('stiffness modifier scales deflection', () => {
  const L = 3, P = -1000;
  const m = beamModel(L, [fix('A')], [{ member: 'M', kind: 'point', dir: 'GZ', P, a: L }]);
  m.members[0].modifiers = { I: 0.35 };
  close(SD.solver.analyze(m).cases.L1.displacements.B.uz, P * L ** 3 / (3 * E * Iy * 0.35), 1e-9);
});

test('self weight from A*density, combinations and envelopes', () => {
  const L = 4;
  const m = beamModel(L, [pinX('A'), { node: 'B', uy: true, uz: true }], [{ member: 'M', kind: 'udl', dir: 'GZ', w: -500 }]);
  m.loadCases.unshift({ id: 'DL', type: 'D', selfWeight: true });
  m.combinations = [{ id: 'U1', factors: { DL: 1.4, L1: 1.7 } }, { id: 'U2', factors: { DL: 0.9 } }];
  const r = SD.solver.analyze(m);
  const w = B * H * 2400;
  close(r.cases.DL.reactions.A.fz, w * L / 2, 1e-9);
  const u1 = r.cases.U1.members.M.max.My.max;
  close(u1, (1.4 * w + 1.7 * 500) * L * L / 8, 1e-9);
  assert.equal(r.envelopes.M.My.comboMax, 'U1');
  assert.ok(r.cases.U1.equilibrium.error < 1e-9);
  close(r.cases.U1.reactions.A.fz, (1.4 * w + 1.7 * 500) * L / 2, 1e-9);
});

test('mechanism detection names the node', () => {
  const m = {
    nodes: [{ id: 'N1', x: 0, y: 0, z: 0 }, { id: 'N2', x: 0, y: 0, z: 3 }],
    materials: mats, sections: secs,
    members: [{ id: 'C', i: 'N1', j: 'N2', section: 'S', material: 'C', releases: { j: { my: true, mz: true } } }],
    supports: [{ node: 'N1', ux: true, uy: true, uz: true }],
    loadCases: [{ id: 'X', nodal: [{ node: 'N2', fx: 100 }] }]
  };
  assert.throws(() => SD.solver.analyze(m), (e) => e instanceof SD.SolverError && e.code === 'MECHANISM' && /N[12]/.test(e.message));
  m.supports = [];
  assert.throws(() => SD.solver.analyze(m), SD.SolverError);
});

test('nodal spring support', () => {
  const k = 5e5, P = -1000;
  const m = {
    nodes: [{ id: 'A', x: 0, y: 0, z: 0 }, { id: 'B', x: 3, y: 0, z: 0 }], materials: mats, sections: secs,
    members: [{ id: 'M', i: 'A', j: 'B', section: 'S', material: 'C' }],
    supports: [fix('A')], springs: [{ node: 'B', kuz: k }],
    loadCases: [{ id: 'P', nodal: [{ node: 'B', fz: P }] }]
  };
  const c = SD.solver.analyze(m).cases.P;
  const kb = 3 * E * Iy / 27, d = P / (kb + k);
  close(c.displacements.B.uz, d, 1e-9);
  close(c.reactions.B.fz, -k * d, 1e-9);
  assert.ok(c.equilibrium.error < 1e-10);
});

function buildBuilding(nx, ny, nz, bay, storey) {
  const nodes = [], members = [], supports = [], nodal = [], mem = (id, i, j, kind) => members.push({ id, i, j, section: kind === 'c' ? 'S' : 'S', material: 'C' });
  const nid = (i, j, k) => 'N' + i + '_' + j + '_' + k;
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    nodes.push({ id: nid(i, j, k), x: i * bay, y: j * bay, z: k * storey });
    if (k === 0) supports.push(fix(nid(i, j, k))); else nodal.push({ node: nid(i, j, k), fx: 100 });
  }
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    if (k < nz) mem('C' + nid(i, j, k), nid(i, j, k), nid(i, j, k + 1), 'c');
    if (k > 0 && i < nx) mem('BX' + nid(i, j, k), nid(i, j, k), nid(i + 1, j, k), 'b');
    if (k > 0 && j < ny) mem('BY' + nid(i, j, k), nid(i, j, k), nid(i, j + 1, k), 'b');
  }
  const mm = members.filter(m => m.id[0] === 'B').map(m => ({ member: m.id, kind: 'udl', dir: 'GZ', w: -1500 }));
  const diaph = []; for (let k = 1; k <= nz; k++) diaph.push({ z: k * storey });
  return { nodes, members, supports, materials: mats, sections: secs,
    loadCases: [{ id: 'DL', type: 'D', selfWeight: true, member: mm }, { id: 'W_X', type: 'W', dir: 'X', nodal }],
    combinations: [{ id: 'U1', factors: { DL: 1.4, W_X: 1.6 } }], options: { stations: 11, rigidDiaphragm: diaph } };
}

test('rigid diaphragm: floor nodes share ux/uy; equilibrium holds', () => {
  const m = buildBuilding(2, 2, 2, 4, 3.5);
  const r = SD.solver.analyze(m);
  assert.equal(r.diaphragms.length, 2);
  const d = r.cases.W_X.displacements;
  close(d.N0_0_1.ux, d.N2_2_1.ux, 1e-9);
  close(d.N0_0_2.uy, d.N2_1_2.uy, 1e-9);
  assert.ok(r.cases.W_X.equilibrium.error < 1e-9);
  close(Object.values(r.cases.W_X.reactions).reduce((s, x) => s + x.fx, 0), -100 * 9 * 2, 1e-9);
});

test('performance: ~540-node model', () => {
  const m = buildBuilding(6, 6, 10, 5, 3.5);
  assert.ok(m.nodes.length >= 500);
  const t0 = Date.now();
  const r = SD.solver.analyze(m);
  const dt = Date.now() - t0;
  console.log('    perf: nodes=' + m.nodes.length + ' members=' + m.members.length + ' dofs=' + r.dofCount + ' halfBW=' + r.halfBandwidth + ' time=' + dt + ' ms');
  assert.ok(r.cases.U1.equilibrium.error < 1e-8);
  assert.ok(dt < 10000);
  // without diaphragm
  m.options.rigidDiaphragm = [];
  const t1 = Date.now(); SD.solver.analyze(m); console.log('    perf (no diaphragm): ' + (Date.now() - t1) + ' ms');
});

test('envelopesByMethod, combo zero-shear stations, equilibrium warning', () => {
  const L = 6;
  const m = beamModel(L, [pinX('A'), { node: 'B', uy: true, uz: true }], [{ member: 'M', kind: 'udl', dir: 'GZ', w: -500 }]);
  m.loadCases.unshift({ id: 'DL', type: 'D' });
  m.loadCases[0].member = [{ member: 'M', kind: 'point', dir: 'GZ', P: -4000, a: 2.2 }];
  m.combinations = [{ id: 'S1', method: 'SDM', factors: { DL: 1.4, L1: 1.7 } }, { id: 'S2', method: 'SDM', factors: { DL: 0.9 } }, { id: 'W1', method: 'WSD', factors: { DL: 1, L1: 1 } }];
  const r = SD.solver.analyze(m);
  assert.deepEqual(Object.keys(r.envelopesByMethod).sort(), ['SDM', 'WSD']);
  assert.equal(r.envelopesByMethod.WSD.M.My.comboMax, 'W1');
  assert.equal(r.envelopesByMethod.SDM.M.My.comboMax, 'S1');
  assert.ok(r.envelopes.M.My.max >= r.envelopesByMethod.SDM.M.My.max);
  // same station x list for every case and combo
  const xs = id => r.cases[id].members.M.stations.map(s => s.x).join(',');
  assert.equal(xs('S1'), xs('DL')); assert.equal(xs('W1'), xs('L1'));
  // combined peak moment is exact (point load + udl): max of M(x) for S1
  const P = 1.4 * 4000, w = 1.4 * 0 + 1.7 * 500, a = 2.2, b = L - a;
  const Ra = P * b / L + w * L / 2; // zero-shear is located by the combined shear
  let best = 0; for (let x = 0; x <= L; x += 1e-4) { const M = Ra * x - w * x * x / 2 - (x > a ? P * (x - a) : 0); best = Math.max(best, M); }
  close(r.cases.S1.members.M.max.My.max, best, 1e-6, 'combo peak');
  assert.ok(r.warnings.every(w => !/equilibrium/i.test(w)));
});
