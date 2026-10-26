/* engine/rc.js — reinforced-concrete member design: beam, slab, column, isolated footing; SDM and WSD.
 * Self-registers on globalThis.SD.rc.  No load-time dependency on other engine files.
 *
 * UNITS (design modules): kg, cm, ksc.  Cross-section dimensions, cover, bar spacing in cm; bar diameters db in mm;
 *   areas cm2; stresses ksc.  INPUT/OUTPUT MOMENTS ARE IN kg-m (converted internally to kg-cm).  Forces in kg.
 *   Optional `dp` = depth to compression steel (cm) overrides the computed value.  Member lengths (span, la, lb, lu) are in METRES.  Slab loads wD, wL in kg/m2.  Footing: B, L, h, cover, col in cm,
 *   qa in kg/cm2 (ksc; or qa_tm2 in t/m2), soilCover in cm, gammaSoil in kg/m3, loads kg, moments kg-m.
 *
 * `set` : 'MR2566' (default) | 'MR6_2527' | 'ACI318';  `qc` : true (default) | false  (quality control, affects phi for MR sets)
 *   MR2566/MR6_2527 phi (QC / no QC): flexure 0.90/0.75, spiral 0.75/0.625, tied 0.70/0.60, shear+torsion 0.85/0.70, bearing 0.70/0.60; rho_max = 0.75 rho_b.
 *   ACI318 phi: 0.90 / spiral 0.75 / tied 0.65 / shear 0.75 / bearing 0.65 with eps_t transition; eps_t >= 0.004.
 * AXIAL CONVENTION: Pu / P positive = COMPRESSION.  Columns: Pu<0 uses the tension branch of the P-M curve (SDM) / is a hard warning (WSD).
 *   Footings: Pu or P_service < 0 (uplift) -> error + hard warning.  Required demands (Mu,Vu / M,V / Pu / P / Pu+P_service) missing or non-finite -> {ok:false,error}.
 * Two-way slabs: the coefficient table is unverified, so slabTwoWay is ok=false (hard warning) unless allowUnverified:true is passed.
 * Footing punching: position 'edge' (3-sided bo, c1 perpendicular to the free edge) / 'corner' (2-sided); moment transfer gamma_v*M*c/Jc is computed for
 *   interior columns only; edge/corner with Mu>0 is a hard warning.
 * Beams: bars needing >1 layer shift d to the layered centroid (clear layer spacing max(db,2.5) cm); with a user-supplied d this is a hard warning.
 * WSD: allowIncrease true|1.33 multiplies allowable stresses (DEFAULT OFF — the regulation states no 1.33 increase).
 *
 * Return shape (docs/ARCHITECTURE.md): {ok, ratio, checks[], steps[], warnings[], hardWarnings[], inputs, ...extras}.
 * Hard warnings also force ok=false.
 *
 * Public: beamSDM, beamWSD, slabOneWay, slabTwoWay (+ twoWayCoefTable, verified:false), columnSDM, columnWSD, footingSDM, footingWSD. */
(function (root) {
  'use strict';
  const SD = root.SD = root.SD || {};
  const rc = SD.rc = SD.rc || {};
  const ES = 2.04e6, PI = Math.PI, sqrt = Math.sqrt;
  const CL_MR = 'กฎกระทรวง 2566 ข้อ 7';

  // ------------------------------------------------------------------ helpers
  const f = (x, n) => (typeof x === 'number' && isFinite(x)) ? String(+x.toFixed(n === undefined ? 2 : n)) : String(x);
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  function ctx() {
    const c = { checks: [], steps: [], warnings: [], hard: [] };
    c.step = (label, formula, substituted, value, unit, clause) => { c.steps.push({ label, formula, substituted, value, unit: unit || '', clause: clause || '' }); return value; };
    c.check = (name, demand, capacity, unit, clause) => {
      const badNum = !isFinite(demand) || !isFinite(capacity) || demand < 0;
      const ratio = badNum ? 999 : (capacity > 1e-12 ? demand / capacity : (demand > 1e-12 ? 999 : 0));
      c.checks.push({ name, demand, capacity, ratio, ok: !badNum && ratio <= 1 + 1e-9, unit: unit || '', clause: clause || '' });
    };
    c.finish = (inputs, extra) => {
      const ratio = c.checks.reduce((m, k) => Math.max(m, k.ratio), 0);
      return Object.assign({ ok: c.checks.every((k) => k.ok) && c.hard.length === 0, ratio, checks: c.checks, steps: c.steps,
        warnings: c.warnings.concat(c.hard), hardWarnings: c.hard, inputs }, extra || {});
    };
    return c;
  }
  function bad(msg, inputs) { return { ok: false, ratio: 999, checks: [], steps: [], warnings: [msg], hardWarnings: [msg], error: msg, inputs }; }
  const fin = (x) => typeof x === 'number' && isFinite(x);
  function layerShift(bs, avail) {
    if (!bs) return 0;
    const smin = Math.max(bs.db / 10, 2.5), nMax = Math.max(1, Math.floor((avail + smin) / (bs.db / 10 + smin))), layers = Math.ceil(bs.n / nMax);
    return layers > 1 ? (layers - 1) * (bs.db / 10 + smin) / 2 : 0;
  }
  const pos = (x) => typeof x === 'number' && isFinite(x) && x > 0;

  function phis(set, qc) {
    set = set || 'MR2566';
    if (set === 'ACI318') return { set, aci: true, flex: 0.9, spiral: 0.75, tied: 0.65, v: 0.75, bearing: 0.65, clause: 'ACI 318 §21.2' };
    const q = qc !== false;
    return { set: set === 'MR6_2527' ? 'MR6_2527' : 'MR2566', qc: q, aci: false, flex: q ? 0.90 : 0.75, spiral: q ? 0.75 : 0.625, tied: q ? 0.70 : 0.60,
      v: q ? 0.85 : 0.70, bearing: q ? 0.70 : 0.60, clause: CL_MR + (q ? ' (มี QC)' : ' (ไม่มี QC)') };
  }
  const beta1 = (fc) => fc <= 280 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 280) / 70);
  const Ec = (fc) => 15100 * sqrt(fc);
  const barA = (db) => PI * Math.pow(db / 10, 2) / 4;           // db mm -> cm2
  const fsAllow = (fy) => fy <= 2400 ? 1200 : fy <= 3000 ? 1500 : 1700;
  const rhoB = (fc, fy) => 0.85 * beta1(fc) * (fc / fy) * (6120 / (6120 + fy));
  const rhoMax = (P, fc, fy) => P.aci ? 0.85 * beta1(fc) * (fc / fy) * (0.003 / 0.007) : 0.75 * rhoB(fc, fy);
  function phiStrainFlex(P, et, fy) {            // beams / flexure only
    if (!P.aci) return P.flex;
    const ey = fy / ES;
    if (et >= ey + 0.003) return P.flex;
    if (et <= ey) return P.tied;
    return P.tied + (P.flex - P.tied) * (et - ey) / 0.003;
  }
  /** minimum / temperature steel ratio (slabs, footings). Spec: SR24 0.0025; SD30/SD40 0.0020; fy>4000 0.0018 (x4200/fy, >=0.0014) */
  function rhoTemp(fy) { return fy <= 2400 ? 0.0025 : fy <= 4000 ? 0.0020 : Math.max(0.0014, Math.min(0.0018, 0.0018 * 4200 / fy)); }
  function minHFactor(fy) { return fy === 4000 ? 1 : 0.4 + fy / 7000; }           // spec: applied when fy != 4000

  /** required As (cm2) for rectangular section, SDM. Mu kg-cm. returns null if section too small for singly reinforced */
  function sdmAs(Mu, b, d, fc, fy, phi) {
    const Rn = Mu / (phi * b * d * d), disc = 1 - 2 * Rn / (0.85 * fc);
    if (disc < 0) return null;
    const rho = 0.85 * fc / fy * (1 - sqrt(disc));
    return { rho, As: rho * b * d, Rn };
  }
  /** WSD singly-reinforced design: fcA, fsA allowable ksc, n modular ratio. M kg-cm. */
  function wsdAs(M, b, d, fcA, fsA, n) {
    const kb = n * fcA / (n * fcA + fsA), jb = 1 - kb / 3, MR = 0.5 * fcA * kb * jb * b * d * d;
    if (M > MR * 1.0000001) return { fail: true, MR, kb, jb };
    let j = 0.875, As = 0, k = 0;
    for (let i = 0; i < 60; i++) { As = M / (fsA * j * d); const r = As / (b * d); k = sqrt(2 * r * n + r * r * n * n) - r * n; j = 1 - k / 3; }
    return { As, k, j, MR, kb, jb, fail: false };
  }

  // ------------------------------------------------------------------ bars
  function barOptions(Areq, width, dbs, minN) {
    return dbs.map((db) => {
      const Ab = barA(db), n = Math.max(minN || 2, Math.ceil(Areq / Ab - 1e-9)), smin = Math.max(db / 10, 2.5);
      const nMax = Math.max(1, Math.floor((width + smin) / (db / 10 + smin)));
      return { db, n, As: n * Ab, fitsOneLayer: n <= nMax, nMaxOneLayer: nMax, layers: Math.ceil(n / nMax) };
    });
  }
  function pickBars(opts) {
    const fit = opts.filter((o) => o.fitsOneLayer).sort((a, b) => (a.As - b.As) || (a.n - b.n));
    return fit.length ? fit[0] : opts.slice().sort((a, b) => a.n - b.n)[0];
  }

  // ================================================================== BEAM — flexure core
  function block(c, b, bf, hf, h, fc, b1) {
    const a = Math.min(b1 * c, h || 1e9);
    if (bf > b && a > hf) {
      const A1 = (bf - b) * hf, A2 = b * a;
      return { a, Cc: 0.85 * fc * (A1 + A2), yc: (A1 * hf / 2 + A2 * a / 2) / (A1 + A2) };
    }
    const w = bf > b ? bf : b;
    return { a, Cc: 0.85 * fc * w * a, yc: a / 2 };
  }
  /** strain-compatibility flexural analysis (rectangular / T, tension As at d, compression Asp at dp). Returns kg-cm. */
  function flexSection(q, P) {
    const { b, d, fc, fy } = q, dp = q.dp || 0, Asp = q.Asp || 0, As = q.As, b1 = beta1(fc), bf = q.bf || b, hf = q.hf || 0, h = q.h;
    if (!(As > 0)) return { Mn: 0, phiMn: 0, c: 0, a: 0, et: 0, phi: P.flex, T: 0, Cc: 0, Cs: 0, fsp: 0, fs: 0 };
    const at = (c) => {
      const bk = block(c, b, bf, hf, h, fc, b1);
      const es = 0.003 * (d - c) / c, fs = Math.max(-fy, Math.min(fy, ES * es));
      let Cs = 0, fsp = 0;
      if (Asp > 0) { fsp = Math.max(-fy, Math.min(fy, ES * 0.003 * (c - dp) / c)); Cs = Asp * (fsp - (bk.a > dp ? 0.85 * fc : 0)); }
      return { bk, es, fs, T: As * fs, Cs, fsp };
    };
    let lo = 1e-6, hi = (h || d * 1.3) * 3;
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2, s = at(m); if (s.bk.Cc + s.Cs - s.T < 0) lo = m; else hi = m; }
    const c = (lo + hi) / 2, s = at(c);
    const Mn = s.bk.Cc * (d - s.bk.yc) + s.Cs * (d - dp), phi = phiStrainFlex(P, s.es, fy);
    return { Mn, phi, phiMn: phi * Mn, c, a: s.bk.a, et: s.es, T: s.T, Cc: s.bk.Cc, Cs: s.Cs, fs: s.fs, fsp: s.fsp };
  }
  /** design As / A's for Mu (kg-cm). singly if possible, else doubly with tension steel at the c-limit. */
  function designFlexure(q, P, Mu) {
    const { b, d, fc, fy } = q, dp = q.dp || 0, b1 = beta1(fc), bf = q.bf || b, hf = q.hf || 0;
    const cb = 6120 / (6120 + fy) * d, cLim = P.aci ? d * 0.003 / 0.007 : 0.75 * cb;
    const lim = block(cLim, b, bf, hf, q.h, fc, b1), AsMaxS = lim.Cc / fy;
    const etLim = 0.003 * (d - cLim) / cLim, phiLim = phiStrainFlex(P, etLim, fy), MnLim = lim.Cc * (d - lim.yc);
    if (Mu <= phiLim * MnLim * 1.0000001) {
      let lo = 0, hi = AsMaxS;
      for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; const r = flexSection(Object.assign({}, q, { As: m, Asp: 0 }), P); if (r.phiMn < Mu) lo = m; else hi = m; }
      return { As: hi, Asp: 0, doubly: false, cLim, AsMaxS };
    }
    const fsp = Math.max(-fy, Math.min(fy, ES * 0.003 * (cLim - dp) / cLim)), net = fsp - (lim.a > dp ? 0.85 * fc : 0);
    if (net <= 0) return { fail: 'compression steel ไม่ยืดหยุ่น/ไม่ทำงาน — เพิ่มขนาดหน้าตัด', cLim };
    const MnReq = Mu / phiLim, Asp = Math.max(0, (MnReq - lim.Cc * (d - lim.yc)) / (net * (d - dp)));
    return { As: (lim.Cc + Asp * net) / fy, Asp, doubly: true, cLim, fsp, AsMaxS, phiLim };
  }

  // ================================================================== beamSDM
  /** beamSDM({b,h,d?,cover,fc,fy,fyv,Mu(kg-m),Vu(kg),Tu?(kg-m),As?(cm2),AsComp?,bars?:{n,db},barsComp?:{n,db},
   *          stirrup?:{db,legs,s},set?,qc?,span?(m),support?,flange?:{bf,hf} (positive moment: flange in compression)}) */
  rc.beamSDM = function (inp) {
    const inputs = clone(inp), { b, h, fc, fy } = inp;
    if (![b, h, fc, fy].every(pos)) return bad('ต้องระบุ b, h, fc, fy > 0', inputs);
    if (!fin(inp.Mu) || !fin(inp.Vu)) return bad('ต้องระบุ Mu (kg-m) และ Vu (kg) เป็นตัวเลข', inputs);
    const P = phis(inp.set, inp.qc), c = ctx(), cover = inp.cover === undefined ? 3 : inp.cover, fyv = inp.fyv || 2400;
    const Mu = Math.abs(inp.Mu || 0) * 100, Vu = Math.abs(inp.Vu || 0), Tu = Math.abs(inp.Tu || 0) * 100;
    const fl = inp.flange && inp.flange.bf > b ? inp.flange : null, bf = fl ? fl.bf : b, hf = fl ? fl.hf : 0;
    const b1 = beta1(fc), sf = sqrt(fc), stDb = (inp.stirrup && inp.stirrup.db) || (fyv <= 2400 ? 9 : 10);
    const clBase = P.aci ? 'ACI 318 §9.3' : CL_MR + ' / วสท. 1008-38';
    c.step('ตัวคูณลดกำลัง φ', 'ชุด ' + P.set + (P.aci ? '' : (P.qc ? ' มี QC' : ' ไม่มี QC')), 'φ flexure=' + P.flex + ' ; shear=' + P.v, P.flex, '', P.clause);
    c.step('β1', 'β1 = 0.85 − 0.05(fc′−280)/70 ≥ 0.65', 'fc′=' + fc, b1, '', 'ACI 318 §22.2.2.4');
    const givenAs = inp.As || (inp.bars ? inp.bars.n * barA(inp.bars.db) : 0);
    const givenAsp = inp.AsComp || (inp.barsComp ? inp.barsComp.n * barA(inp.barsComp.db) : 0);
    let d = inp.d, bars = inp.bars || null, barsComp = inp.barsComp || null, As = givenAs, Asp = givenAsp, design = null, opts = null, AsReq = null, AspReq = null;
    const designMode = !givenAs;
    let dbAssume = (bars && bars.db) || 20;
    const availW = b - 2 * cover - 2 * stDb / 10;
    for (let it = 0; it < 4; it++) {
      const shift0 = layerShift(bars, availW);
      const dd = inp.d || (h - cover - stDb / 10 - dbAssume / 20 - shift0);
      d = dd;
      if (!designMode) break;
      const dbC = (barsComp && barsComp.db) || 16;
      const dp = inp.dp || (cover + stDb / 10 + dbC / 20);
      design = designFlexure({ b, d, dp, fc, fy, bf, hf, h }, P, Mu);
      if (design.fail) { c.hard.push(design.fail); break; }
      AsReq = design.As; AspReq = design.Asp;
      const Asmin = Math.max(0.8 * sf / fy, 14 / fy) * b * d;
      const target = Math.max(AsReq, Asmin);
      opts = barOptions(target, b - 2 * cover - 2 * stDb / 10, [16, 20, 25]);
      const pick = pickBars(opts); bars = { n: pick.n, db: pick.db }; As = pick.As;
      if (AspReq > 1e-9) { const oc = barOptions(AspReq, b - 2 * cover - 2 * stDb / 10, [16, 20, 25], 2); const pc = pickBars(oc); barsComp = { n: pc.n, db: pc.db }; Asp = pc.As; }
      if (inp.d || (pick.db === dbAssume && layerShift(bars, availW) === shift0)) break;
      dbAssume = pick.db;
    }
    if (!(d > 0)) return bad('คำนวณ d ไม่ได้', inputs);
    if (!(As > 0)) return c.finish(inputs, { design });
    const dbC = (barsComp && barsComp.db) || 16, dp = inp.dp || (cover + stDb / 10 + dbC / 20);
    c.step('d', inp.d ? 'd (ระบุ)' : 'd = h − cover − dstirrup − db/2', inp.d ? '' : '= ' + h + ' − ' + cover + ' − ' + f(stDb / 10) + ' − ' + f(bars ? bars.db / 20 : 1), d, 'cm', clBase);
    if (designMode && !inp.d && !inp.bars) c.warnings.push('d คำนวณจากเหล็กที่เลือก (DB' + (bars && bars.db) + ') และเหล็กปลอก ' + stDb + ' มม.');
    const bm = Mu / 100;
    if (designMode) {
      c.step('As ที่ต้องการ', 'ออกแบบให้ φMn ≥ Mu (สมดุลความเครียด)', 'Mu=' + f(bm, 0) + ' kg-m, b=' + b + ', d=' + f(d), AsReq, 'cm²', clBase);
      if (design && design.doubly) c.step('เหล็กรับแรงอัด A′s', 'ใช้ As ที่ขีดจำกัดความเครียด แล้วหา A′s จากโมเมนต์ส่วนเกิน', 'A′s=' + f(AspReq), AspReq, 'cm²', clBase);
    }
    const q = { b, d, dp, As, Asp, fc, fy, bf, hf, h };
    const r = flexSection(q, P);
    // ρ-type steps (rectangular, singly)
    const rb = rhoB(fc, fy), rm = rhoMax(P, fc, fy), rho = As / (b * d);
    c.step('ρb', 'ρb = 0.85β1(fc′/fy)·6120/(6120+fy)', '= 0.85×' + f(b1, 3) + '×(' + fc + '/' + fy + ')×6120/' + (6120 + fy), rb, '', clBase);
    c.step('ρmax', P.aci ? 'ρ ที่ εt = 0.004' : 'ρmax = 0.75ρb', '', rm, '', clBase);
    c.step('a', 'a = (As·fy − A′s(f′s−0.85fc′)) / (0.85 fc′ b)', 'c=' + f(r.c) + ' cm (สมดุลความเครียด)', r.a, 'cm', clBase);
    c.step('φMn', 'φMn = φ[Cc(d − ȳ) + Cs(d − d′)]', 'φ=' + f(r.phi, 3) + ', εt=' + f(r.et, 5), r.phiMn / 100, 'kg-m', clBase);
    c.check('กำลังดัด Mu ≤ φMn', bm, r.phiMn / 100, 'kg-m', clBase);
    const Asmin = Math.max(0.8 * sf / fy, 14 / fy) * b * d;
    c.step('As,min', 'max(0.80√fc′/fy , 14/fy)·bw·d', '= ' + f(Math.max(0.8 * sf / fy, 14 / fy), 5) + '×' + b + '×' + f(d), Asmin, 'cm²', 'ACI 318 §9.6.1 / วสท. 1008-38');
    c.check('As ≥ As,min', Asmin, As, 'cm²', 'ACI 318 §9.6.1 / วสท. 1008-38');
    if (P.aci) c.check('εt ≥ 0.004', 0.004, r.et, '', 'ACI 318 §9.3.3');
    else { const cb = 6120 / (6120 + fy) * d; c.check('ρ ≤ ρmax (c ≤ 0.75cb)', r.c, 0.75 * cb, 'cm', CL_MR + ' / วสท. 1008-38'); }
    if (bars) {
      const need = bars.n * bars.db / 10 + (bars.n - 1) * Math.max(bars.db / 10, 2.5), avail = b - 2 * cover - 2 * stDb / 10;
      const o = barOptions(As, avail, [bars.db]);
      if (need > avail + 1e-9) {
        const msg = 'เหล็ก ' + bars.n + '-DB' + bars.db + ' วางชั้นเดียวไม่พอ (ต้องการ ' + f(need) + ' > ' + f(avail) + ' ซม.) — ต้องวาง ' + o[0].layers + ' ชั้น';
        if (inp.d) c.hard.push(msg + ' แต่ d ที่ระบุอาจสูงเกินจริง — ใช้ d ที่ถึงจุดศูนย์ถ่วงเหล็กหลายชั้น (ลดลง ≈ ' + f(layerShift(bars, avail)) + ' ซม.)');
        else c.warnings.push(msg + ' — ปรับ d ตามจุดศูนย์ถ่วงเหล็กหลายชั้นแล้ว (d=' + f(d) + ')');
      }
    }
    // ---- shear
    const bw = b, Vc = 0.53 * sf * bw * d, vsMax = 2.1 * sf * bw * d, vs1 = 1.1 * sf * bw * d;
    c.step('Vc', 'Vc = 0.53√fc′·bw·d', '= 0.53×' + f(sf) + '×' + bw + '×' + f(d), Vc, 'kg', 'ACI 318 §22.5.5.1 / วสท. 1008-38');
    const phiV = P.v;
    const VsReq = Math.max(0, Vu / phiV - Vc);
    c.check('ขนาดหน้าตัดรับเฉือน Vs ≤ 2.1√fc′bwd', VsReq, vsMax, 'kg', 'ACI 318 §22.5.1.2 / วสท. 1008-38');
    const stir = inp.stirrup, stDbU = (stir && stir.db) || stDb, legs = (stir && stir.legs) || 2, Av = legs * barA(stDbU);
    const sMax = Math.min(d / 2, 60) / (VsReq > vs1 ? 2 : 1), sAv = Av * fyv / (3.5 * bw);
    const needStir = Vu > 0.5 * phiV * Vc;
    let sReq = VsReq > 0 ? Av * fyv * d / VsReq : Infinity;
    const flo = (x) => Math.max(5, Math.floor(x / 2.5 + 1e-9) * 2.5);
    const sSug = flo(Math.min(sReq, sMax, sAv));
    c.step('Vs ที่ต้องการ', 'Vs = Vu/φ − Vc', '= ' + f(Vu, 0) + '/' + phiV + ' − ' + f(Vc, 0), VsReq, 'kg', CL_MR + ' / วสท. 1008-38');
    c.step('ระยะเรียงเหล็กปลอก', 's = Av·fyv·d/Vs ; smax = min(d/2,60) (÷2 ถ้า Vs>1.1√fc′bwd) ; s ≤ Av·fyv/(3.5bw)',
      'Av=' + f(Av) + ' (' + legs + 'ขา RB/DB' + stDbU + '), s_req=' + f(sReq) + ', smax=' + f(sMax) + ', s_Avmin=' + f(sAv), sSug, 'cm', 'ACI 318 §9.7.6.2 / §10.6.2.2');
    if (stir && stir.s) {
      const Vs = Av * fyv * d / stir.s, phiVn = phiV * (Vc + Vs);
      c.step('φVn (เหล็กปลอกที่ให้)', 'φ(Vc + Av·fyv·d/s)', 'Vs=' + f(Vs, 0), phiVn, 'kg', CL_MR + ' / วสท. 1008-38');
      c.check('กำลังเฉือน Vu ≤ φVn', Vu, phiVn, 'kg', CL_MR + ' / วสท. 1008-38');
      const sMaxA = Math.min(d / 2, 60) / (Vs > vs1 ? 2 : 1);
      if (needStir || true) { c.check('ระยะเหล็กปลอก s ≤ smax', stir.s, sMaxA, 'cm', 'ACI 318 §9.7.6.2.2'); }
      if (Vu > 0.5 * phiV * Vc) c.check('Av,min: s ≤ Av·fyv/(3.5bw)', stir.s, sAv, 'cm', 'ACI 318 §9.6.3.3');
    } else if (VsReq <= vsMax) {
      c.step('เหล็กปลอกที่แนะนำ', needStir ? 'ต้องใช้เหล็กปลอก' : 'Vu ≤ φVc/2 : ใช้ขั้นต่ำ', legs + ' ขา ' + (fyv <= 2400 ? 'RB' : 'DB') + stDbU + ' @ ' + f(sSug) + ' ซม.', sSug, 'cm', 'ACI 318 §9.6.3');
    }
    // ---- torsion threshold
    if (Tu > 0) {
      const Acp = b * h, pcp = 2 * (b + h), Tcr = 1.06 * sf * Acp * Acp / pcp, thr = 0.25 * phiV * Tcr;
      c.step('ขีดเริ่มพิจารณาแรงบิด', 'Tth = 0.25φ·Tcr ; Tcr = 1.06√fc′Acp²/pcp', 'Tcr=' + f(Tcr / 100, 0) + ' kg-m', thr / 100, 'kg-m', 'ACI 318 §22.7.4');
      if (Tu > thr) c.hard.push('Tu = ' + f(Tu / 100, 0) + ' kg-m > 0.25φTcr = ' + f(thr / 100, 0) + ' kg-m — ต้องออกแบบแรงบิด (เหล็กปลอกปิด + เหล็กยืนเพิ่ม) ซึ่งโปรแกรมเวอร์ชันนี้ไม่ได้ออกแบบ');
    }
    // ---- deflection (min thickness)
    if (inp.span && inp.support) {
      const div = { simple: 16, oneEnd: 18.5, both: 21, cantilever: 8 }[inp.support];
      if (div) {
        const hmin = inp.span * 100 / div * minHFactor(fy);
        c.step('h ต่ำสุด (ไม่ต้องคำนวณการโก่งตัว)', 'l/' + div + (fy !== 4000 ? ' × (0.4+fy/7000)' : ''), 'l=' + inp.span + ' m', hmin, 'cm', 'ACI 318 Table 9.3.1.1 / วสท. 1008-38');
        c.check('ความหนาขั้นต่ำ hmin ≤ h', hmin, h, 'cm', 'ACI 318 Table 9.3.1.1');
      } else c.warnings.push('support ต้องเป็น simple|oneEnd|both|cantilever');
    }
    if (fl) c.warnings.push('T-beam: ใช้กับโมเมนต์บวก (flange รับแรงอัด); As,min ใช้ bw');
    if (fl && fl.bf) c.step('หน้าตัดตัว T', 'bf=' + fl.bf + ', hf=' + fl.hf, r.a > hf ? 'a > hf : พฤติกรรม T จริง' : 'a ≤ hf : พฤติกรรมสี่เหลี่ยม', r.a, 'cm', 'ACI 318 §6.3.2');
    return c.finish(inputs, {
      d, As, Asp, bars, barsComp, rho, rhoB: rb, rhoMax: rm,
      flexure: { c: r.c, a: r.a, et: r.et, phi: r.phi, Mn: r.Mn / 100, phiMn: r.phiMn / 100, fsp: r.fsp, doubly: Asp > 0 },
      shear: { Vc, Vs_required: VsReq, phiVc: phiV * Vc, stirrupLegs: legs, stirrupDb: stDbU, sSuggested: sSug, sMax, sAvMin: sAv, stirrupRequired: needStir },
      design: designMode ? { AsRequired: AsReq, AspRequired: AspReq, doubly: !!(design && design.doubly), barOptions: opts } : null, units: 'moments kg-m, forces kg, lengths cm'
    });
  };

  // ================================================================== WSD cracked-section core
  function cracked(q) {
    const { b, d, As, n } = q, dp = q.dp || 0, Asp = q.Asp || 0, bf = q.bf || b, hf = q.hf || 0;
    const Bq = 2 * n * Asp + n * As, C = 2 * n * Asp * dp + n * As * d;
    let x = (-Bq + sqrt(Bq * Bq + 2 * bf * C)) / bf, T = false;
    if (bf > b && x > hf) {
      const a2 = b / 2, B2 = (bf - b) * hf + Bq, C2 = (bf - b) * hf * hf / 2 + C;
      x = (-B2 + sqrt(B2 * B2 + 4 * a2 * C2)) / (2 * a2); T = true;
    }
    const Icr = T ? bf * x * x * x / 3 - (bf - b) * Math.pow(x - hf, 3) / 3 + 2 * n * Asp * Math.pow(x - dp, 2) + n * As * Math.pow(d - x, 2)
      : bf * x * x * x / 3 + 2 * n * Asp * Math.pow(x - dp, 2) + n * As * Math.pow(d - x, 2);
    return { x, Icr, T, k: x / d, j: 1 - x / d / 3,
      stresses: (M) => ({ fc: M * x / Icr, fs: n * M * (d - x) / Icr, fsp: 2 * n * M * (x - dp) / Icr }) };
  }
  const incFactor = (v) => v === true ? 1.33 : (typeof v === 'number' && v > 1 ? v : 1);

  // ================================================================== beamWSD
  /** beamWSD({b,h,d?,cover,fc,fy,fyv,M(kg-m service),V(kg service),As?,AsComp?,bars?,barsComp?,stirrup?:{db,legs,s},
   *          allowIncrease?:true|1.33 (default off), n?, flange?:{bf,hf}}) */
  rc.beamWSD = function (inp) {
    const inputs = clone(inp), { b, h, fc, fy } = inp;
    if (![b, h, fc, fy].every(pos)) return bad('ต้องระบุ b, h, fc, fy > 0', inputs);
    if (!fin(inp.M !== undefined ? inp.M : inp.Ms) || !fin(inp.V)) return bad('ต้องระบุ M (kg-m) และ V (kg) ใช้งานเป็นตัวเลข', inputs);
    const c = ctx(), cover = inp.cover === undefined ? 3 : inp.cover, fyv = inp.fyv || 2400, ai = incFactor(inp.allowIncrease);
    const M = Math.abs(inp.M !== undefined ? inp.M : (inp.Ms || 0)) * 100, V = Math.abs(inp.V || 0), sf = sqrt(fc);
    const n = inp.n || ES / Ec(fc), fcA = 0.45 * fc * ai, fsA = (inp.fsAllow || fsAllow(fy)) * ai, fvA = (inp.fvAllow || fsAllow(fyv)) * ai;
    const fl = inp.flange && inp.flange.bf > b ? inp.flange : null, bf = fl ? fl.bf : b, hf = fl ? fl.hf : 0;
    const stDb = (inp.stirrup && inp.stirrup.db) || (fyv <= 2400 ? 9 : 10);
    const CL = 'วสท. 1007-34 / ACI 318-63 WSD';
    c.step('n = Es/Ec', 'Ec = 15100√fc′ ; n = 2.04×10⁶/Ec', 'Ec=' + f(Ec(fc), 0), n, '', CL);
    c.step('หน่วยแรงที่ยอมให้', 'fc = 0.45fc′ ; fs ตามเกรดเหล็ก' + (ai > 1 ? ' ; เพิ่ม ×' + ai : ''), 'fc=' + f(fcA, 1) + ' ; fs=' + f(fsA, 0), fcA, 'ksc', CL);
    if (ai > 1) c.warnings.push('ใช้การเพิ่มหน่วยแรงที่ยอมให้ ×' + ai + ' (กฎกระทรวง 2566 ไม่ได้ระบุไว้ — ต้องระบุในรายการคำนวณ)');
    let As = inp.As || (inp.bars ? inp.bars.n * barA(inp.bars.db) : 0), Asp = inp.AsComp || (inp.barsComp ? inp.barsComp.n * barA(inp.barsComp.db) : 0);
    let bars = inp.bars || null, barsComp = inp.barsComp || null, design = null, opts = null, d = inp.d;
    let dbAssume = (bars && bars.db) || 20;
    for (let it = 0; it < 4; it++) {
      const shift0 = layerShift(bars, b - 2 * cover - 2 * stDb / 10);
      d = inp.d || (h - cover - stDb / 10 - dbAssume / 20 - shift0);
      if (As) break;
      const dp = cover + stDb / 10 + 0.8;
      const bb = bf; // flange width if T (conservative approximations below)
      let s = wsdAs(M, bb, d, fcA, fsA, n);
      if (!s.fail) {
        let Asd = s.As;
        if (fl) { // T-beam: verify with cracked T section, grow As until stresses ok
          for (let i = 0; i < 200; i++) { const cr = cracked({ b, bf, hf, d, As: Asd, n }); const st = cr.stresses(M); if (st.fs <= fsA && st.fc <= fcA) break; Asd *= 1.01; }
        }
        design = { As: Asd, Asp: 0, doubly: false };
      } else {
        const x = s.kb * d, fsp = Math.min(fsA, 2 * n * fcA * (x - dp) / x), Mp = M - s.MR;
        const Aspd = Mp / (fsp * (d - dp)), Asd = s.MR / (fsA * s.jb * d) + Aspd * fsp / fsA;
        let A1 = Asd, A2 = Aspd;
        for (let i = 0; i < 300; i++) {
          const cr = cracked({ b: bb, d, dp, As: A1, Asp: A2, n }), st = cr.stresses(M);
          if (st.fs <= fsA * 1.0001 && st.fc <= fcA * 1.0001 && st.fsp <= fsA * 1.0001) break;
          A1 *= 1.01; A2 *= 1.02;
        }
        design = { As: A1, Asp: A2, doubly: true, MR: s.MR };
      }
      const Asmin = Math.max(0.8 * sf / fy, 14 / fy) * b * d;
      const target = Math.max(design.As, Asmin);
      opts = barOptions(target, b - 2 * cover - 2 * stDb / 10, [16, 20, 25]);
      const pk = pickBars(opts); bars = { n: pk.n, db: pk.db }; As = pk.As;
      if (design.Asp > 0) { const pc = pickBars(barOptions(design.Asp, b - 2 * cover - 2 * stDb / 10, [16, 20, 25])); barsComp = { n: pc.n, db: pc.db }; Asp = pc.As; }
      if (inp.d || (pk.db === dbAssume && layerShift(bars, b - 2 * cover - 2 * stDb / 10) === shift0)) break;
      dbAssume = pk.db; As = 0; Asp = 0;
    }
    const dp = cover + stDb / 10 + ((barsComp && barsComp.db) || 16) / 20;
    if (design) c.step('As ที่ต้องการ (WSD)', design.doubly ? 'MR = ½fc k j b d² < M → ใช้เหล็กรับแรงอัด (2n)' : 'As = M/(fs·j·d)', 'M=' + f(M / 100, 0) + ' kg-m', design.As, 'cm²', CL);
    if (!(As > 0)) return bad('ไม่มี As', inputs);
    const cr = cracked({ b, bf, hf, d, dp, As, Asp, n }), st = cr.stresses(M);
    c.step('แกนสะเทียน kd (หน้าตัดแตกร้าว)', Asp > 0 ? 'b x²/2 + 2nA′s(x−d′) = nAs(d−x)' : 'k = √(2ρn+(ρn)²) − ρn', 'ρ=' + f(As / (b * d), 5) + ', n=' + f(n, 2), cr.x, 'cm', CL);
    c.step('k , j', 'k = x/d ; j = 1 − k/3', '', cr.k, '', CL);
    c.step('Icr', 'หน้าตัดแปลง', '', cr.Icr, 'cm⁴', CL);
    c.step('fc', 'fc = M·x/Icr', '= ' + f(M, 0) + '×' + f(cr.x) + '/' + f(cr.Icr, 0), st.fc, 'ksc', CL);
    c.step('fs', 'fs = n·M(d−x)/Icr', '', st.fs, 'ksc', CL);
    c.check('fc ≤ 0.45fc′', st.fc, fcA, 'ksc', CL);
    c.check('fs ≤ fs,allow', st.fs, fsA, 'ksc', CL);
    if (Asp > 0) { c.step('f′s', 'f′s = 2n·M(x−d′)/Icr', '', st.fsp, 'ksc', CL); c.check('f′s ≤ fs,allow', st.fsp, fsA, 'ksc', CL); }
    const Asmin = Math.max(0.8 * sf / fy, 14 / fy) * b * d;
    c.check('As ≥ As,min', Asmin, As, 'cm²', 'วสท. 1007-34 / ACI 318-63');
    // shear
    const v = V / (b * d), vc = 0.29 * sf * ai, vmax = vc + 1.06 * sf * ai;
    c.step('v', 'v = V/(bd) ; vc = 0.29√fc′ ; vmax = vc+1.06√fc′', 'v=' + f(v, 2) + ', vc=' + f(vc, 2), v, 'ksc', CL);
    c.check('v ≤ vc + 1.06√fc′', v, vmax, 'ksc', CL);
    const stir = inp.stirrup, legs = (stir && stir.legs) || 2, Av = legs * barA((stir && stir.db) || stDb);
    const vs = Math.max(0, v - vc), vsHalf = 0.53 * sf * ai;
    const sReq = vs > 0 ? Av * fvA / (b * vs) : Infinity, sMax = Math.min(d / 2, 60) / (vs > vsHalf ? 2 : 1), sAv = Av * fvA / (3.5 * b);
    const sSug = Math.max(5, Math.floor(Math.min(sReq, sMax, sAv) / 2.5 + 1e-9) * 2.5);
    c.step('ระยะเหล็กปลอก (WSD)', 's = Av·fv/(b(v−vc)) ; smax = d/2 (÷2 ถ้า v−vc>0.53√fc′) ; Av,min', 'Av=' + f(Av) + ', s_req=' + f(sReq) + ', smax=' + f(sMax), sSug, 'cm', CL);
    if (stir && stir.s) {
      c.check('s ≤ s,required (WSD)', stir.s, Math.min(sReq, sMax, sAv), 'cm', CL);
    }
    c.warnings.push('ขีดครึ่งระยะเหล็กปลอก (v−vc > 0.53√fc′) เทียบเคียงจาก SDM — ต้องตรวจกับมาตรฐานฉบับจริง [VERIFY]');
    if (fl) c.warnings.push('T-beam WSD: ใช้กับโมเมนต์บวก');
    return c.finish(inputs, { d, As, Asp, bars, barsComp, n, k: cr.k, j: cr.j, kd: cr.x, Icr: cr.Icr, fc: st.fc, fs: st.fs, fsp: st.fsp,
      allow: { fc: fcA, fs: fsA, fv: fvA }, shear: { v, vc, vmax, sSuggested: sSug, sMax, sAvMin: sAv },
      design: design ? { As: design.As, Asp: design.Asp, doubly: design.doubly, barOptions: opts } : null, units: 'moments kg-m, forces kg, lengths cm' });
  };

  // ================================================================== SLABS
  function loadU(P, wD, wL) { return P.aci ? 1.2 * wD + 1.6 * wL : 1.4 * wD + 1.7 * wL; }
  function spacingOptions(As, smaxS, dbs) {
    return dbs.map((db) => { const s = Math.floor(barA(db) * 100 / As / 2.5 + 1e-9) * 2.5; return { db, s: Math.min(s, Math.floor(smaxS / 2.5) * 2.5), ok: s >= 7.5 }; });
  }
  function stripAs(c, name, Mkgm, d, h, inp, P, method, n, CL, ai) {
    const { fc, fy } = inp, b = 100, Mk = Mkgm * 100, As_min = rhoTemp(fy) * b * h;
    let As, ok = true;
    if (method === 'WSD') {
      const s = wsdAs(Mk, b, d, 0.45 * fc * ai, (inp.fsAllow || fsAllow(fy)) * ai, n);
      if (s.fail) { ok = false; c.check(name + ': M ≤ MR (WSD)', Mk / 100, s.MR / 100, 'kg-m/m', CL); As = As_min; }
      else As = s.As;
    } else {
      const r = sdmAs(Mk, b, d, fc, fy, P.flex);
      if (!r || r.rho > rhoMax(P, fc, fy)) { ok = false; c.check(name + ': ρ ≤ ρmax', r ? r.rho : 1, rhoMax(P, fc, fy), '', CL); As = r ? r.As : As_min; }
      else As = r.As;
    }
    const Asd = Math.max(As, As_min), smaxS = Math.min(3 * h, 45);
    return { name, M: Mkgm, AsReq: As, AsMin: As_min, As: Asd, ok, spacing: spacingOptions(Asd, smaxS, [9, 10, 12, 16]) };
  }
  /** slabOneWay({h,span(m),support:'simple'|'oneEnd'|'both'|'cantilever',wD,wL (kg/m2),fc,fy,method:'SDM'|'WSD',set,qc,cover?,db?(mm),addSelfWeight?,nSpans?}) 1 m strip. */
  rc.slabOneWay = function (inp) {
    const inputs = clone(inp), { h, span, fc, fy } = inp;
    if (![h, span, fc, fy].every(pos)) return bad('ต้องระบุ h, span, fc, fy > 0', inputs);
    const P = phis(inp.set, inp.qc), c = ctx(), method = inp.method === 'WSD' ? 'WSD' : 'SDM', support = inp.support || 'simple';
    const cover = inp.cover === undefined ? 2 : inp.cover, db = inp.db || 10, d = h - cover - db / 20, ai = incFactor(inp.allowIncrease), n = ES / Ec(fc);
    const sw = inp.addSelfWeight ? 2400 * h / 100 : 0, wD = (inp.wD || 0) + sw, wL = inp.wL || 0;
    const CL = method === 'SDM' ? P.clause + ' / วสท. 1008-38' : 'วสท. 1007-34';
    const w = method === 'SDM' ? loadU(P, wD, wL) : wD + wL;
    c.step('น้ำหนักบรรทุก', method === 'SDM' ? (P.aci ? 'wu = 1.2D+1.6L' : 'wu = 1.4D+1.7L') : 'w = D+L', 'D=' + f(wD, 0) + ' (รวมน้ำหนักตัวเอง' + (sw ? ' เพิ่ม ' + f(sw, 0) : ' ตามที่ผู้ใช้ระบุ') + '), L=' + f(wL, 0), w, 'kg/m²', CL);
    const L = span;
    const cases = {
      simple: { pos: 1 / 8, neg: [] },
      oneEnd: { pos: 1 / 11, neg: [[(inp.nSpans === 2 ? 1 / 9 : 1 / 10), 'ที่รองรับต่อเนื่อง']] },
      both: { pos: 1 / 16, neg: [[1 / 11, 'ที่รองรับต่อเนื่อง']] },
      cantilever: { pos: 0, neg: [[1 / 2, 'ที่ฝังแน่น']] }
    }[support];
    if (!cases) return bad('support ต้องเป็น simple|oneEnd|both|cantilever', inputs);
    const hminDiv = { simple: 20, oneEnd: 24, both: 28, cantilever: 10 }[support], hmin = L * 100 / hminDiv * minHFactor(fy);
    c.step('h ต่ำสุด', 'l/' + hminDiv + (fy !== 4000 ? ' × (0.4+fy/7000)' : ''), 'l=' + L + ' m', hmin, 'cm', 'ACI 318 Table 7.3.1.1 / วสท. 1008-38');
    c.check('ความหนาพื้น hmin ≤ h', hmin, h, 'cm', 'ACI 318 Table 7.3.1.1');
    const sections = [];
    if (cases.pos) { const M = cases.pos * w * L * L; c.step('M+ = wl²/' + f(1 / cases.pos, 0), 'M = C·w·l²', '= ' + f(cases.pos, 4) + '×' + f(w, 0) + '×' + L + '²', M, 'kg-m/m', CL); sections.push(stripAs(c, 'M+ กลางช่วง', M, d, h, inp, P, method, n, CL, ai)); }
    cases.neg.forEach((q) => { const M = q[0] * w * L * L; c.step('M− ' + q[1] + ' = wl²/' + f(1 / q[0], 0), 'M = C·w·l²', '= ' + f(q[0], 4) + '×' + f(w, 0) + '×' + L + '²', M, 'kg-m/m', CL); sections.push(stripAs(c, 'M− ' + q[1], M, d, h, inp, P, method, n, CL, ai)); });
    sections.forEach((s) => {
      c.step('As ' + s.name, 'As ตามต้องการ vs As,min = ρtemp·b·h', 'As_req=' + f(s.AsReq) + ', As_min=' + f(s.AsMin) + ' (ρ=' + rhoTemp(fy) + ')', s.As, 'cm²/m', CL);
      c.check('As ' + s.name + ' ≥ ตามต้องการ', s.AsReq, s.As, 'cm²/m', CL);
    });
    const ro = rhoTemp(fy), tempAs = ro * 100 * h;
    c.step('เหล็กกันร้าว (ตั้งฉากเหล็กหลัก)', 'As,temp = ρ·b·h ; s ≤ min(3h, 45)', 'ρ=' + ro, tempAs, 'cm²/m', 'ACI 318 §24.4.3 / วสท. 1008-38');
    const tempSp = spacingOptions(tempAs, Math.min(3 * h, 45), [9, 10, 12]);
    // shear
    const V = (support === 'cantilever' ? w * L : w * L / 2 * (support === 'oneEnd' ? 1.15 : 1)) - w * d / 100;
    const sf = sqrt(fc);
    if (method === 'SDM') c.check('แรงเฉือน Vu(ที่ระยะ d) ≤ φVc', V, P.v * 0.53 * sf * 100 * d, 'kg/m', CL);
    else c.check('หน่วยแรงเฉือน v ≤ 0.29√fc′', V / (100 * d), 0.29 * sf * ai, 'ksc', 'วสท. 1007-34');
    c.warnings.push('สัมประสิทธิ์โมเมนต์เป็นแบบประมาณ (ACI 8.3.3) สำหรับพื้นต่อเนื่องที่ช่วงใกล้เคียงกัน/น้ำหนักจรไม่เกิน 3 เท่าน้ำหนักบรรทุกคงที่ — ตรวจสอบเงื่อนไข');
    if (wL > 3 * wD) c.warnings.push('wL > 3wD: ไม่เข้าเงื่อนไขการใช้สัมประสิทธิ์โมเมนต์โดยประมาณ');
    return c.finish(inputs, { d, w, sections, tempSteel: { As: tempAs, spacing: tempSp }, hmin, maxSpacing: Math.min(3 * h, 45), units: 'M kg-m per m strip, As cm2 per m, spacing cm' });
  };

  // ------------------------------------------------------------------ two-way coefficient table (UNVERIFIED)
  const M_LIST = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];
  rc.twoWayCoefTable = {
    verified: false,
    source: 'ตั้งใจให้เป็นตาราง ACI 318-63 Method 2 / EIT แต่ค่าทั้งหมดยังไม่ได้ตรวจกับมาตรฐานฉบับจริง',
    provenance: 'NOT a verified transcription. The 594 cells could not be recalled reliably; values were generated by an engineering approximation ' +
      '(Marcus-type load share q=1/(1+m^4), reduction 0.8, fixed-end/propped/simple distribution, pos DL/LL split), calibrated to the one anchor I am ' +
      'confident of: interior square panel m=1.0 -> Ca,neg 0.033, Ca,dl 0.018, Ca,ll 0.027. REPLACE with the printed table before use.',
    m: M_LIST,
    note: 'Ca/Cb apply to w·la² / w·lb² (la = short span). neg = coefficient at CONTINUOUS edges; negative moment at a discontinuous edge = 1/3 of the positive moment (computed at run time). Linear interpolation in m; m<0.5 -> treat as one-way.',
    edgesDiscontinuous: '[short-direction(a) ends discontinuous count, long-direction(b) ends discontinuous count] per case: 1:[0,0] 2:[0,1] 3:[1,0] 4:[1,1] 5:[0,2] 6:[2,0] 7:[1,2] 8:[2,1] 9:[2,2]',
    cases: {"1":{"aDisc":0,"bDisc":0,"negA":[0.033,0.037,0.04,0.044,0.047,0.051,0.054,0.057,0.059,0.061,0.063],"negB":[0.033,0.03,0.026,0.023,0.019,0.016,0.013,0.01,0.008,0.006,0.004],"dlA":[0.018,0.02,0.022,0.024,0.026,0.027,0.029,0.031,0.032,0.033,0.034],"llA":[0.027,0.03,0.033,0.035,0.038,0.041,0.044,0.046,0.048,0.049,0.051],"dlB":[0.018,0.016,0.014,0.012,0.01,0.009,0.007,0.005,0.004,0.003,0.002],"llB":[0.027,0.024,0.021,0.019,0.016,0.013,0.01,0.008,0.006,0.005,0.003]},"2":{"aDisc":0,"bDisc":1,"negA":[0.033,0.037,0.04,0.044,0.047,0.051,0.054,0.057,0.059,0.061,0.063],"negB":[0.043,0.038,0.034,0.029,0.025,0.02,0.016,0.013,0.01,0.007,0.005],"dlA":[0.018,0.02,0.022,0.024,0.026,0.027,0.029,0.031,0.032,0.033,0.034],"llA":[0.027,0.03,0.033,0.035,0.038,0.041,0.044,0.046,0.048,0.049,0.051],"dlB":[0.026,0.023,0.02,0.018,0.015,0.012,0.01,0.008,0.006,0.004,0.003],"llB":[0.032,0.029,0.026,0.022,0.019,0.016,0.013,0.01,0.007,0.005,0.004]},"3":{"aDisc":1,"bDisc":0,"negA":[0.043,0.047,0.051,0.056,0.06,0.065,0.069,0.072,0.075,0.078,0.08],"negB":[0.033,0.03,0.026,0.023,0.019,0.016,0.013,0.01,0.008,0.006,0.004],"dlA":[0.026,0.028,0.031,0.034,0.036,0.039,0.041,0.044,0.045,0.047,0.048],"llA":[0.032,0.036,0.039,0.042,0.046,0.049,0.052,0.055,0.057,0.059,0.061],"dlB":[0.018,0.016,0.014,0.012,0.01,0.009,0.007,0.005,0.004,0.003,0.002],"llB":[0.027,0.024,0.021,0.019,0.016,0.013,0.01,0.008,0.006,0.005,0.003]},"4":{"aDisc":1,"bDisc":1,"negA":[0.043,0.047,0.051,0.056,0.06,0.065,0.069,0.072,0.075,0.078,0.08],"negB":[0.043,0.038,0.034,0.029,0.025,0.02,0.016,0.013,0.01,0.007,0.005],"dlA":[0.026,0.028,0.031,0.034,0.036,0.039,0.041,0.044,0.045,0.047,0.048],"llA":[0.032,0.036,0.039,0.042,0.046,0.049,0.052,0.055,0.057,0.059,0.061],"dlB":[0.026,0.023,0.02,0.018,0.015,0.012,0.01,0.008,0.006,0.004,0.003],"llB":[0.032,0.029,0.026,0.022,0.019,0.016,0.013,0.01,0.007,0.005,0.004]},"5":{"aDisc":0,"bDisc":2,"negA":[0.033,0.037,0.04,0.044,0.047,0.051,0.054,0.057,0.059,0.061,0.063],"negB":[0,0,0,0,0,0,0,0,0,0,0],"dlA":[0.018,0.02,0.022,0.024,0.026,0.027,0.029,0.031,0.032,0.033,0.034],"llA":[0.027,0.03,0.033,0.035,0.038,0.041,0.044,0.046,0.048,0.049,0.051],"dlB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004],"llB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004]},"6":{"aDisc":2,"bDisc":0,"negA":[0,0,0,0,0,0,0,0,0,0,0],"negB":[0.033,0.03,0.026,0.023,0.019,0.016,0.013,0.01,0.008,0.006,0.004],"dlA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"llA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"dlB":[0.018,0.016,0.014,0.012,0.01,0.009,0.007,0.005,0.004,0.003,0.002],"llB":[0.027,0.024,0.021,0.019,0.016,0.013,0.01,0.008,0.006,0.005,0.003]},"7":{"aDisc":1,"bDisc":2,"negA":[0.043,0.047,0.051,0.056,0.06,0.065,0.069,0.072,0.075,0.078,0.08],"negB":[0,0,0,0,0,0,0,0,0,0,0],"dlA":[0.026,0.028,0.031,0.034,0.036,0.039,0.041,0.044,0.045,0.047,0.048],"llA":[0.032,0.036,0.039,0.042,0.046,0.049,0.052,0.055,0.057,0.059,0.061],"dlB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004],"llB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004]},"8":{"aDisc":2,"bDisc":1,"negA":[0,0,0,0,0,0,0,0,0,0,0],"negB":[0.043,0.038,0.034,0.029,0.025,0.02,0.016,0.013,0.01,0.007,0.005],"dlA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"llA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"dlB":[0.026,0.023,0.02,0.018,0.015,0.012,0.01,0.008,0.006,0.004,0.003],"llB":[0.032,0.029,0.026,0.022,0.019,0.016,0.013,0.01,0.007,0.005,0.004]},"9":{"aDisc":2,"bDisc":2,"negA":[0,0,0,0,0,0,0,0,0,0,0],"negB":[0,0,0,0,0,0,0,0,0,0,0],"dlA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"llA":[0.038,0.041,0.045,0.049,0.053,0.057,0.06,0.064,0.066,0.069,0.071],"dlB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004],"llB":[0.038,0.034,0.03,0.026,0.022,0.018,0.015,0.011,0.009,0.006,0.004]}}
  };
  function interp(arr, m) {
    const mm = Math.max(0.5, Math.min(1, m)), t = (1 - mm) / 0.05, i = Math.min(arr.length - 2, Math.floor(t + 1e-9)), fr = t - i;
    return arr[i] + (arr[i + 1] - arr[i]) * fr;
  }
  /** slabTwoWay({la,lb (m, la<=lb), case:1..9, h, wD, wL, fc, fy, method:'SDM'|'WSD', set, qc, cover?, db?, addSelfWeight?}) */
  rc.slabTwoWay = function (inp) {
    const inputs = clone(inp), { la, lb, h, fc, fy } = inp;
    if (![la, lb, h, fc, fy].every(pos) || la > lb + 1e-9) return bad('ต้องระบุ la ≤ lb, h, fc, fy > 0', inputs);
    const tc = rc.twoWayCoefTable.cases[inp.case];
    if (!tc) return bad('case ต้องเป็น 1..9', inputs);
    const P = phis(inp.set, inp.qc), c = ctx(), method = inp.method === 'WSD' ? 'WSD' : 'SDM', m = la / lb;
    const cover = inp.cover === undefined ? 2 : inp.cover, db = inp.db || 10, dA = h - cover - db / 20, dB = dA - db / 10, ai = incFactor(inp.allowIncrease), n = ES / Ec(fc);
    const sw = inp.addSelfWeight ? 2400 * h / 100 : 0, wD = (inp.wD || 0) + sw, wL = inp.wL || 0;
    const CL = (method === 'SDM' ? P.clause + ' / ' : '') + 'ACI 318-63 Method 2 / วสท.';
    c.warnings.push('ตารางสัมประสิทธิ์ยังไม่ได้ตรวจสอบกับมาตรฐานฉบับจริง');
    if (inp.allowUnverified !== true) c.hard.push('คำเตือนร้ายแรง: ตารางสัมประสิทธิ์พื้นสองทางเป็นค่าประมาณ ยังไม่ได้ตรวจกับมาตรฐาน — ผลไม่ใช้ออกแบบจริง (ส่ง allowUnverified:true เพื่อยอมรับความเสี่ยงเฉพาะการประมาณเบื้องต้น)');
    if (m < 0.5) c.warnings.push('la/lb < 0.5 — ควรออกแบบเป็นพื้นทางเดียว (slabOneWay)');
    const wDu = method === 'SDM' ? (P.aci ? 1.2 : 1.4) * wD : wD, wLu = method === 'SDM' ? (P.aci ? 1.6 : 1.7) * wL : wL, w = wDu + wLu;
    c.step('น้ำหนักบรรทุก', method === 'SDM' ? 'wu = 1.4D+1.7L (หรือ ACI)' : 'w = D+L', 'D=' + f(wD, 0) + ' L=' + f(wL, 0), w, 'kg/m²', CL);
    c.step('m = la/lb', 'm = la/lb', f(la) + '/' + f(lb), m, '', CL);
    const perim = 2 * (la + lb) * 100, hmin = perim / 180;
    c.step('h ต่ำสุด', 'ความยาวเส้นรอบรูปพื้นแผ่น/180', '2(' + la + '+' + lb + ')×100/180', hmin, 'cm', 'ACI 318-63 / วสท. 1008-38');
    c.check('ความหนาพื้น hmin ≤ h', hmin, h, 'cm', 'ACI 318-63 / วสท. 1008-38');
    if (h < 9) c.warnings.push('h < 9 ซม. ต่ำกว่าค่าต่ำสุด ACI สำหรับพื้นสองทาง');
    const cf = (k) => interp(tc[k], m);
    const dirs = [
      { id: 'a', span: la, d: dA, neg: cf('negA'), dl: cf('dlA'), ll: cf('llA'), nd: tc.aDisc },
      { id: 'b', span: lb, d: dB, neg: cf('negB'), dl: cf('dlB'), ll: cf('llB'), nd: tc.bDisc }
    ];
    const sections = [];
    dirs.forEach((D) => {
      const L2 = D.span * D.span, Mpos = (D.dl * wDu + D.ll * wLu) * L2;
      const items = [{ nm: 'M+ กลางช่วง', M: Mpos, C: D.dl + '/' + D.ll }];
      if (D.nd < 2) items.push({ nm: 'M− ขอบต่อเนื่อง', M: D.neg * w * L2, C: D.neg });
      if (D.nd > 0) items.push({ nm: 'M− ขอบไม่ต่อเนื่อง', M: Mpos / 3, C: '⅓M+' });
      items.forEach((it) => {
        const mid = stripAs(c, 'ทิศ ' + D.id + ' ' + it.nm + ' (แถบกลาง)', it.M, D.d, h, inp, P, method, n, CL, ai);
        const edge = stripAs(c, 'ทิศ ' + D.id + ' ' + it.nm + ' (แถบริม)', it.M * 2 / 3, D.d, h, inp, P, method, n, CL, ai);
        c.step('ทิศ ' + D.id + ' ' + it.nm, 'M = C·w·l² ; แถบริม = ⅔ แถบกลาง', 'C=' + (typeof it.C === 'number' ? f(it.C, 4) : it.C) + ', l=' + D.span + ' m', it.M, 'kg-m/m', CL);
        sections.push({ dir: D.id, location: it.nm, mid, edge });
      });
    });
    c.warnings.push('ไม่ได้ตรวจแรงเฉือนของพื้นสองทาง/การถ่ายแรงลงคาน (สัดส่วนน้ำหนักลงคาน Wa=1/(1+m⁴), Wb=1−Wa)');
    return c.finish(inputs, { m, w, hmin, sections, beamLoadShare: { short: 1 / (1 + Math.pow(m, 4)), long: 1 - 1 / (1 + Math.pow(m, 4)) }, tableVerified: false });
  };

  // ================================================================== COLUMN
  function colSection(inp, c) {
    const { fc, fy } = inp, cover = inp.cover === undefined ? 3 : inp.cover, tieDb = inp.tieDb || 9;
    const circ = pos(inp.D);
    const sec = { circ, cover, tieDb };
    if (circ) { sec.D = inp.D; sec.Ag = PI * inp.D * inp.D / 4; sec.Ig = { x: PI * Math.pow(inp.D, 4) / 64, y: PI * Math.pow(inp.D, 4) / 64 }; sec.H = { x: inp.D, y: inp.D }; sec.r = 0.25 * inp.D; sec.S = PI * Math.pow(inp.D, 3) / 32; }
    else {
      sec.b = inp.b; sec.h = inp.h; sec.Ag = inp.b * inp.h; sec.Ig = { x: inp.b * Math.pow(inp.h, 3) / 12, y: inp.h * Math.pow(inp.b, 3) / 12 };
      sec.H = { x: inp.h, y: inp.b }; sec.rr = { x: 0.3 * inp.h, y: 0.3 * inp.b };
    }
    let bars = [];
    if (inp.layout && inp.layout.length) bars = inp.layout.map((q) => ({ x: q.x, y: q.y, A: q.A || barA(q.db), db: q.db || sqrt(4 * q.A / PI) * 10 }));
    else if (inp.bars) {
      const { n, db } = inp.bars, edge = cover + tieDb / 10 + db / 20;
      if (circ) { const Rs = inp.D / 2 - edge; for (let i = 0; i < n; i++) { const t = PI / 2 + 2 * PI * i / n; bars.push({ x: Rs * Math.cos(t), y: Rs * Math.sin(t), A: barA(db), db }); } }
      else {
        const bx = inp.b - 2 * edge, by = inp.h - 2 * edge; let best = null;
        for (let nx = 2; nx <= n; nx++) for (let ny = 2; ny <= n; ny++) if (2 * nx + 2 * (ny - 2) === n) { const sc = Math.abs(ny / nx - inp.h / inp.b); if (!best || sc < best.sc) best = { nx, ny, sc }; }
        if (!best) { c.hard.push('จำนวนเหล็กยืน n=' + n + ' จัดเรียงสมมาตรรอบเสาไม่ได้ (ใช้ n เป็นเลขคู่ ≥ 4 หรือระบุ layout)'); return null; }
        for (let i = 0; i < best.nx; i++) { const x = -bx / 2 + bx * i / (best.nx - 1); bars.push({ x, y: by / 2, A: barA(db), db }); bars.push({ x, y: -by / 2, A: barA(db), db }); }
        for (let j = 1; j < best.ny - 1; j++) { const y = -by / 2 + by * j / (best.ny - 1); bars.push({ x: bx / 2, y, A: barA(db), db }); bars.push({ x: -bx / 2, y, A: barA(db), db }); }
      }
    } else { c.hard.push('ต้องระบุ bars:{n,db} หรือ layout'); return null; }
    sec.bars = bars; sec.Ast = bars.reduce((s, q) => s + q.A, 0); sec.dbMax = Math.max.apply(null, bars.map((q) => q.db)); sec.n = bars.length;
    return sec;
  }
  function circSeg(R, a) {          // area & moment about centre of segment of depth a measured from the top
    a = Math.max(0, Math.min(a, 2 * R)); if (a <= 0) return { A: 0, M: 0 };
    if (a >= 2 * R) return { A: PI * R * R, M: 0 };
    const A = R * R * Math.acos((R - a) / R) - (R - a) * sqrt(2 * R * a - a * a), M = 2 / 3 * Math.pow(2 * R * a - a * a, 1.5);
    return { A, M };
  }
  /** nominal point at neutral-axis depth c for bending about axis ('x' -> depth along y; 'y' -> depth along x) */
  function colPoint(sec, axis, fc, fy, c) {
    const H = sec.H[axis], b1 = beta1(fc), a = Math.min(b1 * c, H);
    let Fc, Mc;
    if (sec.circ) { const sg = circSeg(sec.D / 2, a); Fc = 0.85 * fc * sg.A; Mc = 0.85 * fc * sg.M; }
    else { const w = axis === 'x' ? sec.b : sec.h; Fc = 0.85 * fc * w * a; Mc = Fc * (H / 2 - a / 2); }
    let P = Fc, M = Mc, dmax = 0;
    sec.bars.forEach((q) => {
      const u = axis === 'x' ? q.y : q.x, di = H / 2 - u; dmax = Math.max(dmax, di);
      const fs = Math.max(-fy, Math.min(fy, ES * 0.003 * (c - di) / c)), F = q.A * (fs - (di < a ? 0.85 * fc : 0));
      P += F; M += F * u;
    });
    return { c, Pn: P, Mn: M, et: 0.003 * (dmax - c) / c, dmax };
  }
  function colCurve(sec, axis, fc, fy, P, tied, c) {
    const H = sec.H[axis], phiC = tied ? P.tied : P.spiral, Ast = sec.Ast;
    const P0 = 0.85 * fc * (sec.Ag - Ast) + fy * Ast, Pnmax = (tied ? 0.80 : 0.85) * P0, phiPnmax = phiC * Pnmax;
    const dmax = Math.max.apply(null, sec.bars.map((q) => H / 2 - (axis === 'x' ? q.y : q.x)));
    const ey = fy / ES, cb = dmax * 0.003 / (0.003 + ey), bal = colPoint(sec, axis, fc, fy, cb);
    const phiOf = (et, Pn) => {
      if (P.aci) {
        if (et <= ey) return phiC; if (et >= ey + 0.003) return P.flex; return phiC + (P.flex - phiC) * (et - ey) / 0.003;
      }
      if (Pn <= 0) return P.flex;
      const Pa = Math.min(0.10 * fc * sec.Ag, phiC * bal.Pn), x = phiC * Pn;
      return x >= Pa ? phiC : P.flex - (P.flex - phiC) * x / Pa;
    };
    const ets = [];
    for (let e = -0.002; e < -1e-9; e += 0.00025) ets.push(e);
    for (let e = 0; e <= 0.0100001; e += 0.0005) ets.push(e);
    [0.012, 0.015, 0.02, 0.03, 0.05, ey, ey + 0.003].forEach((e) => ets.push(e));
    ets.sort((p, q) => p - q);
    const raw = [{ c: Infinity, Pn: P0, Mn: 0, et: -0.003 }];
    ets.forEach((e) => { const cc = dmax * 0.003 / (0.003 + e); raw.push(colPoint(sec, axis, fc, fy, cc)); });
    raw.push({ c: 0, Pn: -fy * Ast, Mn: 0, et: 0.05 });
    const pts = raw.map((q) => {
      const phi = q.c === 0 ? P.flex : phiOf(q.et, q.Pn), phiPn = Math.min(phi * q.Pn, phiPnmax);
      return { c: q.c === Infinity ? null : q.c, et: q.et, Pn: q.Pn, Mn: q.Mn / 100, phi, phiPn, phiMn: phi * q.Mn / 100 };
    });
    return { axis, points: pts, P0, Pnmax, phiPnmax, phiC, balanced: { c: cb, Pb: bal.Pn, Mb: bal.Mn / 100, et: ey }, H };
  }
  function capAtP(pts, Pu) {          // max phiMn (kg-m) at axial load Pu
    let best = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i].phiPn, p2 = pts[i + 1].phiPn, m1 = pts[i].phiMn, m2 = pts[i + 1].phiMn;
      if (Math.abs(p1 - p2) < 1e-9) { if (Math.abs(Pu - p1) < 1e-6) best = Math.max(best, m1, m2); continue; }
      if ((Pu - p1) * (Pu - p2) <= 0) best = Math.max(best, m1 + (m2 - m1) * (Pu - p1) / (p2 - p1));
    }
    return best;
  }
  function nominalAtE(pts, e) {        // e in cm; returns nominal Pn (kg), phi at eccentricity e
    const q = pts.filter((p) => p.Pn > 0 && p.c !== 0);
    for (let i = 0; i < q.length - 1; i++) {
      const P1 = q[i].Pn, P2 = q[i + 1].Pn, M1 = q[i].Mn * 100, M2 = q[i + 1].Mn * 100;
      const e1 = M1 / P1, e2 = M2 / P2;
      if (e >= e1 - 1e-9 && e <= e2 + 1e-9) {
        const den = (M2 - M1) - e * (P2 - P1), t = Math.abs(den) < 1e-12 ? 0 : Math.max(0, Math.min(1, (e * P1 - M1) / den));
        return { Pn: P1 + t * (P2 - P1), phi: q[i].phi + t * (q[i + 1].phi - q[i].phi) };
      }
    }
    const last = q[q.length - 1]; return { Pn: e <= 0 ? q[0].Pn : last.Pn, phi: last.phi };
  }

  /** columnSDM({b,h | D, cover, fc, fy, bars:{n,db}|layout:[{x,y,db}], tie:'tied'|'spiral', tieDb?(mm), tieS?(cm), Pu, Mux, Muy (kg-m),
   *            lu(m), k, sway, pDelta, M1M2 (number or {x,y}, default +1), betad(default 0.6), set, qc})
   *   Mux = moment about the x-axis (bending in the h direction); Muy = about y (b direction). */
  rc.columnSDM = function (inp) {
    const inputs = clone(inp), { fc, fy } = inp;
    if (!pos(fc) || !pos(fy) || !(pos(inp.D) || (pos(inp.b) && pos(inp.h)))) return bad('ต้องระบุ fc, fy และ b,h หรือ D', inputs);
    const P = phis(inp.set, inp.qc), c = ctx(), tied = inp.tie !== 'spiral', PuS = inp.Pu;
    if (!fin(PuS)) return bad('ต้องระบุ Pu (kg, บวก = อัด, ลบ = ดึง)', inputs);
    for (const k of ['Mux', 'Muy']) if (inp[k] !== undefined && !fin(inp[k])) return bad(k + ' ไม่ใช่ตัวเลข', inputs);
    const Pu = Math.max(PuS, 0);
    if (PuS < 0) c.warnings.push('แรงดึง (Pu<0): ใช้ส่วนแรงดึงของเส้นโค้ง P-M (สูงสุด −fy·Ast) — ต้องตรวจการต่อทาบ/การยึดเหล็กเพิ่ม');
    const sec = colSection(inp, c); if (!sec) return c.finish(inputs);
    const CL = P.aci ? 'ACI 318 §22.4' : CL_MR + ' / วสท. 1008-38';
    const Ast = sec.Ast, rho = Ast / sec.Ag;
    c.step('ตัวคูณลดกำลัง φ', 'เสา' + (tied ? 'ปลอกเดี่ยว' : 'ปลอกเกลียว'), 'φ=' + (tied ? P.tied : P.spiral) + (P.aci ? ' (ปรับตาม εt)' : ' (ปรับ→ φ flexure เมื่อ P ลดลง)'), tied ? P.tied : P.spiral, '', P.clause);
    const curves = { x: colCurve(sec, 'x', fc, fy, P, tied, c), y: colCurve(sec, 'y', fc, fy, P, tied, c) };
    const cx = curves.x, P0 = cx.P0;
    c.step('P0', 'P0 = 0.85fc′(Ag − Ast) + fy·Ast', '= 0.85×' + fc + '×(' + f(sec.Ag) + ' − ' + f(Ast) + ') + ' + fy + '×' + f(Ast), P0, 'kg', CL);
    c.step('φPn,max', tied ? 'φPn,max = 0.80φP0 (ปลอกเดี่ยว)' : 'φPn,max = 0.85φP0 (ปลอกเกลียว)', 'φ=' + cx.phiC, cx.phiPnmax, 'kg', CL);
    c.check('แรงอัดแนวแกน Pu ≤ φPn,max', Pu, cx.phiPnmax, 'kg', CL);
    if (PuS < 0) c.check('แรงดึงตามแกน |Pu| ≤ φ·fy·Ast', -PuS, P.flex * fy * Ast, 'kg', CL);
    // reinforcement checks
    c.step('ρg', 'ρg = Ast/Ag', '= ' + f(Ast) + '/' + f(sec.Ag), rho, '', 'ACI 318 §10.6.1 / วสท. 1008-38');
    c.check('ρg ≥ 1%', 0.01, rho, '', 'ACI 318 §10.6.1');
    c.check('ρg ≤ 8% (ค่าสูงสุดสัมบูรณ์)', rho, 0.08, '', 'ACI 318 §10.6.1');
    if (rho > 0.04) c.warnings.push('ρg > 4% — เกินค่าแนะนำ ทำงานก่อสร้างยาก/บริเวณต่อทาบเกิน 8%');
    c.check('จำนวนเหล็กยืนขั้นต่ำ ' + (sec.circ ? 6 : 4), sec.circ ? 6 : 4, sec.n, 'เส้น', 'ACI 318 §10.7.3.1');
    c.check('db ≥ 12 มม.', 12, sec.dbMax, 'mm', 'วสท. 1008-38');
    const least = sec.circ ? sec.D : Math.min(sec.b, sec.h), sTieMax = Math.min(16 * sec.dbMax / 10, 48 * sec.tieDb / 10, least);
    c.step('ระยะเหล็กปลอกสูงสุด', 's ≤ min(16db , 48dtie , ด้านแคบสุด)', '16×' + f(sec.dbMax / 10) + ', 48×' + f(sec.tieDb / 10) + ', ' + f(least), sTieMax, 'cm', 'ACI 318 §25.7.2.1');
    if (inp.tieS) c.check('ระยะเหล็กปลอก s ≤ smax', inp.tieS, sTieMax, 'cm', 'ACI 318 §25.7.2.1');
    const clear = sec.circ ? (PI * (sec.D - 2 * (sec.cover + sec.tieDb / 10 + sec.dbMax / 20)) / sec.n - sec.dbMax / 10) : null;
    if (clear !== null) c.check('ช่องว่างเหล็กยืน ≥ max(1.5db,4)', Math.max(1.5 * sec.dbMax / 10, 4), clear, 'cm', 'ACI 318 §25.2.3');
    // slenderness + moments per axis
    const lu = (inp.lu || 0) * 100, k = inp.k || 1, sway = !!inp.sway;
    if (!inp.lu) c.warnings.push('ไม่ได้ระบุ lu — ถือว่าเป็นเสาสั้น ไม่ตรวจความชะลูด');
    if (sway && !inp.pDelta) c.hard.push('คำเตือนร้ายแรง: โครงอาคารเคลื่อนที่ได้ (sway) — ต้องใช้โมเมนต์จากการวิเคราะห์ลำดับสอง/P-Δ (ตั้ง pDelta:true เมื่อทำแล้ว) โปรแกรมนี้ไม่คำนวณ δs ให้');
    const m1m2 = (ax) => { const v = typeof inp.M1M2 === 'object' && inp.M1M2 ? inp.M1M2[ax] : inp.M1M2; return v === undefined ? 1 : Math.max(-0.5, Math.min(1, v)); };
    if (inp.M1M2 === undefined && !sway && lu) c.warnings.push('ไม่ได้ระบุ M1/M2 — ใช้ +1.0 (โค้งเดี่ยว อนุรักษ์)');
    const betad = inp.betad === undefined ? 0.6 : inp.betad;
    const axes = {};
    const Mraw = sec.circ ? { x: Math.hypot(inp.Mux || 0, inp.Muy || 0), y: 0 } : { x: Math.abs(inp.Mux || 0), y: Math.abs(inp.Muy || 0) };
    const toCheck = sec.circ ? ['x'] : ['x', 'y'];
    toCheck.forEach((ax) => {
      const H = sec.H[ax], r = sec.circ ? sec.r : sec.rr[ax], sl = k * lu / r, emin = 1.5 + 0.03 * H;
      const Mmin = Pu * emin, M2 = Math.max(Mraw[ax] * 100, Mmin), minGov = Mmin >= Mraw[ax] * 100;
      let delta = 1, status = 'short';
      if (lu) {
        if (sway) {
          if (sl > 22) { status = 'slender-sway'; c.hard.push('แกน ' + ax + ': sway และ klu/r=' + f(sl) + ' > 22 — ต้องขยายโมเมนต์ด้วย δs (วิเคราะห์ลำดับสอง)'); } else status = 'short';
        } else {
          const lim = Math.min(40, 34 - 12 * m1m2(ax));
          if (sl > lim) {
            status = 'slender-nonsway';
            const Ecc = Ec(fc), EI = 0.4 * Ecc * sec.Ig[ax] / (1 + betad), Pcr = PI * PI * EI / Math.pow(k * lu, 2);
            const Cm = minGov ? 1 : Math.max(0.4, 0.6 + 0.4 * m1m2(ax));
            const den = 1 - Pu / (0.75 * Pcr);
            delta = den > 0 ? Math.max(1, Cm / den) : Infinity;
            c.step('δns แกน ' + ax, 'δns = Cm/(1 − Pu/(0.75Pc)) ; Pc = π²EI/(klu)² ; EI = 0.4EcIg/(1+βd)', 'klu/r=' + f(sl) + ' > ' + f(lim) + '; Pc=' + f(Pcr, 0) + ', Cm=' + f(Cm, 2), delta, '', 'ACI 318 §6.6.4.5');
            if (!isFinite(delta)) c.hard.push('แกน ' + ax + ': Pu ≥ 0.75Pc — เสาไม่เสถียร เพิ่มขนาดหน้าตัด');
          } else c.step('ความชะลูด แกน ' + ax, 'klu/r ≤ 34 − 12(M1/M2) ≤ 40 → ละเลยผลความชะลูด', 'klu/r=' + f(sl) + ' ≤ ' + f(lim), sl, '', 'ACI 318 §6.2.5');
        }
        c.check('klu/r ≤ 100 (แกน ' + ax + ')', sl, 100, '', 'ACI 318 §6.2.5 / วสท. 1008-38');
      }
      const Mc = isFinite(delta) ? delta * M2 / 100 : 1e12;
      const cap = capAtP(curves[ax].points, PuS);
      c.step('ei,min แกน ' + ax, 'emin = 1.5 + 0.03h', 'h=' + f(H) + ' → e=' + f(emin) + ' cm ; Pu·emin=' + f(Mmin / 100, 0) + ' kg-m', Mmin / 100, 'kg-m', 'ACI 318 §6.6.4.5.4 [VERIFY]');
      c.check('P-M แกน ' + ax + (sec.circ ? ' (Mu ผลรวม)' : '') + ': Mc ≤ φMn ที่ Pu', Mc, cap, 'kg-m', CL);
      axes[ax] = { slenderness: sl, status, emin, M2: M2 / 100, delta, Mc, phiMnAtPu: cap, minEccGoverns: minGov };
    });
    // biaxial
    let biax = null;
    if (!sec.circ && Mraw.x > 0 && Mraw.y > 0) {
      const Mx = axes.x.Mc * 100, My = axes.y.Mc * 100;
      if (PuS > 0 && Pu / cx.phiC >= 0.1 * P0) {
        const nx = nominalAtE(curves.x.points, Mx / Pu), ny = nominalAtE(curves.y.points, My / Pu), phi = Math.min(nx.phi, ny.phi);
        const Pn = 1 / (1 / nx.Pn + 1 / ny.Pn - 1 / P0);
        c.step('Bresler', '1/Pn = 1/Pnx + 1/Pny − 1/P0', 'Pnx=' + f(nx.Pn, 0) + ' (ey=' + f(Mx / Pu) + ' cm), Pny=' + f(ny.Pn, 0) + ' (ex=' + f(My / Pu) + ' cm)', Pn, 'kg', 'ACI 318 commentary R22.4 / วสท. 1008-38');
        c.check('Biaxial (Bresler): Pu ≤ φPn', Pu, phi * Pn, 'kg', 'Bresler reciprocal load');
        biax = { method: 'Bresler', Pnx: nx.Pn, Pny: ny.Pn, Pn, phi };
      } else {
        const rx = axes.x.Mc / Math.max(axes.x.phiMnAtPu, 1e-9), ry = axes.y.Mc / Math.max(axes.y.phiMnAtPu, 1e-9);
        c.step('Load contour', 'Mux/φMnx + Muy/φMny ≤ 1.0 (Pu < 0.1P0)', f(rx, 3) + ' + ' + f(ry, 3), rx + ry, '', 'PCA load contour');
        c.check('Biaxial (load contour)', rx + ry, 1, '', 'PCA load contour');
        biax = { method: 'contour', sum: rx + ry };
      }
    }
    const fyName = fy;
    return c.finish(inputs, { section: sec.circ ? 'D' + sec.D : sec.b + 'x' + sec.h, Ag: sec.Ag, Ast, rhoG: rho, nBars: sec.n, bars: sec.bars, P0, phiPnMax: cx.phiPnmax, tieSpacingMax: sTieMax,
      balanced: { x: curves.x.balanced, y: curves.y.balanced }, axes, biaxial: biax,
      curves: { x: { points: curves.x.points, designPoint: { Pu, Mu: axes.x.Mc } }, y: curves.y && !sec.circ ? { points: curves.y.points, designPoint: { Pu, Mu: axes.y ? axes.y.Mc : 0 } } : null },
      curveUnits: 'Pn,phiPn kg ; Mn,phiMn kg-m', fy: fyName, units: 'moments kg-m, forces kg, lengths cm (lu in m)' });
  };

  // ------------------------------------------------------------------ columnWSD
  /** columnWSD({b,h|D,cover,fc,fy,bars|layout,tie,P,Mx,My (kg-m service),lu,k,allowIncrease?}) — Pa = 0.80[0.25fc′Ag + fs·Ast] tied, 0.85 spiral;
   *  interaction fa/Fa + fbx/Fb + fby/Fb <= 1 on the gross section (conservative, simplified). */
  rc.columnWSD = function (inp) {
    const inputs = clone(inp), { fc, fy } = inp;
    if (!pos(fc) || !pos(fy) || !(pos(inp.D) || (pos(inp.b) && pos(inp.h)))) return bad('ต้องระบุ fc, fy และ b,h หรือ D', inputs);
    const c = ctx(), tied = inp.tie !== 'spiral', ai = incFactor(inp.allowIncrease), CL = 'วสท. 1007-34 [VERIFY]';
    const sec = colSection(inp, c); if (!sec) return c.finish(inputs);
    const fs = (inp.fsAllow || fsAllow(fy)), Ast = sec.Ast, rho = Ast / sec.Ag, P = inp.P;
    if (!fin(P)) return bad('ต้องระบุ P (kg, บวก = อัด)', inputs);
    if (P < 0) return bad('คำเตือนร้ายแรง: แรงดึง (P<0) — columnWSD ไม่รองรับ ใช้ columnSDM หรือออกแบบเป็นชิ้นส่วนรับแรงดึง', inputs);
    const kk = inp.k || 1, lu = (inp.lu || 0) * 100;
    let Pa = (tied ? 0.80 : 0.85) * (0.25 * fc * sec.Ag + fs * Ast) * ai;
    c.step('Pa', tied ? 'Pa = 0.80[0.25fc′Ag + fs·Ast]' : 'Pa = 0.85[0.25fc′Ag + fs·Ast]', '= ' + (tied ? '0.80' : '0.85') + '×[0.25×' + fc + '×' + f(sec.Ag) + ' + ' + f(fs, 0) + '×' + f(Ast) + ']', Pa, 'kg', CL);
    const rs = [];
    ['x', 'y'].forEach((ax) => { rs.push(sec.circ ? sec.r : sec.rr[ax]); });
    const sl = lu ? kk * lu / Math.min(rs[0], rs[1]) : 0;
    let R = 1;
    if (sl > 22) {
      if (sl > 100) c.check('klu/r ≤ 100', sl, 100, '', CL);
      R = Math.min(1, 1.32 - 0.006 * sl);
      c.step('ตัวคูณลดสำหรับเสายาว', 'R = 1.32 − 0.006·klu/r ≤ 1.0', 'klu/r=' + f(sl), R, '', 'ACI 318-63 [VERIFY]');
      c.warnings.push('ตัวคูณลดเสายาว R ใช้สูตร ACI 318-63 จากความจำ — ต้องตรวจกับมาตรฐานฉบับจริง; ถ้าโครงเคลื่อนที่ได้ ต้องวิเคราะห์ P-Δ');
    }
    if (inp.sway && !inp.pDelta) c.hard.push('คำเตือนร้ายแรง: โครงอาคาร sway — ต้องคำนวณ P-Δ แยก โปรแกรมนี้ไม่ได้ขยายโมเมนต์');
    Pa *= R;
    c.check('P ≤ Pa (ไม่มีโมเมนต์)', P, Pa, 'kg', CL);
    c.check('ρg 1%–8%', Math.max(0.01 / Math.max(rho, 1e-9), rho / 0.08), 1, '', 'วสท. 1008-38');
    const Fa = Pa / sec.Ag, fa = P / sec.Ag, Fb = 0.45 * fc * ai;
    const Mx = Math.abs(inp.Mx || 0) * 100, My = Math.abs(inp.My || 0) * 100;
    const Sx = sec.circ ? sec.S : sec.Ig.x / (sec.h / 2), Sy = sec.circ ? sec.S : sec.Ig.y / (sec.b / 2);
    const emx = 1.5 + 0.03 * sec.H.x, emy = 1.5 + 0.03 * sec.H.y;
    const Mxd = Math.max(Mx, P * emx), Myd = Math.max(My, P * emy);
    let fbx, fby;
    if (sec.circ) { const M = Math.hypot(Mx, My), Md = Math.max(M, P * emx); fbx = Md / Sx; fby = 0; }
    else {
      // min eccentricity applied to one axis at a time
      const o1 = Mxd / Sx + My / Sy, o2 = Mx / Sx + Myd / Sy; fbx = Math.max(o1, o2) === o1 ? Mxd / Sx : Mx / Sx; fby = Math.max(o1, o2) === o1 ? My / Sy : Myd / Sy;
    }
    const inter = fa / Fa + (fbx + fby) / Fb;
    c.step('Interaction', 'fa/Fa + fbx/Fb + fby/Fb ≤ 1 ; Fa = Pa/Ag ; Fb = 0.45fc′', 'fa=' + f(fa, 1) + ', Fa=' + f(Fa, 1) + ', fbx=' + f(fbx, 1) + ', fby=' + f(fby, 1) + ', Fb=' + f(Fb, 1), inter, '', CL);
    c.check('Interaction fa/Fa + fb/Fb ≤ 1', inter, 1, '', CL);
    c.warnings.push('WSD เสา: สูตรอินเทอร์แอคชันแบบง่ายบนหน้าตัดรวม (อนุรักษ์) — ไม่ใช่การวิเคราะห์หน้าตัดแตกร้าว [VERIFY]');
    if (ai > 1) c.warnings.push('ใช้การเพิ่มหน่วยแรงที่ยอมให้ ×' + ai + ' (ต้องระบุในรายการคำนวณ)');
    return c.finish(inputs, { Ag: sec.Ag, Ast, rhoG: rho, Pa, fa, Fa, fbx, fby, Fb, interaction: inter, units: 'forces kg, moments kg-m' });
  };

  // ================================================================== FOOTING
  function pressures(P, Ml, Mb, B, L) {          // P kg, Ml,Mb kg-cm, returns {qavg,qmax,qmin}
    const A = B * L, a = P / A, dl = 6 * Ml / (B * L * L), db = 6 * Mb / (L * B * B);
    return { qavg: a, qmax: a + Math.abs(dl) + Math.abs(db), qmin: a - Math.abs(dl) - Math.abs(db), A };
  }
  function footingCore(mode, inp, B, L, h, c0) {
    const c = c0 || ctx(), { fc, fy } = inp, P = phis(inp.set, inp.qc), sdm = mode === 'SDM';
    const col = inp.col || {}, c1 = col.c1, c2 = col.c2, cover = inp.cover === undefined ? 7.5 : inp.cover, dbA = inp.db || 16, d = h - cover - dbA / 10;
    const ai = incFactor(inp.allowIncrease), sf = sqrt(fc), A = B * L, n = ES / Ec(fc);
    const CL = sdm ? P.clause + ' / วสท. 1008-38' : 'วสท. 1007-34';
    // --- service bearing
    const gammaC = 2400e-6, gammaS = (inp.gammaSoil || 1800) * 1e-6, soilCover = inp.soilCover || 0;
    const W = B * L * h * gammaC + B * L * soilCover * gammaS, Ps = inp.P_service || 0;
    const pr = pressures(Ps + W, Math.abs(inp.M_service || 0) * 100, Math.abs(inp.M_service_B || 0) * 100, B, L);
    const qa = inp.qa !== undefined ? inp.qa : (inp.qa_tm2 !== undefined ? inp.qa_tm2 / 10 : undefined);
    c.step('แรงกดดินใช้งาน', 'q = (P+W)/A ± 6M/(B·L²) ± 6MB/(L·B²) ; W = น้ำหนักฐานราก + ดินถม', 'W=' + f(W, 0) + ' kg, A=' + f(A, 0) + ' cm²', pr.qmax, 'ksc', 'การตรวจแรงแบกทานดิน');
    if (qa !== undefined) c.check('qmax ≤ qa', pr.qmax, qa, 'ksc', 'การตรวจแรงแบกทานดิน');
    const eL = (Math.abs(inp.M_service || 0) * 100) / (Ps + W), eB = (Math.abs(inp.M_service_B || 0) * 100) / (Ps + W);
    if (eL > 0 || eB > 0) c.check('ไม่เกิดแรงดึงใต้ฐาน (kern): 6eL/L + 6eB/B ≤ 1', 6 * eL / L + 6 * eB / B, 1, '', 'e ≤ L/6');
    // --- design pressure
    const Pd = sdm ? (inp.Pu || 0) : Ps, Mld = Math.abs(sdm ? (inp.Mu || 0) : (inp.M_service || 0)) * 100, Mbd = Math.abs(sdm ? (inp.Mu_B || 0) : (inp.M_service_B || 0)) * 100;
    const pd = pressures(Pd, Mld, Mbd, B, L), qd = pd.qmax;
    c.step(sdm ? 'แรงกดดินสุทธิประลัย qu' : 'แรงกดดินสุทธิใช้งาน q', 'q = P/A + 6M/(BL²) (ไม่รวมน้ำหนักฐานราก)', 'P=' + f(Pd, 0), qd, 'ksc',
      CL);
    if (Mld > 0 || Mbd > 0) c.warnings.push('ใช้ q สูงสุดแบบสม่ำเสมอทั้งผืนในการคำนวณโมเมนต์/เฉือน (อนุรักษ์) ; punching ใช้ q เฉลี่ย');
    c.step('d', 'd = h − cover − db', '= ' + h + ' − ' + cover + ' − ' + f(dbA / 10), d, 'cm', 'ACI 318 §20.6');
    c.check('d ≥ 15 ซม.', 15, d, 'cm', 'ACI 318 §13.3.1.2');
    const out = { directions: {} };
    // --- one-way shear and flexure per direction
    const dirs = [{ id: 'L', len: L, wid: B, cc: c2 }, { id: 'B', len: B, wid: L, cc: c1 }];
    dirs.forEach((D) => {
      const lc = (D.len - D.cc) / 2, Vu = qd * D.wid * Math.max(0, lc - d), M = qd * D.wid * lc * lc / 2;
      if (sdm) c.check('เฉือนทางเดียว ทิศ ' + D.id + ': Vu ≤ φVc', Vu, P.v * 0.53 * sf * D.wid * d, 'kg', CL);
      else c.check('เฉือนทางเดียว ทิศ ' + D.id + ': v ≤ 0.29√fc′', Vu / (D.wid * d), 0.29 * sf * ai, 'ksc', CL);
      const AsMin = rhoTemp(fy) * D.wid * h;
      let AsReq, ok = true;
      if (sdm) { const r = sdmAs(M, D.wid, d, fc, fy, P.flex); if (!r || r.rho > rhoMax(P, fc, fy)) { ok = false; c.check('ρ ≤ ρmax ทิศ ' + D.id, r ? r.rho : 1, rhoMax(P, fc, fy), '', CL); AsReq = r ? r.As : AsMin; } else AsReq = r.As; }
      else { const s = wsdAs(M, D.wid, d, 0.45 * fc * ai, (inp.fsAllow || fsAllow(fy)) * ai, n); if (s.fail) { ok = false; c.check('M ≤ MR ทิศ ' + D.id, M / 100, s.MR / 100, 'kg-m', CL); AsReq = AsMin; } else AsReq = s.As; }
      const As = Math.max(AsReq, AsMin);
      const opts = [12, 16, 20, 25].map((db) => { const n_ = Math.max(2, Math.ceil(As / barA(db) - 1e-9)), s = (D.wid - 2 * cover - db / 10) / (n_ - 1); return { db, n: n_, spacing: s, As: n_ * barA(db) }; });
      const rec = opts.find((o) => o.spacing >= 10 && o.spacing <= 25) || opts.filter((o) => o.spacing >= 7.5).pop() || opts[opts.length - 1];
      c.step('โมเมนต์ที่หน้าเสา ทิศ ' + D.id, 'M = q·w·lc²/2 ; lc=(' + D.len + '−' + D.cc + ')/2', 'lc=' + f(lc), M / 100, 'kg-m', CL);
      c.step('As ทิศ ' + D.id, 'As,req vs As,min = ρmin·w·h', 'req=' + f(AsReq) + ', min=' + f(AsMin) + ' (ρmin=' + rhoTemp(fy) + ')', As, 'cm²', CL);
      c.check('As ทิศ ' + D.id + ' ≥ ที่ต้องการ', AsReq, As, 'cm²', CL);
      out.directions[D.id] = { lc, M: M / 100, AsReq, AsMin, As, bars: rec, options: opts, maxSpacing: Math.min(3 * h, 45) };
    });
    // --- punching
    const posn = inp.position || 'interior', betaC = Math.max(c1, c2) / Math.min(c1, c2), alphaS = { interior: 40, edge: 30, corner: 20 }[posn];
    if (!alphaS) { c.hard.push("position ต้องเป็น 'interior' | 'edge' | 'corner'"); }
    // critical section: interior 4-sided; edge 3-sided (c1 perpendicular to the free edge); corner 2-sided
    let bo, area;
    if (posn === 'edge') { bo = 2 * (c1 + d / 2) + (c2 + d); area = (c1 + d / 2) * (c2 + d); }
    else if (posn === 'corner') { bo = (c1 + d / 2) + (c2 + d / 2); area = (c1 + d / 2) * (c2 + d / 2); }
    else { bo = 2 * (c1 + d + c2 + d); area = (c1 + d) * (c2 + d); }
    const Vp = Math.max(0, Pd - pd.qavg * area);
    c.step('เฉือนทะลุ Vu', 'Vu = P − qavg·A(เส้นวิกฤต) ; bo ตามตำแหน่งเสา (' + posn + ')', 'bo=' + f(bo) + ' cm', Vp, 'kg', CL);
    // unbalanced moment transfer (interior only): v = Vu/(bo d) + gamma_v M c / Jc
    let vu = Vp / (bo * d), vMom = 0;
    if ((Mld > 0 || Mbd > 0) && posn !== 'interior') c.hard.push('เสาริม/มุม มีโมเมนต์ถ่ายเข้าฐานราก: ยังไม่ได้คำนวณหน่วยแรงเฉือนจากโมเมนต์ไม่สมดุล (γv·M·c/Jc) — ต้องตรวจเพิ่ม');
    else if (Mld > 0 || Mbd > 0) {
      [[Mld, c2 + d, c1 + d], [Mbd, c1 + d, c2 + d]].forEach((q) => {
        const M = q[0], b1 = q[1], b2 = q[2]; if (!(M > 0)) return;
        const gv = 1 - 1 / (1 + 2 / 3 * sqrt(b1 / b2)), Jc = d * b1 * b1 * b1 / 6 + b1 * d * d * d / 6 + d * b2 * b1 * b1 / 2;
        vMom += gv * M * (b1 / 2) / Jc;
      });
      vu += vMom;
      c.step('หน่วยแรงเฉือนจากโมเมนต์ไม่สมดุล', 'γv·M·c/Jc ; γv = 1 − 1/(1+⅔√(b1/b2))', 'รวมทั้งสองทิศ', vMom, 'ksc', 'ACI 318 §8.4.4.2');
    }
    let vc;
    if (sdm) {
      const v1 = 1.06 * sf, v2 = 0.53 * (1 + 2 / betaC) * sf, v3 = 0.27 * (alphaS * d / bo + 2) * sf; vc = Math.min(v1, v2, v3);
      c.step('vc (ทะลุ)', 'min(1.06√fc′ , 0.53(1+2/βc)√fc′ , 0.27(αs·d/bo+2)√fc′)', f(v1, 2) + ' , ' + f(v2, 2) + ' , ' + f(v3, 2), vc, 'ksc', CL);
      c.check('เฉือนทะลุ Vu ≤ φvc·bo·d', vu * bo * d, P.v * vc * bo * d, 'kg', CL);
      out.punching = { bo, betaC, v1, v2, v3, vc, Vu: Vp, vu, vMoment: vMom, phiVc: P.v * vc * bo * d };
    } else {
      const v1 = 0.58 * sf * ai, v2 = 0.29 * (1 + 2 / betaC) * sf * ai; vc = Math.min(v1, v2);
      c.step('vc (ทะลุ WSD)', 'min(0.58√fc′ , 0.29(1+2/βc)√fc′)', f(v1, 2) + ' , ' + f(v2, 2), vc, 'ksc', CL);
      c.check('เฉือนทะลุ v ≤ vc', vu, vc, 'ksc', CL);
      c.warnings.push('ค่าหน่วยแรงเฉือนทะลุ WSD อนุมานสัดส่วน 0.55 ของ SDM — ต้องตรวจกับ วสท. 1007-34 ฉบับจริง [VERIFY]');
      out.punching = { bo, betaC, v1, v2, vc, Vu: Vp, vu, vMoment: vMom };
    }
    out.d = d; out.pressure = { service: pr, design: pd, W };
    return out;
  }
  function bearingOK(inp, B, L, h) {
    const W = B * L * h * 2400e-6 + B * L * (inp.soilCover || 0) * (inp.gammaSoil || 1800) * 1e-6, Ps = (inp.P_service || 0) + W;
    const qa = inp.qa !== undefined ? inp.qa : inp.qa_tm2 / 10, Ml = Math.abs(inp.M_service || 0) * 100, Mb = Math.abs(inp.M_service_B || 0) * 100;
    const p = pressures(Ps, Ml, Mb, B, L);
    return p.qmax <= qa && p.qmin >= -1e-9;
  }
  function footingRun(mode, inp) {
    const inputs = clone(inp), col = inp.col || {};
    if (![inp.fc, inp.fy, col.c1, col.c2].every(pos) || (inp.qa === undefined && inp.qa_tm2 === undefined)) return bad('ต้องระบุ fc, fy, col.c1, col.c2, qa', inputs);
    if (!fin(inp.P_service) || (mode === 'SDM' && !fin(inp.Pu))) return bad('ต้องระบุ P_service' + (mode === 'SDM' ? ' และ Pu' : '') + ' (kg) เป็นตัวเลข', inputs);
    if (inp.P_service < 0 || (mode === 'SDM' && inp.Pu < 0)) return bad('แรงถอน (uplift) — ฐานรากต้องออกแบบรับแรงดึง/ตรวจเสถียรภาพ', inputs);
    for (const k of ['M_service', 'M_service_B', 'Mu', 'Mu_B']) if (inp[k] !== undefined && !fin(inp[k])) return bad(k + ' ไม่ใช่ตัวเลข', inputs);
    let { B, L, h } = inp; const c = ctx(); let sized = null;
    if (!(B > 0 && L > 0)) {
      if (!(inp.P_service > 0)) return bad('ออกแบบขนาดต้องมี P_service', inputs);
      let found = false;
      const hList = [];
      if (h > 0) hList.push(h); else for (let x = 30; x <= 300; x += 5) hList.push(x);
      for (const hh of hList) {
        for (let sL = 60; sL <= 1000 && !found; sL += 5) {
          const L1 = sL, B1 = sL + (col.c1 - col.c2);
          if (B1 < 60 || !bearingOK(inp, B1, L1, hh)) continue;
          const t = ctx(); footingCore(mode, inp, B1, L1, hh, t);
          if (t.checks.every((k) => k.ok)) { B = B1; L = L1; h = hh; found = true; }
        }
        if (found) break;
      }
      if (!found) return bad('ออกแบบขนาดฐานรากไม่สำเร็จภายในช่วง B,L ≤ 1000 ซม. / h ≤ 300 ซม. (หรือ h ที่ระบุไม่พอ)', inputs);
      sized = { B, L, h };
      c.step('ขนาดฐานรากที่เลือก (ออกแบบอัตโนมัติ)', 'เพิ่ม B,L ทีละ 5 ซม. จน qmax ≤ qa และไม่มีแรงดึง ; เพิ่ม h จนผ่านเฉือน', 'B×L×h = ' + B + '×' + L + '×' + h, B * L, 'cm²', 'การออกแบบฐานราก');
    }
    if (!(h > 0)) return bad('ต้องระบุ h', inputs);
    const out = footingCore(mode, inp, B, L, h, c);
    return c.finish(inputs, Object.assign({ B, L, h, sized, units: 'dimensions cm, forces kg, moments kg-m, pressure ksc' }, out));
  }
  /** footingSDM / footingWSD({B?,L?,h,cover(7.5),col:{c1 (along B),c2 (along L)},fc,fy,qa (ksc)|qa_tm2,P_service,M_service? (kg-m, about axis giving eccentricity along L),
   *  M_service_B?, Pu, Mu?, Mu_B?, soilCover?(cm), gammaSoil?(kg/m3), db?(mm, default 16), position?:'interior'|'edge'|'corner', set, qc}) — omit B/L to size. */
  rc.footingSDM = function (inp) { return footingRun('SDM', inp); };
  rc.footingWSD = function (inp) { return footingRun('WSD', inp); };

  // test hooks / shared data
  rc._internal = { phis, beta1, Ec, rhoB, rhoMax, rhoTemp, flexSection, cracked, barA, fsAllow };
  if (typeof module !== 'undefined' && module.exports) module.exports = rc;
})(typeof globalThis !== 'undefined' ? globalThis : this);
