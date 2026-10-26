'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../engine/core.js');
require('../engine/data/materials.js');
require('../engine/data/provinces.js');
require('../engine/data/codes.js');
require('../engine/loads.js');
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, (m || '') + ' got ' + a + ' expected ' + b);

const cases = [{ id: 'DL', type: 'D' }, { id: 'SDL', type: 'SD' }, { id: 'LL', type: 'L' },
  { id: 'W_X', type: 'W', dir: 'X' }, { id: 'W_Y', type: 'W', dir: 'Y' }, { id: 'E_X', type: 'E', dir: 'X' }, { id: 'E_Y', type: 'E', dir: 'Y' }];

test('wind: V50=25, Iw=1, H=30, open, Cg=2, Cp=1.3 -> Ce 1.246, p ~ 129 kg/m2', () => {
  const r = SD.loads.wind.static({ V50: 25, Iw: 1, terrain: 'open', H: 30, D: 20, Cg: 2, Cp: 1.3, fn: 1.5 });
  near(r.q, 39.82, 0.01, 'q'); near(r.Ce, 1.2457, 1e-3, 'Ce'); near(r.p, 129, 0.6, 'p');
  assert.equal(r.applicable, true); assert.ok(r.steps.length >= 4 && r.steps[0].formula);
  assert.equal(SD.loads.wind.static({ V50: 25, H: 90, D: 20, Cp: 1.3, terrain: 'open' }).applicable, false);
  assert.equal(SD.loads.wind.static({ V50: 25, H: 70, D: 20, Cp: 1.3, terrain: 'open' }).applicable, false); // H/D >= 3
  near(SD.loads.wind.dynamicPressure(27), 46.4, 0.2); near(SD.loads.wind.dynamicPressure(31), 61.2, 0.1);
});

test('wind: rough Ce lower bound and story forces', () => {
  near(SD.loads.wind.Ce('rough', 3), 0.7, 1e-12);
  const f = SD.loads.wind.storyForces({ V50: 25, terrain: 'open', H: 7, D: 14, Cg: 2, Cp: 1.3 }, [{ z: 3.5, width: 12 }, { z: 7, width: 12 }]);
  assert.equal(f.length, 2); near(f.baseShear, f[0].F + f[1].F, 1e-6);
  assert.ok(f[1].F > 0 && f[0].Mt > 0 && f.steps.length === 3);
});

test('MR2566 simplified wind pressure table', () => {
  assert.equal(SD.loads.wind.mr2566Simple({ H: 8, terrain: 'city', B: 20 }).p, 60);
  assert.equal(SD.loads.wind.mr2566Simple({ H: 15, terrain: 'city', B: 20 }).p, 80);
  assert.equal(SD.loads.wind.mr2566Simple({ H: 35, terrain: 'city', B: 20 }).p, 120);
  assert.equal(SD.loads.wind.mr2566Simple({ H: 35, terrain: 'open', B: 20 }).p, 160);
  near(SD.loads.wind.mr2566Simple({ H: 15, terrain: 'open', publicLarge: true, B: 20 }).p, 138, 1e-9);
  assert.equal(SD.loads.wind.mr2566Simple({ H: 45, terrain: 'city', B: 20 }).applicable, false);
  assert.equal(SD.loads.wind.mr2566Simple({ H: 30, terrain: 'city', B: 8 }).applicable, false); // H > 3B
});

test('seismic ELF: Cs formula, upper bound, lower bound', () => {
  const st = (n, h, w) => Array.from({ length: n }, (_, i) => ({ h: (i + 1) * h, w }));
  const a = SD.loads.seismic.elf({ Ss: 0.5, S1: 0.2, site: 'D', Ie: 1, system: 'RC_SMF', hn: 10.5, storeys: st(3, 3.5, 100000) });
  near(a.SDS, 2 / 3 * 1.4 * 0.5, 1e-9); near(a.SD1, 2 / 3 * 2.0 * 0.2, 1e-9);
  near(a.Ta, 0.0466 * Math.pow(10.5, 0.9), 1e-9);
  near(a.Cs, a.SDS / 8, 1e-9, 'Cs plateau');
  near(a.V, a.Cs * 300000, 1e-6); near(a.forces.reduce((s, f) => s + f.F, 0), a.V, 1e-6);
  assert.ok(a.forces[2].F > a.forces[0].F);
  const b = SD.loads.seismic.elf({ Ss: 0.5, S1: 0.2, site: 'D', Ie: 1, system: 'RC_SMF', hn: 30, storeys: st(10, 3, 100000) });
  near(b.Cs, b.SD1 / (b.T * 8), 1e-9, 'Cs descending branch'); assert.ok(b.Cs < b.SDS / 8);
  const c = SD.loads.seismic.elf({ Ss: 0.1, S1: 0.05, site: 'D', Ie: 1, system: 'RC_SMF', hn: 40, storeys: st(10, 4, 100000) });
  near(c.Cs, 0.01, 1e-12, 'Cs lower bound');
  const d = SD.loads.seismic.elf({ Ss: 0.5, S1: 0.2, site: 'D', system: 'RC_SMF', hn: 30, Tcalc: 5, storeys: st(10, 3, 1e5) });
  near(d.T, d.Cu * d.Ta, 1e-9); assert.ok(d.Cu > 1.4 && d.Cu < 1.5);
  assert.ok(d.warnings.some(w => /NOT verified/i.test(w)));
  assert.equal(a.SDC, 'D');
  assert.throws(() => SD.loads.seismic.elf({ Ss: 0.5, S1: 0.2, site: 'F', system: 'RC_SMF', hn: 10, storeys: st(1, 3, 1) }), SD.SolverError);
  const dr = SD.loads.seismic.drift({ deltaE: 0.004, Cd: 5.5, Ie: 1, hsx: 3.5 });
  near(dr.delta, 0.022, 1e-12); near(dr.allow, 0.07, 1e-12); assert.equal(dr.ok, true);
});

test('Fa/Fv interpolation', () => {
  near(SD.loads.seismic.Fa('D', 0.375), 1.5, 1e-12); near(SD.loads.seismic.Fv('C', 0.15), 1.65, 1e-12);
  near(SD.loads.seismic.Fa('B', 2), 1.0, 1e-12);
});

test('combination counts: all types present', () => {
  const n = (s, m) => SD.loads.combos(s, m, { cases }).length;
  assert.equal(n('MR2566', 'SDM'), 1 + 4 * 4);
  assert.equal(n('MR2566', 'WSD'), 1 + 4 * 5);
  assert.equal(n('MR6_2527', 'SDM'), 1 + 4 * 2);
  assert.equal(n('MR6_2527', 'WSD'), 1 + 4);
  assert.equal(n('ACI318', 'SDM'), 2 + 4 * 4);
});

test('combination content and skipping of absent types', () => {
  const c = SD.loads.combos('MR2566', 'SDM', { cases });
  assert.deepEqual(c[0].factors, { DL: 1.4, SDL: 1.4, LL: 1.7 });
  const w = c.find(x => x.lateral && x.lateral.type === 'W' && x.lateral.dir === 'X' && x.lateral.sign === -1 && /0\.75/.test(x.name));
  near(w.factors.DL, 1.05, 1e-12); near(w.factors.LL, 1.275, 1e-12); near(w.factors.W_X, -1.6, 1e-12); assert.equal(w.factors.W_Y, undefined);
  assert.equal(new Set(c.map(x => x.id)).size, c.length);
  const g = SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }, { id: 'L', type: 'L' }] });
  assert.equal(g.length, 1);
  const h = SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }, { id: 'L', type: 'L' }, { id: 'H', type: 'H' }] });
  assert.deepEqual(h.map(x => x.name), ['1.4D+1.7L', '1.4D+1.7L+1.7H', '0.9D+1.7H']);
  const inf = SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }, { id: 'Wind_X', type: 'W' }] });
  assert.equal(inf.length, 5); // D-only gravity version + 4 wind combos (L dropped)
  assert.throws(() => SD.loads.combos('Legacy', 'SDM', { cases }), SD.SolverError);
});

test('WSD: 1.33 increase default off, on only for W/E combos without 0.75 reduction', () => {
  assert.ok(SD.loads.combos('MR2566', 'WSD', { cases }).every(c => c.allowIncrease === undefined));
  const on = SD.loads.combos('MR2566', 'WSD', { cases, allowIncrease: true });
  const inc = on.filter(c => c.allowIncrease);
  assert.ok(inc.length > 0 && inc.every(c => c.allowIncrease === 1.33 && !/0\.75/.test(c.name)));
});

test('live-load table, reduction, phi, provinces, codes', () => {
  const M = SD.materials;
  assert.equal(M.liveLoadById('office').q, 250); assert.equal(M.liveLoadById('heavy_parking').q, 800);
  assert.ok(M.liveLoads.every(r => r.verified === true && r.source === 'MR2566 ข้อ 11'));
  assert.equal(SD.loads.liveLoadReduction(2, 'office').pct, 0);
  assert.equal(SD.loads.liveLoadReduction(3, 'office').pct, 0);
  assert.equal(SD.loads.liveLoadReduction(5, 'office').pct, 20);
  assert.equal(SD.loads.liveLoadReduction(20, 'office').pct, 50);
  assert.equal(SD.loads.liveLoadReduction(20, 'classroom').pct, 0);
  assert.equal(SD.loads.liveLoadReduction(20, { q: 600 }).allowed, false);
  assert.equal(SD.loads.impactMultiplier('lift'), 2);
  assert.equal(M.phi('MR2566', { qc: true }).tied, 0.70); assert.equal(M.phi('MR2566', { qc: false }).shear, 0.70);
  assert.equal(M.phi('ACI318').tied, 0.65); assert.equal(M.phiSteel('MR2566').shear, 0.90);
  near(M.Ec(240), 15100 * Math.sqrt(240), 1e-6); near(M.concreteModel(240).E, 2.339e9, 2e6); near(M.beta1(320), 0.85 - 0.05 * 40 / 70, 1e-12);
  near(SD.units.cubeToCylinder(300), 240, 1e-12);
  const P = SD.provinces;
  assert.equal(P.length, 77); assert.equal(new Set(P.map(p => p.provinceTh)).size, 77);
  assert.equal(P.filter(p => p.seismicZone2564 === 1).length, 14); assert.equal(P.filter(p => p.seismicZone2564 === 2).length, 17); assert.equal(P.filter(p => p.seismicZone2564 === 3).length, 12);
  assert.equal(P.filter(p => p.placeholder).length, 13); assert.ok(P.every(p => p.verified === false));
  assert.equal(P.byName('Bangkok').seismicZone2564, 2);
  const C = SD.codes;
  assert.ok(C.registry.every(r => /^https?:\/\//.test(r.officialUrl) && ['current', 'superseded', 'unknown', 'draft'].includes(r.status)));
  assert.ok(C.registry.every(r => r.lastVerifiedDate !== null || r.status === 'unknown' || r.type === 'international' || r.type === 'law'));
  const mr = C.registry.find(r => r.id === 'MR2566-STRUCT');
  assert.equal(mr.status, 'current'); assert.equal(mr.supersedes, 'MR6-2527');
  assert.equal(C.registry.find(r => r.id === 'MR6-2527').status, 'superseded');
  assert.ok(C.forModule('wind').length >= 1); assert.ok(C.forModule('licensing').length >= 4);
  assert.equal(C.staleness(mr, '2026-10-25').badge, false);
  assert.equal(C.staleness(C.registry.find(r => r.id === 'EIT-011038'), '2026-10-25').badge, true);
  assert.equal(C.staleness({ lastVerifiedDate: '2026-09-01' }, '2026-10-25').badge, false);
  assert.equal(C.staleness({ lastVerifiedDate: '2026-01-01' }, '2026-10-25').badge, true);
});

test('regression: required inputs, terrain, leeward sign, D-only combos, dir resolution', () => {
  const st = [{ h: 3, w: 1e5 }];
  const base = { site: 'D', system: 'RC_SMF', hn: 3, storeys: st };
  for (const bad of [null, undefined, NaN, 'x']) {
    assert.throws(() => SD.loads.seismic.elf(Object.assign({ Ss: bad, S1: 0.1 }, base)), (e) => e.code === 'BAD_SEISMIC');
    assert.throws(() => SD.loads.seismic.elf(Object.assign({ Ss: 0.1, S1: bad }, base)), (e) => e.code === 'BAD_SEISMIC');
  }
  const z = SD.loads.seismic.elf(Object.assign({ Ss: 0.3, S1: 0.1, zone2564: 3 }, base));
  assert.ok(z.warnings.some(w => /เขต 3/.test(w) && /1301\/1302-61/.test(w)));
  assert.throws(() => SD.loads.wind.static({ V50: null, H: 10, terrain: 'open' }), (e) => e.code === 'BAD_WIND');
  assert.throws(() => SD.loads.wind.static({ V50: 25, H: undefined, terrain: 'open' }), (e) => e.code === 'BAD_WIND');
  assert.throws(() => SD.loads.wind.static({ V50: 25, H: 10 }), (e) => e.code === 'BAD_WIND'); // terrain required
  assert.throws(() => SD.loads.wind.mr2566Simple({ H: 10 }), (e) => e.code === 'BAD_WIND');
  assert.throws(() => SD.loads.wind.mr2566Simple({ H: 10, terrain: 'sea' }), (e) => e.code === 'BAD_WIND');
  // same terrain alias -> same pressure in mr2566Simple and mr2566StoryForces
  for (const t of ['open', 'city', 'rough', 'A', 'B']) {
    const a = SD.loads.wind.mr2566Simple({ H: 15, terrain: t, B: 20 }).p;
    const f = SD.loads.wind.mr2566StoryForces({ terrain: t }, [{ z: 15, width: 10 }]);
    assert.equal(f[0].p, a, t);
  }
  assert.equal(SD.loads.wind.mr2566Simple({ H: 15, terrain: 'rough', B: 20 }).p, 80);
  // leeward sign
  const n1 = SD.loads.wind.static({ V50: 25, H: 10, D: 20, terrain: 'open', Cp: { windward: 0.8, leeward: -0.5 } });
  const n2 = SD.loads.wind.static({ V50: 25, H: 10, D: 20, terrain: 'open', Cp: { windward: 0.8, leeward: 0.5 } });
  near(n1.Cp, 1.3, 1e-12); near(n2.Cp, 1.3, 1e-12);
  // D-only model
  const d = SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }] });
  assert.equal(d.length, 1); assert.deepEqual(d[0].factors, { D: 1.4 }); assert.deepEqual(d[0].droppedTypes, ['L']);
  const dw = SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }, { id: 'WX', type: 'W' }, { id: 'EY', type: 'E' }] });
  assert.ok(dw.some(c => c.factors.WX === 1.6 && c.factors.D === 1.05) && dw.some(c => c.factors.EY === -1));
  assert.throws(() => SD.loads.combos('MR2566', 'SDM', { cases: [{ id: 'D', type: 'D' }, { id: 'Wind', type: 'W' }] }), (e) => e.code === 'BAD_CASE_DIR');
});
