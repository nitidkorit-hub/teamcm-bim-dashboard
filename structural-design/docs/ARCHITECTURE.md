# Structural Design App — Architecture & API contract

Standalone, no backend, no build step. Opens from `index.html` via a static server (`python -m http.server`)
or directly from file://. Dependencies: three.js (pinned, jsDelivr, ES module via importmap) and Sarabun font.
Everything else is own code. PDF = browser print-to-PDF with print CSS.

## Files
```
structural-design/
  index.html            UI shell, importmap for three.js
  styles.css            app + @media print styles
  app.js                UI controller (classic script)
  viewer3d.js           three.js viewer (ES module, exposes window.SDViewer)
  report.js             calculation-report HTML builder (classic script)
  engine/
    core.js             namespace + unit helpers + vector math
    solver3d.js         3D frame direct stiffness solver
    loads.js            load combinations, wind (1311), seismic ELF (1301/1302)
    rc.js               RC beam/slab/column/footing — SDM + WSD
    steel.js            steel beam/column — LRFD + ASD
    data/codes.js       standards/law registry (with verified flags + lastVerifiedDate)
    data/materials.js   concrete/rebar/steel grades, live-load table, unit weights, SDL
    data/sections.js    steel section library (มอก. 1227 etc.)
    data/provinces.js   wind zone / Ss / S1 seed rows (verified:false)
  tests/*.test.js       node --test
  examples/*.json       sample models
```

## Module pattern (works in browser AND Node)
Each engine file is a classic script:
```js
(function (root) {
  const SD = root.SD = root.SD || {};
  // ... SD.solver = { analyze, ... }
  if (typeof module !== 'undefined' && module.exports) module.exports = SD.solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```
In Node, tests `require('../engine/core.js')` first, then other files (they read `globalThis.SD`).
No DOM access in `engine/`.

## Units
- Analysis model: **kgf, m**. E, G in kg/m². Section A m², I m⁴. Loads kg (point), kg/m (line), kg-m (moment).
- Results: forces kg, moments kg-m, displacements m (UI shows mm), rotations rad.
- Design functions (rc.js, steel.js): **kg, cm, ksc**; moments in kg-cm internally, inputs/outputs documented per function (accept kg-m where noted).

## Model schema (SD.solver.analyze input)
Global axes: X, Y horizontal, **Z up**.
```js
{
  nodes:    [{ id:'N1', x:0, y:0, z:0 }],
  materials:{ C240:{ E:2.339e9, nu:0.2, density:2400 } },  // E kg/m², density kg/m³
  sections: { B30x60:{ A, Iy, Iz, J, shape:'rect', b:0.3, h:0.6 } }, // Iy about local y, Iz about local z
  members:  [{ id:'B1', i:'N1', j:'N2', section:'B30x60', material:'C240',
               roll:0,                      // degrees, rotation of local axes about local x
               releases:{ i:{my:false,mz:false,t:false}, j:{...} }, // optional end moment releases
               modifiers:{ I:0.35 },        // optional stiffness modifier (cracked)
               kind:'beam'|'column'|'brace', group:'B1-typ' }],
  supports: [{ node:'N1', ux:true, uy:true, uz:true, rx:true, ry:true, rz:true }],
  springs?:  [{ node, kux, kuy, kuz, krx, kry, krz }],
  loadCases:[{ id:'DL', name:'Dead', type:'D'|'SD'|'L'|'Lr'|'W'|'E'|'H',
               selfWeight:true,
               nodal:[{ node:'N2', fx:0, fy:0, fz:-1000, mx:0, my:0, mz:0 }],
               member:[{ member:'B1', kind:'udl', dir:'GZ'|'GX'|'GY'|'LX'|'LY'|'LZ', w:-500 }, // kg/m, full length
                       { member:'B1', kind:'point', dir:'GZ', P:-1000, a:2.0 },          // a = m from end i
                       { member:'B1', kind:'trap', dir:'GZ', w1:-200, w2:-600, a:0, b:L } ] }],
  combinations:[{ id:'U1', name:'1.4D+1.7L', method:'SDM'|'WSD', set:'Legacy'|'Current', factors:{ DL:1.4, SDL:1.4, LL:1.7 },
                  allowIncrease?:1.33 }],
  options:{ stations:11, rigidDiaphragm?:[{ z:3.0, master?:'N…' }] }
}
```
Local axes: x from i to j. For non-vertical members local z lies in the vertical plane containing x and global Z
(pointing "up"), y = z × x. For vertical members (x ∥ Z) local y = global Y... use: y = global Y, z = x × y. Then apply `roll`.
Document the exact convention in solver3d.js header. My = moment about local y (strong-axis bending for a beam
whose depth is along local z), Mz = moment about local z.

## Results schema
```js
{
  ok:true, warnings:[], dofCount,
  cases: { [caseOrComboId]: {
    displacements: { N2:{ ux,uy,uz,rx,ry,rz } },
    reactions:     { N1:{ fx,fy,fz,mx,my,mz } },
    members: { B1: {
      endForces: { i:{N,Vy,Vz,T,My,Mz}, j:{...} },          // local, sign convention below
      stations:  [{ x, N, Vy, Vz, T, My, Mz, dy, dz }],       // x in m from i, local deflections
      max: { N:{min,max}, Vy:{...}, Vz:{...}, T:{...}, My:{...}, Mz:{...} } } },
    equilibrium: { sumF:[..], sumR:[..], error }             // global check
  } },
  envelopes: { [memberId]: { My:{min,max,comboMin,comboMax}, ... } }
}
```
Internal-force sign convention (report-style): N + tension; moments + sagging for beams (bottom fiber in tension
for gravity on simply supported beam → +My at midspan). Document in code.
Combinations are linear superpositions of case results (linear analysis).

## Engine API
- `SD.solver.analyze(model) → results` (throws `SD.SolverError` with readable Thai/English message on mechanism/singular).
- `SD.loads.combos(setName, method, opts) → combination[]` from present load-case types.
- `SD.loads.wind.static({V50, Iw, terrain, H, D, Cg, Cp, ...}) → { q, Ce, p, applicable, steps[] }`
- `SD.loads.wind.storyForces(params, floors[{z, width}]) → [{z, F}]`
- `SD.loads.seismic.elf({Ss, S1, site, Ie, R, Cd, Omega0, system, hn, storeys:[{h, w}], TL}) → { SDS, SD1, Ta, T, Cs, V, k, forces[], SDC, steps[] }`
- `SD.rc.beamSDM(input)`, `SD.rc.beamWSD(input)`, `SD.rc.slabOneWay`, `SD.rc.slabTwoWay`, `SD.rc.columnSDM`, `SD.rc.columnWSD`, `SD.rc.footingSDM`, `SD.rc.footingWSD`
- `SD.steel.beam(input)` (method 'LRFD'|'ASD'), `SD.steel.column(input)`, `SD.steel.beamColumn(input)`
Every design function returns:
```js
{ ok:boolean, ratio:number /* demand/capacity, max of checks */, checks:[{ name, demand, capacity, ratio, ok, unit, clause }],
  steps:[{ label, formula, substituted, value, unit, clause }],  // for the report: "สูตร → แทนค่า → ผล"
  warnings:[string], inputs:{...echo} }
```
`clause` references the standard (e.g. 'วสท. 1008-38 / ACI 318 §9.3'). Values tagged unverified must add a warning.

## UI
Tabs: โครงการ (project info, method, combo set, standards) · โมเดล (grid generator, nodes/members/supports tables, 3D view) ·
น้ำหนักบรรทุก (cases, wind, seismic generators) · วิเคราะห์ (run, choose case/combo, 3D diagram N/V/T/M, member detail SVG
diagrams, reactions, drift) · ออกแบบ (member groups → RC/steel design with steps, OK/NG) · มาตรฐาน/กฎหมาย (registry with
status, official link, last verified, badge) · รายการคำนวณ (report preview, engineer info, print/PDF).
Project saved to localStorage + export/import JSON.
