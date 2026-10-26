'use strict';
// Regression tests for code-review findings (sign conventions, required inputs, RHS orientation, edge punching, unverified table).
const test = require('node:test');
const assert = require('node:assert');
require('../engine/data/sections.js');
require('../engine/steel.js');
require('../engine/rc.js');
const { steel: st, rc, sections: S } = globalThis.SD;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol, (msg || '') + ' got ' + a + ' expected ' + b);
const Fy = 2450, base = { cover: 3, fc: 240, fy: 4000, fyv: 2400 }, ftg = Object.assign({}, base, { cover: 7.5 });

test('steel: negative moment/shear are magnitudes; missing/non-finite inputs are errors', () => {
  const p = st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: 9000, Vu: 5000, Lb: 3 });
  const n = st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: -9000, Vu: -5000, Lb: 3 });
  near(n.ratio, p.ratio, 1e-12); assert.ok(n.ratio > 0.5);
  assert.ok(!st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Vu: 5000, Lb: 3 }).ok);             // no Mu
  assert.ok(st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: 1, Vu: 1 }).error);               // no Lb
  assert.ok(!st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: NaN, Vu: 1, Lb: 0 }).ok);
  assert.ok(st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: 100, Vu: 1, Lb: 0 }).ok);        // Lb:0 allowed
  assert.ok(st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: 1000, KLy: 3 }).error);         // KLx missing
  assert.ok(st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', KLx: 3, KLy: 3 }).error);           // Pu missing
  assert.ok(st.beam({ section: 'H300x150x6.5x9', Fy, method: 'LRFD', Mu: 1, Vu: 1, Lb: 1 }).warnings.some((w) => w.includes('ยังไม่ได้ตรวจสอบกับตาราง')));
});

test('steel: tension (Pu<0) uses yield capacity, not buckling', () => {
  // Tn = Fy Ag = 2450 x 63.53 = 155,649 ; phi 0.90 -> 140,084
  const t = st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: -100000, KLx: 8, KLy: 8 });
  assert.ok(t.tension && t.ok); near(t.capacity, 0.9 * 2450 * 63.53, 1e-4);
  assert.ok(!st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: -150000, KLx: 8, KLy: 8 }).ok);
  const bc = st.beamColumn({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: -0.5 * 140084, Mux: 100, KLx: 3, KLy: 3, Lb: 3 });
  near(bc.Pc, 0.9 * 2450 * 63.53, 1e-4); assert.strictEqual(bc.equation, 'H1-1a');
});

test('sections: RHS depth/width orientation', () => {
  const r = S.find('RHS150x100x4.5');
  assert.ok(r.Ix > r.Iy && r.d === 15 && r.bf === 10);
  const t = st.beam({ section: 'RHS200x100x4.5', Fy, method: 'LRFD', Mu: 1000, Vu: 1000, Lb: 0 });
  assert.ok(t.ok && t.hardWarnings.length === 0, JSON.stringify(t.warnings));
  assert.ok(t.Mn > 0);
});

test('columnSDM: tension branch and missing Pu', () => {
  const col = Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, tie: 'tied' });
  // Ast=25.133 -> pure tension capacity 0.9 x 4000 x 25.133 = 90,478 kg
  const ok = rc.columnSDM(Object.assign({ Pu: -30000, Mux: 500 }, col));
  assert.ok(ok.ok, JSON.stringify(ok.checks.filter((c) => !c.ok)));
  const ng = rc.columnSDM(Object.assign({ Pu: -100000, Mux: 0 }, col));
  assert.ok(!ng.ok);
  assert.ok(rc.columnSDM(Object.assign({}, col)).error);
  assert.ok(!rc.columnWSD(Object.assign({ P: -1000 }, col)).ok);
});

test('footing: uplift and missing demands', () => {
  const f = Object.assign({ B: 200, L: 200, h: 50, col: { c1: 30, c2: 30 }, qa: 3, P_service: 60000, Pu: 90000 }, ftg);
  const up = rc.footingSDM(Object.assign({}, f, { Pu: -5000 }));
  assert.ok(!up.ok && up.hardWarnings[0].includes('uplift'));
  assert.ok(!rc.footingWSD(Object.assign({}, f, { P_service: -1 })).ok);
  assert.ok(rc.footingSDM(Object.assign({}, f, { Pu: undefined })).error);
});

test('footing punching: edge/corner bo and moment transfer', () => {
  const f = Object.assign({ B: 200, L: 200, h: 50, col: { c1: 30, c2: 30 }, qa: 3, P_service: 60000, Pu: 90000 }, ftg);
  // d=40.9 ; edge: bo = 2(30+20.45)+(30+40.9) = 171.8 ; corner: (30+20.45)x2 = 100.9
  near(rc.footingSDM(Object.assign({}, f, { position: 'edge' })).punching.bo, 171.8, 1e-6);
  near(rc.footingSDM(Object.assign({}, f, { position: 'corner' })).punching.bo, 100.9, 1e-6);
  assert.ok(rc.footingSDM(Object.assign({}, f, { position: 'edge' })).punching.bo < rc.footingSDM(f).punching.bo);
  // interior with unbalanced moment: demand stress increases, still computed
  const m = rc.footingSDM(Object.assign({}, f, { Mu: 5000 }));
  assert.ok(m.punching.vMoment > 0 && m.punching.vu > rc.footingSDM(f).punching.vu);
  // edge + moment -> hard warning (not computed)
  const em = rc.footingSDM(Object.assign({}, f, { position: 'edge', Mu: 5000 }));
  assert.ok(!em.ok && em.hardWarnings.some((w) => w.includes('โมเมนต์ไม่สมดุล')));
});

test('slabTwoWay: ok=false unless allowUnverified', () => {
  const s = Object.assign({}, base, { cover: 2, la: 4, lb: 5, case: 4, h: 13, wD: 400, wL: 200 });
  const r = rc.slabTwoWay(s);
  assert.ok(!r.ok && r.hardWarnings.length > 0);
  const r2 = rc.slabTwoWay(Object.assign({}, s, { allowUnverified: true }));
  assert.ok(r2.hardWarnings.length === 0 && r2.warnings.includes('ตารางสัมประสิทธิ์ยังไม่ได้ตรวจสอบกับมาตรฐานฉบับจริง'));
});

test('beams: missing demands error; two-layer bars reduce d', () => {
  assert.ok(rc.beamSDM(Object.assign({}, base, { b: 30, h: 60 , Vu: 1 })).error);
  assert.ok(rc.beamWSD(Object.assign({}, base, { b: 30, h: 60, M: 1000 })).error);
  // b=20: only 2 DB25 fit per layer -> ~4+ bars need 2 layers ; single-layer d would be 60-3-0.9-1.25 = 54.85
  const r = rc.beamSDM(Object.assign({}, base, { b: 20, h: 60, Mu: 30000, Vu: 1000 }));
  assert.ok(r.d < 54.0, 'layered d=' + r.d);
  // user-supplied d with a two-layer bar set is a hard warning
  const g = rc.beamSDM(Object.assign({}, base, { b: 20, h: 60, d: 54.85, bars: { n: 6, db: 25 }, Mu: 1000, Vu: 100 }));
  assert.ok(!g.ok && g.hardWarnings.length > 0);
});
