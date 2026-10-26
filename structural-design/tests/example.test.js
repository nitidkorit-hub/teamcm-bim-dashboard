'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../engine/core.js');
require('../engine/data/materials.js');
require('../engine/loads.js');
require('../engine/solver3d.js');
const model = require('../examples/frame-3d-2storey.json');

test('example 2-storey frame analyzes; equilibrium and gravity total hold', () => {
  const r = SD.solver.analyze(model);
  assert.equal(r.ok, true);
  for (const id of Object.keys(r.cases)) assert.ok(r.cases[id].equilibrium.error < 1e-9, id);
  // DL reaction = applied total (self weight + slab + ...)
  const fz = Object.values(r.cases.DL.reactions).reduce((s, x) => s + x.fz, 0);
  assert.ok(Math.abs(fz + r.cases.DL.equilibrium.sumF[2]) < 1e-6 * fz);
  // lateral: sum of base shear equals wind total
  const fx = Object.values(r.cases.W_X.reactions).reduce((s, x) => s + x.fx, 0);
  const applied = model.loadCases.find(c => c.id === 'W_X').nodal.reduce((s, n) => s + n.fx, 0);
  assert.ok(Math.abs(fx + applied) < 1e-6 * applied);
  assert.equal(model.combinations.length, 9);
  const env = r.envelopes[model.members.find(m => m.kind === 'beam').id];
  assert.ok(env.My.max > 0 && env.My.min < 0 && env.My.comboMax && env.My.comboMin);
});
