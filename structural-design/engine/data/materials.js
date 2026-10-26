/* engine/data/materials.js — material grades, allowable stresses, phi sets, live loads, unit weights, SDL presets.
 * Design units: kg, cm, ksc unless the name says otherwise. Model units (concreteModel/steelModel): kgf, m.
 * Live-load table: MR2566 ข้อ 11 (verified:true per coordinator override). Everything else is the §3 seed
 * (values tagged verifiedNote). */
(function (root) {
  const SD = root.SD = root.SD || {};
  const M = SD.materials = SD.materials || {};

  M.Es = 2.04e6;      // ksc, reinforcing & structural steel
  M.nuConcrete = 0.2;
  M.nuSteel = 0.3;

  // ---- concrete (fc' cylinder strength, ksc)
  M.concrete = [180, 210, 240, 280, 320].map(fc => ({ id: 'C' + fc, fc, Ec: 0, density: 2400 }));
  /** Ec = 15100 sqrt(fc') ksc */
  M.Ec = (fc) => 15100 * Math.sqrt(fc);
  M.concrete.forEach(c => { c.Ec = M.Ec(c.fc); });
  /** beta1 = 0.85 for fc'<=280, -0.05 per 70 ksc above, min 0.65 */
  M.beta1 = (fc) => fc <= 280 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 280) / 70);
  /** modular ratio n = Es/Ec (displayed in WSD reports) */
  M.modularRatio = (fc) => M.Es / M.Ec(fc);
  /** Analysis-model concrete material (kg/m2). */
  M.concreteModel = (fc) => ({ E: M.Ec(fc) * 1e4, nu: M.nuConcrete, density: 2400 });
  M.steelModel = () => ({ E: M.Es * 1e4, nu: M.nuSteel, density: 7850 });
  /** fc'(cylinder) from cube strength */
  M.cubeToCylinder = (cube) => 0.80 * cube;

  // ---- reinforcement (fy ksc). fsAllow = WSD allowable tensile stress.
  M.rebar = [
    { id: 'SR24', std: 'มอก. 20', type: 'round', fy: 2400, fsAllow: 1200, diameters: [6, 9, 12, 15, 19, 22, 25] },
    { id: 'SD30', std: 'มอก. 24', type: 'deformed', fy: 3000, fsAllow: 1500, diameters: [10, 12, 16, 20, 25, 28, 32] },
    { id: 'SD40', std: 'มอก. 24', type: 'deformed', fy: 4000, fsAllow: 1700, diameters: [10, 12, 16, 20, 25, 28, 32] },
    { id: 'SD50', std: 'มอก. 24', type: 'deformed', fy: 5000, fsAllow: 1700, diameters: [10, 12, 16, 20, 25, 28, 32] }
  ];
  M.rebarById = (id) => M.rebar.find(r => r.id === id) || null;

  // ---- structural steel (Fy, Fu ksc)
  M.steel = [
    { id: 'SS400', std: 'มอก. 1227', Fy: 2450, Fu: 4100, verified: false },
    { id: 'A36', std: 'ASTM A36', Fy: 2530, Fu: 4080, verified: false },
    { id: 'SM490', std: 'มอก. 1227', Fy: 3250, Fu: 5000, verified: false },
    { id: 'A572-50', std: 'ASTM A572 Gr.50', Fy: 3515, Fu: 4570, verified: false }
  ];
  M.steelById = (id) => M.steel.find(s => s.id === id) || null;

  // ---- WSD allowable stresses (วสท. 1007-34 [VERIFY]) — ksc
  M.wsdAllowable = function (fc, rebarId) {
    const rb = M.rebarById(rebarId); if (!rb) throw new Error('Unknown rebar grade ' + rebarId);
    const sq = Math.sqrt(fc), vc = 0.29 * sq;
    return { fcAllow: 0.45 * fc, fsAllow: rb.fsAllow, n: M.modularRatio(fc), vc, vMax: vc + 1.06 * sq,
      note: 'WSD allowable stresses, วสท. 1007-34 [VERIFY]; 1.33 increase for W/E is a project toggle (default OFF).' };
  };

  // ---- strength-reduction factors
  // MR2566 (กฎกระทรวง 2566): with/without quality control (QC). ACI318: ACI φ. MR6_2527: same as MR2566 with QC.
  const MR_QC = { flexure: 0.90, axialTension: 0.90, spiral: 0.75, tied: 0.70, shear: 0.85, torsion: 0.85, bearing: 0.70 };
  const MR_NOQC = { flexure: 0.75, axialTension: 0.75, spiral: 0.625, tied: 0.60, shear: 0.70, torsion: 0.70, bearing: 0.60 };
  const ACI = { flexure: 0.90, axialTension: 0.90, spiral: 0.75, tied: 0.65, shear: 0.75, torsion: 0.75, bearing: 0.65 };
  M.phiSets = {
    MR2566: { qc: true, rc: Object.assign({ rhoMaxRule: '0.75rho_b' }, MR_QC), rcNoQC: Object.assign({ rhoMaxRule: '0.75rho_b' }, MR_NOQC),
      steelLRFD: { tensionYield: 0.90, tensionFracture: 0.75, compression: 0.90, flexure: 0.90, shear: 0.90, connection: 0.75 } },
    MR6_2527: { rc: Object.assign({ rhoMaxRule: '0.75rho_b' }, MR_QC), rcNoQC: Object.assign({ rhoMaxRule: '0.75rho_b' }, MR_NOQC),
      steelLRFD: { tensionYield: 0.90, tensionFracture: 0.75, compression: 0.90, flexure: 0.90, shear: 0.90, connection: 0.75 } },
    ACI318: { rc: Object.assign({ rhoMaxRule: 'epsT>=0.004' }, ACI), rcNoQC: Object.assign({ rhoMaxRule: 'epsT>=0.004' }, ACI),
      steelLRFD: { tensionYield: 0.90, tensionFracture: 0.75, compression: 0.90, flexure: 0.90, shear: 1.00, connection: 0.75 } }
  };
  /** phi('MR2566', {qc:true}) -> { flexure, spiral, tied, shear, torsion, bearing, axialTension, rhoMaxRule, set, qc } */
  M.phi = function (set, opts) {
    const s = M.phiSets[set]; if (!s) throw new Error('Unknown phi set ' + set);
    const qc = !(opts && opts.qc === false);
    return Object.assign({ set, qc: set === 'ACI318' ? null : qc }, qc ? s.rc : s.rcNoQC);
  };
  M.phiSteel = (set) => Object.assign({ set }, (M.phiSets[set] || M.phiSets.MR2566).steelLRFD);
  M.asdFactors = { Omega_b: 1.67, Omega_v: 1.50, Omega_c: 1.67, Omega_t: 1.67 };

  // ---- live loads, MR2566 ข้อ 11 (kg/m2). reductionAllowed follows ข้อ 14.
  const src = 'MR2566 ข้อ 11';
  const ll = (id, th, en, q, ra) => ({ id, th, en, q, unit: 'kg/m2', reductionAllowed: ra && q <= 500, verified: true, source: src });
  M.liveLoads = [
    ll('roof', 'หลังคา', 'Roof', 50, true),
    ll('canopy', 'กันสาดคอนกรีต', 'Concrete canopy', 100, true),
    ll('housing', 'ที่พักอาศัย ห้องพักโรงแรม/คอนโดมิเนียม', 'Housing, hotel/condo rooms', 200, true),
    ll('rooftop_deck', 'ดาดฟ้า', 'Rooftop deck', 200, true),
    ll('office', 'สำนักงาน', 'Office', 250, true),
    ll('classroom', 'ห้องเรียน', 'Classroom (school)', 250, false),
    ll('shophouse', 'ส่วนพาณิชย์ของตึกแถว/ห้องแถว', 'Shophouse commercial part', 300, true),
    ll('carpark_light', 'ที่จอดรถยนต์นั่ง (ไม่เกิน 7 ที่นั่ง)', 'Car park (<=7 seats)', 300, false),
    ll('assembly_fixed', 'ที่ชุมนุมคน ที่นั่งติดตรึง', 'Assembly, fixed seats', 300, false),
    ll('assembly_movable', 'ที่ชุมนุมคน ที่นั่งเคลื่อนที่ได้', 'Assembly, movable seats', 400, false),
    ll('retail', 'ร้านค้าปลีก', 'Retail', 400, true),
    ll('hotel_service', 'ส่วนบริการของโรงแรม', 'Hotel service areas', 400, true),
    ll('fire_stair', 'บันไดหนีไฟ', 'Fire stair', 400, true),
    ll('assembly_lobby', 'ล็อบบี้ บันได ทางเดินของอาคารที่ชุมนุมคน', 'Lobby/stair/corridor of assembly building', 500, false),
    ll('storage', 'คลังสินค้า ค้าส่ง อุตสาหกรรม', 'Wholesale, storage, industrial', 500, false),
    ll('heavy_parking', 'ที่จอดรถบรรทุก/รถโดยสาร', 'Bus/truck parking', 800, false)
  ];
  M.liveLoadById = (id) => M.liveLoads.find(r => r.id === id) || null;
  /** Impact ข้อ 16: additional percentage of the live load */
  M.impact = [
    { id: 'lift', th: 'ลิฟต์', additionalPct: 100, source: 'MR2566 ข้อ 16', verified: true },
    { id: 'light_machinery', th: 'เครื่องจักรเบา', additionalPct: 20, source: 'MR2566 ข้อ 16', verified: true },
    { id: 'reciprocating', th: 'เครื่องจักรลูกสูบ/ลูกเลื่อน', additionalPct: 50, source: 'MR2566 ข้อ 16', verified: true },
    { id: 'hung_floor', th: 'พื้นแขวน', additionalPct: 33, source: 'MR2566 ข้อ 16', verified: true }
  ];

  // ---- unit weights kg/m3
  M.unitWeights = { rc: 2400, plainConcrete: 2300, steel: 7850, mortar: 2100, soil: 1800, water: 1000, timberMin: 600, timberMax: 800 };

  // ---- superimposed dead load presets (kg/m2 of surface; walls as kg/m2 x height => kg/m)
  M.sdlPresets = [
    { id: 'finish', th: 'ผิวพื้น/ปูกระเบื้อง', min: 100, max: 150, default: 120, unit: 'kg/m2' },
    { id: 'ceiling_mep', th: 'ฝ้าเพดาน+ระบบ MEP', min: 20, max: 50, default: 30, unit: 'kg/m2' },
    { id: 'brick_wall_10', th: 'ผนังก่ออิฐมอญ 10 ซม.', min: 180, max: 200, default: 190, unit: 'kg/m2 wall' },
    { id: 'aac_wall_10', th: 'ผนังอิฐมวลเบา 10 ซม.', min: 60, max: 70, default: 65, unit: 'kg/m2 wall' },
    { id: 'light_partition', th: 'ผนังเบา', min: 30, max: 40, default: 35, unit: 'kg/m2 wall' }
  ].map(p => Object.assign(p, { verified: false, note: 'seed value, editable [VERIFY]' }));
  /** wall line load kg/m = kg/m2 x height */
  M.wallLineLoad = (kgPerM2, h) => kgPerM2 * h;

  if (typeof module !== 'undefined' && module.exports) module.exports = M;
})(typeof globalThis !== 'undefined' ? globalThis : this);
