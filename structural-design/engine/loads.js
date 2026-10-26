/* engine/loads.js — load combinations, wind (MR2566 ข้อ 17 simplified + มยผ. 1311-50 static), seismic ELF, live-load reduction.
 * Units: kg, m, kg/m2 (kgf-based); angles none.  No DOM.
 *
 * HOW LOAD CASES ARE TAGGED (input to SD.loads.combos): each case = { id, type, dir? }
 *   type : 'D' | 'SD' (superimposed dead, grouped with D) | 'L' | 'Lr' (roof live, grouped with L) | 'W' | 'E' | 'H' | 'F' | 'T'
 *   dir  : 'X' | 'Y' for W and E cases, e.g. { id:'W_X', type:'W', dir:'X' }. If dir is missing it is inferred from an id
 *          ending in _X / _Y; if still unknown the case is treated as a single un-directed case (still expanded +/-).
 * W and E combinations are generated for +X, -X, +Y, -Y (only the directions that have cases). A negative sign multiplies
 * the factor of every case in that direction by -1 (linear analysis).
 * Combination id: <SET>_<METHOD>_<nn>, e.g. MR2566_SDM_07.
 */
(function (root) {
  const SD = root.SD = root.SD || {};
  if (typeof require === 'function' && typeof module !== 'undefined' && !SD.SolverError) require('./core.js');
  const SolverError = SD.SolverError;
  const rnd = (x, d) => SD.round(x, d === undefined ? 4 : d);
  const step = (label, formula, substituted, value, unit, clause) => ({ label, formula, substituted, value: typeof value === 'number' ? rnd(value, 4) : value, unit: unit || '', clause: clause || '' });
  const L = SD.loads = SD.loads || {};

  // ==================================================================== COMBINATIONS
  // term: [group, factor]; groups D L W E H F T. optional:true groups (H,F,T aggregate) need >=1 present.
  const T = (name, terms, o) => Object.assign({ name, terms }, o);
  const SETS = {
    MR2566: {
      label: 'กฎกระทรวง พ.ศ. 2566 (MR2566)', default: true, clause: 'กฎกระทรวง 2566 ข้อ 6-7',
      SDM: [
        T('1.4D+1.7L', [['D', 1.4], ['L', 1.7]]),
        T('0.75(1.4D+1.7L)+1.6W', [['D', 1.05], ['L', 1.275], ['W', 1.6]]),
        T('0.9D+1.6W', [['D', 0.9], ['W', 1.6]]),
        T('0.75(1.4D+1.7L)+1.0E', [['D', 1.05], ['L', 1.275], ['E', 1.0]]),
        T('0.9D+1.0E', [['D', 0.9], ['E', 1.0]]),
        T('1.4D+1.7L+1.7H', [['D', 1.4], ['L', 1.7], ['H', 1.7]]),
        T('0.9D+1.7H', [['D', 0.9], ['H', 1.7]]),
        T('1.4D+1.7L+1.4F', [['D', 1.4], ['L', 1.7], ['F', 1.4]]),
        T('0.9D+1.4F', [['D', 0.9], ['F', 1.4]]),
        T('0.75(1.4D+1.4T+1.7L)', [['D', 1.05], ['T', 1.05], ['L', 1.275]]),
        T('1.4D+1.4T', [['D', 1.4], ['T', 1.4]])
      ],
      WSD: [
        T('D+L', [['D', 1], ['L', 1]]),
        T('D+0.75(L+W)', [['D', 1], ['L', 0.75], ['W', 0.75]], { reduced: true }),
        T('0.6D+W', [['D', 0.6], ['W', 1]]),
        T('D+0.7E', [['D', 1], ['E', 0.7]]),
        T('D+0.525E+0.75L', [['D', 1], ['E', 0.525], ['L', 0.75]], { reduced: true }),
        T('0.6D+0.7E', [['D', 0.6], ['E', 0.7]]),
        T('D+L+H+F+T', [['D', 1], ['L', 1], ['H', 1], ['F', 1], ['T', 1]], { optional: ['H', 'F', 'T'] })
      ]
    },
    MR6_2527: {
      label: 'กฎกระทรวง ฉบับที่ 6 พ.ศ. 2527 (legacy, permits filed before 4 มี.ค. 2567)', default: false, clause: 'กฎกระทรวง ฉบับที่ 6 (2527)',
      SDM: [
        T('1.4D+1.7L', [['D', 1.4], ['L', 1.7]]),
        T('0.75(1.4D+1.7L+1.7W)', [['D', 1.05], ['L', 1.275], ['W', 1.275]]),
        T('0.9D+1.3W', [['D', 0.9], ['W', 1.3]])
      ],
      WSD: [
        T('D+L', [['D', 1], ['L', 1]]),
        T('0.75(D+L+W)', [['D', 0.75], ['L', 0.75], ['W', 0.75]], { reduced: true })
      ]
    },
    ACI318: {
      label: 'ACI 318 / ASCE 7 style (alternative generally accepted standard)', default: false, clause: 'ACI 318-14 §5.3',
      SDM: [
        T('1.4D', [['D', 1.4]]),
        T('1.2D+1.6L', [['D', 1.2], ['L', 1.6]]),
        T('1.2D+1.0L+1.6W', [['D', 1.2], ['L', 1.0], ['W', 1.6]]),
        T('0.9D+1.6W', [['D', 0.9], ['W', 1.6]]),
        T('1.2D+1.0L+1.0E', [['D', 1.2], ['L', 1.0], ['E', 1.0]]),
        T('0.9D+1.0E', [['D', 0.9], ['E', 1.0]])
      ],
      WSD: null // no WSD list defined for ACI318 -> falls back to MR2566 WSD (noted in warnings)
    }
  };
  const GROUP_OF = { D: 'D', SD: 'D', L: 'L', Lr: 'L', W: 'W', E: 'E', H: 'H', F: 'F', T: 'T' };

  function caseDir(c) {
    if (c.dir) return String(c.dir).toUpperCase();
    const m = /([XY])$/i.exec(c.id || '');
    if (!m) throw new SolverError('Cannot resolve direction of ' + c.type + ' case "' + c.id + '": set dir:"X"|"Y" or end the id with X or Y (e.g. W_X, WX)', 'BAD_CASE_DIR');
    return m[1].toUpperCase();
  }
  const clean = (x) => Math.round(x * 1e9) / 1e9;

  /**
   * SD.loads.combos(set, method, opts) -> combination[]
   *  set: 'MR2566' (default) | 'MR6_2527' | 'ACI318';  method: 'SDM' | 'WSD'
   *  opts.cases: [{id,type,dir?}] (required) — or opts.types: ['D','L',...] (synthesises ids D,L,W_X,...)
   *  opts.allowIncrease: false (default) | true -> adds allowIncrease:1.33 (opts.allowIncreaseFactor) to WSD combos with W/E
   *    that carry no 0.75 reduction (the 0.75 factors already stand in for it). Printed in the report when used.
   *  opts.dirs: ['X','Y'] restrict directions.
   *  A combo whose L term has no L case is generated without it (combo.droppedTypes=['L']); a combo whose W/E/H/F/T type is absent is skipped.
   *  W/E cases without `dir` must have an id ending in X or Y (W_X, WX) else BAD_CASE_DIR is thrown.
   */
  L.combos = function (setName, method, opts) {
    opts = opts || {};
    setName = setName || 'MR2566'; method = method || 'SDM';
    const set = SETS[setName];
    if (!set) throw new SolverError('Unknown combination set "' + setName + '" (use MR2566, MR6_2527 or ACI318)', 'BAD_COMBO_SET');
    if (method !== 'SDM' && method !== 'WSD') throw new SolverError('Method must be SDM or WSD', 'BAD_METHOD');
    let cases = opts.cases;
    if (!cases && opts.types) cases = opts.types.map(t => ({ id: t, type: t }));
    if (!Array.isArray(cases)) throw new SolverError('combos(): opts.cases (array of {id,type,dir}) is required', 'NO_CASES');
    const notes = [];
    let list = set[method];
    if (!list) { list = SETS.MR2566[method]; notes.push('Set ' + setName + ' has no ' + method + ' list; MR2566 ' + method + ' used'); }

    const groups = { D: [], L: [], W: [], E: [], H: [], F: [], T: [] };
    cases.forEach(c => { const g = GROUP_OF[c.type]; if (g) groups[g].push(c); });
    const out = [];
    const incFactor = opts.allowIncreaseFactor || 1.33;
    list.forEach(tpl => {
      let terms = tpl.terms;
      if (tpl.optional) {
        const opt = tpl.optional;
        if (!opt.some(g => groups[g].length)) return;
        terms = tpl.terms.filter(([g]) => opt.indexOf(g) < 0 || groups[g].length > 0);
      }
      // a missing live-load term is dropped (D-only version of the combo); any other absent defining type (W,E,H,F,T,D) skips the combo
      const dropped = [];
      if (groups.L.length === 0 && terms.some(([g]) => g === 'L')) { terms = terms.filter(([g]) => g !== 'L'); dropped.push('L'); }
      if (!terms.length || terms.some(([g]) => groups[g].length === 0)) return;
      const latTerm = terms.find(([g]) => g === 'W' || g === 'E');
      const base = {};
      terms.forEach(([g, f]) => { if (g !== 'W' && g !== 'E') groups[g].forEach(c => { base[c.id] = clean((base[c.id] || 0) + f); }); });
      const eligible = !tpl.reduced && !!latTerm;
      const mk = (factors, name, lateral) => {
        const o = { id: setName + '_' + method + '_' + String(out.length + 1).padStart(2, '0'), name, method, set: setName, factors, lateral: lateral || null, clause: set.clause };
        if (dropped.length) o.droppedTypes = dropped;
        if (method === 'WSD' && opts.allowIncrease && eligible) o.allowIncrease = incFactor;
        out.push(o);
      };
      if (!latTerm) { mk(base, tpl.name, null); return; }
      const [lg, lf] = latTerm;
      const dirs = Array.from(new Set(groups[lg].map(caseDir))).sort();
      dirs.filter(d => !opts.dirs || opts.dirs.indexOf(d) >= 0).forEach(d => {
        [1, -1].forEach(sg => {
          const f = Object.assign({}, base);
          groups[lg].filter(c => caseDir(c) === d).forEach(c => { f[c.id] = clean(sg * lf); });
          mk(f, tpl.name + ' [' + lg + (sg > 0 ? '+' : '-') + d + ']', { type: lg, dir: d, sign: sg });
        });
      });
    });
    out.notes = notes;
    return out;
  };
  L.combos.sets = Object.keys(SETS).map(k => ({ id: k, label: SETS[k].label, default: SETS[k].default, clause: SETS[k].clause }));
  L.combos.defaultSet = 'MR2566';

  // ==================================================================== WIND
  const W = L.wind = {};
  const RHO_AIR = 1.25; // kg/m3
  W.dynamicPressure = (V) => 0.5 * RHO_AIR * V * V / SD.G; // kg/m2
  W.Iw = { low: 0.8, normal: 1.0, high: 1.15, essential: 1.15, serviceability: 0.75 }; // [VERIFY]
  // ONE terrain mapping for every wind function. 'open'|'A'|'coastal' -> open ; 'rough'|'B'|'city' -> rough/city. Anything else (incl. missing) throws.
  const terrainKey = function (t) {
    if (t === 'open' || t === 'A' || t === 'coastal') return 'open';
    if (t === 'rough' || t === 'B' || t === 'city') return 'rough';
    throw new SolverError('terrain is required: "open" (A/coastal) or "rough"/"city" (B); got ' + t, 'BAD_WIND');
  };
  const reqNum = function (v, name, fn, positive) {
    if (typeof v !== 'number' || !isFinite(v) || (positive && !(v > 0))) throw new SolverError(fn + ': ' + name + ' must be a finite number' + (positive ? ' > 0' : '') + ' (got ' + v + ')', 'BAD_WIND');
    return v;
  };
  const checkFloors = function (floors, fn) {
    if (!Array.isArray(floors) || !floors.length) throw new SolverError(fn + ': floors[] is required', 'BAD_WIND');
    floors.forEach(f => { reqNum(f.z, 'floor z', fn, false); reqNum(f.width, 'floor width', fn, true); });
  };
  /** Ce exposure factor at height z: open (A) (z/10)^0.2 >= 0.9 ; rough (B) 0.7 (z/12)^0.3 >= 0.7 [VERIFY] */
  W.Ce = function (terrain, z) {
    return terrainKey(terrain) === 'open' ? Math.max(0.9, Math.pow(Math.max(z, 1e-6) / 10, 0.2)) : Math.max(0.7, 0.7 * Math.pow(Math.max(z, 1e-6) / 12, 0.3));
  };

  function windCp(par, warnings) {
    if (typeof par.Cp === 'number') return { ww: par.Cp, lw: 0, net: par.Cp, note: 'net Cp given' };
    const ww = par.Cp && par.Cp.windward !== undefined ? par.Cp.windward : 0.8;
    const hd = par.D ? par.H / par.D : null;
    // leeward may be given with the spec sign (-0.5) or as a magnitude (0.5): |leeward| is used, net Cp = windward + |leeward|
    const lw = par.Cp && par.Cp.leeward !== undefined ? Math.abs(par.Cp.leeward) : (hd === null || hd >= 1 ? 0.5 : 0.3);
    if (!par.Cp) warnings.push('Cp defaults (windward +0.8, leeward -0.5 for H/D>=1, else -0.3) are seed values [VERIFY มยผ. 1311-50]');
    return { ww, lw, net: ww + lw, note: 'windward ' + ww + ' + leeward ' + lw };
  }

  /** SD.loads.wind.static({V50, Iw, terrain, H, D, Cg, Cp, fn, z}) -> { q, Ce, p, applicable, warnings, steps } (p in kg/m2) */
  W.static = function (par) {
    reqNum(par.V50, 'V50', 'wind.static', true); reqNum(par.H, 'H', 'wind.static', true);
    terrainKey(par.terrain);
    if (par.D !== undefined) reqNum(par.D, 'D', 'wind.static', true);
    if (par.Cg !== undefined) reqNum(par.Cg, 'Cg', 'wind.static', true);
    if (par.z !== undefined) reqNum(par.z, 'z', 'wind.static', true);
    if (typeof par.Iw === 'string' && W.Iw[par.Iw] === undefined) throw new SolverError('wind.static: unknown Iw key ' + par.Iw, 'BAD_WIND');
    if (typeof par.Cp === 'number') reqNum(par.Cp, 'Cp', 'wind.static', true);
    const warnings = ['มยผ. 1311-50 formulas/coefficients are seed values [VERIFY revision] - not verified against the standard'];
    const steps = [], cl = 'มยผ. 1311-50 [VERIFY]';
    const Iw = typeof par.Iw === 'string' ? W.Iw[par.Iw] : (par.Iw === undefined ? 1.0 : par.Iw);
    const z = par.z === undefined ? par.H : par.z;
    const Cg = par.Cg === undefined ? 2.0 : par.Cg;
    const q = W.dynamicPressure(par.V50);
    steps.push(step('Dynamic pressure q', 'q = 0.5 x rho x V^2 / g', '0.5 x ' + RHO_AIR + ' x ' + par.V50 + '^2 / ' + SD.G, q, 'kg/m2', cl));
    const Ce = W.Ce(par.terrain, z);
    const open = terrainKey(par.terrain) === 'open';
    steps.push(step('Exposure factor Ce', open ? 'Ce = max(0.9, (H/10)^0.2)' : 'Ce = max(0.7, 0.7 (H/12)^0.3)', 'H = ' + z + ' m', Ce, '-', cl));
    const cp = windCp(par, warnings);
    steps.push(step('Pressure coefficient Cp', 'Cp = windward + leeward', cp.note, cp.net, '-', cl));
    const p = Iw * q * Ce * Cg * cp.net;
    steps.push(step('Design wind pressure p', 'p = Iw x q x Ce x Cg x Cp', Iw + ' x ' + rnd(q) + ' x ' + rnd(Ce) + ' x ' + Cg + ' x ' + cp.net, p, 'kg/m2', cl));
    let applicable = true;
    if (!(par.H < 80)) { applicable = false; warnings.push('H >= 80 m: dynamic procedure required'); }
    if (par.D && !(par.H / par.D < 3)) { applicable = false; warnings.push('H/D >= 3: dynamic procedure required'); }
    if (par.fn !== undefined && !(par.fn > 1)) { applicable = false; warnings.push('fn <= 1 Hz: dynamic procedure required'); }
    if (par.fn === undefined) warnings.push('fn (natural frequency) not provided; static-procedure check fn > 1 Hz not performed');
    if (!par.D) warnings.push('D not provided; H/D < 3 check not performed');
    steps.push(step('Static procedure applicability', 'H < 80 m, H/D < 3, fn > 1 Hz', 'H = ' + par.H + (par.D ? ', H/D = ' + rnd(par.H / par.D, 2) : ''), applicable ? 'applicable' : 'dynamic procedure required', '', cl));
    return { q, Ce, Iw, Cg, Cp: cp.net, p, applicable, warnings, steps };
  };

  /** Story forces from a static pressure. floors: [{z, width, breadth?}] (z = level elevation m, width = facade width normal to wind m,
   *  breadth = plan dimension normal to the wind direction used for the 5% eccentricity, default = width).
   *  Tributary height = from mid-way to the level below (ground = 0 for the first level) to mid-way to the level above; top level up to
   *  z + parapet (par.parapet, default 0).  Pressure evaluated at each level's own height. Returns array [{z,F,p,Ce,trib,Mt}] (+ .steps .baseShear). */
  W.storyForces = function (par, floors) {
    checkFloors(floors, 'wind.storyForces');
    const fl = floors.slice().sort((a, b) => a.z - b.z), out = [], steps = [];
    let base = 0;
    fl.forEach((f, i) => {
      const below = i === 0 ? 0 : fl[i - 1].z, lo = i === 0 ? f.z / 2 : (f.z + below) / 2;
      const hi = i === fl.length - 1 ? f.z + (par.parapet || 0) : (f.z + fl[i + 1].z) / 2;
      const trib = Math.max(0, hi - lo);
      const r = W.static(Object.assign({}, par, { z: Math.max(f.z, 1e-3) }));
      const F = r.p * f.width * trib, e = 0.05 * (f.breadth || f.width);
      base += F;
      out.push({ z: f.z, F, p: r.p, Ce: r.Ce, trib, ecc: e, Mt: F * e });
      steps.push(step('Story force at z = ' + f.z + ' m', 'F = p x width x tributary height', rnd(r.p) + ' x ' + f.width + ' x ' + rnd(trib), F, 'kg', 'มยผ. 1311-50 [VERIFY]'));
    });
    steps.push(step('Wind base shear', 'V = sum F', out.length + ' levels', base, 'kg', ''));
    out.steps = steps; out.baseShear = base;
    return out;
  };

  /** MR2566 ข้อ 17 simplified wind pressure (kg/m2). {H, terrain:'city'|'open', publicLarge, B?, area?} */
  const MR17 = { city: [[10, 60], [20, 80], [40, 120]], open: [[10, 100], [20, 120], [40, 160]] };
  W.mr2566Pressure = function (terrain, z) {
    const tab = MR17[terrainKey(terrain) === 'open' ? 'open' : 'city'];
    reqNum(z, 'height', 'wind.mr2566Pressure', true);
    for (const [hmax, p] of tab) if (z <= hmax) return p;
    return tab[tab.length - 1][1];
  };
  W.mr2566Simple = function (par) {
    reqNum(par.H, 'H', 'wind.mr2566Simple', true);
    if (par.B !== undefined) reqNum(par.B, 'B', 'wind.mr2566Simple', true);
    const cl = 'MR2566 ข้อ 17', warnings = [], steps = [];
    const terrain = terrainKey(par.terrain) === 'open' ? 'open' : 'city';
    const pBase = W.mr2566Pressure(terrain, par.H);
    steps.push(step('Simplified pressure at H', 'table: ' + (terrain === 'open' ? '100/120/160' : '60/80/120') + ' kg/m2 for 0-10/10-20/20-40 m', 'H = ' + par.H + ' m, ' + terrain, pBase, 'kg/m2', cl));
    const mult = par.publicLarge ? 1.15 : 1;
    if (par.publicLarge) steps.push(step('Public building >= 1,000 m2', 'p x 1.15', rnd(pBase) + ' x 1.15', pBase * mult, 'kg/m2', cl));
    let applicable = par.H <= 40;
    if (par.H > 40) warnings.push('H > 40 m: simplified method not applicable (use มยผ. 1311-50)');
    if (par.B !== undefined) { if (par.H > 3 * par.B) { applicable = false; warnings.push('H > 3B: simplified method not applicable'); } }
    else warnings.push('B not provided; H <= 3B check not performed');
    steps.push(step('Applicability', 'H <= 40 m and H <= 3B', 'H = ' + par.H + (par.B !== undefined ? ', B = ' + par.B : ''), applicable ? 'applicable' : 'not applicable', '', cl));
    return { p: pBase * mult, pBase, multiplier: mult, applicable, warnings, steps };
  };
  /** Story forces with the ข้อ 17 banded pressure (pressure taken at each level's height). Same floors format as storyForces. */
  W.mr2566StoryForces = function (par, floors) {
    checkFloors(floors, 'wind.mr2566StoryForces'); terrainKey(par.terrain);
    const fl = floors.slice().sort((a, b) => a.z - b.z), out = [], steps = [];
    let base = 0;
    fl.forEach((f, i) => {
      const lo = i === 0 ? f.z / 2 : (f.z + fl[i - 1].z) / 2, hi = i === fl.length - 1 ? f.z + (par.parapet || 0) : (f.z + fl[i + 1].z) / 2;
      const trib = Math.max(0, hi - lo), p = W.mr2566Pressure(par.terrain, Math.max(f.z, 1e-3)) * (par.publicLarge ? 1.15 : 1);
      const F = p * f.width * trib; base += F;
      out.push({ z: f.z, F, p, trib, ecc: 0.05 * (f.breadth || f.width), Mt: F * 0.05 * (f.breadth || f.width) });
      steps.push(step('Story force at z = ' + f.z + ' m', 'F = p x width x tributary height', rnd(p) + ' x ' + f.width + ' x ' + rnd(trib), F, 'kg', 'MR2566 ข้อ 17'));
    });
    out.steps = steps; out.baseShear = base;
    return out;
  };

  // ==================================================================== LIVE LOAD REDUCTION (MR2566 ข้อ 13/14)
  // floorsBelowRoof: 0 = roof, 1 = first floor below roof, ... Percentages: 0 for roof + 3 floors below, then 10,20,30,40, 50 max.
  // [VERIFY] the exact floor mapping against the gazette text (brief says "max 50% from 7th floor below roof").
  // index = floors below roof: roof 0, 1st-3rd below 0, 4th 10, 5th 20, 6th 30, 7th 40, 8th and below 50 [VERIFY vs MR2566 ข้อ 13]
  L.LL_REDUCTION_PCT = [0, 0, 0, 0, 10, 20, 30, 40, 50]; // conservative reading: roof + first three floors below = 0 %
  /** occupancy: live-load id (SD.materials.liveLoads) or {id?, q, reductionAllowed?} -> {pct, factor, allowed, steps, warnings} */
  L.liveLoadReduction = function (floorsBelowRoof, occupancy) {
    const warnings = ['Reduction table mapping to floors below roof is [VERIFY] against MR2566 ข้อ 13'], cl = 'MR2566 ข้อ 13/14';
    let occ = occupancy;
    if (typeof occ === 'string') {
      occ = SD.materials && SD.materials.liveLoadById ? SD.materials.liveLoadById(occ) : null;
      if (!occ) throw new SolverError('Unknown occupancy "' + occupancy + '"', 'BAD_OCCUPANCY');
    }
    occ = occ || {};
    const n = Math.max(0, Math.round(floorsBelowRoof));
    let allowed = occ.reductionAllowed !== false && !(occ.q > 500);
    const steps = [];
    let pct = 0;
    if (!allowed) steps.push(step('Reduction not allowed', 'assembly, school, hospital, warehouse/factory, parking, or LL > 500 kg/m2', 'LL = ' + (occ.q === undefined ? '?' : occ.q), 0, '%', cl));
    else {
      pct = L.LL_REDUCTION_PCT[Math.min(n, L.LL_REDUCTION_PCT.length - 1)];
      steps.push(step('Live-load reduction', 'table by floors below roof', n + ' floor(s) below roof', pct, '%', cl));
    }
    return { pct, factor: 1 - pct / 100, allowed, steps, warnings };
  };
  /** Impact factor ข้อ 16: returns multiplier for the live load e.g. 'lift' -> 2.0 */
  L.impactMultiplier = (id) => { const r = SD.materials && SD.materials.impact.find(x => x.id === id); if (!r) throw new SolverError('Unknown impact id ' + id, 'BAD_IMPACT'); return 1 + r.additionalPct / 100; };

  // ==================================================================== SEISMIC (ELF)
  const S = L.seismic = {};
  // ASCE 7-10 Tables 11.4-1 / 11.4-2 — FLAGGED UNVERIFIED against the Thai standard [DO NOT SHIP UNVERIFIED]
  S.FA_TABLE = { ss: [0.25, 0.5, 0.75, 1.0, 1.25], A: [0.8, 0.8, 0.8, 0.8, 0.8], B: [1.0, 1.0, 1.0, 1.0, 1.0], C: [1.2, 1.2, 1.1, 1.0, 1.0], D: [1.6, 1.4, 1.2, 1.1, 1.0], E: [2.5, 1.7, 1.2, 0.9, 0.9], verified: false, source: 'ASCE 7-10 Table 11.4-1' };
  S.FV_TABLE = { s1: [0.1, 0.2, 0.3, 0.4, 0.5], A: [0.8, 0.8, 0.8, 0.8, 0.8], B: [1.0, 1.0, 1.0, 1.0, 1.0], C: [1.7, 1.6, 1.5, 1.4, 1.3], D: [2.4, 2.0, 1.8, 1.6, 1.5], E: [3.5, 3.2, 2.8, 2.4, 2.4], verified: false, source: 'ASCE 7-10 Table 11.4-2' };
  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 0; i + 1 < xs.length; i++) if (x <= xs[i + 1]) return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i]);
  }
  S.Fa = (site, Ss) => { const r = S.FA_TABLE[site]; if (!r) throw new SolverError('Site class ' + site + ': Fa needs a site-specific study (class F) or is undefined', 'BAD_SITE'); return interp(S.FA_TABLE.ss, r, Ss); };
  S.Fv = (site, S1) => { const r = S.FV_TABLE[site]; if (!r) throw new SolverError('Site class ' + site + ': Fv needs a site-specific study (class F) or is undefined', 'BAD_SITE'); return interp(S.FV_TABLE.s1, r, S1); };

  // R / Omega0 / Cd (seed per spec) and approximate-period type
  S.SYSTEMS = {
    RC_SMF: { R: 8, Omega0: 3, Cd: 5.5, period: 'concreteMF' }, RC_IMF: { R: 5, Omega0: 3, Cd: 4.5, period: 'concreteMF' }, RC_OMF: { R: 3, Omega0: 3, Cd: 2.5, period: 'concreteMF' },
    RC_SW_SPECIAL: { R: 6, Omega0: 2.5, Cd: 5, period: 'other' }, RC_SW_ORDINARY: { R: 5, Omega0: 2.5, Cd: 4.5, period: 'other' }, RC_DUAL: { R: 7, Omega0: 2.5, Cd: 5.5, period: 'other' },
    STEEL_SMF: { R: 8, Omega0: 3, Cd: 5.5, period: 'steelMF' }, STEEL_IMF: { R: 4.5, Omega0: 3, Cd: 4, period: 'steelMF' }, STEEL_OMF: { R: 3.5, Omega0: 3, Cd: 3, period: 'steelMF' },
    STEEL_SCBF: { R: 6, Omega0: 2, Cd: 5, period: 'other' }
  };
  S.CT = { steelMF: [0.0724, 0.8], concreteMF: [0.0466, 0.9], EBF: [0.0731, 0.75], BRBF: [0.0731, 0.75], other: [0.0488, 0.75] }; // hn in metres
  S.Cu = (SD1) => interp([0.1, 0.15, 0.2, 0.3, 0.4], [1.7, 1.6, 1.5, 1.4, 1.4], SD1);
  S.sdc = function (SDS, SD1, S1, Ie) {
    const a = SDS < 0.167 ? 'A' : SDS < 0.33 ? 'B' : SDS < 0.5 ? 'C' : 'D';
    const b = SD1 < 0.067 ? 'A' : SD1 < 0.133 ? 'B' : SD1 < 0.2 ? 'C' : 'D';
    let c = a > b ? a : b;
    if (S1 >= 0.75) c = Ie >= 1.5 ? 'F' : 'E';
    return c;
  };

  /** SD.loads.seismic.elf({Ss,S1,site,Ie,R,Cd,Omega0,system,hn,storeys:[{h,w}],TL,Tcalc?,Fa?,Fv?,irregular?,breadth?,zone2564?}) -> result.
   *  Ss and S1 must be finite numbers (>= 0) else BAD_SEISMIC. zone2564 (1|2|3, optional) only adds a warning: Ss/S1 must still come from มยผ. 1301/1302-61.
   *  storeys[i].h = elevation of level i above the base (m); w = seismic weight of level (kg).  system = key of S.SYSTEMS (fills R/Omega0/Cd)
   *  or an approximate-period type (steelMF|concreteMF|EBF|BRBF|other). forces[] = [{h,w,Cvx,F,Vstory,Mt}]. */
  S.elf = function (par) {
    const warnings = ['Fa/Fv tables are ASCE 7-10 values, NOT verified against มยผ. 1301/1302-61 [DO NOT SHIP UNVERIFIED]'], steps = [];
    const cl = 'มยผ. 1301/1302-61 / ASCE 7-10 §12.8 [VERIFY]';
    const num = (v, name, positive) => { if (typeof v !== 'number' || !isFinite(v) || (positive ? !(v > 0) : v < 0)) throw new SolverError('seismic.elf: ' + name + ' must be a finite number' + (positive ? ' > 0' : ' >= 0') + ' (got ' + v + ')', 'BAD_SEISMIC'); return v; };
    num(par.Ss, 'Ss', false); num(par.S1, 'S1', false);
    if (par.Ie !== undefined) num(par.Ie, 'Ie', true);
    if (par.zone2564 !== undefined && par.zone2564 !== null) warnings.push('จังหวัดอยู่ในเขตควบคุมแผ่นดินไหว เขต ' + par.zone2564 + ' ตามกฎกระทรวง 2564 — ต้องกรอก Ss/S1 จาก มยผ. 1301/1302-61');
    const sys = S.SYSTEMS[par.system] || {};
    const R = par.R !== undefined ? par.R : sys.R, Cd = par.Cd !== undefined ? par.Cd : sys.Cd, Om = par.Omega0 !== undefined ? par.Omega0 : sys.Omega0;
    if (!(R > 0)) throw new SolverError('seismic.elf: R is required (or a known `system`)', 'BAD_SEISMIC');
    const Ie = par.Ie === undefined ? 1.0 : par.Ie, site = par.site || 'D', hn = par.hn;
    if (!(hn > 0)) throw new SolverError('seismic.elf: hn (m) is required', 'BAD_SEISMIC');
    const stor = par.storeys || [];
    stor.forEach((e, i) => { num(e.h, 'storeys[' + i + '].h', true); num(e.w, 'storeys[' + i + '].w', true); });
    if (!stor.length) throw new SolverError('seismic.elf: storeys[] is required', 'BAD_SEISMIC');
    let TL = par.TL; if (!TL) { TL = 4; warnings.push('TL not provided; 4 s assumed (placeholder) [VERIFY]'); }
    const Fa = par.Fa !== undefined ? par.Fa : S.Fa(site, par.Ss), Fv = par.Fv !== undefined ? par.Fv : S.Fv(site, par.S1);
    const SMS = Fa * par.Ss, SM1 = Fv * par.S1, SDS = 2 / 3 * SMS, SD1 = 2 / 3 * SM1;
    steps.push(step('Site coefficients', 'Fa(Ss, site), Fv(S1, site)', 'site ' + site + ', Ss = ' + par.Ss + ', S1 = ' + par.S1, 'Fa = ' + rnd(Fa, 3) + ', Fv = ' + rnd(Fv, 3), '', 'ASCE 7-10 Tables 11.4-1/2 [unverified]'));
    steps.push(step('Design spectral accelerations', 'SDS = 2/3 Fa Ss ; SD1 = 2/3 Fv S1', 'SDS = 2/3 x ' + rnd(Fa, 3) + ' x ' + par.Ss + ' ; SD1 = 2/3 x ' + rnd(Fv, 3) + ' x ' + par.S1, 'SDS = ' + rnd(SDS) + ', SD1 = ' + rnd(SD1), 'g', cl));
    const pt = sys.period || (S.CT[par.system] ? par.system : 'other');
    const [Ct, x] = S.CT[par.periodType || pt];
    const Ta = Ct * Math.pow(hn, x), Cu = S.Cu(SD1);
    steps.push(step('Approximate period Ta', 'Ta = Ct x hn^x', Ct + ' x ' + hn + '^' + x, Ta, 's', cl));
    steps.push(step('Upper-limit coefficient Cu', 'interpolated on SD1', 'SD1 = ' + rnd(SD1), Cu, '-', cl));
    let T = Ta;
    if (par.Tcalc) { T = Math.min(par.Tcalc, Cu * Ta); steps.push(step('Period used', 'T = min(Tcalc, Cu Ta)', 'min(' + par.Tcalc + ', ' + rnd(Cu * Ta) + ')', T, 's', cl)); }
    const rI = R / Ie;
    const CsCalc = SDS / rI;
    const CsMax = T <= TL ? SD1 / (T * rI) : SD1 * TL / (T * T * rI);
    const CsMin = Math.max(0.044 * SDS * Ie, 0.01);
    let Cs = Math.min(CsCalc, CsMax);
    steps.push(step('Seismic response coefficient', 'Cs = min( SDS/(R/Ie), SD1/(T(R/Ie)) [or SD1 TL/(T^2 (R/Ie)) if T > TL] )', 'min(' + rnd(CsCalc, 4) + ', ' + rnd(CsMax, 4) + ')', Cs, '-', cl));
    let lower = CsMin, lowerNote = 'max(0.044 SDS Ie, 0.01)';
    if (par.S1 >= 0.6) { const l6 = 0.5 * par.S1 / rI; if (l6 > lower) { lower = l6; lowerNote = '0.5 S1/(R/Ie)'; } }
    if (Cs < lower) { Cs = lower; steps.push(step('Cs lower bound governs', lowerNote, 'Cs = ' + rnd(lower, 4), Cs, '-', cl)); }
    const Wtot = stor.reduce((s, e) => s + e.w, 0), V = Cs * Wtot;
    steps.push(step('Base shear', 'V = Cs x W', rnd(Cs, 4) + ' x ' + rnd(Wtot, 1), V, 'kg', cl));
    const k = T <= 0.5 ? 1 : T >= 2.5 ? 2 : 1 + (T - 0.5) / 2;
    steps.push(step('Distribution exponent k', 'k = 1 (T<=0.5), 2 (T>=2.5), linear between', 'T = ' + rnd(T, 3), k, '-', cl));
    const den = stor.reduce((s, e) => s + e.w * Math.pow(e.h, k), 0);
    let acc = 0;
    const forces = stor.slice().sort((a, b) => b.h - a.h).map(e => {
      const Cvx = e.w * Math.pow(e.h, k) / den, F = Cvx * V; acc += F;
      return { h: e.h, w: e.w, Cvx, F, Vstory: acc, Mt: F * 0.05 * (e.breadth || par.breadth || 0) };
    }).reverse();
    steps.push(step('Vertical distribution', 'Fx = Cvx V, Cvx = wx hx^k / sum(wi hi^k)', 'k = ' + rnd(k, 3), forces.map(f => rnd(f.F, 1)).join(', '), 'kg', cl));
    const sdc = S.sdc(SDS, SD1, par.S1, Ie);
    steps.push(step('Seismic design category', 'max(SDC by SDS, SDC by SD1); S1 >= 0.75 => E/F', 'SDS = ' + rnd(SDS) + ', SD1 = ' + rnd(SD1), sdc, '', 'ASCE 7-10 Table 11.6 [VERIFY vs Thai SDC]'));
    const Ts = SDS > 0 ? SD1 / SDS : 0;
    if (par.irregular) warnings.push('Structure is irregular: ELF may not be permitted - dynamic analysis required');
    if ((sdc === 'D' || sdc === 'E' || sdc === 'F') && T >= 3.5 * Ts) warnings.push('T >= 3.5 Ts in SDC D-F: ELF limited, dynamic analysis required');
    if (par.breadth === undefined && !stor.some(e => e.breadth)) warnings.push('No plan breadth given: accidental torsion (5%) moments not computed');
    if (T > TL) warnings.push('T > TL: long-period branch of Cs used');
    return { SMS, SM1, SDS, SD1, Fa, Fv, Ta, Cu, T, Cs, CsCalc, CsMax, CsMin, V, W: Wtot, k, forces, SDC: sdc, R, Cd, Omega0: Om, Ie, TL, warnings, steps };
  };
  /** Drift check: delta = Cd x deltaE / Ie <= limit x hsx (default 0.020 hsx, RC risk I/II) */
  S.drift = function (par) {
    const lim = par.limit === undefined ? 0.020 : par.limit;
    const delta = par.Cd * par.deltaE / (par.Ie || 1), allow = lim * par.hsx;
    const steps = [
      step('Amplified story drift', 'delta = Cd x deltaE / Ie', par.Cd + ' x ' + rnd(par.deltaE, 5) + ' / ' + (par.Ie || 1), delta, 'm', 'ASCE 7-10 §12.8.6 [VERIFY]'),
      step('Allowable drift', 'delta_a = ' + lim + ' x hsx', lim + ' x ' + par.hsx, allow, 'm', 'ASCE 7-10 Table 12.12-1 / มยผ. 1301-61 [VERIFY]')
    ];
    return { delta, allow, ratio: allow > 0 ? delta / allow : Infinity, ok: delta <= allow, steps };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SD.loads;
})(typeof globalThis !== 'undefined' ? globalThis : this);
