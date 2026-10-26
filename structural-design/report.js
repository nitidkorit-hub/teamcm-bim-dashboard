/* report.js - builds the calculation-report (รายการคำนวณ) HTML. Classic script, exposes window.SDReport.
 * Every dynamic string goes through esc(). Diagrams are inline SVG strings.
 * SDReport.build(P, ctx) -> html string
 *   P   : project object (see app.js defaultProject)
 *   ctx : { results, drift, registry (effective rows), today, deflection }
 */
(function (root) {
  'use strict';
  const SET_LABELS = {
    MR2566: 'กฎกระทรวง 2566 (บังคับใช้ 4 มี.ค. 2567)',
    MR6_2527: 'กฎกระทรวงฉบับที่ 6 (2527) — เฉพาะคำขอก่อน 4 มี.ค. 2567',
    ACI318: 'ACI 318 (ทางเลือก)'
  };
  const LEVELS = { associate: 'ภาคี', ordinary: 'สามัญ', senior: 'วุฒิ' };

  // Only report.js code can create Raw HTML; data coming from JSON can never be an instance of this class.
  class Raw { constructor(html) { this.html = html; } }
  const raw = (html) => new Raw(html);
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const nf = {};
  function fmt(n, d) {
    if (n === null || n === undefined || n === '' || typeof n === 'boolean') return n === true ? 'ใช่' : n === false ? 'ไม่' : '-';
    const v = Number(n);
    if (!isFinite(v)) return esc(n);
    const a = Math.abs(v);
    const k = d === undefined ? (a >= 1000 ? 'f0' : a >= 100 ? 'f1' : a >= 10 ? 'f2' : 'sig4') : 'f' + d;
    if (!nf[k]) nf[k] = k === 'sig4' ? new Intl.NumberFormat('th-TH', { maximumSignificantDigits: 4 }) : new Intl.NumberFormat('th-TH', { maximumFractionDigits: +k.slice(1), minimumFractionDigits: 0 });
    return nf[k].format(v);
  }
  /** D/C ratio: never rounds an over-limit value (>1) down to 1.000 or an under-limit value up to 1.000 */
  function fmtRatio(x) {
    const v = Number(x); if (!isFinite(v)) return '-';
    if (v > 1) return (Math.max(Math.ceil(v * 1000 - 1e-9), 1001) / 1000).toFixed(3);
    const f = Math.floor(v * 1000 + 1e-9) / 1000;
    return (v < 1 && f >= 1 ? 0.999 : f).toFixed(3);
  }
  function fdate(iso) {
    if (!iso) return '-';
    const d = new Date(iso); if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* ---------- phi table actually used ---------- */
  function phiRows(set, qc) {
    try {
      const M = root.SD && root.SD.materials;
      if (M && M.phi) {
        const p = M.phi(set, { qc: qc !== false });
        return { note: (SET_LABELS[set] || set) + (set === 'ACI318' ? '' : (qc !== false ? ' - มีการควบคุมคุณภาพ (QC)' : ' - ไม่มีการควบคุมคุณภาพ (QC)')) + (p.rhoMaxRule ? ' | ρmax: ' + p.rhoMaxRule : '') + ' (ค่าจาก SD.materials.phi)',
          rows: [['flexure', p.flexure], ['axial tension', p.axialTension], ['spiral column', p.spiral], ['tied column', p.tied], ['shear', p.shear], ['torsion', p.torsion], ['bearing', p.bearing]] };
      }
    } catch (e) { /* fall back to local table */ }
    if (set === 'ACI318') return {
      note: 'ACI 318 - ค่า φ ตาม ACI (flexure ใช้ 0.90 เมื่อ εt เพียงพอ, ช่วงเปลี่ยนผ่านตาม εt)',
      rows: [['flexure / axial tension (tension-controlled)', 0.90], ['spiral column', 0.75], ['tied column', 0.65], ['shear, torsion', 0.75], ['bearing', 0.65]]
    };
    if (set === 'MR6_2527') return {
      note: 'กฎกระทรวงฉบับที่ 6 (2527) - ค่า φ ตาม วสท. 1008-38 (อ้างอิงจากข้อกำหนดเดิม)',
      rows: [['flexure / axial tension', 0.90], ['spiral column', 0.75], ['tied column', 0.70], ['shear, torsion', 0.85], ['bearing', 0.70]]
    };
    return qc !== false ? {
      note: 'กฎกระทรวง 2566 - กรณีมีการควบคุมคุณภาพ (QC)',
      rows: [['flexure / axial tension', 0.90], ['spiral column', 0.75], ['tied column', 0.70], ['shear, torsion', 0.85], ['bearing', 0.70]]
    } : {
      note: 'กฎกระทรวง 2566 - กรณีไม่มีการควบคุมคุณภาพ (QC)',
      rows: [['flexure / axial tension', 0.75], ['spiral column', 0.625], ['tied column', 0.60], ['shear, torsion', 0.70], ['bearing', 0.60]]
    };
  }
  function steelPhiNote(set) {
    try { const M = root.SD && root.SD.materials; if (M && M.phiSteel) { const p = M.phiSteel(set); return 'LRFD phi: tension yield ' + p.tensionYield + ', fracture ' + p.tensionFracture + ', compression ' + p.compression + ', flexure ' + p.flexure + ', shear ' + p.shear + ', connection ' + p.connection; } } catch (e) { /* fall back */ }
    return set === 'MR2566' ? 'LRFD ตามกฎกระทรวง 2566: tension yield 0.90, fracture 0.75, compression/flexure/shear 0.90, connections 0.75'
      : 'LRFD/ASD factors ตามที่ engine ใช้ (ดูแผ่นออกแบบ)';
  }
  function licenceGuidance(P) {
    const st = Number(P.meta.storeys) || 0;
    const rows = ['วุฒิวิศวกร: ทุกงาน', 'สามัญวิศวกร: งานออกแบบและคำนวณทุกประเภท',
      'ภาคีวิศวกร: อาคาร ≤ 4 ชั้น หรือความสูงต่อชั้น ≤ 5 ม. และไม่ใช่อาคารสาธารณะ (งานที่อยู่ในเขตแผ่นดินไหวต้องผ่านการอบรมด้านแผ่นดินไหว)'];
    let warn = '';
    if (P.engineer.level === 'associate' && (st > 4 || P.meta.publicBuilding)) warn = 'ข้อสังเกต: ระดับ ภาคี อาจไม่เพียงพอสำหรับอาคารนี้ (จำนวนชั้น/อาคารสาธารณะ) - โปรดตรวจสอบกับข้อบังคับสภาวิศวกร';
    return { rows, warn };
  }

  /* ---------- SVG helpers ---------- */
  function svgDiagram(series, o) {
    o = o || {};
    const W = o.W || 320, H = o.H || 150, ml = 40, mr = 14, mt = 22, mb = 18;
    let xmax = 0, vmin = 0, vmax = 0;
    series.forEach((s) => { s.x.forEach((x) => { xmax = Math.max(xmax, x); }); s.v.forEach((v) => { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }); });
    if (!(xmax > 0)) xmax = 1;
    if (vmax - vmin < 1e-12) { vmax += 1; vmin -= 1; }
    const pad = (vmax - vmin) * 0.12; const lo = vmin - pad, hi = vmax + pad;
    const X = (x) => ml + (x / xmax) * (W - ml - mr);
    const Y = (v) => mt + (hi - v) / (hi - lo) * (H - mt - mb);
    let g = '';
    g += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#bbb"/>`;
    g += `<text x="6" y="14" font-size="11" font-weight="600">${esc(o.title || '')} <tspan fill="#666" font-weight="400">${esc(o.unit ? '[' + o.unit + ']' : '')}</tspan></text>`;
    g += `<line x1="${ml}" y1="${Y(0)}" x2="${W - mr}" y2="${Y(0)}" stroke="#333" stroke-width="1"/>`;
    g += `<text x="${ml}" y="${H - 4}" font-size="9" fill="#666">0</text><text x="${W - mr}" y="${H - 4}" font-size="9" fill="#666" text-anchor="end">${esc(fmt(xmax, 2))} m</text>`;
    const cols = ['#c0392b', '#2471a3', '#1e8449'];
    series.forEach((s, si) => {
      if (!s.x.length) return;
      const c = s.color || cols[si % cols.length];
      let pts = s.x.map((x, i) => `${X(x).toFixed(1)},${Y(s.v[i]).toFixed(1)}`).join(' ');
      if (si === 0 && series.length === 1) g += `<polygon points="${X(s.x[0]).toFixed(1)},${Y(0)} ${pts} ${X(s.x[s.x.length - 1]).toFixed(1)},${Y(0)}" fill="${c}" fill-opacity="0.12" stroke="none"/>`;
      g += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
      let imax = 0, imin = 0;
      s.v.forEach((v, i) => { if (v > s.v[imax]) imax = i; if (v < s.v[imin]) imin = i; });
      [[imax, 'max'], [imin, 'min']].forEach(([i, k]) => {
        if (k === 'min' && imin === imax) return;
        if (Math.abs(s.v[i]) < 1e-9) return;
        const px = X(s.x[i]), py = Y(s.v[i]);
        const anchor = px > W - 60 ? 'end' : px < ml + 30 ? 'start' : 'middle';
        const dy = s.v[i] >= 0 ? -4 : 11;
        g += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="${c}"/><text x="${px.toFixed(1)}" y="${(py + dy).toFixed(1)}" font-size="9.5" fill="${c}" text-anchor="${anchor}">${esc(fmt(s.v[i], o.dec === undefined ? 2 : o.dec))}</text>`;
      });
    });
    return `<svg class="svg-chart" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'diagram')}">${g}</svg>`;
  }

  function svgProjection(model, hAxis, vAxis, o) {
    o = o || {};
    const W = o.W || 520, H = o.H || 300, pad = 34;
    const nodes = (model.nodes || []);
    const byId = {}; nodes.forEach((n) => { byId[n.id] = n; });
    const zsel = o.level;
    let members = (model.members || []).filter((m) => byId[m.i] && byId[m.j]);
    let nset = nodes;
    if (zsel !== undefined) {
      members = members.filter((m) => Math.abs(byId[m.i].z - zsel) < 1e-3 && Math.abs(byId[m.j].z - zsel) < 1e-3);
      nset = nodes.filter((n) => Math.abs(n.z - zsel) < 1e-3);
    }
    if (!nset.length) return '<div class="muted">-</div>';
    let h0 = Infinity, h1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    nset.forEach((n) => { h0 = Math.min(h0, n[hAxis]); h1 = Math.max(h1, n[hAxis]); v0 = Math.min(v0, n[vAxis]); v1 = Math.max(v1, n[vAxis]); });
    const sc = Math.min((W - 2 * pad) / Math.max(h1 - h0, 1e-6), (H - 2 * pad) / Math.max(v1 - v0, 1e-6));
    const sx = Math.min(sc, 1e6);
    const X = (n) => pad + (n[hAxis] - h0) * sx, Y = (n) => H - pad - (n[vAxis] - v0) * sx;
    let g = `<rect width="${W}" height="${H}" fill="#fff" stroke="#bbb"/>`;
    const uniq = (ax) => [...new Set(nset.map((n) => Math.round(n[ax] * 1000) / 1000))].sort((a, b) => a - b).slice(0, 24);
    uniq(hAxis).forEach((v) => { const x = pad + (v - h0) * sx; g += `<line x1="${x}" y1="${pad - 12}" x2="${x}" y2="${H - pad + 8}" stroke="#e3e6ea" stroke-dasharray="3,3"/><text x="${x}" y="${H - 8}" font-size="9" text-anchor="middle" fill="#555">${esc(fmt(v, 2))}</text>`; });
    uniq(vAxis).forEach((v) => { const y = H - pad - (v - v0) * sx; g += `<line x1="${pad - 8}" y1="${y}" x2="${W - pad + 12}" y2="${y}" stroke="#e3e6ea" stroke-dasharray="3,3"/><text x="4" y="${y + 3}" font-size="9" fill="#555">${esc(fmt(v, 2))}</text>`; });
    const colr = { beam: '#2f6db5', column: '#333', brace: '#d9822b' };
    members.forEach((m) => {
      const a = byId[m.i], b = byId[m.j];
      if (Math.abs(a[hAxis] - b[hAxis]) < 1e-9 && Math.abs(a[vAxis] - b[vAxis]) < 1e-9) return;
      g += `<line x1="${X(a).toFixed(1)}" y1="${Y(a).toFixed(1)}" x2="${X(b).toFixed(1)}" y2="${Y(b).toFixed(1)}" stroke="${colr[m.kind] || '#2f6db5'}" stroke-width="${m.kind === 'column' ? 2.4 : 1.6}"/>`;
    });
    const sup = new Set((model.supports || []).map((s) => s.node));
    nset.forEach((n) => {
      const x = X(n), y = Y(n);
      if (sup.has(n.id)) g += `<polygon points="${x},${y} ${x - 6},${y + 10} ${x + 6},${y + 10}" fill="#2e8b57"/>`;
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#000"/>`;
      if (nset.length <= 40) g += `<text x="${(x + 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="8" fill="#a33">${esc(n.id)}</text>`;
    });
    g += `<text x="${W - 6}" y="12" font-size="10" text-anchor="end" font-weight="600">${esc(o.title || '')}</text>`;
    return `<svg class="svg-chart" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'model')}">${g}</svg>`;
  }

  function svgPM(pm, demands, o) {
    o = o || {};
    const W = o.W || 340, H = o.H || 260, ml = 48, mb = 26, mt = 20, mr = 12;
    const pts = (pm || []).map((p) => [Number(p.M !== undefined ? p.M : p.Mn), Number(p.P !== undefined ? p.P : p.Pn)]).filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (!pts.length) return '';
    const dem = (demands || []).filter((d) => isFinite(d.M) && isFinite(d.P));
    let mx = 0, pmx = -Infinity, pmn = Infinity;
    pts.concat(dem.map((d) => [d.M, d.P])).forEach(([m, p]) => { mx = Math.max(mx, m); pmx = Math.max(pmx, p); pmn = Math.min(pmn, p); });
    pmn = Math.min(pmn, 0); if (pmx <= pmn) pmx = pmn + 1; if (mx <= 0) mx = 1;
    const X = (m) => ml + m / mx * (W - ml - mr), Y = (p) => mt + (pmx - p) / (pmx - pmn) * (H - mt - mb);
    let g = `<rect width="${W}" height="${H}" fill="#fff" stroke="#bbb"/>`;
    g += `<line x1="${ml}" y1="${Y(0)}" x2="${W - mr}" y2="${Y(0)}" stroke="#999"/><line x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}" stroke="#999"/>`;
    g += `<polyline fill="rgba(36,113,163,.10)" stroke="#2471a3" stroke-width="1.8" points="${pts.map((p) => X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ')}"/>`;
    dem.forEach((d) => { g += `<circle cx="${X(d.M).toFixed(1)}" cy="${Y(d.P).toFixed(1)}" r="4" fill="${d.ok === false ? '#c0392b' : '#1e8449'}"/><text x="${(X(d.M) + 6).toFixed(1)}" y="${(Y(d.P) - 4).toFixed(1)}" font-size="9">${esc(d.label || '')}</text>`; });
    g += `<text x="6" y="13" font-size="11" font-weight="600">${esc(o.title || 'P-M interaction (φPn - φMn)')}</text>`;
    g += `<text x="${W - mr}" y="${H - 6}" font-size="9" text-anchor="end" fill="#555">φMn [${esc(o.munit || 'kg-m')}]</text><text x="${ml + 4}" y="${mt + 10}" font-size="9" fill="#555">φPn [${esc(o.punit || 'kg')}]</text>`;
    g += `<text x="${ml - 4}" y="${Y(pmx) + 4}" font-size="9" text-anchor="end">${esc(fmt(pmx, 0))}</text><text x="${W - mr}" y="${Y(0) - 3}" font-size="9" text-anchor="end">${esc(fmt(mx, 0))}</text>`;
    return `<svg class="svg-chart" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="P-M interaction">${g}</svg>`;
  }

  /* ---------- html pieces ---------- */
  function kv(rows) {
    return '<table class="kv">' + rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${r[2] ? r[1] : esc(r[1] === undefined || r[1] === '' ? '-' : r[1])}</td></tr>`).join('') + '</table>';
  }
  function table(head, rows, numCols) {
    numCols = numCols || [];
    return '<table><thead><tr>' + head.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${c instanceof Raw ? c.html : esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  }
  function stepsHtml(steps) {
    return (steps || []).map((s) => `<div class="rpt-step"><b>${esc(s.label)}</b>` +
      (s.formula ? ` : ${esc(s.formula)}` : '') + (s.substituted ? `<br>&rarr; <span class="sub">${esc(s.substituted)}</span>` : '') +
      (s.value !== undefined && s.value !== null && s.value !== '' ? ` = <b>${esc(typeof s.value === 'number' ? fmt(s.value, 3) : s.value)}</b> ${esc(s.unit || '')}` : '') +
      (s.clause ? ` <i style="color:#555">[${esc(s.clause)}]</i>` : '') + '</div>').join('');
  }
  function sigBlock(P) {
    const e = P.engineer || {};
    const g = licenceGuidance(P);
    return `<div class="rpt-sign"><div><b>ผู้ออกแบบและคำนวณ</b><div class="line"></div>
      <div>ลงชื่อ ( ${esc(e.name || '................................................')} )</div>
      <div>วันที่ ${esc(e.signDate ? fdate(e.signDate) : '........../........../..........')}</div></div>
      <div>${kvMini([['ชื่อวิศวกร', e.name], ['ใบอนุญาต กว. เลขที่', e.license], ['ระดับ', LEVELS[e.level] || e.level], ['สาขา', e.discipline || 'วิศวกรรมโยธา']])}</div></div>` +
      (g.warn ? `<div class="rpt-warn">${esc(g.warn)}</div>` : '');
  }
  function kvMini(rows) { return rows.map((r) => `<div>${esc(r[0])}: <b>${esc(r[1] || '................')}</b></div>`).join(''); }

  /* ---------- derived data ---------- */
  function memberLen(model, m) {
    const a = model.nodes.find((n) => n.id === m.i), b = model.nodes.find((n) => n.id === m.j);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
  }
  function isCantilever(model, m) {
    const cnt = {}; (model.members || []).forEach((x) => { cnt[x.i] = (cnt[x.i] || 0) + 1; cnt[x.j] = (cnt[x.j] || 0) + 1; });
    const sup = new Set((model.supports || []).map((s) => s.node));
    return [m.i, m.j].some((n) => cnt[n] === 1 && !sup.has(n));
  }
  function serviceDeflection(P, results) {
    // unfactored sum of D/SD/L cases (type based); deflection from stations dz
    if (!results || !results.cases) return [];
    const cases = P.loads.cases || [];
    const dead = cases.filter((c) => c.type === 'D' || c.type === 'SD').map((c) => c.id).filter((id) => results.cases[id]);
    const live = cases.filter((c) => c.type === 'L').map((c) => c.id).filter((id) => results.cases[id]);
    const out = [];
    (P.model.members || []).forEach((m) => {
      if (m.kind === 'column') return;
      const L = memberLen(P.model, m);
      const cant = isCantilever(P.model, m);
      const sum = (ids) => {
        let mx = 0;
        const first = ids.length && results.cases[ids[0]].members[m.id];
        if (!first) return 0;
        first.stations.forEach((s, k) => {
          let t = 0; ids.forEach((id) => { const mm = results.cases[id].members[m.id]; if (mm && mm.stations[k]) t += mm.stations[k].dzc; });
          mx = Math.max(mx, Math.abs(t));
        });
        return mx;
      };
      const tot = sum(dead.concat(live)), lv = sum(live);
      if (tot > 0 || lv > 0) out.push({ id: m.id, L, Leff: cant ? 2 * L : L, cant, total: tot, live: lv });
    });
    return out;
  }
  function envCell(env, k) {
    if (!env || !env[k]) return '-';
    const e = env[k];
    const pick = Math.abs(e.max) >= Math.abs(e.min) ? [e.max, e.comboMax] : [e.min, e.comboMin];
    return fmt(pick[0], 0) + (pick[1] ? ' (' + pick[1] + ')' : '');
  }
  function reactionSummary(P, results) {
    const ids = Object.keys(results.cases).filter((k) => (P.loads.combos || []).some((c) => c.id === k));
    const rows = {};
    ids.forEach((cid) => {
      const rr = results.cases[cid].reactions || {};
      Object.keys(rr).forEach((n) => {
        const r = rr[n]; const o = rows[n] = rows[n] || { fzmax: -Infinity, fzmin: Infinity, fx: 0, fy: 0, mx: 0, my: 0, cmax: '', cmin: '' };
        if (r.fz > o.fzmax) { o.fzmax = r.fz; o.cmax = cid; } if (r.fz < o.fzmin) { o.fzmin = r.fz; o.cmin = cid; }
        o.fx = Math.max(o.fx, Math.abs(r.fx)); o.fy = Math.max(o.fy, Math.abs(r.fy)); o.mx = Math.max(o.mx, Math.abs(r.mx)); o.my = Math.max(o.my, Math.abs(r.my));
      });
    });
    return rows;
  }

  function collectWarnings(P, ctx) {
    const w = [];
    const R = ctx.results;
    if (R && R.warnings) R.warnings.forEach((x) => w.push('การวิเคราะห์: ' + x));
    const wo = P.loads.windOut; if (wo) [wo.X, wo.Y].forEach((d) => { if (d && d.res) { if (d.res.applicable === false) w.push('ลม: วิธีที่เลือกไม่ครอบคลุมอาคารนี้ - ต้องใช้วิธีอื่น/dynamic'); (d.res.warnings || []).forEach((x) => w.push('ลม: ' + x)); } });
    const so = P.loads.seismicOut; if (so && so.res && so.res.warnings) so.res.warnings.forEach((x) => w.push('แผ่นดินไหว: ' + x));
    const dsg = (P.design && P.design.out) || {};
    Object.keys(dsg).forEach((id) => {
      const o = dsg[id]; const it = (P.design.items || []).find((x) => x.id === id);
      (o.runs || []).forEach((r) => { (r.hard || []).forEach((x) => w.push(`[คำเตือนร้ายแรง] ${it ? it.label : id} / ${r.title}: ${x}`)); (r.warnings || []).forEach((x) => w.push(`${it ? it.label : id} / ${r.title}: ${x}`)); if (r.slabApprox) w.push(`${it ? it.label : id}: สัมประสิทธิ์พื้นสองทางเป็นค่าประมาณ verified:false - ต้องตรวจสอบกับตารางต้นฉบับ`); });
    });
    (P.loads.assignments || []).forEach((a) => { if (a.unverifiedLL) w.push(`น้ำหนักบรรทุกจร "${a.name}" ใช้ค่าจากตารางที่ยังไม่ตรวจสอบ (verified:false)`); });
    const sOut = P.loads.seismicOut; if (sOut && sOut.params && Number(sOut.params.TL) === 4) w.push('แผ่นดินไหว: TL = 4 วินาทีเป็นค่า placeholder ยังไม่ได้ตรวจสอบกับ มยผ. 1301/1302-61');
    if (ctx.provinceUnverified) w.push('ข้อมูลจังหวัด (V50/Ss/S1) เป็นค่า placeholder verified:false - ต้องแทนที่ด้วยค่าจากตารางมาตรฐานก่อนใช้งานจริง');
    Object.keys(dsg).forEach((id) => { const o = dsg[id]; const it = (P.design.items || []).find((x) => x.id === id); (o.notes || []).forEach((x) => w.push(`${it ? it.label : id}: ${x}`)); if (o.allowUnverified) w.push(`${it ? it.label : id}: ผู้ใช้เลือก "ยอมรับใช้ตารางสัมประสิทธิ์ที่ยังไม่ตรวจสอบ" สำหรับพื้นสองทาง`); });
    ((ctx.comboNotes) || []).forEach((x) => w.push('combination: ' + x));
    w.push('ไม่ได้ตรวจสอบการออกแบบรับแรงบิด (torsion) ในโปรแกรมรุ่นนี้ - ต้องพิจารณาแยกเมื่อมีแรงบิดมีนัยสำคัญ');
    w.push('ผลกระทบ P-Δ / ความไม่เป็นเชิงเส้นทางเรขาคณิตไม่ได้รวมในการวิเคราะห์เชิงเส้น - ตรวจสอบ sway (second-order) ด้วยตนเองสำหรับโครงที่ยอมให้เคลื่อนที่ด้านข้าง');
    w.push('แรงลม/แผ่นดินไหวกระจายเท่ากันที่โหนดของแต่ละระดับพื้น ไม่ได้รวม accidental eccentricity ±5% และ dynamic analysis');
    w.push('แผ่นพื้นสองทางต้องตรวจสอบสัมประสิทธิ์จากตารางอ้างอิงต้นฉบับก่อนใช้งาน');
    const un = (ctx.registry || []).filter((r) => r.used && (r.status === 'unknown' || r.status === 'draft' || r.stale));
    un.forEach((r) => w.push(`มาตรฐาน "${r.titleTh || r.id}" สถานะ ${r.status}${r.stale ? ' และยังไม่ได้ตรวจสอบเกิน 180 วัน' : ''} - ต้องยืนยันกับแหล่งทางการ`));
    if (P.method.allowIncrease) w.push('ใช้ allowable stress increase 1.33 ใน combination ที่มีลม/แผ่นดินไหว (กฎกระทรวง 2566 ไม่ได้ระบุไว้) - ผู้ออกแบบต้องรับรองเหตุผล');
    if (P.method.comboSet === 'MR6_2527') w.push('ใช้ชุด combination ตามกฎกระทรวงฉบับที่ 6 (2527) - ใช้ได้เฉพาะคำขอที่ยื่นก่อน 4 มี.ค. 2567');
    if (!R) w.push('ยังไม่ได้รันการวิเคราะห์ - ผลในรายงานส่วนที่ 7 ไม่สมบูรณ์');
    return [...new Set(w)];
  }

  /* ---------- main builder ---------- */
  function build(P, ctx) {
    ctx = ctx || {};
    const R = ctx.results || null;
    const M = P.model, m = P.meta, me = P.method;
    const today = ctx.today || new Date().toISOString().slice(0, 10);
    const setLbl = SET_LABELS[me.comboSet] || me.comboSet;
    const eng = P.engineer || {};
    const footerBase = `<span>${esc(m.name || 'โครงการ')} - รายการคำนวณโครงสร้าง (Rev. ${esc(m.revision || '0')})</span><span>${esc(eng.name ? 'วิศวกรผู้ออกแบบ: ' + eng.name : 'ยังไม่ระบุวิศวกร')} ${esc(eng.license ? '(กว. ' + eng.license + ')' : '')}</span>`;
    const staleList = ctx.stale || [];
    const stampTxt = staleList.length ? `ผลลัพธ์ไม่เป็นปัจจุบัน — ต้องวิเคราะห์/ออกแบบใหม่ (${staleList.join('; ')})` : '';
    const stamp = stampTxt ? `<div class="rpt-stale">${esc(stampTxt)}</div>` : '';
    const footerTxt = footerBase + (stampTxt ? `<span class="rpt-stale-f">${esc('ผลลัพธ์ไม่เป็นปัจจุบัน — ต้องวิเคราะห์/ออกแบบใหม่')}</span>` : '');
    const page = (inner) => `<section class="rpt-page">${stamp}${inner}<div class="rpt-footer inpage">${footerTxt}</div></section>`;
    const sections = [];
    const toc = [];
    const secs = ['ปกรายการคำนวณ', 'สารบัญและประวัติการแก้ไข', 'เกณฑ์การออกแบบ', 'มาตรฐานและเอกสารอ้างอิง', 'น้ำหนักบรรทุก', 'แบบจำลองโครงสร้าง', 'ผลการวิเคราะห์', 'การออกแบบองค์อาคาร', 'สรุปผลและข้อควรระวัง', 'การรับรองโดยวิศวกร'];
    secs.forEach((s, i) => toc.push(`${i + 1}. ${s}`));

    // 1 cover
    sections.push(page(`<div class="cover-title"><h1>รายการคำนวณโครงสร้าง</h1><div style="font-size:16px">Structural Calculation Report</div></div>
      <div style="margin-top:14mm">${kv([['โครงการ', m.name], ['สถานที่ตั้ง', [m.location, m.province].filter(Boolean).join(' จ.')], ['เจ้าของโครงการ', m.owner], ['การใช้อาคาร', m.use],
        ['จำนวนชั้น', m.storeys], ['พื้นที่ใช้สอย (ตร.ม.)', m.area ? fmt(m.area, 1) : ''], ['ความสูงอาคาร (ม.)', m.height ? fmt(m.height, 2) : ''], ['ระบบโครงสร้าง', m.system],
        ['ชุด combination', setLbl], ['วันที่', fdate(m.date || today)], ['Revision', m.revision || '0']])}</div>
      <div style="margin-top:12mm">${sigBlock(P)}</div>`));

    // 2 contents + revision
    const revs = (P.revisions && P.revisions.length ? P.revisions : [{ rev: m.revision || '0', date: m.date || today, desc: 'ออกรายงานฉบับแรก', by: eng.name || '' }]);
    sections.push(page(`<h2>2. สารบัญและประวัติการแก้ไข</h2><table class="rpt-toc"><tbody>${toc.map((t) => `<tr><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      <h3>ประวัติการแก้ไข (Revision log)</h3>${table(['Rev.', 'วันที่', 'รายละเอียด', 'โดย'], revs.map((r) => [r.rev, fdate(r.date), r.desc, r.by]))}`));

    // 3 criteria
    const sdmCombos = (P.loads.combos || []);
    const out = (P.design && P.design.out) || {};
    const items = (P.design && P.design.items) || [];
    const recs = items.map((it) => out[it.id]).filter(Boolean);
    const keyOf = (o) => [o.set, o.qc !== false, !!o.allowIncrease].join('|');
    const distinct = {}; recs.forEach((o) => { distinct[keyOf(o)] = o; });
    const curKey = [me.comboSet, me.qc !== false, !!me.allowIncrease].join('|');
    const mismatch = Object.keys(distinct).filter((k) => k !== curKey);
    let phiHtml = '';
    const phiShow = Object.keys(distinct).length ? Object.keys(distinct).map((k) => distinct[k]) : [{ set: me.comboSet, qc: me.qc, allowIncrease: me.allowIncrease }];
    phiShow.forEach((o) => {
      const ph = phiRows(o.set, o.qc);
      phiHtml += `<h3>ค่า φ ที่ใช้จริงในการออกแบบ - ${esc(SET_LABELS[o.set] || o.set)}, QC ${o.qc !== false ? 'มี' : 'ไม่มี'}, allowable increase ${o.allowIncrease ? '1.33' : 'ไม่ใช้'} - ${esc(ph.note)}</h3>` + table(['การกระทำ', 'φ'], ph.rows.map((x) => [x[0], fmt(x[1], 3)]), [1]);
    });
    sections.push(page(`<h2>3. เกณฑ์การออกแบบ</h2>${mismatch.length ? '<div class="rpt-warn" style="border-color:#b00020;background:#fdecea;color:#b00020"><b>ผลออกแบบบางรายการใช้เกณฑ์ (ชุด combination / QC / allowable increase) ไม่ตรงกับการตั้งค่าโครงการปัจจุบัน</b> - ต้องออกแบบใหม่ให้สอดคล้อง</div>' : ''}${kv([
      ['ชุด load combination (ตั้งค่าปัจจุบัน)', setLbl], ['วิธีออกแบบคอนกรีตเสริมเหล็ก', me.rc === 'SDM' ? 'SDM - Strength Design Method' : 'WSD - Working Stress Design'],
      ['วิธีออกแบบเหล็กรูปพรรณ', me.steel === 'LRFD' ? 'LRFD' : 'ASD'], ['การควบคุมคุณภาพ (QC)', me.qc !== false ? 'มี' : 'ไม่มี'],
      ['Allowable stress increase 1.33 (WSD)', me.allowIncrease ? 'ใช้เฉพาะ combination ที่มีลม/แผ่นดินไหว และไม่มีการลด 0.75 อยู่แล้ว (combination แรงโน้มถ่วงไม่เพิ่ม) - ออกแบบแยกกลุ่มและใช้อัตราส่วนที่วิกฤตที่สุด' : 'ไม่ใช้'],
      ['Cracked modifiers (strength analysis)', `คาน ${fmt(me.crackedBeam, 2)} Ig, เสา ${fmt(me.crackedColumn, 2)} Ig (ค่าที่ผู้ใช้กำหนด)`],
      ['หน่วยกำลังอัดคอนกรีต', me.strengthBasis === 'cube' ? "ผู้ใช้ป้อนเป็น cube; fc' (cylinder) = 0.80 x cube" : "fc' (cylinder)"],
      ['หน่วยในการวิเคราะห์', 'kgf, m (แสดงผล: kg, kg-m, mm)'], ['หน่วยในการออกแบบ', 'kg, cm, ksc']], 0)}
      ${phiHtml}
      <div class="muted">เหล็กรูปพรรณ: ${esc(steelPhiNote(me.comboSet))}</div>
      <h3>รายการ combination ที่ใช้</h3>${table(['ID', 'ชื่อ', 'วิธี', 'ชุด', 'ตัวคูณ', 'increase'], sdmCombos.map((c) => [c.id, c.name, c.method, c.set, Object.keys(c.factors || {}).map((k) => k + ':' + c.factors[k]).join(', '), c.allowIncrease ? c.allowIncrease : '-']))}`));

    // 4 references
    const reg = (ctx.registry || []).filter((r) => r.used);
    sections.push(page(`<h2>4. มาตรฐานและเอกสารอ้างอิง</h2>
      <div class="rpt-warn">ผู้ออกแบบต้องยืนยันฉบับ/สถานะของมาตรฐานกับแหล่งทางการก่อนยื่นขออนุญาต ตารางนี้แสดงข้อมูลตามที่บันทึกในโปรแกรม ณ วันที่พิมพ์</div>
      ${table(['เอกสาร', 'หน่วยงาน', 'ฉบับ/ปี', 'สถานะ', 'ตรวจสอบล่าสุด', 'ผู้ตรวจ'], reg.map((r) => [
        (r.titleTh || r.id) + (r.titleEn ? ' / ' + r.titleEn : ''), r.issuer, r.editionYear, r.status + (r.stale ? ' (ไม่ได้ตรวจสอบเกิน 180 วัน)' : ''), r.lastVerifiedDate ? fdate(r.lastVerifiedDate) : 'ยังไม่ได้ตรวจสอบ', r.verifiedBy]))}`));

    // 5 loads
    let l5 = '<h2>5. น้ำหนักบรรทุก</h2>';
    l5 += '<h3>5.1 กรณีน้ำหนักบรรทุก (Load cases)</h3>' + table(['ID', 'ชื่อ', 'ประเภท', 'น้ำหนักตัวเอง', 'โหลดจุด', 'โหลดบนองค์อาคาร'], (P.loads.cases || []).map((c) => [c.id, c.name, c.type, c.selfWeight ? 'รวม' : '-', (c.nodal || []).length, (c.member || []).length]), [4, 5]);
    if ((P.loads.assignments || []).length) l5 += '<h3>5.2 พื้นและน้ำหนักบรรทุกจร (slab-to-beam)</h3>' + table(['รายการ', 'ความหนาพื้น (ซม.)', 'SDL (กก./ตร.ม.)', 'LL (กก./ตร.ม.)', 'ที่มา LL / หมายเหตุ', 'Tributary (ม.)', 'จำนวนองค์อาคาร'],
      P.loads.assignments.map((a) => [a.name, a.slabT, a.sdl, a.liveValue, (a.liveOverride ? 'กำหนดเอง: ' : 'ตาราง: ') + (a.liveKey || '') + (a.liveRemark ? ' / ' + a.liveRemark : ''), a.width, (a.members || []).length]), [1, 2, 3, 5, 6]);
    if ((P.loads.walls || []).length) l5 += '<h3>5.3 น้ำหนักผนัง (line load)</h3>' + table(['รายการ', 'น้ำหนักผนัง (กก./ตร.ม.)', 'สูง (ม.)', 'ลดช่องเปิด', 'w (กก./ม.)', 'จำนวนองค์อาคาร'],
      P.loads.walls.map((w) => [w.name, w.unitWt, w.height, w.reduction || 0, fmt(w.unitWt * w.height * (1 - (w.reduction || 0))), (w.members || []).length]), [1, 2, 3, 4, 5]);
    const wo = P.loads.windOut;
    if (wo) {
      l5 += `<h3>5.4 แรงลม - ${esc(wo.method === 'MR2566' ? 'กฎกระทรวง 2566 ข้อ 17 (แบบง่าย)' : 'มยผ. 1311-50')}</h3>`;
      ['X', 'Y'].forEach((ax) => { const d = wo[ax]; if (!d) return; l5 += `<div><b>ทิศทาง ${ax}</b></div>` + (d.res && d.res.steps ? stepsHtml(d.res.steps) : '') +
        (d.forces ? table(['ระดับ z (ม.)', 'F (กก.)'], d.forces.map((f) => [fmt(f.z, 2), fmt(f.F, 0)]), [0, 1]) : ''); });
    }
    const so = P.loads.seismicOut;
    if (so && so.res) {
      l5 += `<h3>5.5 แรงแผ่นดินไหว (ELF)</h3>${kv([['เขตแผ่นดินไหว (กฎกระทรวง 2564)', so.zone || 'ไม่อยู่ในเขตควบคุม'], ['SDS', fmt(so.res.SDS, 3)], ['SD1', fmt(so.res.SD1, 3)], ['Ta (s)', fmt(so.res.Ta, 3)], ['T ที่ใช้ (s)', fmt(so.res.T, 3)], ['Cs', fmt(so.res.Cs, 4)], ['V (กก.)', fmt(so.res.V, 0)], ['SDC', so.res.SDC]])}` +
        stepsHtml(so.res.steps) + (so.forces ? table(['ระดับ', 'z/h (ม.)', 'F (กก.)'], so.forces.map((f, i) => [i + 1, fmt(f.h !== undefined ? f.h : f.z, 2), fmt(f.F !== undefined ? f.F : f.Fx, 0)]), [1, 2]) : '');
    }
    sections.push(page(l5));

    // 6 model
    const zs = [...new Set((M.nodes || []).map((n) => Math.round(n.z * 1000) / 1000))].sort((a, b) => a - b);
    const lvl = zs.length > 1 ? zs[1] : zs[0];
    let l6 = `<h2>6. แบบจำลองโครงสร้าง</h2>${kv([['จำนวนโหนด', (M.nodes || []).length], ['จำนวนองค์อาคาร', (M.members || []).length], ['จำนวนจุดรองรับ', (M.supports || []).length], ['ระดับพื้น (z, ม.)', zs.join(', ')]])}`;
    if ((M.nodes || []).length) l6 += `<div class="rpt-svg">${svgProjection(M, 'x', 'y', { title: 'ผังที่ระดับ z=' + fmt(lvl, 2), level: lvl })}</div><div class="rpt-svg">${svgProjection(M, 'x', 'z', { title: 'ด้านหน้า (X-Z)' })}</div><div class="rpt-svg">${svgProjection(M, 'y', 'z', { title: 'ด้านข้าง (Y-Z)' })}</div>`;
    l6 += '<h3>วัสดุและหน้าตัด</h3>' + table(['ชื่อ', 'E (ksc)', 'ν', 'density (กก./ลบ.ม.)'], Object.keys(M.materials || {}).map((k) => [k, fmt(M.materials[k].E / 1e4, 0), M.materials[k].nu, M.materials[k].density]), [1, 2, 3]);
    l6 += table(['หน้าตัด', 'รูปทรง', 'A (ซม.²)', 'Iy (ซม.⁴)', 'Iz (ซม.⁴)', 'J (ซม.⁴)'], Object.keys(M.sections || {}).map((k) => { const s = M.sections[k]; return [k, s.shape + (s.b ? ` ${fmt(s.b * 100, 1)}x${fmt(s.h * 100, 1)} ซม.` : ''), fmt(s.A * 1e4, 1), fmt(s.Iy * 1e8, 0), fmt(s.Iz * 1e8, 0), fmt(s.J * 1e8, 0)]; }), [2, 3, 4, 5]);
    l6 += '<h3>องค์อาคาร</h3>' + table(['ID', 'i', 'j', 'หน้าตัด', 'วัสดุ', 'ชนิด', 'กลุ่ม', 'ยาว (ม.)', 'Modifier I', 'Release'], (M.members || []).map((x) => [x.id, x.i, x.j, x.section, x.material, x.kind, x.group, fmt(memberLen(M, x), 2),
      x.modifiers && x.modifiers.I ? x.modifiers.I : (x.kind === 'column' ? me.crackedColumn : x.kind === 'beam' ? me.crackedBeam : 1), relText(x.releases)]), [7, 8]);
    l6 += '<h3>จุดรองรับ</h3>' + table(['โหนด', 'ux', 'uy', 'uz', 'rx', 'ry', 'rz'], (M.supports || []).map((s) => [s.node, ...['ux', 'uy', 'uz', 'rx', 'ry', 'rz'].map((k) => (s[k] ? 'fix' : '-'))]));
    sections.push(page(l6));

    // 7 results
    let l7 = '<h2>7. ผลการวิเคราะห์</h2>';
    if (!R) l7 += '<div class="rpt-warn">ยังไม่ได้รันการวิเคราะห์</div>';
    else {
      l7 += kv([['DOF', R.dofCount], ['Equilibrium error (max)', ctx.eqErr !== undefined ? ctx.eqErr : '-'], ['รหัส/เวลาการวิเคราะห์', ctx.analysisInfo ? ctx.analysisInfo.id + ' / ' + new Date(ctx.analysisInfo.at).toLocaleString('th-TH') : '-'], ['จำนวน case/combination', Object.keys(R.cases).length]]);
      const envHead = ['องค์อาคาร', 'N', 'Vy', 'Vz', 'T', 'My', 'Mz'];
      const FK = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'];
      const fullTable = (E) => table(envHead, (M.members || []).map((x) => { const e = (E || {})[x.id]; return [x.id, ...FK.map((k) => envCell(e, k))]; }));
      const groupTable = (E) => {
        const groups = {}; (M.members || []).forEach((x) => { (groups[x.group || '(ไม่มีกลุ่ม)'] = groups[x.group || '(ไม่มีกลุ่ม)'] || []).push(x); });
        return table(['กลุ่ม', 'จำนวน', ...FK], Object.keys(groups).map((g) => [g, groups[g].length, ...FK.map((k) => {
          let best = null; groups[g].forEach((x) => { const e = (E || {})[x.id]; if (!e || !e[k]) return; const v = Math.abs(e[k].max) >= Math.abs(e[k].min) ? [e[k].max, e[k].comboMax] : [e[k].min, e[k].comboMin]; if (!best || Math.abs(v[0]) > Math.abs(best.v)) best = { v: v[0], c: v[1], id: x.id }; });
          return best ? fmt(best.v, 0) + ' (' + best.id + (best.c ? ', ' + best.c : '') + ')' : '-';
        })]));
      };
      const envTable = (E) => (ctx.fullForceTable ? fullTable(E) : groupTable(E));
      const ebm = R.envelopesByMethod;
      if (ebm && (ebm.SDM || ebm.WSD)) ['SDM', 'WSD'].forEach((mt) => { if (ebm[mt]) l7 += `<h3>7.1 แรงภายในสูงสุด - combination วิธี ${mt} (หน่วย กก., กก.-ม.; ค่าสูงสุดในกลุ่ม (องค์อาคาร, combo))</h3>` + envTable(ebm[mt]); });
      else l7 += '<h3>7.1 แรงภายในสูงสุด (envelope ทุก combination ปนกันทั้ง SDM/WSD - ไม่ใช้ตรวจสอบกำลังโดยตรง; หน่วย กก., กก.-ม.)</h3>' + envTable(R.envelopes);
      const gov = (M.members || []).filter((x) => x.kind !== 'column').map((x) => ({ x, v: Math.max(Math.abs(((R.envelopes || {})[x.id] || {}).My ? R.envelopes[x.id].My.max : 0), Math.abs(((R.envelopes || {})[x.id] || {}).My ? R.envelopes[x.id].My.min : 0)) })).sort((a, b) => b.v - a.v)[0];
      if (gov && gov.v > 0) {
        const cid = (R.envelopes[gov.x.id].My.max >= -R.envelopes[gov.x.id].My.min ? R.envelopes[gov.x.id].My.comboMax : R.envelopes[gov.x.id].My.comboMin);
        const cr = R.cases[cid] && R.cases[cid].members[gov.x.id];
        if (cr) l7 += `<div class="rpt-svg">${svgDiagram([{ x: cr.stations.map((s) => s.x), v: cr.stations.map((s) => s.My) }], { title: `My องค์อาคาร ${gov.x.id} (${cid})`, unit: 'kg-m', W: 460, H: 170, dec: 0 })}</div>`;
      }
      const rs = reactionSummary(P, R);
      l7 += '<h3>7.2 ปฏิกิริยาที่จุดรองรับ (envelope)</h3>' + table(['โหนด', '|Fx| max', '|Fy| max', 'Fz max (combo)', 'Fz min (combo)', '|Mx| max', '|My| max'],
        Object.keys(rs).map((n) => [n, fmt(rs[n].fx, 0), fmt(rs[n].fy, 0), fmt(rs[n].fzmax, 0) + ' (' + rs[n].cmax + ')', fmt(rs[n].fzmin, 0) + ' (' + rs[n].cmin + ')', fmt(rs[n].mx, 0), fmt(rs[n].my, 0)]), [1, 2, 3, 4, 5, 6]);
      const sd = serviceDeflection(P, R);
      if (sd.length) l7 += '<h3>7.3 การโก่งตัว (elastic, ใช้ cracked I ตามที่กำหนด, ไม่รวม long-term multiplier; น้ำหนักบรรทุกใช้งาน D+SD+L ไม่คูณตัวคูณ; ข้อกำหนด L/360 น้ำหนักจร, L/240 รวม; คานยื่นใช้ความยาวประสิทธิผล 2L)</h3>' +
        table(['องค์อาคาร', 'L (ม.)', 'δ รวม (มม.)', 'L/δ รวม', 'δ จร (มม.)', 'L/δ จร', 'ผล'], sd.map((d) => {
          const tr = d.total ? d.Leff / d.total : Infinity, lr = d.live ? d.Leff / d.live : Infinity;
          const ok = tr >= 240 && lr >= 360;
          return [d.id + (d.cant ? ' (ยื่น)' : ''), fmt(d.L, 2), fmt(d.total * 1000, 2), isFinite(tr) ? fmt(tr, 0) : '-', fmt(d.live * 1000, 2), isFinite(lr) ? fmt(lr, 0) : '-', raw(`<span class="${ok ? 'rpt-ok' : 'rpt-ng'}">${ok ? 'OK' : 'NG'}</span>`)];
        }), [1, 2, 3, 4, 5]);
      if (ctx.drift && ctx.drift.length) l7 += '<h3>7.4 Storey drift</h3>' + table(['Case', 'ชั้น/ระดับ z (ม.)', 'h (ม.)', 'δ (มม.)', 'Δ (มม.)', 'Δ/h', 'ขีดจำกัด', 'ผล'], ctx.drift.map((d) => [d.caseId, fmt(d.z, 2), fmt(d.h, 2), fmt(d.u * 1000, 2), fmt(d.delta * 1000, 2), fmt(d.ratio, 5), fmt(d.limit, 5), raw(`<span class="${d.ok ? 'rpt-ok' : 'rpt-ng'}">${d.ok ? 'OK' : 'NG'}</span>`)]), [1, 2, 3, 4, 5, 6]);
    }
    sections.push(page(l7));

    // 8 designs - EVERY item is listed
    let l8 = '<h2>8. การออกแบบองค์อาคาร</h2>';
    const staleIds = new Set(ctx.staleDesignIds || []);
    let notDesigned = 0;
    items.forEach((it) => {
      const o = out[it.id];
      if (!o) { notDesigned++; l8 += `<h3>${esc(it.label)}</h3><div class="rpt-warn" style="border-color:#b00020;background:#fdecea;color:#b00020"><b>ยังไม่ได้ออกแบบ (NOT DESIGNED)</b></div>`; return; }
      l8 += `<h3>${esc(it.label)} <small>(${esc(o.typeLabel || it.type)}; วิธี ${esc(o.method || '')}; combination: ${esc(SET_LABELS[o.set] || o.set || '')}; QC ${o.qc !== false ? 'มี' : 'ไม่มี'}; คำนวณเมื่อ ${esc(o.at ? new Date(o.at).toLocaleString('th-TH') : '-')}${o.analysisId ? '; รหัสวิเคราะห์ ' + esc(o.analysisId) : ''})</small></h3>`;
      if (staleIds.has(it.id)) l8 += '<div class="rpt-warn" style="border-color:#b00020;background:#fdecea;color:#b00020"><b>ผลออกแบบรายการนี้ไม่เป็นปัจจุบัน — ต้องออกแบบใหม่</b></div>';
      if (o.forces) l8 += kv(Object.keys(o.forces).map((k) => [k, fmt(o.forces[k], 1)]));
      if (o.govCombos && Object.keys(o.govCombos).length) l8 += '<div class="muted">combination ที่ควบคุมแรงออกแบบ: ' + esc(Object.keys(o.govCombos).map((k) => k + '=' + o.govCombos[k]).join(', ')) + '</div>';
      (o.runs || []).forEach((r) => {
        l8 += `<div><b>${esc(r.title)}</b> - D/C = ${esc(fmtRatio(r.ratio))} <span class="${r.ok ? 'rpt-ok' : 'rpt-ng'}">${r.ok ? 'OK' : 'NOT OK'}</span>${r.governing ? ' <i>(ควบคุมโดย: ' + esc(r.governing) + ')</i>' : ''}</div>`;
        if (r.inputs) l8 += '<div class="muted">Input: ' + esc(Object.keys(r.inputs).filter((k) => typeof r.inputs[k] !== 'object').map((k) => k + '=' + r.inputs[k]).join(', ')) + '</div>';
        l8 += table(['การตรวจสอบ', 'Demand', 'Capacity', 'D/C', 'หน่วย', 'ผล', 'อ้างอิง'], (r.checks || []).map((c) => [c.name, fmt(c.demand, 2), fmt(c.capacity, 2), fmtRatio(c.ratio), c.unit, raw(`<span class="${c.ok ? 'rpt-ok' : 'rpt-ng'}">${c.ok ? 'OK' : 'NOT OK'}</span>`), c.clause]), [1, 2, 3]);
        l8 += stepsHtml(r.steps);
        (r.hard || []).forEach((x) => { l8 += `<div class="rpt-warn" style="border-color:#b00020;background:#fdecea;color:#b00020"><b>คำเตือนร้ายแรง:</b> ${esc(x)}</div>`; });
        if (r.slabApprox) l8 += '<div class="rpt-warn" style="border-color:#b00020;color:#b00020"><b>ตารางสัมประสิทธิ์พื้นสองทางเป็นค่าประมาณ (verified:false)</b>' + (o.allowUnverified ? ' - ผู้ใช้เลือกยอมรับใช้ตารางที่ยังไม่ตรวจสอบ' : '') + ' - ต้องตรวจสอบกับตารางต้นฉบับ</div>';
        if (r.pm && r.pm.length) l8 += `<div class="rpt-svg">${svgPM(r.pm, r.pmDemands, { title: 'P-M แกน x' })}${r.pmY && r.pmY.length ? svgPM(r.pmY, r.pmYDemands, { title: 'P-M แกน y' }) : ''}</div>`;
      });
    });
    if (!items.length) l8 += '<div class="rpt-warn">ไม่มีรายการออกแบบ</div>';
    sections.push(page(l8));

    // 9 conclusions
    const allRuns = []; items.forEach((it) => { const o = out[it.id]; if (o) (o.runs || []).forEach((r) => allRuns.push({ it, r })); });
    const ng = allRuns.filter((x) => !x.r.ok);
    const warns = collectWarnings(P, ctx);
    sections.push(page(`<h2>9. สรุปผลและข้อควรระวัง</h2>
      <p>รายการออกแบบทั้งหมด ${items.length} รายการ: ออกแบบแล้ว ${items.length - notDesigned}, <b${notDesigned ? ' style="color:#b00020"' : ''}>ยังไม่ได้ออกแบบ ${notDesigned}</b> | การตรวจสอบ ${allRuns.length} รายการ: ผ่าน ${allRuns.length - ng.length}, ไม่ผ่าน ${ng.length}${ng.length ? ' (' + esc(ng.map((x) => x.it.label + '/' + x.r.title).join(', ')) + ')' : ''}</p>
      <h3>คำเตือนและรายการที่ไม่ได้ตรวจสอบ (รวบรวมจากโปรแกรม)</h3>${warns.map((x) => (x.startsWith('[คำเตือนร้ายแรง]') ? `<div class="rpt-warn" style="border-color:#b00020;background:#fdecea;color:#b00020">${esc(x)}</div>` : `<div class="rpt-warn">${esc(x)}</div>`)).join('')}`));

    // 10 sign + legal
    const g = licenceGuidance(P);
    sections.push(page(`<h2>10. การรับรองโดยวิศวกร</h2>${sigBlock(P)}
      <div class="rpt-legal"><b>หมายเหตุทางกฎหมาย:</b> รายการคำนวณนี้ต้องจัดทำและลงนามรับรองโดยวิศวกรโยธาผู้ได้รับใบอนุญาตประกอบวิชาชีพวิศวกรรมควบคุม ตาม พ.ร.บ.วิศวกร พ.ศ. 2542 และกฎกระทรวงที่เกี่ยวข้อง
        <br>แนวทางระดับใบอนุญาต (เพื่อประกอบการพิจารณาเท่านั้น ตามข้อบังคับสภาวิศวกร พ.ศ. 2566): ${g.rows.map((x) => esc(x)).join(' / ')}</div>
      <div class="rpt-legal"><b>ข้อจำกัดความรับผิดชอบ:</b> ซอฟต์แวร์นี้เป็นเครื่องมือช่วยคำนวณเท่านั้น วิศวกรผู้ลงนามเป็นผู้รับผิดชอบผลการออกแบบ ข้อมูลมาตรฐานและค่าพารามิเตอร์ทั้งหมดต้องได้รับการตรวจสอบกับเอกสารทางการก่อนใช้งานจริง</div>`));

    return `<div class="rpt-footer fixedf">${footerTxt}</div>` + sections.join('');
  }
  function relText(r) {
    if (!r) return '-';
    const f = (e) => (e ? ['my', 'mz', 't'].filter((k) => e[k]).join('+') : '');
    const a = f(r.i), b = f(r.j);
    return a || b ? `i:${a || '-'} j:${b || '-'}` : '-';
  }

  root.SDReport = { build, esc, fmt, fmtRatio, fdate, svgDiagram, svgProjection, svgPM, SET_LABELS, LEVELS, phiRows, serviceDeflection, collectWarnings, memberLen, reactionSummary };
})(typeof globalThis !== 'undefined' ? globalThis : this);
