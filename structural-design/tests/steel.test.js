'use strict';
// Steel examples, SS400 Fy=2450 ksc, E=2.04e6 (sqrt(E/Fy)=28.857). Moments kg-m, lengths m.
const test = require('node:test');
const assert = require('node:assert');
require('../engine/data/sections.js');
require('../engine/steel.js');
const st = globalThis.SD.steel;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol, (msg || '') + ' got ' + a + ' expected ' + b + ' (±' + tol * 100 + '%)');
const Fy = 2450;
const H300 = 'H300x150x6.5x9';

test('beam Lb < Lp: Mn = Mp = Fy Zx', () => {
  // Zx = 392.85 + 129.2 + 20.0 = 542 cm3 -> Mp = 2450x542 = 1,327,900 kg-cm = 13,279 kg-m ; phiMn = 0.9 Mp = 11,951
  // compact: lf = 15/(2x0.9)=8.33 <= 10.97 ; Lp = 1.76 x 3.295 x 28.857 = 167 cm
  const r = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 10000, Vu: 5000, Lb: 1.0, Cb: 1 });
  near(r.Mp, 13279, 0.01); near(r.Mn, r.Mp, 1e-12); assert.strictEqual(r.flangeClass, 'compact'); near(r.Lp, 1.67, 0.01);
  near(r.capacity.LRFD, 0.9 * r.Mp, 1e-12); assert.ok(r.ok); assert.ok(r.regime.startsWith('plastic'));
});

test('beam Lp < Lb < Lr: linear interpolation', () => {
  // Lr (hand) = 499 cm ; Lb=3 m: Mn = Mp - (Mp - 0.7FySx)(300-167.4)/(499-167.4) ; 0.7FySx=824,229 (Sx=480.6)
  // = 1,328,145 - 503,916x0.3999 = 1,126,6xx kg-cm = 11,266 kg-m
  const r = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 9000, Vu: 5000, Lb: 3.0, Cb: 1 });
  near(r.Lr, 4.99, 0.01); near(r.Mn, 11266, 0.015); assert.ok(r.regime.startsWith('inelastic'));
  const cb = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 9000, Vu: 5000, Lb: 3.0, Cb: 1.3 });
  assert.ok(cb.Mn > r.Mn && cb.Mn <= cb.Mp + 1e-9);
});

test('beam Lb > Lr: elastic LTB', () => {
  // Lb=8 m, rts=3.921: x=204 ; Fcr = pi^2 E/x^2 sqrt(1+0.078(Jc/(Sx ho))x^2) = 483.8x1.819 = 880 ksc ; Mn = 880x480.6 = 4,229 kg-m
  const r = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 3000, Vu: 3000, Lb: 8, Cb: 1 });
  near(r.Mn, 4229, 0.02); assert.ok(r.regime.startsWith('elastic')); assert.ok(r.Mn < r.Mp);
  assert.ok(r.warnings.some((w) => w.includes('Lb > Lr')));
});

test('beam shear, deflection, phi sources, unsupported sections', () => {
  const r = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 1000, Vu: 20000, Lb: 1 });
  // Aw = 30x0.65=19.5 ; Vn = 0.6x2450x19.5 = 28,665 (Cv=1, h/tw=39.4 <= 2.24x28.857=64.6) ; MR2566 phi=0.90 -> 25,799
  near(r.Vn, 28665, 1e-6); near(r.checks[1].capacity, 25799, 1e-4);
  const a = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 1000, Vu: 20000, Lb: 1, steelPhiSource: 'AISC' });
  near(a.checks[1].capacity, 28665, 1e-6);
  // deflection 5wL^4/384EI: w=1000 kg/m (10 kg/cm), L=6 m, Ix=7209 -> 5x10x600^4/(384x2.04e6x7209)=1.147 cm ; limit L/360=1.667
  const d = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 1000, Vu: 1000, Lb: 1, span: 6, wService: 1000, deltaLimit: 360 });
  const dc = d.checks.find((c) => c.name.startsWith('การโก่งตัว')); near(dc.demand, 1.147, 0.01); assert.ok(dc.ok);
  const slender = st.beam({ section: { type: 'H', d: 60, bf: 20, tw: 0.4, tf: 0.5, r: 1, A: 50, Ix: 30000, Iy: 700, Zx: 1100, Zy: 100, J: 5, Cw: 1e6 }, Fy, method: 'LRFD', Mu: 1, Vu: 1, Lb: 1 });
  assert.ok(!slender.ok && slender.hardWarnings.length > 0);
});

test('ASD vs LRFD consistency', () => {
  const l = st.beam({ section: H300, Fy, method: 'LRFD', Mu: 5000, Vu: 5000, Lb: 3 });
  const a = st.beam({ section: H300, Fy, method: 'ASD', Ma: 5000 / 1.5, Va: 5000 / 1.5, Lb: 3 });
  near(l.Mn, a.Mn, 1e-12);                                        // same nominal strength
  near(l.capacity.LRFD / l.capacity.ASD, 0.9 * 1.67, 1e-9);        // 1.503
  near(l.checks[0].ratio, a.checks[0].ratio, 0.01);                // flexure ratio agrees when Mu = 1.5 Ma
  const lc = st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: 50000, KLx: 3, KLy: 3 });
  const ac = st.column({ section: 'H200x200x8x12', Fy, method: 'ASD', Pa: 50000 / 1.5, KLx: 3, KLy: 3 });
  near(lc.Pn, ac.Pn, 1e-12); near(lc.ratio, ac.ratio, 0.01);
});

test('column Fcr: inelastic and elastic branches', () => {
  // H200x200x8x12: ry=sqrt(1600/63.53)=5.019 ; limit 4.71x28.857=135.9
  // KLy=2 m: KL/r=39.85 ; Fe=pi^2E/39.85^2=12,678 ; Fcr=0.658^(2450/12678)x2450=2,260 ; Pn=2260x63.53=143,600
  const a = st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: 100000, KLx: 2, KLy: 2 });
  assert.strictEqual(a.branch, 'inelastic'); near(a.slenderness, 39.85, 0.005); near(a.Fcr, 2260, 0.005); near(a.Pn, 143600, 0.006);
  // KLy=8 m: KL/r=159.4 > 135.9 ; Fe=792.4 ; Fcr=0.877xFe=694.9 ; Pn=44,150
  const b = st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: 30000, KLx: 8, KLy: 8 });
  assert.strictEqual(b.branch, 'elastic'); near(b.Fcr, 694.9, 0.005); near(b.Pn, 44150, 0.006); assert.ok(b.ok);
  const c = st.column({ section: 'H200x200x8x12', Fy, method: 'LRFD', Pu: 1000, KLx: 11, KLy: 11 });
  assert.ok(!c.ok, 'KL/r > 200');
  assert.ok(a.checks[0].clause.includes('2566'));
});

test('beamColumn H1-1a and H1-1b', () => {
  const sec = 'H200x200x8x12', base = { section: sec, Fy, method: 'LRFD', KLx: 3, KLy: 3, Lb: 3, Cb: 1 };
  const col = st.column(Object.assign({ Pu: 1 }, base)), bm = st.beam(Object.assign({ Mu: 1, Vu: 1 }, base));
  const Pc = col.capacity, Mcx = bm.capacity.LRFD;
  // H1-1a: Pr/Pc=0.5, Mrx/Mcx=0.2 -> 0.5 + 8/9(0.2) = 0.6778
  const a = st.beamColumn(Object.assign({ Pu: 0.5 * Pc, Mux: 0.2 * Mcx }, base));
  assert.strictEqual(a.equation, 'H1-1a'); near(a.interaction, 0.5 + 8 / 9 * 0.2, 1e-9); assert.ok(a.ok);
  // H1-1b: Pr/Pc=0.1, Mrx/Mcx=0.5 -> 0.05 + 0.5 = 0.55
  const b = st.beamColumn(Object.assign({ Pu: 0.1 * Pc, Mux: 0.5 * Mcx }, base));
  assert.strictEqual(b.equation, 'H1-1b'); near(b.interaction, 0.55, 1e-9);
  // biaxial: add weak-axis moment 0.1 Mcy -> 0.65
  const c = st.beamColumn(Object.assign({ Pu: 0.1 * Pc, Mux: 0.5 * Mcx, Muy: 0.1 * b.Mcy }, base));
  near(c.interaction, 0.65, 1e-9);
  const ng = st.beamColumn(Object.assign({ Pu: 0.5 * Pc, Mux: 0.6 * Mcx }, base)); assert.ok(!ng.ok);
});
