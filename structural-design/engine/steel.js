/* engine/steel.js — steel beam / column / beam-column, LRFD and ASD (AISC 360-16 style / วสท. 011038).
 * Units: kg, cm, ksc, E = 2.04e6 ksc.  INPUT MOMENTS ARE IN kg-m (converted internally to kg-cm); lengths Lb, KLx, KLy, span are in METRES;
 * section dimensions in cm (rows of SD.sections, or a plain object with the same fields).  Output moments kg-m.
 *
 *   SD.steel.beam({section, Fy, method:'LRFD'|'ASD', Mu|Ma, Vu|Va, Lb, Cb, span?, deltaLimit?, wService?|delta?, steelPhiSource?})
 *   SD.steel.column({section, Fy, method, Pu|Pa, KLx, KLy, steelPhiSource?})
 *   SD.steel.beamColumn({section, Fy, method, Pu|Pa, Mux|Max, Muy|May, KLx, KLy, Lb, Cb, steelPhiSource?})
 *   steelPhiSource: 'MR2566' (default; phi = 0.90 flexure/compression/shear/tension-yield, 0.75 fracture) | 'AISC' (shear 1.00 when h/tw <= 2.24 sqrt(E/Fy))
 *   deltaLimit: denominator N of L/N (default 360 = live-load limit; use 240 for total load, ประกาศ มท. 2567).
 * AXIAL CONVENTION: Pu/Pa positive = COMPRESSION, negative = TENSION (column/beamColumn then use the tension-yield capacity, phi 0.90 / Omega 1.67).
 *   Moments and shears are used as magnitudes.  Required inputs: beam Mu|Ma and Lb (Lb:0 = fully braced); column/beamColumn Pu|Pa, KLx, KLy (beamColumn also Lb).
 *   Missing/non-finite required inputs return {ok:false, error}.  Rows with verified:false add a warning.
 * Every function returns {ok, ratio, checks[], steps[], warnings[], hardWarnings[], inputs, ...extras} per docs/ARCHITECTURE.md.
 * Self-registers on globalThis.SD.steel.  Optional SD.sections used at call time only when `section` is a string. */
(function (root) {
  'use strict';
  const SD = root.SD = root.SD || {};
  const steel = SD.steel = SD.steel || {};
  const E = 2.04e6, PI = Math.PI;
  const GSH = E / 2.6; // G = E/(2(1+0.3))

  // ------------------------------------------------------------------ helpers
  const f = (x, n) => String(+Number(x).toFixed(n === undefined ? 2 : n));
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
  function unverified(g, c) { if (g.verified === false) c.warnings.push('คุณสมบัติหน้าตัดยังไม่ได้ตรวจสอบกับตาราง มอก.'); }
  const fin = (x) => typeof x === 'number' && isFinite(x);
  function bad(msg, inputs) { return { ok: false, ratio: 999, checks: [], steps: [], warnings: [msg], hardWarnings: [msg], error: msg, inputs }; }

  function getSection(s) {
    if (s && typeof s === 'object') return s;
    const lib = SD.sections;
    return lib && lib.find ? lib.find(s) : null;
  }
  function geom(sec) {
    const type = sec.type || 'H';
    const g = Object.assign({}, sec, { type });
    if (!g.hw) g.hw = g.d - 2 * g.tf - 2 * (g.r || 0);
    if (!g.rx) g.rx = Math.sqrt(g.Ix / g.A);
    if (!g.ry) g.ry = Math.sqrt(g.Iy / g.A);
    if (!g.Sx) g.Sx = g.Ix / (g.d / 2);
    if (!g.Sy) g.Sy = g.Iy / ((g.bf || g.d) / 2);
    g.isI = type === 'H' || type === 'I';
    g.isC = type === 'C';
    g.isTube = type === 'SHS' || type === 'RHS';
    g.isPipe = type === 'PIPE';
    return g;
  }
  /** resistance factor / safety factor.  kind: 'flex'|'comp'|'shear'|'tens'; shearRolledOK true when h/tw <= 2.24 sqrt(E/Fy) rolled I */
  function resist(method, src, kind, shearRolledOK) {
    if (method === 'ASD') {
      const om = { flex: 1.67, comp: 1.67, tens: 1.67, shear: shearRolledOK ? 1.50 : 1.67 }[kind];
      return { factor: om, apply: (Rn) => Rn / om, text: 'Ω=' + om };
    }
    let phi = 0.90;
    if (kind === 'shear' && src === 'AISC' && shearRolledOK) phi = 1.00;
    return { factor: phi, apply: (Rn) => phi * Rn, text: 'φ=' + phi };
  }
  const clauseFor = (base, src) => base + (src === 'AISC' ? '' : ' / กฎกระทรวง 2566 (φ)');

  // ------------------------------------------------------------------ flexure (strong axis)
  /** Nominal strong-axis flexural strength Mn (kg-cm). Lb in cm. Returns {Mn, Mp, Lp, Lr, regime, supported, notes[], ...} */
  function flexX(g, Fy, Lb, Cb, c) {
    const sq = Math.sqrt(E / Fy), out = { supported: true, notes: [] };
    const Mp = Fy * g.Zx; out.Mp = Mp;
    if (g.isI || g.isC) {
      const lamF = g.isC ? g.bf / g.tf : g.bf / (2 * g.tf), lpf = 0.38 * sq, lrf = 1.0 * sq;
      const lamW = g.hw / g.tw, lpw = 3.76 * sq;
      out.lamF = lamF; out.lamW = lamW; out.lpf = lpf; out.lrf = lrf; out.lpw = lpw;
      out.flange = lamF <= lpf ? 'compact' : lamF <= lrf ? 'noncompact' : 'slender';
      out.web = lamW <= lpw ? 'compact' : 'noncompact/slender';
      c.step('ความชะลูด flange', 'λf = ' + (g.isC ? 'bf/tf' : 'bf/2tf') + ' ; λp=0.38√(E/Fy) ; λr=1.0√(E/Fy)',
        'λf=' + f(lamF) + ' ; λp=' + f(lpf) + ' ; λr=' + f(lrf), lamF, '', 'AISC 360-16 Table B4.1b');
      c.step('ความชะลูด web', 'λw = h/tw ; λp=3.76√(E/Fy)', 'λw=' + f(lamW) + ' ; λp=' + f(lpw), lamW, '', 'AISC 360-16 Table B4.1b');
      if (out.flange === 'slender' || out.web !== 'compact') {
        out.supported = false;
        c.hard.push('ไม่รองรับ: ' + (out.flange === 'slender' ? 'flange ชะลูด (slender)' : 'web ไม่ compact (F4/F5)') + ' — ยังไม่ได้ implement');
        out.Mn = 0; out.regime = 'unsupported'; return out;
      }
      const ho = g.d - g.tf, J = g.J, Cw = g.Cw || g.Iy * ho * ho / 4;
      const cc = g.isC ? (ho / 2) * Math.sqrt(g.Iy / Cw) : 1;
      const rts = Math.sqrt(Math.sqrt(g.Iy * Cw) / g.Sx);
      const Lp = 1.76 * g.ry * sq;
      const jc = J * cc / (g.Sx * ho);
      const Lr = 1.95 * rts * E / (0.7 * Fy) * Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * Math.pow(0.7 * Fy / E, 2)));
      out.Lp = Lp; out.Lr = Lr; out.rts = rts;
      c.step('Lp', 'Lp = 1.76 ry √(E/Fy)', '= 1.76×' + f(g.ry) + '×' + f(sq, 1), Lp / 100, 'm', 'AISC 360-16 F2-5');
      c.step('Lr', 'Lr = 1.95 rts E/(0.7Fy) √(Jc/(Sx ho)+√((Jc/(Sx ho))²+6.76(0.7Fy/E)²))', 'rts=' + f(rts, 3) + ' cm, Jc/(Sx ho)=' + f(jc, 5), Lr / 100, 'm', 'AISC 360-16 F2-6');
      let MnLTB;
      if (Lb <= Lp) { MnLTB = Mp; out.regime = 'plastic (Lb ≤ Lp)'; }
      else if (Lb <= Lr) {
        MnLTB = Math.min(Mp, Cb * (Mp - (Mp - 0.7 * Fy * g.Sx) * (Lb - Lp) / (Lr - Lp)));
        out.regime = 'inelastic LTB (Lp < Lb ≤ Lr)';
      } else {
        const x = Lb / rts, Fcr = Cb * PI * PI * E / (x * x) * Math.sqrt(1 + 0.078 * jc * x * x);
        MnLTB = Math.min(Mp, Fcr * g.Sx); out.Fcr = Fcr; out.regime = 'elastic LTB (Lb > Lr)';
      }
      let MnFLB = Mp;
      if (out.flange === 'noncompact') MnFLB = Mp - (Mp - 0.7 * Fy * g.Sx) * (lamF - lpf) / (lrf - lpf);
      out.MnLTB = MnLTB; out.MnFLB = MnFLB; out.Mn = Math.min(MnLTB, MnFLB);
      c.step('Mn (LTB)', 'Lb≤Lp: Mp ; Lp<Lb≤Lr: Cb[Mp−(Mp−0.7FySx)(Lb−Lp)/(Lr−Lp)] ≤ Mp ; Lb>Lr: Fcr·Sx ≤ Mp',
        out.regime + ', Cb=' + f(Cb) + ', Mp=' + f(Mp / 100, 0) + ' kg-m', MnLTB / 100, 'kg-m', 'AISC 360-16 F2 / วสท. 011038');
      if (out.flange === 'noncompact') c.step('Mn (FLB)', 'Mp−(Mp−0.7FySx)(λ−λp)/(λr−λp)', '', MnFLB / 100, 'kg-m', 'AISC 360-16 F3-1');
      return out;
    }
    if (g.isTube) {
      const t = g.t || g.tw, b = g.bflat || g.bf - 3 * t, hh = g.hw || g.d - 3 * t;
      const lamF = b / t, lamW = hh / t;
      const flange = lamF <= 1.12 * sq ? 'compact' : lamF <= 1.40 * sq ? 'noncompact' : 'slender';
      out.flange = flange; out.web = lamW <= 2.42 * sq ? 'compact' : lamW <= 5.70 * sq ? 'noncompact' : 'slender';
      c.step('ความชะลูดผนังท่อสี่เหลี่ยม', 'b/t ≤ 1.12√(E/Fy) ; h/t ≤ 2.42√(E/Fy)', 'b/t=' + f(lamF) + ' (' + flange + '), h/t=' + f(lamW) + ' (' + out.web + ')', lamF, '', 'AISC 360-16 Table B4.1b F7');
      if (flange === 'slender' || out.web !== 'compact') { out.supported = false; c.hard.push('ไม่รองรับ: ผนังท่อสี่เหลี่ยมไม่ compact — ยังไม่ได้ implement (F7.2/F7.3 web)'); out.Mn = 0; out.regime = 'unsupported'; return out; }
      let Mn = Mp;
      if (flange === 'noncompact') Mn = Math.min(Mp, Mp - (Mp - Fy * g.Sx) * (3.57 * lamF / sq - 4.0));
      const JA = Math.sqrt(g.J * g.A);
      const Lp = 0.13 * E * g.ry * JA / Mp, Lr = 2 * E * g.ry * JA / (Fy * g.Sx);
      out.Lp = Lp; out.Lr = Lr;
      let MnL = Mp;
      if (Lb > Lp && Lb <= Lr) MnL = Math.min(Mp, Cb * (Mp - (Mp - Fy * g.Sx) * (Lb - Lp) / (Lr - Lp)));
      else if (Lb > Lr) MnL = Math.min(Mp, 2 * E * Cb * JA / (Lb / g.ry));
      out.Mn = Math.min(Mn, MnL); out.regime = Lb <= Lp ? 'plastic' : 'LTB';
      c.step('Mn (HSS)', 'Mp หรือ F7.2/F7.4', 'Lp=' + f(Lp / 100) + ' m Lr=' + f(Lr / 100) + ' m', out.Mn / 100, 'kg-m', 'AISC 360-16 F7');
      return out;
    }
    if (g.isPipe) {
      const D = g.D || g.d, t = g.t || g.tw, lam = D / t;
      out.flange = lam <= 0.07 * E / Fy ? 'compact' : lam <= 0.31 * E / Fy ? 'noncompact' : 'slender'; out.web = out.flange;
      c.step('D/t ท่อกลม', 'λp=0.07E/Fy ; λr=0.31E/Fy', 'D/t=' + f(lam) + ' λp=' + f(0.07 * E / Fy, 1) + ' λr=' + f(0.31 * E / Fy, 1), lam, '', 'AISC 360-16 Table B4.1b F8');
      if (out.flange === 'slender') { out.supported = false; c.hard.push('ไม่รองรับ: ท่อกลม slender'); out.Mn = 0; out.regime = 'unsupported'; return out; }
      out.Mn = out.flange === 'compact' ? Mp : (0.021 * E / lam + Fy) * g.Sx;
      out.regime = 'no LTB (round)'; c.step('Mn (pipe)', out.flange === 'compact' ? 'Mp = Fy Zx' : '(0.021E/(D/t)+Fy)Sx', '', out.Mn / 100, 'kg-m', 'AISC 360-16 F8');
      return out;
    }
    out.supported = false; out.Mn = 0; c.hard.push('ชนิดหน้าตัดไม่รองรับ: ' + g.type); return out;
  }

  /** Weak-axis nominal flexural strength (kg-cm): F6 for I/C, plastic for compact tubes/pipes. */
  function flexY(g, Fy, c) {
    const sq = Math.sqrt(E / Fy), Mp = Fy * g.Zy;
    if (g.isI || g.isC) {
      const lam = g.isC ? g.bf / g.tf : g.bf / (2 * g.tf), lp = 0.38 * sq, lr = 1.0 * sq;
      if (lam > lr) { c.hard.push('ไม่รองรับ: flange slender (แกนอ่อน)'); return 0; }
      const Mpc = Math.min(Mp, 1.6 * Fy * g.Sy);
      const Mn = lam <= lp ? Mpc : Mpc - (Mpc - 0.7 * Fy * g.Sy) * (lam - lp) / (lr - lp);
      c.step('Mny', 'Mp=Fy Zy ≤ 1.6Fy Sy ; noncompact flange interpolate', 'λ=' + f(lam), Mn / 100, 'kg-m', 'AISC 360-16 F6');
      return Mn;
    }
    // tubes / pipes: use same compactness classes as strong axis, no LTB
    const tmp = ctx(); const o = flexX(Object.assign({}, g, { Zx: g.Zy, Sx: g.Sy, Ix: g.Iy, ry: g.rx, bflat: g.hw || (g.d - 3 * (g.t || g.tw)), hw: g.bflat || (g.bf - 3 * (g.t || g.tw)) }), Fy, 0, 1, tmp);
    tmp.hard.forEach((m) => c.hard.push(m));
    c.step('Mny', 'F7/F8 (ไม่มี LTB)', '', o.Mn / 100, 'kg-m', 'AISC 360-16 F7/F8');
    return o.Mn;
  }

  // ------------------------------------------------------------------ shear
  function shear(g, Fy, c) {
    const sq = Math.sqrt(E / Fy);
    let Aw, h, tw, kv = 5;
    if (g.isPipe) {
      const lam = (g.D || g.d) / (g.t || g.tw);
      if (lam > 0.45 * E / Fy) { c.hard.push('ไม่รองรับ: D/t ท่อกลม > 0.45E/Fy (นอกขอบเขต G5)'); return { Vn: 0, Cv: 0, rolledOK: false }; }
      const Fcr = Math.min(0.6 * Fy, 0.78 * E / Math.pow(lam, 1.5)), Vn = Fcr * g.A / 2;
      c.step('Vn (ท่อกลม)', 'Vn = Fcr·Ag/2 ; Fcr = min(0.6Fy , 0.78E/(D/t)^1.5) (ไม่ใช้พจน์ L/D → อนุรักษ์)', 'D/t=' + f(lam) + ', Fcr=' + f(Fcr, 0), Vn, 'kg', 'AISC 360-16 G5');
      return { Vn, Cv: 1, rolledOK: false };
    }
    if (g.isTube) { h = g.hw || g.d - 3 * g.t; tw = g.t || g.tw; Aw = 2 * h * tw; }
    else { h = g.hw; tw = g.tw; Aw = g.d * g.tw; }
    const lam = h / tw, rolledOK = (g.isI || g.isC) && lam <= 2.24 * sq;
    let Cv;
    const k = Math.sqrt(kv * E / Fy);
    if (rolledOK) Cv = 1;
    else if (lam <= 1.10 * k) Cv = 1;
    else if (lam <= 1.37 * k) Cv = 1.10 * k / lam;
    else Cv = 1.51 * kv * E / (lam * lam * Fy);
    const Vn = 0.6 * Fy * Aw * Cv;
    c.step('Vn', 'Vn = 0.6 Fy Aw Cv', '= 0.6×' + Fy + '×' + f(Aw) + '×' + f(Cv, 3) + ' (h/tw=' + f(lam) + ')', Vn, 'kg', 'AISC 360-16 G2.1');
    return { Vn, Cv, Aw, rolledOK };
  }

  // ------------------------------------------------------------------ beam
  steel.beam = function (inp) {
    const inputs = JSON.parse(JSON.stringify(inp || {}));
    const sec = getSection(inp.section); if (!sec) return bad('ไม่พบหน้าตัด: ' + (inp.section && inp.section.name || inp.section), inputs);
    const g = geom(sec), Fy = inp.Fy, method = inp.method === 'ASD' ? 'ASD' : 'LRFD', src = inp.steelPhiSource || 'MR2566';
    if (!(Fy > 0)) return bad('ต้องระบุ Fy (ksc)', inputs);
    const c = ctx(), Lb = (inp.Lb || 0) * 100, Cb = inp.Cb || 1.0;
    const M0 = method === 'ASD' ? (inp.Ma !== undefined ? inp.Ma : inp.Mu) : (inp.Mu !== undefined ? inp.Mu : inp.Ma);
    const V0 = method === 'ASD' ? (inp.Va !== undefined ? inp.Va : inp.Vu) : (inp.Vu !== undefined ? inp.Vu : inp.Va);
    if (!fin(M0)) return bad('ต้องระบุโมเมนต์ออกแบบ (Mu หรือ Ma) เป็นตัวเลข', inputs);
    if (!fin(inp.Lb)) return bad('ต้องระบุ Lb (ม.) — ใส่ 0 หากค้ำยันด้านข้างต่อเนื่อง', inputs);
    if (V0 !== undefined && !fin(V0)) return bad('Vu/Va ไม่ใช่ตัวเลข', inputs);
    const M = Math.abs(M0), V = Math.abs(V0 || 0);
    if (V0 === undefined) c.warnings.push('ไม่ได้ระบุ Vu/Va — ไม่ได้ตรวจแรงเฉือน (ใช้ 0)');
    unverified(g, c);
    if (inp.Cb === undefined) c.warnings.push('ไม่ได้ระบุ Cb — ใช้ Cb = 1.0 (อนุรักษ์)');
    if (Cb > 3) c.warnings.push('Cb > 3.0 ไม่อนุญาต — ใช้ 3.0');
    const fx = flexX(g, Fy, Lb, Math.min(Cb, 3), c);
    const sh = shear(g, Fy, c);
    const rf = resist(method, src, 'flex'), rv = resist(method, src, 'shear', sh.rolledOK);
    const McKgm = rf.apply(fx.Mn) / 100;
    c.step(method === 'LRFD' ? 'φMn' : 'Mn/Ω', method === 'LRFD' ? 'φb Mn' : 'Mn / Ωb', rf.text + ' × ' + f(fx.Mn / 100, 0), McKgm, 'kg-m', clauseFor('AISC 360-16 F1 / วสท. 011038', src));
    c.check('โมเมนต์ดัดแกนแข็ง ' + (method === 'LRFD' ? 'Mu ≤ φMn' : 'Ma ≤ Mn/Ω'), M, McKgm, 'kg-m', clauseFor('AISC 360-16 F2 / วสท. 011038', src));
    const VcKg = rv.apply(sh.Vn);
    c.step(method === 'LRFD' ? 'φVn' : 'Vn/Ω', rv.text, '', VcKg, 'kg', clauseFor('AISC 360-16 G2 / วสท. 011038', src));
    c.check('แรงเฉือน ' + (method === 'LRFD' ? 'Vu ≤ φVn' : 'Va ≤ Vn/Ω'), V, VcKg, 'kg', clauseFor('AISC 360-16 G2 / วสท. 011038', src));
    if (Lb > 0 && fx.Lr && Lb > fx.Lr) c.warnings.push('Lb > Lr: โก่งเดาะดัดด้านข้างแบบยืดหยุ่น');
    // deflection (optional)
    let delta = inp.delta;
    if (delta === undefined && inp.wService && inp.span) {
      const L = inp.span * 100;
      delta = 5 * (inp.wService / 100) * Math.pow(L, 4) / (384 * E * g.Ix);
      c.step('Δ ที่ใช้งาน (คานช่วงเดียว, น้ำหนักแผ่สม่ำเสมอ)', 'Δ = 5wL⁴/(384EI)', 'w=' + inp.wService + ' kg/m, L=' + inp.span + ' m', delta, 'cm', 'การโก่งตัว');
    }
    if (delta !== undefined && inp.span) {
      const N = inp.deltaLimit || 360, lim = inp.span * 100 / N;
      c.check('การโก่งตัว Δ ≤ L/' + N, delta, lim, 'cm', 'ประกาศ มท. 2567 (L/360 น้ำหนักจร, L/240 รวม)');
    }
    return c.finish(inputs, { section: g.name, method, Mp: fx.Mp / 100, Mn: fx.Mn / 100, Lp: fx.Lp && fx.Lp / 100, Lr: fx.Lr && fx.Lr / 100, regime: fx.regime,
      flangeClass: fx.flange, webClass: fx.web, Vn: sh.Vn, Cv: sh.Cv, Cb: Math.min(Cb, 3),
      capacity: { LRFD: resist('LRFD', src, 'flex').apply(fx.Mn) / 100, ASD: resist('ASD', src, 'flex').apply(fx.Mn) / 100 }, unitsNote: 'moments kg-m, lengths m' });
  };

  // ------------------------------------------------------------------ column
  function compression(g, Fy, KLx, KLy, c) {
    const sq = Math.sqrt(E / Fy);
    // slender element check (Table B4.1a)
    let slender = false, msg = '';
    if (g.isI || g.isC) {
      const lf = g.isC ? g.bf / g.tf : g.bf / (2 * g.tf), lw = g.hw / g.tw;
      if (lf > 0.56 * sq) { slender = true; msg = 'flange ชะลูด b/t=' + f(lf) + ' > ' + f(0.56 * sq); }
      if (lw > 1.49 * sq) { slender = true; msg += ' web ชะลูด h/tw=' + f(lw) + ' > ' + f(1.49 * sq); }
    } else if (g.isTube) {
      const t = g.t || g.tw, lb = (g.bflat || g.bf - 3 * t) / t, lh = (g.hw || g.d - 3 * t) / t;
      if (Math.max(lb, lh) > 1.40 * sq) { slender = true; msg = 'ผนังท่อ b/t=' + f(Math.max(lb, lh)) + ' > ' + f(1.40 * sq); }
    } else if (g.isPipe) {
      const l = (g.D || g.d) / (g.t || g.tw);
      if (l > 0.11 * E / Fy) { slender = true; msg = 'D/t=' + f(l) + ' > ' + f(0.11 * E / Fy); }
    }
    c.step('ตรวจ slender element (รับแรงอัด)', 'λ ≤ λr (Table B4.1a)', slender ? msg : 'ไม่เป็น slender', slender ? 1 : 0, '', 'AISC 360-16 Table B4.1a');
    if (slender) c.hard.push('ไม่รองรับ: ชิ้นส่วนชะลูด (slender element) รับแรงอัด — ' + msg);
    const rx = g.rx, ry = g.ry, sx = KLx / rx, sy = KLy / ry, sl = Math.max(sx, sy);
    const Fe = PI * PI * E / (sl * sl), lim = 4.71 * sq;
    const Fcr = sl <= lim ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
    const Pn = Fcr * g.A;
    c.step('KL/r', 'max(KLx/rx , KLy/ry)', 'KLx/rx=' + f(sx) + ' ; KLy/ry=' + f(sy), sl, '', 'AISC 360-16 E2');
    c.step('Fe', 'Fe = π²E/(KL/r)²', '= π²×' + E + '/' + f(sl) + '²', Fe, 'ksc', 'AISC 360-16 E3-4');
    c.step('Fcr', sl <= lim ? 'KL/r ≤ 4.71√(E/Fy)=' + f(lim) + ' : 0.658^(Fy/Fe) Fy' : 'KL/r > ' + f(lim) + ' : 0.877 Fe',
      'Fy/Fe=' + f(Fy / Fe, 3), Fcr, 'ksc', 'AISC 360-16 E3-2/E3-3');
    c.step('Pn', 'Pn = Fcr Ag', '= ' + f(Fcr) + '×' + f(g.A), Pn, 'kg', 'AISC 360-16 E3-1');
    return { Pn, Fcr, Fe, slenderness: sl, sx, sy, branch: sl <= lim ? 'inelastic' : 'elastic', slender };
  }

  steel.column = function (inp) {
    const inputs = JSON.parse(JSON.stringify(inp || {}));
    const sec = getSection(inp.section); if (!sec) return bad('ไม่พบหน้าตัด', inputs);
    const g = geom(sec), Fy = inp.Fy, method = inp.method === 'ASD' ? 'ASD' : 'LRFD', src = inp.steelPhiSource || 'MR2566';
    if (!(Fy > 0)) return bad('ต้องระบุ Fy (ksc)', inputs);
    const c = ctx();
    const P0 = method === 'ASD' ? (inp.Pa !== undefined ? inp.Pa : inp.Pu) : (inp.Pu !== undefined ? inp.Pu : inp.Pa);
    if (!fin(P0)) return bad('ต้องระบุแรงตามแกน (Pu หรือ Pa; บวก = อัด, ลบ = ดึง)', inputs);
    if (!(inp.KLx > 0) || !(inp.KLy > 0)) return bad('ต้องระบุ KLx และ KLy (ม.) > 0', inputs);
    unverified(g, c);
    const KLx = inp.KLx * 100, KLy = inp.KLy * 100;
    if (P0 < 0) {
      const rt = resist(method, src, 'tens'), Tn = Fy * g.A, Tc = rt.apply(Tn);
      c.step('กำลังรับแรงดึงครากบนพื้นที่รวม', 'Tn = Fy·Ag', '= ' + Fy + '×' + f(g.A), Tn, 'kg', 'AISC 360-16 D2(a)');
      c.check('แรงดึง ' + (method === 'LRFD' ? 'Tu ≤ φtTn' : 'Ta ≤ Tn/Ωt'), -P0, Tc, 'kg', clauseFor('AISC 360-16 D2 / วสท. 011038', src));
      c.warnings.push('แรงดึง: ตรวจเฉพาะการครากบนพื้นที่รวม — การแตกที่หน้าตัดสุทธิ/จุดต่อ (φ=0.75) ไม่ได้ตรวจ');
      return c.finish(inputs, { section: g.name, method, tension: true, Tn, capacity: Tc });
    }
    const P = P0;
    const r = compression(g, Fy, KLx, KLy, c);
    const rc = resist(method, src, 'comp'), Pc = rc.apply(r.Pn);
    c.step(method === 'LRFD' ? 'φcPn' : 'Pn/Ωc', rc.text, '', Pc, 'kg', clauseFor('AISC 360-16 E1 / วสท. 011038', src));
    c.check('กำลังรับแรงอัด ' + (method === 'LRFD' ? 'Pu ≤ φPn' : 'Pa ≤ Pn/Ω'), P, Pc, 'kg', clauseFor('AISC 360-16 E3 / วสท. 011038', src));
    c.check('อัตราส่วนชะลูด KL/r ≤ 200', r.slenderness, 200, '', 'AISC 360-16 E2 (ข้อแนะนำ)');
    if (r.slenderness > 120) c.warnings.push('KL/r > 120 — ชะลูดมาก ควรพิจารณาเพิ่มขนาด');
    if (g.isC) c.warnings.push('ช่อง (C): การโก่งเดาะแบบบิด/ดัด-บิด (E4) ไม่ได้ตรวจสอบ');
    if (g.isI && g.Cw) {
      const Fez = (PI * PI * E * g.Cw / Math.pow(Math.max(KLx, KLy), 2) + GSH * g.J) / (g.Ix + g.Iy);
      if (Fez < r.Fe * 1.5) c.warnings.push('Fez (บิด) = ' + f(Fez, 0) + ' ksc ใกล้เคียง Fe — ควรตรวจโก่งเดาะแบบบิด (E4)');
    }
    return c.finish(inputs, { section: g.name, method, Pn: r.Pn, Fcr: r.Fcr, Fe: r.Fe, slenderness: r.slenderness, branch: r.branch, capacity: Pc,
      capacityBoth: { LRFD: resist('LRFD', src, 'comp').apply(r.Pn), ASD: resist('ASD', src, 'comp').apply(r.Pn) } });
  };

  // ------------------------------------------------------------------ beam-column
  steel.beamColumn = function (inp) {
    const inputs = JSON.parse(JSON.stringify(inp || {}));
    const sec = getSection(inp.section); if (!sec) return bad('ไม่พบหน้าตัด', inputs);
    const g = geom(sec), Fy = inp.Fy, method = inp.method === 'ASD' ? 'ASD' : 'LRFD', src = inp.steelPhiSource || 'MR2566';
    if (!(Fy > 0)) return bad('ต้องระบุ Fy (ksc)', inputs);
    const c = ctx();
    const pickR = (u, a) => (method === 'ASD' ? (inp[a] !== undefined ? inp[a] : inp[u]) : (inp[u] !== undefined ? inp[u] : inp[a]));
    const pick = (u, a) => pickR(u, a) || 0;
    const Praw = pickR('Pu', 'Pa');
    if (!fin(Praw)) return bad('ต้องระบุแรงตามแกน (Pu หรือ Pa; บวก = อัด, ลบ = ดึง)', inputs);
    if (!(inp.KLx > 0) || !(inp.KLy > 0)) return bad('ต้องระบุ KLx และ KLy (ม.) > 0', inputs);
    if (!fin(inp.Lb)) return bad('ต้องระบุ Lb (ม.) — ใส่ 0 หากค้ำยันต่อเนื่อง', inputs);
    for (const k of ['Mux', 'Max', 'Muy', 'May']) if (inp[k] !== undefined && !fin(inp[k])) return bad(k + ' ไม่ใช่ตัวเลข', inputs);
    unverified(g, c);
    const tens = Praw < 0;
    const Pr = Math.abs(Praw), Mrx = Math.abs(pick('Mux', 'Max')) * 100, Mry = Math.abs(pick('Muy', 'May')) * 100; // kg-cm
    const col = tens ? { Pn: Fy * g.A, Fcr: Fy, slenderness: 0 } : compression(g, Fy, inp.KLx * 100, inp.KLy * 100, c);
    if (tens) c.warnings.push('แรงดึง + ดัด: ใช้กำลังรับแรงดึงคราก (φtFyAg) เป็น Pc ใน H1-1 — ไม่ได้ตรวจการแตกที่หน้าตัดสุทธิ');
    const fx = flexX(g, Fy, (inp.Lb || 0) * 100, Math.min(inp.Cb || 1, 3), c);
    const MnY = flexY(g, Fy, c);
    const Pc = resist(method, src, tens ? 'tens' : 'comp').apply(col.Pn), Mcx = resist(method, src, 'flex').apply(fx.Mn), Mcy = resist(method, src, 'flex').apply(MnY);
    const a = Pc > 0 ? Pr / Pc : 999, mx = Mcx > 0 ? Mrx / Mcx : (Mrx > 0 ? 999 : 0), my = Mcy > 0 ? Mry / Mcy : (Mry > 0 ? 999 : 0);
    let H, form;
    if (a >= 0.2) { H = a + 8 / 9 * (mx + my); form = 'Pr/Pc + 8/9(Mrx/Mcx + Mry/Mcy) ≤ 1.0'; }
    else { H = a / 2 + (mx + my); form = 'Pr/(2Pc) + (Mrx/Mcx + Mry/Mcy) ≤ 1.0'; }
    c.step('Pr/Pc', 'Pr / Pc', f(Pr, 0) + '/' + f(Pc, 0), a, '', 'AISC 360-16 H1.1');
    c.step('Mrx/Mcx , Mry/Mcy', 'Mr / Mc', f(Mrx / 100, 0) + '/' + f(Mcx / 100, 0) + ' , ' + f(Mry / 100, 0) + '/' + f(Mcy / 100, 0), mx + my, '', 'AISC 360-16 H1.1');
    c.step('สมการ interaction (' + (a >= 0.2 ? 'H1-1a' : 'H1-1b') + ')', form, '= ' + f(H, 3), H, '', clauseFor('AISC 360-16 H1-1 / วสท. 011038', src));
    c.check('Interaction ' + (a >= 0.2 ? 'H1-1a' : 'H1-1b'), H, 1, '', clauseFor('AISC 360-16 H1-1 / วสท. 011038', src));
    c.warnings.push('Mr และ Pr ต้องเป็นผลวิเคราะห์อันดับสอง (รวม B1/B2 หรือ P-Δ) — ฟังก์ชันนี้ไม่ได้ขยายโมเมนต์ให้');
    if (col.slenderness > 200) c.check('KL/r ≤ 200', col.slenderness, 200, '', 'AISC 360-16 E2');
    return c.finish(inputs, { section: g.name, method, interaction: H, equation: a >= 0.2 ? 'H1-1a' : 'H1-1b', Pc, Mcx: Mcx / 100, Mcy: Mcy / 100, Pn: col.Pn, Fcr: col.Fcr });
  };

  steel.E = E;
  if (typeof module !== 'undefined' && module.exports) module.exports = steel;
})(typeof globalThis !== 'undefined' ? globalThis : this);
