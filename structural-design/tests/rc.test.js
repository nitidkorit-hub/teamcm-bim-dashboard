'use strict';
// node --test tests/   — hand-derived regression examples (kg, cm, ksc; moments kg-m). Tolerances stated per test.
const test = require('node:test');
const assert = require('node:assert');
require('../engine/rc.js');
const rc = globalThis.SD.rc;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol, (msg || '') + ' got ' + a + ' expected ' + b + ' (±' + tol * 100 + '%)');
const base = { cover: 3, fc: 240, fy: 4000, fyv: 2400 };
const slabB = Object.assign({}, base, { cover: 2 }), ftgB = Object.assign({}, base, { cover: 7.5 });
const fails = (r) => JSON.stringify(r.checks.filter((c) => !c.ok).map((c) => c.name + ' ' + c.demand + '/' + c.capacity));

test('beamSDM singly reinforced phiMn (MR2566 QC, phi=0.90)', () => {
  // b=30, d=55, As=14.726 cm2 (3-DB25).  a = As fy/(0.85 fc b) = 58904/6120 = 9.625 cm
  // Mn = As fy (d - a/2) = 58904 x 50.1875 = 2,956,243 kg-cm = 29,562 kg-m ; phiMn = 0.9 x 29,562 = 26,606 kg-m
  const r = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 20000, Vu: 5000 }));
  near(r.flexure.a, 9.625, 0.002, 'a'); near(r.flexure.phiMn, 26606, 0.005, 'phiMn');
  // rho = 14.726/(30x55) = 0.008925 ; rho_b = 0.85x0.85x(240/4000)x(6120/10120) = 0.02622 ; rho_max = 0.01966
  near(r.rho, 0.008925, 0.002); near(r.rhoB, 0.026216, 0.002); near(r.rhoMax, 0.019662, 0.002);
  assert.ok(r.ok, fails(r));
});

test('beamSDM required As: Mu=20000 kg-m', () => {
  // Rn = 2.0e6/(0.9x30x55^2) = 24.488 ; rho = 0.051(1 - sqrt(1 - 2x24.488/204)) = 0.006542 ; As = 0.006542x1650 = 10.79 cm2
  const r = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, Mu: 20000, Vu: 5000 }));
  near(r.design.AsRequired, 10.79, 0.01);
  assert.ok(r.As >= r.design.AsRequired - 1e-9); assert.ok(r.bars.n >= 2 && r.ok, fails(r));
  assert.ok(r.design.barOptions.length === 3);
});

test('phi sets: no-QC and ACI318', () => {
  const r1 = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 10000, Vu: 100, qc: false }));
  near(r1.flexure.phi, 0.75, 1e-9);
  const r2 = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 10000, Vu: 100, set: 'ACI318' }));
  near(r2.flexure.phi, 0.9, 1e-9); assert.ok(r2.flexure.et > 0.005);
});

test('beamSDM doubly reinforced', () => {
  // b=30, d=55, d'=5, As=30, A's=9.  Textbook (comp. steel yields, ignore displaced concrete):
  // a=(30-9)4000/6120=13.725 ; Mn=84000(55-6.8625)+36000(55-5)=5,843,550 kg-cm=58,436 kg-m ; phiMn=52,592 kg-m
  // (strain-compatibility result includes the displaced-concrete term -> ~0.3% lower)
  const r = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, dp: 5, As: 30, AsComp: 9, Mu: 50000, Vu: 100 }));
  near(r.flexure.phiMn, 52592, 0.01); assert.ok(r.flexure.doubly);
  // design mode produces compression steel when Mu exceeds the singly-reinforced limit
  const d2 = rc.beamSDM(Object.assign({}, base, { b: 25, h: 50, d: 45, dp: 5, Mu: 30000, Vu: 100 }));
  assert.ok(d2.design.doubly && d2.Asp > 0, 'doubly in design mode');
  assert.ok(d2.flexure.phiMn >= 30000 * 0.99, 'phiMn=' + d2.flexure.phiMn);
});

test('beamSDM shear stirrup spacing', () => {
  // Vc=0.53x15.492x30x55=13,547 ; Vu=25,000, phi=0.85 -> Vs=25000/0.85-13547=15,865
  // Av(RB9 x2)=1.2723 ; s=1.2723x2400x55/15865=10.59 -> 10.0 cm (2.5 multiples) ; smax=27.5 ; Av,min s<=1.2723x2400/(3.5x30)=29.1
  const r = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 25000 }));
  near(r.shear.Vc, 13547, 0.002); near(r.shear.Vs_required, 15865, 0.005);
  assert.strictEqual(r.shear.sSuggested, 10); near(r.shear.sMax, 27.5, 1e-9); near(r.shear.sAvMin, 29.08, 0.005);
  const ok = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 25000, stirrup: { db: 9, legs: 2, s: 10 } }));
  assert.ok(ok.checks.find((c) => c.name.startsWith('กำลังเฉือน')).ok);
  const ng = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 25000, stirrup: { db: 9, legs: 2, s: 25 } }));
  assert.ok(!ng.ok);
});

test('beamSDM deflection min h, torsion warning, T-beam', () => {
  const r = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 100, span: 6, support: 'simple' }));
  near(r.checks.find((c) => c.name.startsWith('ความหนาขั้นต่ำ')).demand, 37.5, 1e-9);     // 600/16, fy=4000 -> factor 1
  const t = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 100, Tu: 5000 }));
  assert.ok(t.hardWarnings.length > 0 && !t.ok, 'large torsion -> hard warning');
  const T = rc.beamSDM(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, Mu: 1000, Vu: 100, flange: { bf: 120, hf: 12 } }));
  assert.ok(T.flexure.a < 12 && T.flexure.phiMn > r.flexure.phiMn * 0.99);
});

test('beamWSD k, j, fc, fs', () => {
  // n=Es/Ec=2.04e6/233,935=8.72 ; rho=14.726/1650=0.008925 ; k=0.3243 ; j=0.8919
  // M=12000 kg-m: fs=M/(As j d)=1.2e6/(14.726x0.8919x55)=1661 ; fc=2M/(k j b d^2)=91.4
  const r = rc.beamWSD(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, M: 12000, V: 8000 }));
  near(r.n, 8.72, 0.002); near(r.k, 0.3243, 0.003); near(r.j, 0.8919, 0.002); near(r.fs, 1661, 0.005); near(r.fc, 91.4, 0.005);
  assert.ok(r.ok, fails(r));
  near(r.allow.fc, 108, 1e-9); near(r.allow.fs, 1700, 1e-9);             // allowable increase default OFF
  const inc = rc.beamWSD(Object.assign({}, base, { b: 30, h: 60, d: 55, As: 14.726, M: 12000, V: 8000, allowIncrease: true }));
  near(inc.allow.fc, 108 * 1.33, 1e-9);
});

test('beamWSD required As / doubly (2n)', () => {
  const s = rc.beamWSD(Object.assign({}, base, { b: 30, h: 60, d: 55, M: 12000, V: 8000 }));
  assert.ok(s.ok && s.fs <= 1700 * 1.001 && s.fc <= 108.1, fails(s));
  const dbl = rc.beamWSD(Object.assign({}, base, { b: 25, h: 50, d: 45, dp: 5, M: 14000, V: 5000 }));
  assert.ok(dbl.design.doubly && dbl.Asp > 0 && dbl.ok, fails(dbl));
});

test('slabOneWay simple span and continuity coefficients', () => {
  // h=13, d=13-2-0.5=10.5, wu=1.4x400+1.7x300=1070, M=1070x2.5^2/8=835.9 kg-m/m
  // Rn=83,594/(0.9x100x110.25)=8.425 ; rho=0.002152 ; As=2.259 cm2/m < As,min=0.0020x100x13=2.6 -> As=2.6 ; DB10 s=floor(78.54/2.6/2.5)x2.5=30
  const r = rc.slabOneWay(Object.assign({}, slabB, { h: 13, span: 2.5, support: 'simple', wD: 400, wL: 300 }));
  near(r.w, 1070, 1e-9); near(r.sections[0].M, 835.9, 0.002); near(r.sections[0].AsReq, 2.259, 0.01);
  near(r.sections[0].As, 2.6, 1e-9);
  assert.strictEqual(r.sections[0].spacing.find((s) => s.db === 10).s, 30);
  near(r.tempSteel.As, 2.6, 1e-9); assert.strictEqual(r.maxSpacing, 39); assert.ok(r.ok, fails(r));
  const c1 = rc.slabOneWay(Object.assign({}, slabB, { h: 13, span: 3, support: 'oneEnd', wD: 400, wL: 300 }));
  near(c1.sections[0].M, 1070 * 9 / 11, 1e-6); near(c1.sections[1].M, 1070 * 9 / 10, 1e-6);
  const cant = rc.slabOneWay(Object.assign({}, slabB, { h: 15, span: 1.2, support: 'cantilever', wD: 400, wL: 300 }));
  near(cant.sections[0].M, 1070 * 1.44 / 2, 1e-6);
});

test('slabTwoWay structure + mandatory unverified warning', () => {
  assert.strictEqual(rc.twoWayCoefTable.verified, false);
  const r = rc.slabTwoWay(Object.assign({}, slabB, { la: 4, lb: 5, case: 4, h: 13, wD: 400, wL: 200 }));
  assert.ok(r.warnings.includes('ตารางสัมประสิทธิ์ยังไม่ได้ตรวจสอบกับมาตรฐานฉบับจริง'));
  assert.strictEqual(r.tableVerified, false);
  near(r.hmin, 2 * 900 / 180, 1e-9);                                  // perimeter/180 = 10 cm
  const sq = rc.slabTwoWay(Object.assign({}, slabB, { la: 4, lb: 4, case: 1, h: 13, wD: 400, wL: 200 }));
  // interior square panel: anchor coefficients 0.033 / 0.018 / 0.027 ; wu = 1.4x400+1.7x200=900
  const neg = sq.sections.find((s) => s.dir === 'a' && s.location.startsWith('M−'));
  near(neg.mid.M, 0.033 * 900 * 16, 1e-6); near(neg.edge.M, 0.033 * 900 * 16 * 2 / 3, 1e-6);
  const p = sq.sections.find((s) => s.dir === 'a' && s.location.startsWith('M+'));
  near(p.mid.M, (0.018 * 560 + 0.027 * 340) * 16, 1e-6);
  assert.ok(Math.abs(sq.beamLoadShare.short - 0.5) < 1e-9);
});

test('columnSDM pure axial, balanced point, P-M curve', () => {
  // 40x40, 8-DB20 (Ast=25.133): P0=0.85x240x(1600-25.133)+4000x25.133=421,804 ; phiPn,max=0.70x0.80xP0=236,210
  const col = Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, tie: 'tied', Pu: 100000, Mux: 4000 });
  const r = rc.columnSDM(col);
  near(r.P0, 421804, 0.0005); near(r.phiPnMax, 236210, 0.0005);
  // balanced (hand): dmax=35.1, cb=21.226, a=18.04: Cc=147,222 ; top 3 bars +35,778 ; middle 2 bars (di=20 > a=18.04, outside the block) +2,220 ; bottom 3 bars -37,699
  // Pb=147,521 kg ; Mb = 1,616,350+540,248+569,255 = 2,725,853 kg-cm = 27,259 kg-m
  near(r.balanced.x.Pb, 147521, 0.002); near(r.balanced.x.Mb, 27259, 0.005);
  assert.ok(r.curves.x.points.length >= 30 && r.curves.y.points.length >= 30);
  const top = r.curves.x.points[0]; near(top.Pn, r.P0, 1e-9); near(top.phiPn, r.phiPnMax, 1e-9);
  assert.ok(r.curves.x.points.some((p) => p.phi > 0.85), 'tension-controlled region reaches phi=0.90');
  assert.ok(r.ok, fails(r));
  const over = rc.columnSDM(Object.assign({}, col, { Pu: 250000 }));
  assert.ok(!over.ok);
});

test('columnSDM Bresler biaxial', () => {
  const r = rc.columnSDM(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, tie: 'tied', Pu: 120000, Mux: 6000, Muy: 6000 }));
  assert.strictEqual(r.biaxial.method, 'Bresler');
  // identity: 1/Pn = 1/Pnx + 1/Pny - 1/P0
  near(1 / r.biaxial.Pn, 1 / r.biaxial.Pnx + 1 / r.biaxial.Pny - 1 / r.P0, 1e-9);
  // symmetric section & loads -> Pnx = Pny ; Pnx lies on the curve at e = M/Pu = 600000/120000 = 5 cm (no slenderness: lu not given)
  near(r.biaxial.Pnx, r.biaxial.Pny, 1e-6);
  const pts = r.curves.x.points.filter((p) => p.Pn > 0 && p.c);
  let e = null;
  for (let i = 0; i < pts.length - 1; i++) if ((pts[i].Pn - r.biaxial.Pnx) * (pts[i + 1].Pn - r.biaxial.Pnx) <= 0) {
    const t = (r.biaxial.Pnx - pts[i].Pn) / (pts[i + 1].Pn - pts[i].Pn); e = (pts[i].Mn + t * (pts[i + 1].Mn - pts[i].Mn)) * 100 / r.biaxial.Pnx;
  }
  near(e, 5, 0.03, 'eccentricity on curve');
  const lc = rc.columnSDM(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, Pu: 20000, Mux: 5000, Muy: 5000 }));
  assert.strictEqual(lc.biaxial.method, 'contour');                    // Pu < 0.1 P0 -> load contour
});

test('columnSDM slenderness, sway hard warning, circular spiral, min eccentricity, rho', () => {
  const sl = rc.columnSDM(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, Pu: 120000, Mux: 5000, lu: 4.5, k: 1, M1M2: 0.5 }));
  assert.strictEqual(sl.axes.x.status, 'slender-nonsway'); assert.ok(sl.axes.x.delta > 1);
  const sw = rc.columnSDM(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, Pu: 120000, Mux: 5000, lu: 3, sway: true }));
  assert.ok(sw.hardWarnings.some((w) => w.includes('sway')) && !sw.ok);
  const sp = rc.columnSDM(Object.assign({}, base, { D: 50, bars: { n: 8, db: 20 }, tie: 'spiral', Pu: 150000, Mux: 5000, Muy: 3000 }));
  // Ag=pi 50^2/4=1963.5, Ast=25.133: P0=204(Ag-Ast)+4000 Ast ; phiPn,max=0.75x0.85xP0
  const P0 = 204 * (Math.PI * 2500 / 4 - 25.133) + 4000 * 25.133; near(sp.P0, P0, 0.0005); near(sp.phiPnMax, 0.75 * 0.85 * P0, 0.001);
  assert.ok(sp.ok, fails(sp));
  const minE = rc.columnSDM(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, Pu: 100000, Mux: 0 }));
  near(minE.axes.x.M2, 100000 * (1.5 + 0.03 * 40) / 100, 1e-9);        // emin = 2.7 cm
  const rho = rc.columnSDM(Object.assign({}, base, { b: 30, h: 30, bars: { n: 4, db: 12 }, Pu: 10000 }));
  assert.ok(!rho.ok, 'rho_g < 1%');
});

test('columnWSD', () => {
  const r = rc.columnWSD(Object.assign({}, base, { b: 40, h: 40, bars: { n: 8, db: 20 }, tie: 'tied', P: 80000, Mx: 0 }));
  // Pa = 0.80[0.25x240x1600 + 1700x25.133] = 0.80[96000+42726]=110,981
  near(r.Pa, 110981, 0.0005);
});

test('footing punching and one-way shear (SDM)', () => {
  // B=L=200, h=50, d=50-7.5-1.6=40.9, col 30x30, Pu=90,000 ; qu=2.25 ksc
  // Vu=90000-2.25x70.9^2=78,690 ; bo=283.6 ; vc=min(16.42, 24.63, 32.50)=16.42 ; phiVc=0.85x16.42x283.6x40.9=161,890
  const r = rc.footingSDM(Object.assign({}, ftgB, { B: 200, L: 200, h: 50, col: { c1: 30, c2: 30 }, qa: 3, P_service: 60000, Pu: 90000 }));
  near(r.d, 40.9, 1e-9); near(r.punching.bo, 283.6, 1e-9); near(r.punching.Vu, 78690, 0.001);
  near(r.punching.v1, 16.42, 0.002); near(r.punching.v2, 24.63, 0.002); near(r.punching.v3, 32.50, 0.003); near(r.punching.phiVc, 161890, 0.003);
  // one-way: lc=85, Vu=2.25x200x(85-40.9)=19,845 ; phiVc=0.85x0.53x15.492x200x40.9=57,086
  const sh = r.checks.find((c) => c.name.startsWith('เฉือนทางเดียว ทิศ L'));
  near(sh.demand, 19845, 0.001); near(sh.capacity, 57086, 0.003);
  near(r.directions.L.M, 16256, 0.001);                                // 2.25x200x85^2/2 = 1,625,625 kg-cm
  near(r.directions.L.AsMin, 0.002 * 200 * 50, 1e-9);
  assert.ok(r.ok, fails(r));
  assert.ok(r.directions.L.bars.n >= 2);
});

test('footing bearing: qa, kern, size design, WSD', () => {
  // W = 200x200x50x2.4e-3 = 4800 ; q=(60000+4800)/40000=1.62 > 1.5 -> NG
  const ng = rc.footingSDM(Object.assign({}, ftgB, { B: 200, L: 200, h: 50, col: { c1: 30, c2: 30 }, qa: 1.5, P_service: 60000, Pu: 90000 }));
  const q = ng.checks.find((c) => c.name === 'qmax ≤ qa'); assert.ok(!q.ok); near(q.demand, 1.62, 1e-6);
  // M=30,000 kg-m on P+W=64,800 -> e=46 cm ; 6e/L = 1.39 > 1 -> uplift -> NG
  const ecc = rc.footingSDM(Object.assign({}, ftgB, { B: 200, L: 200, h: 50, col: { c1: 30, c2: 30 }, qa: 9, P_service: 60000, M_service: 30000, Pu: 90000, Mu: 40000 }));
  assert.ok(!ecc.checks.find((c) => c.name.startsWith('ไม่เกิดแรงดึง')).ok);
  const sized = rc.footingSDM(Object.assign({}, ftgB, { col: { c1: 30, c2: 30 }, qa: 1.5, P_service: 60000, Pu: 90000 }));
  assert.ok(sized.ok && sized.sized && sized.B >= 200, 'sized ' + sized.B + 'x' + sized.L + 'x' + sized.h + fails(sized));
  const w = rc.footingWSD(Object.assign({}, ftgB, { B: 220, L: 220, h: 50, col: { c1: 30, c2: 30 }, qa: 1.5, P_service: 60000 }));
  assert.ok(w.ok, fails(w));
});
