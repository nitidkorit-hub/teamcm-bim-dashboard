'use strict';
const test = require('node:test');
const assert = require('node:assert');
require('../engine/data/sections.js');
const S = globalThis.SD.sections;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= Math.abs(b) * tol, (msg || '') + ' got ' + a + ' expected ' + b);

test('library rows flagged unverified with per-property source', () => {
  assert.ok(S.rows.length > 60);
  S.rows.forEach((r) => { assert.strictEqual(r.verified, false); assert.ok(['table', 'computed'].includes(r.source.A)); assert.ok(r.Ix > 0 && r.Zx > r.Sx * 0.99, r.name); });
  assert.ok(['H', 'I', 'C', 'PIPE', 'SHS', 'RHS'].every((t) => S.list(t).length > 0));
});

test('cross-check >=3 H sections against published values (within 1%)', () => {
  // H200x200x8x12: A=63.53, Ix=4720, Iy=1600 ; H300x150x6.5x9: Ix=7210, Iy=508 ; H400x400x13x21: Ix=66600, Iy=22400
  const a = S.find('H200x200x8x12'), b = S.find('H 300 x 150 x 6.5 x 9'), c = S.find('h400X400x13x21');
  near(a.A, 63.53, 0.002); near(a.Ix, 4720, 0.01); near(a.Iy, 1600, 0.01);
  near(b.Ix, 7210, 0.01); near(b.Iy, 508, 0.01);
  near(c.Ix, 66600, 0.01); near(c.Iy, 22400, 0.01);
  near(a.weight, 49.9, 0.01);
  near(b.Zx, 542, 0.01);                                              // hand: 392.85 + 129.2 + 20.0
  near(a.Cw, a.Iy * (a.d - a.tf) ** 2 / 4, 1e-9);                     // Cw = Iy ho^2/4
});

test('solver helpers (m units)', () => {
  const r = S.rect(0.3, 0.6);
  near(r.A, 0.18, 1e-12); near(r.Iy, 0.3 * 0.6 ** 3 / 12, 1e-12); near(r.Iz, 0.6 * 0.3 ** 3 / 12, 1e-12);
  const sq = S.rect(0.4, 0.4); near(sq.J, 0.1406 * 0.4 ** 4, 0.01);          // square torsion constant 0.1406 a^4
  const ci = S.circle(0.5); near(ci.A, Math.PI * 0.25 / 4, 1e-9); near(ci.J, 2 * ci.Iy, 1e-9);
  const st = S.toSolver('H200x200x8x12'); near(st.A, 63.53e-4, 0.002); near(st.Iy, 4720e-8, 0.01);
});
