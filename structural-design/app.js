/* app.js - UI controller (classic script). Talks to window.SD (engine), SDReport and SDViewer.
 * Security: all DOM is built with createElement/textContent via h(); imported JSON is sanitised in normalizeProject().
 * Engine contract assumptions are listed in the hand-off report; they are isolated in the ADAPTERS section.
 */
(function () {
  'use strict';
  const R_ = window.SDReport;
  const esc = R_.esc, fmt = R_.fmt;
  const LS_KEY = 'sd.project.v1';
  const SET_LABELS = R_.SET_LABELS;
  const SETS = ['MR2566', 'MR6_2527', 'ACI318'];
  const SD = () => window.SD || {};

  /* =============================== DOM helpers =============================== */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  const $ = (s, r) => (r || document).querySelector(s);
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function toNum(v, d) { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : (d === undefined ? 0 : d); }
  function safeKey(k) { return k !== '__proto__' && k !== 'constructor' && k !== 'prototype'; }
  function todayISO() { const d = new Date(), p2 = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function uid(p) { return p + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  let toastT;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 6000 : 2800);
  }
  function withBusy(text, fn) {
    $('#busy-text').textContent = text; $('#busy').hidden = false;
    setTimeout(() => {
      try { fn(); } catch (e) { console.error(e); toast((e && e.message) || String(e), true); }
      finally { $('#busy').hidden = true; }
    }, 40);
  }
  function badge(text, cls) { return h('span', { class: 'pill pill-' + (cls || 'gray'), text }); }
  function addAll(host) { for (let i = 1; i < arguments.length; i++) append(host, arguments[i]); return host; }
  function note(text, cls) { return h('div', { class: 'note ' + (cls ? 'note-' + cls : ''), text }); }
  function card(title, ...kids) { return h('div', { class: 'card' }, title ? h('h3', { text: title }) : null, kids); }

  /* ------------ form field bound to an object property ------------ */
  function field(label, obj, key, o) {
    o = o || {};
    let inp;
    const cur = obj[key];
    if (o.options) {
      inp = h('select');
      o.options.forEach((op) => { const v = typeof op === 'object' ? op.v : op, t = typeof op === 'object' ? op.t : op; inp.appendChild(h('option', { value: v, text: t, selected: String(v) === String(cur) })); });
      inp.addEventListener('change', () => { obj[key] = o.num ? toNum(inp.value) : inp.value; changed(o); });
    } else if (o.type === 'checkbox') {
      inp = h('input', { type: 'checkbox', checked: !!cur });
      inp.addEventListener('change', () => { obj[key] = inp.checked; changed(o); });
      return h('label', { class: 'field check' }, inp, h('span', { text: label }));
    } else if (o.type === 'textarea') {
      inp = h('textarea', { rows: o.rows || 2 }); inp.value = cur === undefined ? '' : cur;
      inp.addEventListener('change', () => { obj[key] = inp.value; changed(o); });
    } else {
      inp = h('input', { type: o.type || 'text', value: cur === undefined || cur === null ? '' : cur });
      if (o.type === 'number') { inp.step = o.step || 'any'; if (o.min !== undefined) inp.min = o.min; }
      if (o.placeholder) inp.placeholder = o.placeholder;
      if (o.maxlength) inp.maxLength = o.maxlength;
      inp.addEventListener('change', () => {
        if (o.type === 'number') { const n = parseFloat(inp.value); if (!isFinite(n)) { inp.classList.add('invalid'); return; } inp.classList.remove('invalid'); obj[key] = n; } else obj[key] = inp.value;
        changed(o);
      });
    }
    return h('label', { class: 'field' }, h('span', { text: label + (o.unit ? ' [' + o.unit + ']' : '') }), inp);
  }
  function changed(o) { if (o && o.stale) markStale(); if (o && o.onChange) o.onChange(); save(); }

  /* ------------ editable table ------------ */
  function editTable(cfg) {
    const wrap = h('div');
    const tb = h('div', { class: 'toolbar' });
    const filt = h('input', { type: 'text', placeholder: 'กรอง...', 'aria-label': 'กรองตาราง' }); filt.style.width = '160px';
    const count = h('span', { class: 'muted small' });
    tb.appendChild(filt); tb.appendChild(count);
    if (cfg.onAdd) tb.appendChild(h('button', { class: 'btn', type: 'button', text: cfg.addLabel || '+ เพิ่มแถว', onclick: () => { cfg.onAdd(); build(); } }));
    if (cfg.extra) tb.appendChild(cfg.extra);
    const sc = h('div', { class: 'tscroll' });
    wrap.appendChild(tb); wrap.appendChild(sc);
    let sortKey = null, sortDir = 1, limit = cfg.maxRows || 300;
    function cellText(r, c) { const v = c.get ? c.get(r) : r[c.key]; return v === undefined || v === null ? '' : String(v); }
    function build() {
      clear(sc);
      const rows = cfg.rows();
      const q = filt.value.trim().toLowerCase();
      let idx = rows.map((r, i) => i);
      if (q) idx = idx.filter((i) => cfg.cols.some((c) => cellText(rows[i], c).toLowerCase().includes(q)));
      if (sortKey) {
        const c = cfg.cols.find((x) => x.key === sortKey);
        idx.sort((a, b) => { const va = cellText(rows[a], c), vb = cellText(rows[b], c); const na = parseFloat(va), nb = parseFloat(vb); return (isFinite(na) && isFinite(nb) ? na - nb : va.localeCompare(vb)) * sortDir; });
      }
      count.textContent = `${idx.length}/${rows.length} แถว`;
      const thead = h('tr', null, cfg.cols.map((c) => h('th', { class: 'sortable', title: 'คลิกเพื่อเรียงลำดับ', onclick: () => { sortDir = sortKey === c.key ? -sortDir : 1; sortKey = c.key; build(); }, text: c.label + (sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : '') })), cfg.onDelete ? h('th', { text: '' }) : null);
      const tbody = h('tbody');
      idx.slice(0, limit).forEach((i) => {
        const r = rows[i];
        const tr = h('tr', { class: (cfg.onSelect ? 'clickable ' : '') + (cfg.selected && cfg.selected(r) ? 'sel' : '') });
        if (cfg.onSelect) tr.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') cfg.onSelect(r); });
        cfg.cols.forEach((c) => {
          const td = h('td', { class: c.type === 'num' || c.type === 'ro-num' ? 'num' : (c.type === 'ro' ? 'ro' : '') });
          const val = c.get ? c.get(r) : r[c.key];
          if (c.type === 'ro' || c.type === 'ro-num') td.textContent = val === undefined || val === null ? '' : (c.type === 'ro-num' && typeof val === 'number' ? fmt(val, c.dec === undefined ? 3 : c.dec) : String(val));
          else if (c.type === 'bool') { const cb = h('input', { type: 'checkbox', checked: !!val }); cb.addEventListener('change', () => { c.set ? c.set(r, cb.checked) : (r[c.key] = cb.checked); cfg.onChange && cfg.onChange(r, c); }); td.appendChild(cb); }
          else if (c.type === 'select') {
            const opts = typeof c.options === 'function' ? c.options(r) : c.options;
            const s = h('select'); opts.forEach((o) => s.appendChild(h('option', { value: o, text: o, selected: String(o) === String(val) })));
            if (val !== undefined && !opts.includes(val)) s.insertBefore(h('option', { value: val, text: String(val), selected: true }), s.firstChild);
            s.addEventListener('change', () => { c.set ? c.set(r, s.value) : (r[c.key] = s.value); cfg.onChange && cfg.onChange(r, c); }); td.appendChild(s);
          } else {
            const inp = h('input', { type: c.type === 'num' ? 'number' : 'text', value: val === undefined || val === null ? '' : val });
            if (c.type === 'num') inp.step = c.step || 'any'; inp.style.width = c.w || (c.type === 'num' ? '78px' : '100px');
            inp.addEventListener('change', () => {
              let v = inp.value;
              if (c.type === 'num') { v = parseFloat(v); if (!isFinite(v)) { inp.classList.add('invalid'); return; } inp.classList.remove('invalid'); }
              c.set ? c.set(r, v) : (r[c.key] = v); cfg.onChange && cfg.onChange(r, c);
            });
            td.appendChild(inp);
          }
          tr.appendChild(td);
        });
        if (cfg.onDelete) tr.appendChild(h('td', null, h('button', { class: 'btn btn-sm btn-danger', type: 'button', title: 'ลบแถว', text: '✕', onclick: (e) => { e.stopPropagation(); cfg.onDelete(r); build(); } })));
        tbody.appendChild(tr);
      });
      sc.appendChild(h('table', { class: 't' }, h('thead', null, thead), tbody));
      if (idx.length > limit) sc.appendChild(h('div', { class: 'note' }, `แสดง ${limit} จาก ${idx.length} แถว - `, h('button', { class: 'btn btn-sm', type: 'button', text: 'แสดงเพิ่ม', onclick: () => { limit += 300; build(); } })));
    }
    filt.addEventListener('input', build);
    build();
    wrap.rebuild = build;
    return wrap;
  }

  /* read-only sortable table; cols: [{label, get, num, dec}] */
  function roTable(cols, rows, o) {
    o = o || {};
    let sk = null, sd = 1;
    const sc = h('div', { class: 'tscroll ' + (o.tall ? 'tall' : '') });
    const filt = o.filter ? h('input', { type: 'text', placeholder: 'กรอง...' }) : null;
    if (filt) filt.style.width = '150px';
    const host = h('div', null, filt ? h('div', { class: 'toolbar' }, filt) : null, sc);
    function build() {
      clear(sc);
      let rs = rows.slice();
      const q = filt ? filt.value.trim().toLowerCase() : '';
      if (q) rs = rs.filter((r) => cols.some((c) => String(c.get(r)).toLowerCase().includes(q)));
      const total = rs.length; let capped = false;
      if (sk !== null) { const c = cols[sk]; rs.sort((a, b) => { const x = c.get(a), y = c.get(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sd; }); }
      const tr0 = h('tr', null, cols.map((c, i) => h('th', { class: 'sortable', text: c.label + (sk === i ? (sd > 0 ? ' ▲' : ' ▼') : ''), onclick: () => { sd = sk === i ? -sd : 1; sk = i; build(); } })));
      const tb = h('tbody');
      if (o.limit && rs.length > o.limit) { rs = rs.slice(0, o.limit); capped = true; }
      rs.forEach((r) => {
        const tr = h('tr', { class: (o.onRow ? 'clickable ' : '') + (o.isSel && o.isSel(r) ? 'sel' : '') });
        if (o.onRow) tr.addEventListener('click', () => o.onRow(r));
        cols.forEach((c) => { const v = c.get(r); const td = h('td', { class: c.num ? 'num' : '' }); if (v instanceof Node) td.appendChild(v); else td.textContent = typeof v === 'number' ? fmt(v, c.dec) : (v === undefined || v === null ? '' : String(v)); tr.appendChild(td); });
        tb.appendChild(tr);
      });
      sc.appendChild(h('table', { class: 't' }, h('thead', null, tr0), tb));
      if (!rs.length) sc.appendChild(h('div', { class: 'note', text: 'ไม่มีข้อมูล' }));
      if (capped) sc.appendChild(h('div', { class: 'note', text: `แสดง ${o.limit} จาก ${total} แถว - ใช้ช่องกรองเพื่อค้นหาองค์อาคารอื่น` }));
    }
    if (filt) filt.addEventListener('input', build);
    build();
    return host;
  }

  /* =============================== Project state =============================== */
  function defaultProject() {
    return {
      version: 1,
      meta: { name: '', province: '', location: '', owner: '', use: '', storeys: 3, area: 0, height: 0, system: 'โครงต้านแรงดัดคอนกรีตเสริมเหล็ก', date: todayISO(), revision: '0', publicBuilding: false },
      method: { rc: 'SDM', steel: 'LRFD', comboSet: 'MR2566', allowIncrease: false, crackedBeam: 0.35, crackedColumn: 0.70, strengthBasis: 'cylinder', qc: true, gammaW: 1.6 },
      standardsUsed: null,
      verifications: {},
      model: { nodes: [], materials: {}, sections: {}, members: [], supports: [], options: { stations: 11 } },
      loads: { cases: defaultCases(), combos: [], combosEdited: false, comboNotes: [], assignments: [], walls: [], wind: null, seismic: null, windOut: null, seismicOut: null },
      design: { items: [], out: {} },
      engineer: { name: '', license: '', level: '', discipline: 'วิศวกรรมโยธา', signDate: '' },
      revisions: [],
      generator: { nbx: 3, nby: 2, spanX: '6', spanY: '5', heights: '4,3.5', colB: 40, colH: 40, bxB: 25, bxH: 50, byB: 25, byH: 50, fc: 240, support: 'fixed', rebarFy: 4000 }
    };
  }
  function defaultCases() {
    return [{ id: 'DL', name: 'น้ำหนักบรรทุกคงที่ (Dead)', type: 'D', selfWeight: true, nodal: [], member: [] },
      { id: 'SDL', name: 'น้ำหนักคงที่เพิ่มเติม (Superimposed)', type: 'SD', selfWeight: false, nodal: [], member: [] },
      { id: 'LL', name: 'น้ำหนักบรรทุกจร (Live)', type: 'L', selfWeight: false, nodal: [], member: [] }];
  }
  let P = defaultProject();
  const S = { results: null, analysis: null, selMember: null, tab: 'project', viewers: {}, vcont: {}, stale: false, drift: [], eqErr: undefined, analysisSel: '__env', diagKind: 'My', showDeformed: true };

  /* ---------- hashing (stale detection) ---------- */
  function hash53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function stateHash() {
    const M = P.model, me = P.method;
    return hash53(JSON.stringify([M.nodes, M.materials, M.sections, M.members, M.supports, M.springs || null, M.options, P.loads.cases, P.loads.combos,
      [me.rc, me.steel, me.comboSet, me.allowIncrease, me.crackedBeam, me.crackedColumn, me.strengthBasis, me.qc]]));
  }
  function geomHash() { const M = P.model; return hash53(JSON.stringify([M.nodes, M.members, M.sections, M.materials, M.supports])); }
  function itemHash(it) { const me = P.method; return hash53(JSON.stringify([it.type, it.group, it.node, it.inputs, me.rc, me.steel, me.comboSet, me.qc, me.allowIncrease, me.strengthBasis])); }
  function analysisStale() { return !S.results || !S.analysis || S.analysis.hash !== stateHash(); }
  const MANUAL_TYPES = ['rcSlab'];   // items whose inputs are fully manual: no dependence on the analysis
  function recordStale(it) { const o = P.design.out[it.id]; if (!o) return false; if (MANUAL_TYPES.includes(it.type)) return o.inputHash !== itemHash(it); return o.modelHash !== stateHash() || o.inputHash !== itemHash(it); }
  function staleList() {
    const l = [];
    if (!S.results) l.push('ยังไม่มีผลวิเคราะห์ในหน่วยความจำ (รันวิเคราะห์ใหม่)'); else if (analysisStale()) l.push('ผลวิเคราะห์ไม่ตรงกับโมเดล/น้ำหนักบรรทุกปัจจุบัน');
    P.design.items.forEach((it) => { if (recordStale(it)) l.push('ผลออกแบบ ' + it.label); });
    if (P.loads.windOut && P.loads.windOut.hash !== geomHash()) l.push('แรงลม (โมเดลเปลี่ยน)');
    if (P.loads.seismicOut && P.loads.seismicOut.hash !== geomHash()) l.push('แรงแผ่นดินไหว (โมเดลเปลี่ยน)');
    return l;
  }

  /* ---------- sanitise untrusted JSON into project shape ---------- */
  function sobj(o) { const r = {}; if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) if (safeKey(k)) r[k] = o[k]; return r; }
  function sarr(a) { return Array.isArray(a) ? a : []; }
  function sstr(v, n) { return v === undefined || v === null ? '' : String(v).slice(0, n || 300); }
  function snum(v, d) { return toNum(v, d); }
  function cleanJSON(v, d) {
    d = d || 0; if (d > 6) return null;
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string') return v.slice(0, 1000);
    if (Array.isArray(v)) return v.slice(0, 500).map((x) => cleanJSON(x, d + 1));
    if (typeof v === 'object') { const o = {}; Object.keys(v).slice(0, 100).forEach((k) => { if (safeKey(k)) o[k] = cleanJSON(v[k], d + 1); }); return o; }
    return null;
  }
  const strArr = (a, n) => sarr(a).slice(0, 200).map((x) => sstr(x, n || 500));
  function cleanSteps(a) { return sarr(a).slice(0, 300).map((s) => { s = sobj(s); return { label: sstr(s.label, 200), formula: sstr(s.formula, 500), substituted: sstr(s.substituted, 800), value: typeof s.value === 'number' ? snum(s.value) : sstr(s.value, 100), unit: sstr(s.unit, 30), clause: sstr(s.clause, 200) }; }); }
  function cleanPts(a) { return sarr(a).slice(0, 400).map((q) => { q = sobj(q); return { P: snum(q.P), M: snum(q.M) }; }); }
  function cleanDem(a) { return sarr(a).slice(0, 10).map((q) => { q = sobj(q); return { P: snum(q.P), M: snum(q.M), label: sstr(q.label, 20), ok: q.ok !== false }; }); }
  function cleanRun(r) {
    r = sobj(r);
    return {
      title: sstr(r.title, 200), ok: !!r.ok, ratio: snum(r.ratio),
      checks: sarr(r.checks).slice(0, 300).map((c) => { c = sobj(c); return { name: sstr(c.name, 200), demand: snum(c.demand), capacity: snum(c.capacity), ratio: snum(c.ratio), ok: !!c.ok, unit: sstr(c.unit, 30), clause: sstr(c.clause, 200) }; }),
      steps: cleanSteps(r.steps), warnings: strArr(r.warnings), hard: strArr(r.hard), notes: strArr(r.notes),
      inputs: r.inputs && typeof r.inputs === 'object' ? cleanJSON(r.inputs) : undefined, sized: r.sized && typeof r.sized === 'object' ? cleanJSON(r.sized) : undefined,
      pm: cleanPts(r.pm), pmDemands: cleanDem(r.pmDemands), pmY: cleanPts(r.pmY), pmYDemands: cleanDem(r.pmYDemands),
      slabApprox: !!r.slabApprox, governing: sstr(r.governing, 300)
    };
  }
  function cleanOut(o) {
    o = sobj(o);
    const forces = {}; const fo = sobj(o.forces); Object.keys(fo).forEach((k) => { forces[sstr(k, 60)] = snum(fo[k]); });
    const gc = {}; const go = sobj(o.govCombos); Object.keys(go).forEach((k) => { gc[sstr(k, 60)] = sstr(go[k], 100); });
    return { at: sstr(o.at, 40), typeLabel: sstr(o.typeLabel, 80), method: sstr(o.method, 10), set: sstr(o.set, 20), qc: o.qc !== false, allowIncrease: !!o.allowIncrease, allowUnverified: !!o.allowUnverified,
      forces, govCombos: gc, runs: sarr(o.runs).slice(0, 30).map(cleanRun), notes: strArr(o.notes), analysisId: sstr(o.analysisId, 40), analysisAt: sstr(o.analysisAt, 40), modelHash: sstr(o.modelHash, 30), inputHash: sstr(o.inputHash, 30) };
  }
  function cleanWindOut(w) {
    if (!w || typeof w !== 'object') return null; w = sobj(w);
    const dir = (d) => { if (!d || typeof d !== 'object') return null; d = sobj(d); const r = sobj(d.res); return { res: { p: snum(r.p), applicable: r.applicable !== false, warnings: strArr(r.warnings), steps: cleanSteps(r.steps) }, forces: sarr(d.forces).slice(0, 200).map((f) => { f = sobj(f); return { z: snum(f.z), F: snum(f.F) }; }) }; };
    return { method: w.method === '1311' ? '1311' : 'MR2566', X: dir(w.X), Y: dir(w.Y), hash: sstr(w.hash, 30) };
  }
  function cleanSeismicOut(o) {
    if (!o || typeof o !== 'object') return null; o = sobj(o); const r = sobj(o.res), p = sobj(o.params);
    return { params: { TL: snum(p.TL, 0) }, zone: sstr(o.zone, 60), hash: sstr(o.hash, 30),
      res: { SDS: snum(r.SDS), SD1: snum(r.SD1), Ta: snum(r.Ta), T: snum(r.T), Cs: snum(r.Cs), V: snum(r.V), k: snum(r.k), SDC: sstr(r.SDC, 5), warnings: strArr(r.warnings), steps: cleanSteps(r.steps) },
      forces: sarr(o.forces).slice(0, 200).map((f) => { f = sobj(f); return { z: snum(f.z), h: snum(f.h), F: snum(f.F) }; }) };
  }
  function cleanWind(w) {
    if (!w || typeof w !== 'object') return null; w = sobj(w);
    return { method: w.method === '1311' ? '1311' : 'MR2566', V50: snum(w.V50, 25), Iw: snum(w.Iw, 1), terrain: w.terrain === 'rough' ? 'rough' : 'open', Cg: snum(w.Cg, 2), Cp: snum(w.Cp, 1.3), area: w.area === 'open' ? 'open' : 'city', largePublic: !!w.largePublic };
  }
  function cleanSeismic(s) {
    if (!s || typeof s !== 'object') return null; s = sobj(s);
    const optN = (v) => (v === null || v === undefined || v === '' ? null : snum(v));
    const weights = {}; const wo = sobj(s.weights); Object.keys(wo).slice(0, 200).forEach((k) => { if (isFinite(parseFloat(k))) weights[k] = snum(wo[k]); });
    return { Ss: optN(s.Ss), S1: optN(s.S1), site: ['A', 'B', 'C', 'D', 'E', 'F'].includes(s.site) ? s.site : 'D', Ie: snum(s.Ie, 1), sysKey: sstr(s.sysKey || 'RC_SMF', 40), R: snum(s.R, 8), Cd: snum(s.Cd, 5.5), Omega0: snum(s.Omega0, 3), taType: sstr(s.taType || 'concreteMF', 20), TL: snum(s.TL, 4), llFrac: snum(s.llFrac, 0), weights, weightsStale: !!s.weightsStale };
  }
  function cleanInputs(o) { const r = {}; const x = sobj(o); Object.keys(x).slice(0, 60).forEach((k) => { const v = x[k]; if (typeof v === 'number' && isFinite(v)) r[k] = v; else if (typeof v === 'string') r[k] = v.slice(0, 200); else if (typeof v === 'boolean') r[k] = v; }); return r; }

  function normalizeModel(m) {
    m = sobj(m);
    const out = { nodes: [], materials: {}, sections: {}, members: [], supports: [], options: { stations: 11 } };
    sarr(m.nodes).forEach((n) => { n = sobj(n); if (n.id !== undefined) out.nodes.push({ id: sstr(n.id, 40), x: snum(n.x), y: snum(n.y), z: snum(n.z) }); });
    const has = (x) => x !== undefined && x !== null && x !== '' && isFinite(parseFloat(x));
    const mats = sobj(m.materials); Object.keys(mats).forEach((k) => { const v = sobj(mats[k]); const o = { nu: snum(v.nu, 0.2), density: snum(v.density, 2400) }; if (has(v.E)) o.E = snum(v.E); out.materials[k] = o; });
    const secs = sobj(m.sections); Object.keys(secs).forEach((k) => {
      const v = sobj(secs[k]); const s = { shape: sstr(v.shape || 'rect', 20) };
      ['A', 'Iy', 'Iz', 'J'].forEach((p) => { if (has(v[p])) s[p] = snum(v[p]); });          // absent stays absent (never 0)
      if (has(v.b)) s.b = snum(v.b); if (has(v.h)) s.h = snum(v.h); if (v.label) s.label = sstr(v.label, 60);
      const complete = () => ['A', 'Iy', 'Iz', 'J'].every((p) => s[p] > 0);
      if (!complete() && s.b > 0 && s.h > 0) { const rp = rectProps(s.b, s.h); ['A', 'Iy', 'Iz', 'J'].forEach((p) => { if (!(s[p] > 0)) s[p] = rp[p]; }); }
      if (!complete() && SD().sections && SD().sections.find && SD().sections.toSolver) {        // steel section from the library
        try { const row = SD().sections.find(v.label || k); const t = row && SD().sections.toSolver(row); if (t) { ['A', 'Iy', 'Iz', 'J'].forEach((p) => { if (!(s[p] > 0)) s[p] = t[p]; }); s.shape = s.shape === 'rect' ? 'steel' : s.shape; } } catch (e) { /* leave incomplete; analysis pre-check reports it */ }
      }
      out.sections[k] = s;
    });
    sarr(m.members).forEach((x) => {
      x = sobj(x); if (x.id === undefined) return;
      const o = { id: sstr(x.id, 40), i: sstr(x.i, 40), j: sstr(x.j, 40), section: sstr(x.section, 60), material: sstr(x.material, 60), roll: snum(x.roll), kind: ['beam', 'column', 'brace'].includes(x.kind) ? x.kind : 'beam', group: sstr(x.group, 60) };
      if (x.releases && typeof x.releases === 'object') { const rl = sobj(x.releases); const f = (e) => { e = sobj(e); return { my: !!e.my, mz: !!e.mz, t: !!e.t }; }; o.releases = { i: f(rl.i), j: f(rl.j) }; }
      if (x.modifiers && typeof x.modifiers === 'object') { const md = sobj(x.modifiers); if (isFinite(parseFloat(md.I))) o.modifiers = { I: parseFloat(md.I) }; }
      out.members.push(o);
    });
    sarr(m.supports).forEach((s) => { s = sobj(s); if (s.node === undefined) return; const o = { node: sstr(s.node, 40) }; ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'].forEach((k) => { o[k] = !!s[k]; }); out.supports.push(o); });
    if (Array.isArray(m.springs)) out.springs = m.springs.slice(0, 500).map((s) => cleanJSON(sobj(s)));
    out.options.stations = Math.max(3, Math.min(41, snum(sobj(m.options).stations, 11)));
    return out;
  }
  function normalizeCases(a) {
    return sarr(a).map((c) => {
      c = sobj(c);
      return {
        id: sstr(c.id, 30), name: sstr(c.name, 100), type: ['D', 'SD', 'L', 'Lr', 'W', 'E', 'H'].includes(c.type) ? c.type : 'D', selfWeight: !!c.selfWeight,
        nodal: sarr(c.nodal).map((n) => { n = sobj(n); return { node: sstr(n.node, 40), fx: snum(n.fx), fy: snum(n.fy), fz: snum(n.fz), mx: snum(n.mx), my: snum(n.my), mz: snum(n.mz), src: n.src ? sstr(n.src, 40) : undefined }; }),
        member: sarr(c.member).map((n) => { n = sobj(n); const o = { member: sstr(n.member, 40), kind: ['udl', 'point', 'trap'].includes(n.kind) ? n.kind : 'udl', dir: ['GZ', 'GX', 'GY', 'LX', 'LY', 'LZ'].includes(n.dir) ? n.dir : 'GZ' }; ['w', 'P', 'a', 'b', 'w1', 'w2'].forEach((k) => { if (n[k] !== undefined) o[k] = snum(n[k]); }); if (n.src) o.src = sstr(n.src, 40); return o; })
      };
    }).filter((c) => c.id);
  }
  function normalizeCombos(a) {
    return sarr(a).map((c) => {
      c = sobj(c); if (c.method !== 'WSD' && c.method !== 'SDM') return null;
      const f = {}; const fs = sobj(c.factors); Object.keys(fs).forEach((k) => { f[k] = snum(fs[k]); });
      const o = { id: sstr(c.id, 30), name: sstr(c.name, 100), method: c.method, set: sstr(c.set || 'MR2566', 20), factors: f };
      if (c.allowIncrease) o.allowIncrease = snum(c.allowIncrease, 1.33);
      if (c.clause) o.clause = sstr(c.clause, 100);
      return o;
    }).filter((c) => c && c.id);
  }
  function normalizeProject(raw, opts) {
    opts = opts || {};
    const imported = !!opts.imported;
    const d = defaultProject(); raw = sobj(raw);
    if (raw.nodes && !raw.model) { raw = { model: raw, loads: { cases: raw.loadCases, combos: raw.combinations } }; } // bare model file
    const meta = sobj(raw.meta), me = sobj(raw.method), en = sobj(raw.engineer), g = sobj(raw.generator);
    Object.keys(d.meta).forEach((k) => { if (meta[k] !== undefined) d.meta[k] = typeof d.meta[k] === 'number' ? snum(meta[k]) : typeof d.meta[k] === 'boolean' ? !!meta[k] : sstr(meta[k], 200); });
    Object.keys(d.method).forEach((k) => { if (me[k] !== undefined) d.method[k] = typeof d.method[k] === 'number' ? snum(me[k]) : typeof d.method[k] === 'boolean' ? !!me[k] : sstr(me[k], 30); });
    if (!SETS.includes(d.method.comboSet)) d.method.comboSet = 'MR2566';
    if (!['SDM', 'WSD'].includes(d.method.rc)) d.method.rc = 'SDM';
    if (!['LRFD', 'ASD'].includes(d.method.steel)) d.method.steel = 'LRFD';
    if (!['cylinder', 'cube'].includes(d.method.strengthBasis)) d.method.strengthBasis = 'cylinder';
    if (!imported) Object.keys(d.engineer).forEach((k) => { if (en[k] !== undefined) d.engineer[k] = sstr(en[k], 120); }); // identity never comes from an imported file
    Object.keys(d.generator).forEach((k) => { if (g[k] !== undefined) d.generator[k] = typeof d.generator[k] === 'number' ? snum(g[k]) : sstr(g[k], 100); });
    d.model = normalizeModel(raw.model);
    const lo = sobj(raw.loads);
    const cs = normalizeCases(lo.cases); if (cs.length) d.loads.cases = cs;
    d.loads.combos = normalizeCombos(lo.combos); d.loads.combosEdited = !!lo.combosEdited;
    d.loads.comboNotes = strArr(lo.comboNotes);
    d.loads.assignments = sarr(lo.assignments).map((a) => { a = sobj(a); return { id: sstr(a.id || uid('a'), 20), name: sstr(a.name, 100), members: sarr(a.members).map((x) => sstr(x, 40)), slabT: snum(a.slabT, 12), sdl: snum(a.sdl, 150), liveKey: sstr(a.liveKey, 80), liveValue: snum(a.liveValue, 250), liveOverride: !!a.liveOverride, liveRemark: sstr(a.liveRemark, 300), width: snum(a.width, 2.5), unverifiedLL: !!a.unverifiedLL }; });
    d.loads.walls = sarr(lo.walls).map((a) => { a = sobj(a); return { id: sstr(a.id || uid('w'), 20), name: sstr(a.name, 100), members: sarr(a.members).map((x) => sstr(x, 40)), unitWt: snum(a.unitWt, 180), height: snum(a.height, 3), reduction: snum(a.reduction, 0) }; });
    d.loads.wind = cleanWind(lo.wind);
    d.loads.seismic = cleanSeismic(lo.seismic);
    const ds = sobj(raw.design);
    d.design.items = sarr(ds.items).slice(0, 500).map((it) => { it = sobj(it); return { id: sstr(it.id || uid('d'), 24), type: sstr(it.type, 20), label: sstr(it.label, 100), group: sstr(it.group, 60), node: sstr(it.node, 40), inputs: cleanInputs(it.inputs) }; });
    if (imported) { d.design.out = {}; d.loads.windOut = null; d.loads.seismicOut = null; }   // results must be recomputed after import
    else {
      d.design.out = {}; const oo = sobj(ds.out); Object.keys(oo).slice(0, 500).forEach((k) => { d.design.out[k] = cleanOut(oo[k]); });
      d.loads.windOut = cleanWindOut(lo.windOut); d.loads.seismicOut = cleanSeismicOut(lo.seismicOut);
    }
    d.standardsUsed = Array.isArray(raw.standardsUsed) ? raw.standardsUsed.map((x) => sstr(x, 80)) : null;
    const vv = sobj(raw.verifications); Object.keys(vv).forEach((k) => { const v = sobj(vv[k]); d.verifications[sstr(k, 80)] = { by: sstr(v.by, 120), date: sstr(v.date, 12), notes: sstr(v.notes, 500) }; });
    d.revisions = sarr(raw.revisions).slice(0, 200).map((r) => { r = sobj(r); return { rev: sstr(r.rev, 10), date: sstr(r.date, 12), desc: sstr(r.desc, 300), by: sstr(r.by, 100) }; });
    return d;
  }

  /* ------------ persistence ------------ */
  let saveT;
  function flushSave() {
    clearTimeout(saveT);
    try { localStorage.setItem(LS_KEY, JSON.stringify(P)); const el = $('#save-status'); if (el) el.textContent = 'บันทึกอัตโนมัติ ' + new Date().toLocaleTimeString('th-TH'); }
    catch (e) { const el = $('#save-status'); if (el) el.textContent = 'บันทึกในเบราว์เซอร์ไม่ได้ - โปรดส่งออก JSON'; }
  }
  function save() { clearTimeout(saveT); saveT = setTimeout(flushSave, 300); }
  function loadSaved() {
    let s = null;
    try { s = localStorage.getItem(LS_KEY); if (s) P = normalizeProject(JSON.parse(s), { imported: false }); }
    catch (e) {
      console.warn('load failed', e);
      if (s) { try { localStorage.setItem(LS_KEY + '.backup.' + Date.now(), s); } catch (_) { /* quota */ } S.loadWarn = 'อ่านโครงการที่บันทึกไว้ไม่ได้ - สำรองข้อมูลเดิมไว้ใน localStorage (' + LS_KEY + '.backup.*) แล้วเริ่มโครงการใหม่'; }
      P = defaultProject();
    }
  }
  function refreshStale() { const st = !!S.results && analysisStale(); S.stale = st; const b = $('#stale-banner'); if (b) b.hidden = !st; return st; }
  function markStale() { refreshStale(); }
  function clearStale() { S.stale = false; const b = $('#stale-banner'); if (b) b.hidden = true; }

  function downloadJSON(obj, name) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importFile(file, modelOnly) {
    const fr = new FileReader();
    fr.onload = () => {
      try { applyImported(JSON.parse(fr.result), modelOnly); }
      catch (e) { toast('ไฟล์ JSON ไม่ถูกต้อง: ' + e.message, true); }
    };
    fr.readAsText(file);
  }
  function applyImported(raw, modelOnly) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !(raw.model || Array.isArray(raw.nodes) || raw.meta)) { toast('ไฟล์ไม่ใช่โครงการหรือโมเดลที่รู้จัก (ต้องมี model, nodes หรือ meta) - ไม่ได้นำเข้า', true); return; }
    if (raw.model && (typeof raw.model !== 'object' || Array.isArray(raw.model))) { toast('รูปแบบ model ในไฟล์ไม่ถูกต้อง - ไม่ได้นำเข้า', true); return; }
    const hasWork = P.model.nodes.length || P.design.items.length || P.loads.assignments.length;
    if (hasWork && !confirm('การนำเข้าจะเขียนทับข้อมูลโมเดล น้ำหนักบรรทุก และผลออกแบบปัจจุบัน ต้องการดำเนินการต่อหรือไม่?\n(แนะนำให้ส่งออก JSON สำรองก่อน)')) return;
    const isModel = raw && !raw.model && Array.isArray(raw.nodes);
    if (modelOnly || isModel) {
      const src = isModel ? raw : (raw.model || raw);
      const np = normalizeProject({ model: isModel ? raw : src, loads: { cases: src.loadCases, combos: src.combinations } }, { imported: true });
      P.model = np.model;
      P.loads.cases = np.loads.cases.length ? np.loads.cases : defaultCases();
      P.loads.combos = np.loads.combos; P.loads.combosEdited = np.loads.combos.length > 0;
      P.loads.assignments = []; P.loads.walls = []; P.loads.windOut = null; P.loads.seismicOut = null; P.loads.comboNotes = [];
      if (P.loads.seismic) P.loads.seismic.weights = {};
      P.design = { items: [], out: {} };
    } else P = normalizeProject(raw, { imported: true });
    ensureBothMethods();
    S.results = null; S.analysis = null; S.error = null; S.drift = []; S.selMember = null; clearStale(); save(); renderAll();
    toast('นำเข้าข้อมูลแล้ว - ผลวิเคราะห์/ออกแบบ/แรงลม/แผ่นดินไหวต้องคำนวณใหม่' + (modelOnly || isModel ? '' : ' และกรอกข้อมูลวิศวกรเอง'));
  }

  /* =============================== ADAPTERS (engine data) =============================== */
  function engineMissing() {
    const s = SD(); const miss = [];
    [['core', s.units || s.vec || s.v3 || s.version || s.core || s.SolverError], ['codes', s.codes], ['materials', s.materials], ['sections', s.sections], ['provinces', s.provinces], ['solver', s.solver], ['loads', s.loads], ['rc', s.rc], ['steel', s.steel]].forEach(([n, ok]) => { if (!ok) miss.push(n); });
    return miss;
  }
  function needEngine(parts) {
    const s = SD(); const miss = parts.filter((p) => !p.split('.').reduce((o, k) => (o ? o[k] : undefined), s));
    return miss;
  }
  function engineNotLoaded(parts) { return note('Engine ยังไม่พร้อม (' + parts.join(', ') + ' ไม่ถูกโหลด) - หน้านี้จะใช้งานได้เมื่อ engine/*.js โหลดครบ', 'warn'); }
  function registry() { const c = SD().codes; if (!c) return []; const r = typeof c.registry === 'function' ? c.registry() : c.registry; return Array.isArray(r) ? r : (r && typeof r === 'object' ? Object.keys(r).map((k) => Object.assign({ id: k }, r[k])) : []); }
  function provinces() {
    const p = SD().provinces; if (!p) return [];
    const arr = Array.isArray(p) ? p : Array.isArray(p.list) ? p.list : Array.isArray(p.rows) ? p.rows : Object.keys(p).map((k) => (typeof p[k] === 'object' ? Object.assign({ id: k }, p[k]) : null)).filter(Boolean);
    return arr.map((r) => ({ name: r.provinceTh || r.nameTh || r.name || r.province || r.id, row: r }));
  }
  function provinceRow(name) { const f = provinces().find((p) => p.name === name); return f ? f.row : null; }
  function liveLoads() {
    const m = SD().materials; if (!m || !m.liveLoads) return [];
    const L = m.liveLoads; const arr = Array.isArray(L) ? L : Object.keys(L).map((k) => (typeof L[k] === 'object' ? Object.assign({ key: k }, L[k]) : { key: k, value: L[k] }));
    return arr.map((r) => ({ key: r.key || r.id || r.nameTh, name: r.th || r.nameTh || r.name || r.label || r.key || r.id, value: toNum(r.q !== undefined ? r.q : (r.value !== undefined ? r.value : (r.w !== undefined ? r.w : r.load)), 0), verified: r.verified, source: r.source }));
  }
  function isStale(row) {
    const s = SD().codes && SD().codes.staleness;
    try {
      if (typeof s === 'function') { const r = s(row); if (typeof r === 'boolean') return { stale: r }; if (typeof r === 'number') return { stale: r > 180 || !isFinite(r), days: r }; if (r && typeof r === 'object') return { stale: !!(r.stale !== undefined ? r.stale : r.isStale), days: r.days !== undefined ? r.days : r.ageDays }; }
    } catch (e) { /* fall through */ }
    if (!row.lastVerifiedDate) return { stale: true };
    const days = (Date.now() - new Date(row.lastVerifiedDate).getTime()) / 864e5;
    return { stale: days > 180, days: Math.floor(days) };
  }
  function effectiveRegistry() {
    const used = P.standardsUsed;
    return registry().map((r) => {
      const v = P.verifications[r.id];
      const row = Object.assign({}, r);
      if (v && v.date) { row.lastVerifiedDate = v.date; row.verifiedBy = v.by; }
      const st = isStale(row);
      return Object.assign(row, { stale: st.stale, days: st.days, localNote: v ? v.notes : '', used: used === null ? true : used.includes(r.id) });
    });
  }

  /* =============================== Model builders =============================== */
  function rectProps(bm, hm) {
    const a = Math.min(bm, hm), c = Math.max(bm, hm);
    const J = (1 / 3 - 0.21 * (a / c) * (1 - Math.pow(a / c, 4) / 12)) * c * Math.pow(a, 3);
    return { A: bm * hm, Iy: bm * Math.pow(hm, 3) / 12, Iz: hm * Math.pow(bm, 3) / 12, J, shape: 'rect', b: bm, h: hm };
  }
  function ensureRect(bcm, hcm) {
    const key = `RC${fmt(bcm, 1)}x${fmt(hcm, 1)}`;
    if (!P.model.sections[key]) P.model.sections[key] = rectProps(bcm / 100, hcm / 100);
    return key;
  }
  function fcCyl(v) { return P.method.strengthBasis === 'cube' ? 0.8 * v : v; }
  function ensureConcrete(fcInput) {
    const fc = fcCyl(fcInput);
    const key = 'C' + fmt(fcInput, 0);
    if (!P.model.materials[key]) P.model.materials[key] = { E: 15100 * Math.sqrt(fc) * 1e4, nu: 0.2, density: 2400 };
    return key;
  }
  function ensureSteelMat() {
    if (!P.model.materials.SS400) P.model.materials.SS400 = { E: 2.04e10, nu: 0.3, density: 7850 };
    return 'SS400';
  }
  function parseList(str, n, def) {
    const a = String(str).split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => isFinite(x) && x > 0);
    if (!a.length) return Array(n).fill(def);
    if (a.length === 1) return Array(n).fill(a[0]);
    return a;
  }
  function generateGrid() {
    const g = P.generator;
    const xs = [0], ys = [0], zs = [0];
    parseList(g.spanX, g.nbx, 6).forEach((s) => xs.push(xs[xs.length - 1] + s));
    parseList(g.spanY, g.nby, 5).forEach((s) => ys.push(ys[ys.length - 1] + s));
    parseList(g.heights, 1, 3.5).forEach((s) => zs.push(zs[zs.length - 1] + s));
    if (P.model.nodes.length && !confirm('การสร้างกริดจะแทนที่โมเดลเดิม (โหนด/องค์อาคาร/จุดรองรับ) และล้างน้ำหนักบรรทุกบนองค์อาคาร ต้องการดำเนินการต่อหรือไม่?')) return;
    const mdl = { nodes: [], materials: {}, sections: {}, members: [], supports: [], options: P.model.options };
    P.model = mdl;
    const mat = ensureConcrete(g.fc);
    const sc = ensureRect(g.colB, g.colH), sbx = ensureRect(g.bxB, g.bxH), sby = ensureRect(g.byB, g.byH);
    const nid = (i, j, k) => `N${i + 1}_${j + 1}_${k}`;
    for (let k = 0; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) mdl.nodes.push({ id: nid(i, j, k), x: xs[i], y: ys[j], z: zs[k] });
    for (let k = 1; k < zs.length; k++) for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) mdl.members.push({ id: `C${i + 1}_${j + 1}_${k}`, i: nid(i, j, k - 1), j: nid(i, j, k), section: sc, material: mat, roll: 0, kind: 'column', group: 'C-L' + k });
    for (let k = 1; k < zs.length; k++) {
      for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length - 1; i++) mdl.members.push({ id: `BX${i + 1}_${j + 1}_${k}`, i: nid(i, j, k), j: nid(i + 1, j, k), section: sbx, material: mat, roll: 0, kind: 'beam', group: 'BX-L' + k });
      for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length - 1; j++) mdl.members.push({ id: `BY${i + 1}_${j + 1}_${k}`, i: nid(i, j, k), j: nid(i, j + 1, k), section: sby, material: mat, roll: 0, kind: 'beam', group: 'BY-L' + k });
    }
    for (let j = 0; j < ys.length; j++) for (let i = 0; i < xs.length; i++) mdl.supports.push({ node: nid(i, j, 0), ux: true, uy: true, uz: true, rx: g.support === 'fixed', ry: g.support === 'fixed', rz: g.support === 'fixed' });
    P.loads.cases.forEach((c) => { c.member = []; c.nodal = []; });
    P.loads.cases = P.loads.cases.filter((c) => !['W_X', 'W_Y', 'E_X', 'E_Y'].includes(c.id));
    P.loads.assignments = []; P.loads.walls = []; P.loads.windOut = null; P.loads.seismicOut = null;
    P.design.items = []; P.design.out = {}; if (P.loads.seismic) { P.loads.seismic.weights = {}; }
    P.meta.storeys = zs.length - 1; P.meta.height = zs[zs.length - 1];
    S.results = null; S.selMember = null; clearStale();
    onModelChanged(true); save(); renderTab('model'); toast(`สร้างโมเดล: ${mdl.nodes.length} โหนด, ${mdl.members.length} องค์อาคาร`);
  }

  /* model as the solver wants it (cracked modifiers applied, UI-only fields stripped) */
  function buildEngineModel() {
    const M = P.model, me = P.method;
    const members = M.members.map((x) => {
      const sec = M.sections[x.section];
      const o = { id: x.id, i: x.i, j: x.j, section: x.section, material: x.material, roll: x.roll || 0, kind: x.kind, group: x.group };
      if (x.releases) o.releases = clone(x.releases);
      if (x.modifiers && x.modifiers.I) o.modifiers = { I: x.modifiers.I };
      else if (sec && sec.shape === 'rect') { const f = x.kind === 'column' ? me.crackedColumn : x.kind === 'beam' ? me.crackedBeam : 1; if (f && f !== 1) o.modifiers = { I: f }; }
      return o;
    });
    const stripSrc = (arr) => arr.map((e) => { const c = Object.assign({}, e); delete c.src; return c; });
    return {
      nodes: clone(M.nodes), materials: clone(M.materials), sections: clone(M.sections), members, supports: clone(M.supports), springs: M.springs ? clone(M.springs) : undefined,
      loadCases: P.loads.cases.map((c) => ({ id: c.id, name: c.name, type: c.type, selfWeight: c.selfWeight, nodal: stripSrc(c.nodal), member: stripSrc(c.member) })),
      combinations: clone(P.loads.combos), options: { stations: M.options.stations || 11 }
    };
  }
  function memberLen(x) { return R_.memberLen(P.model, x); }
  function levels() { return [...new Set(P.model.nodes.map((n) => Math.round(n.z * 1000) / 1000))].sort((a, b) => a - b); }

  let mvT;
  function onModelChanged(immediate) {
    markStale();
    if (P.loads.seismic) P.loads.seismic.weightsStale = true;
    clearTimeout(mvT);
    const go = () => { if (S.viewers.model) { S.viewers.model.setModel(P.model); } };
    if (immediate) go(); else mvT = setTimeout(go, 200);
    save();
  }

  /* =============================== Viewer helpers =============================== */
  function getViewer(key, big) {
    if (!S.vcont[key]) S.vcont[key] = h('div', { class: 'viewer' + (big ? ' big' : '') });
    const cont = S.vcont[key];
    if (!window.SDViewer) {
      if (!cont.firstChild) cont.appendChild(h('div', { class: 'viewer-msg' }, 'ไม่สามารถโหลด three.js (ต้องออนไลน์เพื่อดึงจาก CDN และเปิดผ่าน static server เช่น python -m http.server แทน file://) - ตารางข้อมูลยังใช้งานได้'));
      return cont;
    }
    if (!S.viewers[key]) {
      clear(cont);
      try {
        S.viewers[key] = window.SDViewer.create(cont, { onSelect: (id) => selectMember(id, key) });
        S.viewers[key].setModel(P.model);
      } catch (e) { cont.appendChild(h('div', { class: 'viewer-msg' }, 'เปิด WebGL ไม่ได้: ' + e.message)); }
    }
    return cont;
  }
  function afterShowViewer(key) { setTimeout(() => { const v = S.viewers[key]; if (v) { v.resize(); } }, 50); }
  window.addEventListener('sdviewer-ready', () => { if (S.tab === 'model' || S.tab === 'analysis') renderTab(S.tab); });

  function selectMember(id, from) {
    S.selMember = id;
    ['model', 'analysis'].forEach((k) => { if (S.viewers[k]) S.viewers[k].highlight(id); });
    if (S.tab === 'analysis') renderMemberDetail();
    if (S.tab === 'model') renderModelSel();
  }

  /* =============================== Tabs infra =============================== */
  const RENDER = {};
  const TAB_IDS = ['project', 'model', 'loads', 'analysis', 'design', 'codes', 'report'];
  function renderTab(t) { const p = $('#tab-' + t); clear(p); try { RENDER[t](p); } catch (e) { console.error(e); p.appendChild(note('เกิดข้อผิดพลาดในการแสดงผลหน้านี้: ' + e.message, 'err')); } }
  function showTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    TAB_IDS.forEach((id) => { $('#tab-' + id).hidden = id !== t; });
    renderTab(t);
    if (t === 'model') afterShowViewer('model');
    if (t === 'analysis') afterShowViewer('analysis');
  }
  function renderAll() { updateEngineStatus(); renderTab(S.tab); if (S.viewers.model) S.viewers.model.setModel(P.model); }
  function updateEngineStatus() {
    const miss = engineMissing(); const el = $('#engine-status');
    el.textContent = miss.length ? 'engine: ยังไม่ครบ (' + miss.join(', ') + ')' : 'engine: พร้อม';
    el.className = 'pill ' + (miss.length ? 'pill-warn' : 'pill-ok');
  }

  /* =============================== Tab 1: Project =============================== */
  RENDER.project = function (p) {
    const m = P.meta, me = P.method;
    const provs = provinces();
    const provOpts = [{ v: '', t: '- เลือกจังหวัด -' }].concat(provs.length ? provs.map((x) => ({ v: x.name, t: x.name })) : (m.province ? [{ v: m.province, t: m.province }] : []));
    p.appendChild(h('h2', { text: 'ข้อมูลโครงการและเกณฑ์การออกแบบ' }));
    const provNote = h('div');
    function updProvNote() {
      clear(provNote);
      if (!m.province) return;
      const row = provinceRow(m.province);
      if (!row) { if (provs.length) provNote.appendChild(note('ไม่พบข้อมูลจังหวัดนี้ในตารางพารามิเตอร์', 'warn')); return; }
      const z = row.seismicZone2564;
      provNote.appendChild(note('เขตแผ่นดินไหว (กฎกระทรวง 2564): ' + (z === null || z === undefined || z === '' ? 'ไม่อยู่ในเขตควบคุม' : 'เขต ' + z) + (row.verified === false ? ' - ข้อมูลยังไม่ผ่านการตรวจสอบ (verified:false)' : ''), row.verified === false ? 'warn' : ''));
    }
    const info = card('ข้อมูลโครงการ', h('div', { class: 'grid-form' },
      field('ชื่อโครงการ', m, 'name', { maxlength: 200 }),
      field('จังหวัด', m, 'province', { options: provOpts, onChange: () => { updProvNote(); } }),
      field('สถานที่ตั้ง (ที่อยู่)', m, 'location', { maxlength: 300 }),
      field('เจ้าของโครงการ', m, 'owner', { maxlength: 200 }),
      field('การใช้อาคาร', m, 'use', { maxlength: 200 }),
      field('จำนวนชั้น', m, 'storeys', { type: 'number', step: 1, min: 1 }),
      field('พื้นที่ใช้สอยรวม', m, 'area', { type: 'number', unit: 'ตร.ม.' }),
      field('ความสูงอาคาร', m, 'height', { type: 'number', unit: 'ม.' }),
      field('ระบบโครงสร้าง', m, 'system', { maxlength: 200 }),
      field('Revision', m, 'revision', { maxlength: 10 }),
      field('วันที่', m, 'date', { type: 'date' }),
      field('เป็นอาคารสาธารณะ', m, 'publicBuilding', { type: 'checkbox' })), provNote);
    updProvNote();
    if (!provs.length) info.appendChild(engineNotLoaded(['provinces']));
    p.appendChild(info);

    const comboNote = h('div');
    const setOpts = SETS.map((s) => ({ v: s, t: SET_LABELS[s] }));
    p.appendChild(card('วิธีออกแบบและ load combination', h('div', { class: 'grid-form' },
      field('คอนกรีตเสริมเหล็ก', me, 'rc', { options: [{ v: 'SDM', t: 'SDM - Strength Design Method' }, { v: 'WSD', t: 'WSD - Working Stress Design' }], stale: true }),
      field('เหล็กรูปพรรณ', me, 'steel', { options: [{ v: 'LRFD', t: 'LRFD' }, { v: 'ASD', t: 'ASD' }], stale: true }),
      field('ชุด load combination', me, 'comboSet', { options: setOpts, stale: true, onChange: () => { if (!P.loads.combosEdited) { regenCombos(); toast('สร้าง combination ตามชุดที่เลือกใหม่แล้ว'); } else toast('combination ที่แก้ไขเองไม่ถูกเปลี่ยน - กด "สร้างอัตโนมัติ" ในแท็บน้ำหนักบรรทุก', false); } }),
      field("หน่วยกำลังอัดคอนกรีตที่ป้อน", me, 'strengthBasis', { options: [{ v: 'cylinder', t: "Cylinder (fc')" }, { v: 'cube', t: "Cube (fc' = 0.80 x cube)" }] }),
      field('Cracked modifier คาน (x Ig)', me, 'crackedBeam', { type: 'number', step: 0.05, stale: true }),
      field('Cracked modifier เสา (x Ig)', me, 'crackedColumn', { type: 'number', step: 0.05, stale: true }),
      field('มีการควบคุมคุณภาพ (QC)', me, 'qc', { type: 'checkbox', stale: true }),
      field('ใช้ allowable stress increase 1.33 (WSD, ลม/แผ่นดินไหว)', me, 'allowIncrease', { type: 'checkbox', stale: true, onChange: () => { if (!P.loads.combosEdited) regenCombos(); } })),
      note('กฎกระทรวง 2566 ไม่ได้ระบุ allowable increase 1.33 จึงปิดไว้เป็นค่าเริ่มต้น หากเปิดใช้จะพิมพ์ในรายงาน ชุด MR6_2527 ใช้ได้เฉพาะคำขอที่ยื่นก่อน 4 มี.ค. 2567', 'warn'), comboNote));

    // standards used
    const reg = effectiveRegistry();
    const std = card('มาตรฐานที่ใช้ในโครงการ (จาก SD.codes.registry)');
    if (!reg.length) std.appendChild(engineNotLoaded(['codes.registry']));
    else {
      std.appendChild(roTable([
        { label: 'ใช้', get: (r) => { const cb = h('input', { type: 'checkbox', checked: r.used }); cb.addEventListener('change', () => { if (P.standardsUsed === null) P.standardsUsed = reg.map((x) => x.id); const s = new Set(P.standardsUsed); cb.checked ? s.add(r.id) : s.delete(r.id); P.standardsUsed = [...s]; save(); }); return cb; } },
        { label: 'เอกสาร', get: (r) => r.titleTh || r.id }, { label: 'ฉบับ/ปี', get: (r) => (r.editionYear ? String(r.editionYear) : '') }, { label: 'สถานะ', get: (r) => statusBadge(r) }], reg, { filter: true }));
    }
    p.appendChild(std);

    p.appendChild(card('ประวัติการแก้ไข (Revision log)', editTable({
      cols: [{ key: 'rev', label: 'Rev.', w: '50px' }, { key: 'date', label: 'วันที่', w: '110px' }, { key: 'desc', label: 'รายละเอียด', w: '420px' }, { key: 'by', label: 'โดย', w: '160px' }],
      rows: () => P.revisions, onAdd: () => P.revisions.push({ rev: String(P.revisions.length), date: todayISO(), desc: '', by: '' }), onDelete: (r) => { P.revisions.splice(P.revisions.indexOf(r), 1); save(); }, onChange: save, addLabel: '+ เพิ่ม revision'
    })));
  };
  function statusBadge(r) {
    const wrap = h('span');
    const map = { current: ['ปัจจุบัน', 'ok'], superseded: ['ถูกแทนที่', 'ng'], draft: ['ร่าง', 'info'], unknown: ['ยังไม่ทราบสถานะ', 'warn'] };
    const m = map[r.status] || map.unknown;
    wrap.appendChild(badge(m[0], m[1]));
    if (r.stale) { wrap.appendChild(document.createTextNode(' ')); wrap.appendChild(badge('ยังไม่ได้ตรวจสอบเกิน 180 วัน', 'warn')); }
    return wrap;
  }

  /* =============================== Tab 2: Model =============================== */
  S.modelSub = 'members';
  function steelLib() {
    const s = SD().sections; if (!s) return [];
    if (typeof s.list === 'function') return s.list().filter((r) => r && (r.name || r.id));
    const arr = Array.isArray(s) ? s : Array.isArray(s.list) ? s.list : Array.isArray(s.library) ? s.library : Array.isArray(s.all) ? s.all : Object.keys(s).map((k) => (s[k] && typeof s[k] === 'object' ? Object.assign({ name: k }, s[k]) : null)).filter(Boolean);
    return arr.filter((r) => r && (r.name || r.id));
  }
  RENDER.model = function (p) {
    const g = P.generator;
    p.appendChild(h('h2', { text: 'แบบจำลองโครงสร้าง 3 มิติ' }));
    const row = h('div', { class: 'row' });
    const left = h('div', { class: 'col', style: 'flex:0 0 430px' });
    left.appendChild(card('ตัวสร้างโครงข้อแข็ง (grid generator)', h('div', { class: 'grid-form compact' },
      field('จำนวนช่วงแกน X (ถ้ารายการ span มีหลายค่า จะใช้ตามรายการ)', g, 'nbx', { type: 'number', step: 1, min: 1 }),
      field('จำนวนช่วงแกน Y', g, 'nby', { type: 'number', step: 1, min: 1 }),
      field('ช่วง span X (ม.) เช่น 6 หรือ 6,6,5.5', g, 'spanX'),
      field('ช่วง span Y (ม.)', g, 'spanY'),
      field('ความสูงชั้น (ม.) เช่น 4,3.5,3.5', g, 'heights'),
      field('เสา b x h (ซม.)', g, 'colB', { type: 'number' }), field('  h (ซม.) - ตามแกนโลคอล z', g, 'colH', { type: 'number' }),
      field('คานแกน X: b (ซม.)', g, 'bxB', { type: 'number' }), field('  h (ซม.)', g, 'bxH', { type: 'number' }),
      field('คานแกน Y: b (ซม.)', g, 'byB', { type: 'number' }), field('  h (ซม.)', g, 'byH', { type: 'number' }),
      field("คอนกรีต fc' (" + (P.method.strengthBasis === 'cube' ? 'cube' : 'cylinder') + ', ksc)', g, 'fc', { type: 'number' }),
      field('จุดรองรับที่ฐาน', g, 'support', { options: [{ v: 'fixed', t: 'ยึดแน่น (fixed)' }, { v: 'pinned', t: 'บานพับ (pinned)' }] })),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'สร้างโมเดล', onclick: generateGrid })),
      note('Ec = 15100 √fc\' (ksc). เสาตั้ง: local y = แกน Y, local z = -X ดังนั้น "h" ของเสาอยู่ตามแนวแกน X ของอาคาร', '')));
    left.appendChild(card('นำเข้า/ส่งออก', h('div', { class: 'toolbar' },
      h('button', { class: 'btn', type: 'button', text: 'โหลดตัวอย่างโครงข้อแข็ง 2 ชั้น', onclick: loadExample }),
      h('button', { class: 'btn', type: 'button', text: 'ส่งออกโมเดล JSON', onclick: () => downloadJSON(buildEngineModel(), 'model.json') }),
      h('button', { class: 'btn', type: 'button', text: 'นำเข้าโมเดล JSON', onclick: () => { const f = h('input', { type: 'file', accept: '.json' }); f.addEventListener('change', () => f.files[0] && importFile(f.files[0], true)); f.click(); } }))));
    row.appendChild(left);
    const right = h('div', { class: 'col', style: 'flex:2 1 600px' });
    const labN = h('input', { type: 'checkbox' }), labM = h('input', { type: 'checkbox' });
    const vc = getViewer('model');
    const upd = () => S.viewers.model && S.viewers.model.setLabels({ nodes: labN.checked, members: labM.checked });
    labN.addEventListener('change', upd); labM.addEventListener('change', upd);
    right.appendChild(h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, labN, ' แสดงชื่อโหนด'), h('label', { class: 'field' }, labM, ' แสดงชื่อองค์อาคาร'),
      h('button', { class: 'btn', type: 'button', text: 'จัดมุมมอง', onclick: () => S.viewers.model && S.viewers.model.fit() }),
      h('span', { class: 'muted small', text: 'ลากเพื่อหมุน, ล้อเมาส์ซูม, คลิกที่องค์อาคารเพื่อเลือก' })));
    right.appendChild(vc);
    right.appendChild(h('div', { id: 'model-sel', class: 'note' }));
    row.appendChild(right);
    p.appendChild(row);
    renderModelSel();

    const subs = [['members', 'องค์อาคาร'], ['nodes', 'โหนด'], ['supports', 'จุดรองรับ'], ['sections', 'หน้าตัด'], ['materials', 'วัสดุ']];
    const holder = h('div');
    const bar = h('div', { class: 'toolbar' }, subs.map(([k, t]) => h('button', { class: 'btn' + (S.modelSub === k ? ' btn-primary' : ''), type: 'button', text: t, onclick: () => { S.modelSub = k; renderTab('model'); } })));
    p.appendChild(card('ตารางข้อมูลโมเดล (แก้ไขได้ - หน่วย m)', bar, holder));
    holder.appendChild(modelTable(S.modelSub));
  };
  function renderModelSel() {
    const el = $('#model-sel'); if (!el) return; clear(el);
    const x = P.model.members.find((m) => m.id === S.selMember);
    el.textContent = x ? `เลือก: ${x.id} (${x.kind}) ${x.i} -> ${x.j}, หน้าตัด ${x.section}, ยาว ${fmt(memberLen(x), 3)} ม., กลุ่ม ${x.group}` : 'คลิกที่องค์อาคารใน 3D เพื่อดูรายละเอียด';
  }
  function modelTable(kind) {
    const M = P.model;
    const chg = () => onModelChanged(false);
    if (kind === 'nodes') return editTable({
      cols: [{ key: 'id', label: 'ID' }, { key: 'x', label: 'x (m)', type: 'num' }, { key: 'y', label: 'y (m)', type: 'num' }, { key: 'z', label: 'z (m)', type: 'num' }],
      rows: () => M.nodes, onChange: chg, onAdd: () => M.nodes.push({ id: 'N' + (M.nodes.length + 1) + '_' + uid(''), x: 0, y: 0, z: 0 }),
      onDelete: (r) => { M.nodes.splice(M.nodes.indexOf(r), 1); chg(); }
    });
    if (kind === 'members') return editTable({
      cols: [{ key: 'id', label: 'ID' }, { key: 'i', label: 'โหนด i', w: '80px' }, { key: 'j', label: 'โหนด j', w: '80px' },
        { key: 'section', label: 'หน้าตัด', type: 'select', options: () => Object.keys(M.sections) }, { key: 'material', label: 'วัสดุ', type: 'select', options: () => Object.keys(M.materials) },
        { key: 'kind', label: 'ชนิด', type: 'select', options: ['beam', 'column', 'brace'] }, { key: 'group', label: 'กลุ่มออกแบบ', w: '90px' }, { key: 'roll', label: 'roll (deg)', type: 'num', w: '60px' },
        { key: 'L', label: 'ยาว (m)', type: 'ro-num', dec: 3, get: (r) => memberLen(r) },
        { key: 'mod', label: 'Modifier I', type: 'num', w: '60px', get: (r) => (r.modifiers ? r.modifiers.I : ''), set: (r, v) => { r.modifiers = { I: v }; } },
        { key: 'ri', label: 'release i (my,mz,t)', w: '90px', get: (r) => relStr(r.releases, 'i'), set: (r, v) => setRel(r, 'i', v) }, { key: 'rj', label: 'release j', w: '90px', get: (r) => relStr(r.releases, 'j'), set: (r, v) => setRel(r, 'j', v) }],
      rows: () => M.members, onChange: chg, selected: (r) => r.id === S.selMember, onSelect: (r) => selectMember(r.id),
      onAdd: () => M.members.push({ id: 'M' + (M.members.length + 1), i: '', j: '', section: Object.keys(M.sections)[0] || '', material: Object.keys(M.materials)[0] || '', roll: 0, kind: 'beam', group: '' }),
      onDelete: (r) => { M.members.splice(M.members.indexOf(r), 1); chg(); }
    });
    if (kind === 'supports') {
      const f = (k) => ({ key: k, label: k, type: 'bool' });
      return editTable({
        cols: [{ key: 'node', label: 'โหนด' }, f('ux'), f('uy'), f('uz'), f('rx'), f('ry'), f('rz')], rows: () => M.supports, onChange: chg,
        onAdd: () => M.supports.push({ node: '', ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }), onDelete: (r) => { M.supports.splice(M.supports.indexOf(r), 1); chg(); }
      });
    }
    if (kind === 'sections') {
      const rowsFn = () => Object.keys(M.sections).map((k) => ({ k, s: M.sections[k] }));
      const lib = steelLib();
      const sel = h('select'); sel.appendChild(h('option', { value: '', text: lib.length ? '+ เพิ่มหน้าตัดเหล็กจาก library...' : 'ไม่มี library เหล็ก' }));
      lib.slice(0, 600).forEach((r) => sel.appendChild(h('option', { value: r.name || r.id, text: r.name || r.id })));
      const wrap = h('div');
      let tbl;
      sel.addEventListener('change', () => { if (!sel.value) return; addSteelSection(sel.value); tbl.rebuild(); sel.value = ''; chg(); });
      const rb = h('input', { type: 'text', placeholder: 'b x h (ซม.) เช่น 30x60' }); rb.style.width = '150px';
      const addRect = h('button', { class: 'btn', type: 'button', text: '+ หน้าตัดสี่เหลี่ยม', onclick: () => { const mm = rb.value.match(/^\s*([\d.]+)\s*[xX*]\s*([\d.]+)\s*$/); if (!mm) { toast('รูปแบบ b x h ไม่ถูกต้อง', true); return; } ensureRect(+mm[1], +mm[2]); tbl.rebuild(); chg(); } });
      tbl = editTable({
        cols: [{ key: 'k', label: 'ชื่อ', type: 'ro' }, { key: 'shape', label: 'รูปทรง', type: 'ro', get: (r) => r.s.shape },
          { key: 'b', label: 'b (cm)', type: 'num', get: (r) => (r.s.b !== undefined ? +(r.s.b * 100).toFixed(2) : ''), set: (r, v) => { rectSet(r.s, v / 100, r.s.h); } },
          { key: 'h', label: 'h (cm)', type: 'num', get: (r) => (r.s.h !== undefined ? +(r.s.h * 100).toFixed(2) : ''), set: (r, v) => { rectSet(r.s, r.s.b, v / 100); } },
          { key: 'A', label: 'A (cm²)', type: 'num', get: (r) => (r.s.A > 0 ? +(r.s.A * 1e4).toPrecision(5) : ''), set: (r, v) => { r.s.A = v / 1e4; } },
          { key: 'Iy', label: 'Iy (cm⁴)', type: 'num', get: (r) => (r.s.Iy > 0 ? +(r.s.Iy * 1e8).toPrecision(6) : ''), set: (r, v) => { r.s.Iy = v / 1e8; } },
          { key: 'Iz', label: 'Iz (cm⁴)', type: 'num', get: (r) => (r.s.Iz > 0 ? +(r.s.Iz * 1e8).toPrecision(6) : ''), set: (r, v) => { r.s.Iz = v / 1e8; } },
          { key: 'J', label: 'J (cm⁴)', type: 'num', get: (r) => (r.s.J > 0 ? +(r.s.J * 1e8).toPrecision(6) : ''), set: (r, v) => { r.s.J = v / 1e8; } }],
        rows: rowsFn, onChange: (r) => { chg(); }, onDelete: (r) => { if (M.members.some((x) => x.section === r.k)) { toast('หน้าตัดนี้ถูกใช้โดยองค์อาคาร', true); return; } delete M.sections[r.k]; chg(); }, extra: h('span', null, rb, ' ', addRect, ' ', sel)
      });
      wrap.appendChild(tbl); wrap.appendChild(note('Iy = โมเมนต์อินเนอร์เชียรอบแกนโลคอล y (ความลึกอยู่ตามแกน z) - คำนวณใหม่อัตโนมัติเมื่อแก้ b/h ของหน้าตัดสี่เหลี่ยม'));
      return wrap;
    }
    // materials
    const mrows = () => Object.keys(M.materials).map((k) => ({ k, m: M.materials[k] }));
    const mt = editTable({
      cols: [{ key: 'k', label: 'ชื่อ', type: 'ro' }, { key: 'E', label: 'E (ksc)', type: 'num', get: (r) => (r.m.E > 0 ? Math.round(r.m.E / 1e4) : ''), set: (r, v) => { r.m.E = v * 1e4; } },
        { key: 'nu', label: 'ν', type: 'num', get: (r) => r.m.nu, set: (r, v) => { r.m.nu = v; } }, { key: 'd', label: 'density (kg/m³)', type: 'num', get: (r) => r.m.density, set: (r, v) => { r.m.density = v; } }],
      rows: mrows, onChange: chg, onDelete: (r) => { if (M.members.some((x) => x.material === r.k)) { toast('วัสดุนี้ถูกใช้งานอยู่', true); return; } delete M.materials[r.k]; chg(); },
      extra: h('span', null, h('button', { class: 'btn', type: 'button', text: '+ เหล็ก SS400', onclick: () => { ensureSteelMat(); mt.rebuild(); chg(); } }),
        ' ', h('button', { class: 'btn', type: 'button', text: "+ คอนกรีตตาม fc' ในตัวสร้างกริด", onclick: () => { ensureConcrete(P.generator.fc); mt.rebuild(); chg(); } }))
    });
    return mt;
  }
  function rectSet(s, b, hh) { if (!(b > 0 && hh > 0)) return; Object.assign(s, rectProps(b, hh)); }
  function addSteelSection(name) {
    const r = steelLib().find((x) => (x.name || x.id) === name); if (!r) return;
    if (typeof SD().sections.toSolver === 'function') { const t = SD().sections.toSolver(r); P.model.sections[name] = { A: t.A, Iy: t.Iy, Iz: t.Iz, J: t.J, shape: 'steel', label: name }; ensureSteelMat(); return; }
    const A = toNum(r.A !== undefined ? r.A : r.area), Ix = toNum(r.Ix), Iy = toNum(r.Iy), J = toNum(r.J);
    P.model.sections[name] = { A: A * 1e-4, Iy: Ix * 1e-8, Iz: Iy * 1e-8, J: J * 1e-8, shape: 'steel', label: name };
    ensureSteelMat();
  }
  function relStr(rl, side) { if (!rl || !rl[side]) return ''; return ['my', 'mz', 't'].filter((k) => rl[side][k]).join(','); }
  function setRel(x, side, v) {
    x.releases = x.releases || { i: { my: false, mz: false, t: false }, j: { my: false, mz: false, t: false } };
    const parts = String(v).toLowerCase().split(/[,\s]+/);
    x.releases[side] = { my: parts.includes('my'), mz: parts.includes('mz'), t: parts.includes('t') };
  }
  function loadExample() {
    fetch('examples/frame-3d-2storey.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => applyImported(j, false)).catch((e) => toast('โหลดตัวอย่างไม่ได้ (' + e.message + ') - ต้องเปิดผ่าน static server เช่น python -m http.server หรือใช้ปุ่มนำเข้า JSON', true));
  }

  /* =============================== Tab 6: Codes =============================== */
  RENDER.codes = function (p) {
    p.appendChild(h('h2', { text: 'มาตรฐานและกฎหมายที่เกี่ยวข้อง' }));
    p.appendChild(h('div', { class: 'banner-note', text: 'โปรแกรมนี้ไม่ได้รับรองความถูกต้องของข้อมูลมาตรฐาน - ผู้ใช้ต้องยืนยันฉบับ สถานะ และเนื้อหากับแหล่งทางการ (ราชกิจจานุเบกษา, กรมโยธาธิการและผังเมือง, วสท., สภาวิศวกร) ก่อนนำไปใช้ยื่นขออนุญาตทุกครั้ง การ "บันทึกการตรวจสอบ" เป็นเพียงบันทึกของผู้ใช้ในโครงการนี้' }));
    const reg = effectiveRegistry();
    if (!reg.length) { p.appendChild(engineNotLoaded(['codes.registry'])); return; }
    p.appendChild(roTable([
      { label: 'เอกสาร', get: (r) => r.titleTh || r.id }, { label: 'ภาษาอังกฤษ', get: (r) => r.titleEn || '' }, { label: 'หน่วยงาน', get: (r) => r.issuer || '' },
      { label: 'ประเภท', get: (r) => r.type || '' }, { label: 'ฉบับ/ปี', get: (r) => (r.editionYear ? String(r.editionYear) : '') }, { label: 'มีผลบังคับใช้', get: (r) => (r.effectiveDate ? R_.fdate(r.effectiveDate) : '') }, { label: 'แทนที่เอกสาร', get: (r) => r.supersedes || '' }, { label: 'สถานะ', get: (r) => statusBadge(r) },
      { label: 'ใช้กับโมดูล', get: (r) => (Array.isArray(r.appliesToModules) ? r.appliesToModules.join(', ') : (r.appliesToModules || '')) },
      { label: 'ลิงก์ทางการ', get: (r) => h('span', null, officialLink(r.officialUrl), (r.altUrls || []).map((u, i) => h('span', null, ' ', officialLink(u, 'ลิงก์สำรอง ' + (i + 1))))) },
      { label: 'ตรวจสอบล่าสุด', get: (r) => (r.lastVerifiedDate ? R_.fdate(r.lastVerifiedDate) + (P.verifications[r.id] ? ' (ผู้ใช้)' : '') : 'ยังไม่ได้ตรวจสอบ') },
      { label: 'ผู้ตรวจสอบ', get: (r) => r.verifiedBy || '' }, { label: 'หมายเหตุ', get: (r) => [r.notes, r.localNote].filter(Boolean).join(' | ') },
      { label: '', get: (r) => h('button', { class: 'btn btn-sm', type: 'button', text: 'บันทึกการตรวจสอบ', onclick: () => openVerify(r) }) }], reg, { filter: true, tall: true }));
  };
  function officialLink(u, label) {
    if (!u || !/^https?:\/\//i.test(String(u))) return u ? String(u) : '-';
    return h('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: label || 'เปิดเว็บทางการ' });
  }
  function openVerify(r) {
    const dlg = $('#dlg-verify'), f = $('#form-verify');
    $('#dlg-verify-title').textContent = (r.titleTh || r.id) + (r.editionYear ? ' (' + r.editionYear + ')' : '');
    const v = P.verifications[r.id] || {};
    f.by.value = v.by || ''; f.date.value = v.date || todayISO(); f.notes.value = v.notes || '';
    f.onsubmit = () => { P.verifications[r.id] = { by: f.by.value.slice(0, 120), date: f.date.value, notes: f.notes.value.slice(0, 500) }; save(); setTimeout(() => renderTab('codes'), 0); };
    $('#dlg-verify-cancel').onclick = () => dlg.close();
    dlg.showModal();
  }

  /* =============================== Tab 3: Loads =============================== */
  const SEISMIC_FALLBACK = { RC_SMF: { R: 8, Omega0: 3, Cd: 5.5, period: 'concreteMF' }, RC_IMF: { R: 5, Omega0: 3, Cd: 4.5, period: 'concreteMF' }, RC_OMF: { R: 3, Omega0: 3, Cd: 2.5, period: 'concreteMF' }, STEEL_SMF: { R: 8, Omega0: 3, Cd: 5.5, period: 'steelMF' } };
  function seismicSystems() { const x = SD().loads && SD().loads.seismic && SD().loads.seismic.SYSTEMS; return x || SEISMIC_FALLBACK; }
  function ensureCase(id, name, type) {
    let c = P.loads.cases.find((x) => x.id === id);
    if (!c) { c = { id, name, type, selfWeight: false, nodal: [], member: [] }; P.loads.cases.push(c); }
    return c;
  }
  function caseOfType(type, id, name) { return P.loads.cases.find((c) => c.type === type) || ensureCase(id, name, type); }

  function addCombosFor(meth) {
    const L = SD().loads; if (!L || !L.combos) return;
    const opts = { types: [...new Set(P.loads.cases.map((c) => c.type))], cases: P.loads.cases.map((c) => { const m = /_([XY])$/.exec(c.id); return m ? { id: c.id, type: c.type, dir: m[1] } : { id: c.id, type: c.type }; }), allowIncrease: !!P.method.allowIncrease };
    const seen = new Set(P.loads.combos.map((c) => c.id));
    try {
      const arr = L.combos(P.method.comboSet, meth, opts) || [];
      (arr.notes || []).forEach((n) => { if (!P.loads.comboNotes.includes(n)) P.loads.comboNotes.push(String(n).slice(0, 500)); });
      arr.forEach((c) => {
        let id = c.id || 'U' + (P.loads.combos.length + 1); while (seen.has(id)) id += '_' + meth; seen.add(id);
        P.loads.combos.push({ id, name: c.name || id, method: meth, set: c.set || P.method.comboSet, factors: Object.assign({}, c.factors), allowIncrease: c.allowIncrease, clause: c.clause });
      });
    } catch (e) { toast('สร้าง combination ไม่ได้: ' + e.message, true); }
  }
  function regenCombos() {
    P.loads.combos = []; P.loads.comboNotes = [];
    if (!SD().loads || !SD().loads.combos) return;
    addCombosFor('SDM'); addCombosFor('WSD');
    P.loads.combosEdited = false; markStale(); save();
  }
  /** both SDM and WSD combinations are needed (footing bearing uses WSD service loads) */
  function ensureBothMethods() {
    if (!SD().loads || !SD().loads.combos) return;
    ['SDM', 'WSD'].forEach((m) => { if (!P.loads.combos.some((c) => c.method === m)) addCombosFor(m); });
  }
  function rebuildAutoLoads() {
    P.loads.cases.forEach((c) => { c.member = c.member.filter((e) => !(e.src && (e.src.startsWith('asg:') || e.src.startsWith('wall:')))); });
    const add = (c, mem, w, src) => c.member.push({ member: mem, kind: 'udl', dir: 'GZ', w: -Math.abs(w), src });
    const dl = caseOfType('D', 'DL', 'Dead'), sdl = caseOfType('SD', 'SDL', 'Superimposed'), ll = caseOfType('L', 'LL', 'Live');
    dl.selfWeight = true;
    P.loads.assignments.forEach((a) => a.members.forEach((m) => {
      if (a.slabT > 0) add(dl, m, a.slabT / 100 * 2400 * a.width, 'asg:' + a.id);
      if (a.sdl > 0) add(sdl, m, a.sdl * a.width, 'asg:' + a.id);
      if (a.liveValue > 0) add(ll, m, a.liveValue * a.width, 'asg:' + a.id);
    }));
    P.loads.walls.forEach((a) => a.members.forEach((m) => add(sdl, m, a.unitWt * a.height * (1 - (a.reduction || 0)), 'wall:' + a.id)));
    markStale(); save();
  }
  function parseFactors(s) { const f = {}; String(s).split(/[,;]+/).forEach((t) => { const m = t.split(':'); if (m.length === 2 && m[0].trim() && isFinite(parseFloat(m[1])) && safeKey(m[0].trim())) f[m[0].trim()] = parseFloat(m[1]); }); return f; }

  function stepsView(steps) {
    if (!steps || !steps.length) return null;
    return h('div', { class: 'steps' }, steps.map((s) => h('div', { class: 'step' },
      h('div', { class: 'lbl', text: s.label || '' }),
      s.formula ? h('div', { class: 'fm', text: 'สูตร: ' + s.formula }) : null,
      s.substituted ? h('div', { class: 'sub', text: 'แทนค่า: ' + s.substituted }) : null,
      (s.value !== undefined && s.value !== null && s.value !== '') ? h('div', { class: 'res', text: 'ผลลัพธ์: ' + (typeof s.value === 'number' ? fmt(s.value, 4) : s.value) + ' ' + (s.unit || '') }) : null,
      s.clause ? h('div', { class: 'cl', text: 'อ้างอิง: ' + s.clause }) : null)));
  }
  function levelNodes(z) { return P.model.nodes.filter((n) => Math.abs(n.z - z) < 1e-3); }
  function extents() {
    const ns = P.model.nodes; if (!ns.length) return { X: 0, Y: 0, H: 0 };
    const r = (k) => Math.max(...ns.map((n) => n[k])) - Math.min(...ns.map((n) => n[k]));
    return { X: r('x'), Y: r('y'), H: Math.max(...ns.map((n) => n.z)) - Math.min(...ns.map((n) => n.z)) };
  }
  function applyLateral(prefix, type, dirKeys, forcesFn, src) {
    // dirKeys: {X:'W_X', Y:'W_Y'}; forcesFn(dir) -> [{z, F}]
    ['X', 'Y'].forEach((ax) => {
      const c = ensureCase(prefix + '_' + ax, (type === 'W' ? 'Wind ' : 'Earthquake ') + ax, type);
      c.type = type; c.selfWeight = false;
      c.nodal = c.nodal.filter((e) => e.src !== src);
      forcesFn(ax).forEach((f) => {
        const ns = levelNodes(f.z); if (!ns.length || !isFinite(f.F)) return;
        ns.forEach((n) => c.nodal.push({ node: n.id, fx: ax === 'X' ? f.F / ns.length : 0, fy: ax === 'Y' ? f.F / ns.length : 0, fz: 0, mx: 0, my: 0, mz: 0, src }));
      });
    });
    if (!P.loads.combosEdited) regenCombos();
    markStale(); save();
  }

  RENDER.loads = function (p) {
    p.appendChild(h('h2', { text: 'น้ำหนักบรรทุกและ load combination' }));
    // ---- cases
    const caseSel = { id: P.loads.cases[0] ? P.loads.cases[0].id : '' };
    const memHolder = h('div');
    const casesTbl = editTable({
      cols: [{ key: 'id', label: 'ID', w: '70px' }, { key: 'name', label: 'ชื่อ', w: '260px' }, { key: 'type', label: 'ประเภท', type: 'select', options: ['D', 'SD', 'L', 'Lr', 'W', 'E', 'H'] }, { key: 'selfWeight', label: 'น้ำหนักตัวเอง', type: 'bool' },
        { key: 'n1', label: 'โหลดจุด', type: 'ro-num', dec: 0, get: (r) => r.nodal.length }, { key: 'n2', label: 'โหลดบนองค์อาคาร', type: 'ro-num', dec: 0, get: (r) => r.member.length }],
      rows: () => P.loads.cases, selected: (r) => r.id === caseSel.id, onSelect: (r) => { caseSel.id = r.id; casesTbl.rebuild(); drawCaseLoads(); },
      onChange: () => { markStale(); save(); }, onAdd: () => P.loads.cases.push({ id: 'C' + (P.loads.cases.length + 1), name: 'New case', type: 'D', selfWeight: false, nodal: [], member: [] }),
      onDelete: (r) => { P.loads.cases.splice(P.loads.cases.indexOf(r), 1); markStale(); save(); }, addLabel: '+ เพิ่ม load case'
    });
    function drawCaseLoads() {
      clear(memHolder);
      const c = P.loads.cases.find((x) => x.id === caseSel.id); if (!c) return;
      memHolder.appendChild(h('h4', { text: 'รายการโหลดของ case: ' + c.id + ' (kg, kg/m, kg-m; ทิศ GZ ลบ = ลงล่าง)' }));
      const valKey = (r) => (r.kind === 'point' ? 'P' : r.kind === 'trap' ? 'w1' : 'w');
      memHolder.appendChild(editTable({
        cols: [{ key: 'member', label: 'องค์อาคาร', w: '90px' }, { key: 'kind', label: 'ชนิด', type: 'select', options: ['udl', 'point', 'trap'] }, { key: 'dir', label: 'ทิศ', type: 'select', options: ['GZ', 'GX', 'GY', 'LX', 'LY', 'LZ'] },
          { key: 'v', label: 'w / P / w1', type: 'num', get: (r) => r[valKey(r)] || 0, set: (r, v) => { r[valKey(r)] = v; } }, { key: 'a', label: 'a (m)', type: 'num', get: (r) => r.a || 0, set: (r, v) => { r.a = v; } },
          { key: 'w2', label: 'w2', type: 'num', get: (r) => r.w2 || 0, set: (r, v) => { r.w2 = v; } }, { key: 'b', label: 'b (m)', type: 'num', get: (r) => r.b || 0, set: (r, v) => { r.b = v; } }, { key: 'src', label: 'ที่มา', type: 'ro' }],
        rows: () => c.member, onChange: () => { markStale(); save(); }, onAdd: () => c.member.push({ member: '', kind: 'udl', dir: 'GZ', w: 0 }), onDelete: (r) => { c.member.splice(c.member.indexOf(r), 1); markStale(); save(); }, addLabel: '+ โหลดบนองค์อาคาร'
      }));
      memHolder.appendChild(h('h4', { text: 'โหลดที่โหนด (kg, kg-m)' }));
      memHolder.appendChild(editTable({
        cols: [{ key: 'node', label: 'โหนด', w: '90px' }].concat(['fx', 'fy', 'fz', 'mx', 'my', 'mz'].map((k) => ({ key: k, label: k, type: 'num' }))).concat([{ key: 'src', label: 'ที่มา', type: 'ro' }]),
        rows: () => c.nodal, onChange: () => { markStale(); save(); }, onAdd: () => c.nodal.push({ node: '', fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }), onDelete: (r) => { c.nodal.splice(c.nodal.indexOf(r), 1); markStale(); save(); }, addLabel: '+ โหลดที่โหนด'
      }));
    }
    p.appendChild(card('1. Load cases (D = รวมน้ำหนักตัวเอง; SD = superimposed dead)', casesTbl, memHolder));
    drawCaseLoads();

    // ---- slab -> beam
    p.appendChild(slabCard());
    p.appendChild(wallCard());
    p.appendChild(windCard());
    p.appendChild(seismicCard());
    p.appendChild(comboCard());
  };

  function slabCard() {
    const ll = liveLoads();
    const groups = [...new Set(P.model.members.filter((m) => m.kind === 'beam').map((m) => m.group).filter(Boolean))];
    const f = { group: groups[0] || '', name: '', width: 2.5 };
    const tblHost = h('div');
    const unv = ll.filter((x) => x.verified === false).length;
    function draw() {
      clear(tblHost);
      const liveKeys = ll.map((x) => x.key);
      const t = editTable({
        cols: [{ key: 'name', label: 'รายการ', w: '160px' }, { key: 'mc', label: 'จำนวนคาน', type: 'ro-num', dec: 0, get: (r) => r.members.length },
          { key: 'members', label: 'คาน (คั่นด้วย ,)', w: '200px', get: (r) => r.members.join(','), set: (r, v) => { r.members = v.split(/[,\s]+/).filter(Boolean); } },
          { key: 'slabT', label: 'หนาพื้น (cm)', type: 'num' }, { key: 'sdl', label: 'SDL (kg/m²)', type: 'num' },
          { key: 'liveKey', label: 'ประเภทการใช้งาน (LL)', type: 'select', options: () => (liveKeys.length ? liveKeys : ['(ไม่มีตาราง)']), set: (r, v) => { r.liveKey = v; const e = ll.find((x) => x.key === v); if (e) { r.liveValue = e.value; r.liveOverride = false; r.unverifiedLL = e.verified === false; } draw(); } },
          { key: 'liveValue', label: 'LL (kg/m²)', type: 'num', set: (r, v) => { const e = ll.find((x) => x.key === r.liveKey); r.liveValue = v; r.liveOverride = !e || e.value !== v; if (r.liveOverride) draw(); } },
          { key: 'liveRemark', label: 'หมายเหตุ/ที่มาของ LL (จำเป็นเมื่อกำหนดเอง)', w: '220px' }, { key: 'width', label: 'Tributary (m)', type: 'num' },
          { key: 'ov', label: 'LL', type: 'ro', get: (r) => (r.liveOverride ? (r.liveRemark ? 'กำหนดเอง' : 'ขาดหมายเหตุ!') : 'ตามตาราง') }],
        rows: () => P.loads.assignments, onChange: () => save(), onDelete: (r) => { P.loads.assignments.splice(P.loads.assignments.indexOf(r), 1); save(); }
      });
      tblHost.appendChild(t);
    }
    draw();
    const body = card('2. พื้น -> น้ำหนักบนคาน (slab load to beam UDL)',
      note('w(DL) = หนาพื้น x 2400 x tributary; w(SDL) = SDL x tributary; w(LL) = LL x tributary (ทิศ GZ ลบ) - ใส่ใน load case ประเภท D / SD / L ตามลำดับ; tributary width ต้องคำนวณตามพื้นที่รับน้ำหนักจริงของคานแต่ละตัว', ''),
      ll.length ? null : engineNotLoaded(['materials.liveLoads']),
      unv ? note(`ตาราง LL มี ${unv} รายการที่ยังไม่ตรวจสอบ (verified:false) - ตรวจสอบกับกฎกระทรวง 2566 ข้อ 11`, 'warn') : null,
      h('div', { class: 'toolbar' },
        h('label', { class: 'field' }, 'กลุ่มคาน ', (() => { const s = h('select'); groups.forEach((g) => s.appendChild(h('option', { value: g, text: g }))); s.addEventListener('change', () => { f.group = s.value; }); return s; })()),
        h('label', { class: 'field' }, 'ชื่อรายการ ', (() => { const i = h('input', { type: 'text', placeholder: 'เช่น พื้นห้องพัก' }); i.addEventListener('change', () => { f.name = i.value; }); return i; })()),
        h('label', { class: 'field' }, 'Tributary (ม.) ', (() => { const i = h('input', { type: 'number', value: f.width, step: 'any' }); i.style.width = '70px'; i.addEventListener('change', () => { f.width = toNum(i.value, 2.5); }); return i; })()),
        h('button', { class: 'btn', type: 'button', text: '+ เพิ่มจากกลุ่มคาน', onclick: () => {
          if (!f.group) { toast('ไม่มีกลุ่มคาน - สร้างโมเดลก่อน', true); return; }
          const e = ll[0];
          P.loads.assignments.push({ id: uid('a'), name: f.name || ('พื้น ' + f.group), members: P.model.members.filter((m) => m.group === f.group).map((m) => m.id), slabT: 12, sdl: 150, liveKey: e ? e.key : '', liveValue: e ? e.value : 250, liveOverride: false, liveRemark: '', width: f.width, unverifiedLL: !!(e && e.verified === false) });
          draw(); save();
        } }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'ใช้โหลดทั้งหมด (พื้น + ผนัง) กับ load cases', onclick: () => {
          const bad = P.loads.assignments.find((a) => a.liveOverride && !String(a.liveRemark).trim());
          if (bad) { toast('LL ที่กำหนดเองต้องระบุหมายเหตุ/ที่มา: ' + bad.name, true); return; }
          rebuildAutoLoads(); renderTab('loads'); toast('สร้างโหลดบนองค์อาคารแล้ว');
        } })),
      tblHost);
    return body;
  }
  function wallCard() {
    const groups = [...new Set(P.model.members.filter((m) => m.kind === 'beam').map((m) => m.group).filter(Boolean))];
    const f = { group: groups[0] || '' };
    const host = h('div');
    const t = editTable({
      cols: [{ key: 'name', label: 'รายการ', w: '160px' }, { key: 'members', label: 'คานใต้ผนัง (คั่นด้วย ,)', w: '240px', get: (r) => r.members.join(','), set: (r, v) => { r.members = v.split(/[,\s]+/).filter(Boolean); } },
        { key: 'unitWt', label: 'น้ำหนักผนัง (kg/m²)', type: 'num' }, { key: 'height', label: 'สูง (m)', type: 'num' }, { key: 'reduction', label: 'ลดช่องเปิด (0-1)', type: 'num' },
        { key: 'w', label: 'w (kg/m)', type: 'ro-num', dec: 1, get: (r) => r.unitWt * r.height * (1 - (r.reduction || 0)) }],
      rows: () => P.loads.walls, onChange: () => { save(); t.rebuild(); }, onDelete: (r) => { P.loads.walls.splice(P.loads.walls.indexOf(r), 1); save(); },
      extra: h('span', null, (() => { const s = h('select'); groups.forEach((g) => s.appendChild(h('option', { value: g, text: g }))); s.addEventListener('change', () => { f.group = s.value; }); return s; })(), ' ',
        h('button', { class: 'btn', type: 'button', text: '+ ผนังบนกลุ่มคาน', onclick: () => { P.loads.walls.push({ id: uid('w'), name: 'ผนัง ' + f.group, members: P.model.members.filter((m) => m.group === f.group).map((m) => m.id), unitWt: 180, height: 3, reduction: 0 }); t.rebuild(); save(); } }))
    });
    host.appendChild(t);
    return card('3. น้ำหนักผนัง (line load) - อิฐก่อ 10 ซม. ~180-200, AAC 10 ซม. ~60-70, ผนังเบา ~30-40 kg/m²', host, note('ใช้ปุ่ม "ใช้โหลดทั้งหมด" ในหัวข้อ 2 เพื่อสร้างโหลดผนังลงใน SDL case'));
  }

  function windCard() {
    if (!P.loads.wind) P.loads.wind = { method: 'MR2566', V50: 25, Iw: 1, terrain: 'open', Cg: 2, Cp: 1.3, area: 'city', largePublic: false };
    const w = P.loads.wind, ex = extents();
    const out = h('div');
    const L = SD().loads;
    function drawOut() {
      clear(out); const o = P.loads.windOut; if (!o) return;
      ['X', 'Y'].forEach((ax) => {
        const d = o[ax]; if (!d) return;
        out.appendChild(h('h4', { text: `ทิศทาง ${ax}: ${d.res && d.res.p !== undefined ? 'p = ' + fmt(d.res.p, 1) + ' kg/m²' : ''}${d.res && d.res.applicable === false ? ' - วิธีสถิตไม่ครอบคลุม ต้องใช้ dynamic' : ''}` }));
        ((d.res && d.res.warnings) || []).forEach((x) => out.appendChild(note(x, 'warn')));
        const sv = stepsView(d.res && d.res.steps); if (sv) out.appendChild(sv);
        out.appendChild(roTable([{ label: 'ระดับ z (m)', get: (r) => r.z, num: true, dec: 2 }, { label: 'แรงลม F (kg)', get: (r) => r.F, num: true, dec: 0 }], d.forces || []));
      });
    }
    const host = card('4. แรงลม (สร้างเป็น load case W_X / W_Y)');
    if (needEngine(['loads.wind']).length) host.appendChild(engineNotLoaded(['loads.wind']));
    const pr = provinceRow(P.meta.province);
    addAll(host, h('div', { class: 'grid-form' },
      field('วิธีคำนวณ', w, 'method', { options: [{ v: 'MR2566', t: 'กฎกระทรวง 2566 ข้อ 17 (แบบง่าย)' }, { v: '1311', t: 'มยผ. 1311-50' }], onChange: () => renderTab('loads') }),
      w.method === 'MR2566' ? [
        field('ลักษณะพื้นที่', w, 'area', { options: [{ v: 'city', t: 'ในเมือง/ชุมชน (city)' }, { v: 'open', t: 'โล่ง/ชายฝั่ง (open/coastal)' }] }),
        field('อาคารสาธารณะพื้นที่ ≥ 1,000 ตร.ม. (+15%)', w, 'largePublic', { type: 'checkbox' })
      ] : [
        field('V50 ความเร็วลมอ้างอิง', w, 'V50', { type: 'number', unit: 'm/s' }), field('Iw', w, 'Iw', { type: 'number' }),
        field('สภาพภูมิประเทศ', w, 'terrain', { options: [{ v: 'open', t: 'โล่ง (A)' }, { v: 'rough', t: 'ขรุขระ/เมือง (B)' }] }), field('Cg', w, 'Cg', { type: 'number' }), field('Cp สุทธิ', w, 'Cp', { type: 'number' })
      ]),
      h('div', { class: 'muted small', text: `ขนาดอาคารจากโมเดล: กว้างตามแกน X = ${fmt(ex.X, 2)} ม., ตามแกน Y = ${fmt(ex.Y, 2)} ม., สูง H = ${fmt(ex.H, 2)} ม.` }),
      pr && pr.V50 != null && w.method === '1311' ? h('button', { class: 'btn btn-sm', type: 'button', text: 'ใช้ V50 ของจังหวัด (' + pr.V50 + ' m/s)', onclick: () => { w.V50 = toNum(pr.V50, 25); renderTab('loads'); } }) : null,
      note(w.method === 'MR2566' ? 'ข้อ 17 ใช้ได้เมื่อ H ≤ 40 ม. และ H ≤ 3B' : 'ตรวจสอบเงื่อนไข static procedure: H < 80 ม., H/D < 3, fn > 1 Hz', ''),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'คำนวณและสร้างโหลดลม', onclick: () => runWind(w, ex, drawOut) })), out);
    drawOut();
    return host;
  }
  function runWind(w, ex, drawOut) {
    const L = SD().loads;
    if (!L || !L.wind) { toast('engine ลม (SD.loads.wind) ยังไม่พร้อม', true); return; }
    const lv = levels().filter((z) => z > 0);
    if (!lv.length) { toast('ไม่มีระดับพื้นในโมเดล', true); return; }
    const H = ex.H, res = {};
    ['X', 'Y'].forEach((ax) => {
      const B = ax === 'X' ? ex.Y : ex.X, D = ax === 'X' ? ex.X : ex.Y; // wind along ax: face width = other plan dimension
      const floors = lv.map((z) => ({ z, width: B, breadth: D }));
      try {
        if (w.method === 'MR2566') {
          if (!L.wind.mr2566Simple || !L.wind.mr2566StoryForces) throw new Error('SD.loads.wind.mr2566Simple ไม่พร้อม');
          const par = { H, B, terrain: w.area, publicLarge: !!w.largePublic };
          const base = L.wind.mr2566Simple(par);
          const fr = L.wind.mr2566StoryForces(par, floors);
          res[ax] = { res: Object.assign({}, base, { steps: (base.steps || []).concat(fr.steps || []) }), forces: fr.map((f) => ({ z: f.z, F: f.F })) };
        } else {
          if (!L.wind.static) throw new Error('SD.loads.wind.static ไม่พร้อม');
          const par = { V50: w.V50, Iw: w.Iw, terrain: w.terrain, H, D, Cg: w.Cg, Cp: w.Cp };
          const r = L.wind.static(par);
          const fr = L.wind.storyForces(par, floors);
          res[ax] = { res: Object.assign({}, r, { steps: (r.steps || []).concat(fr.steps || []) }), forces: fr.map((f) => ({ z: f.z, F: f.F })) };
        }
      } catch (e) { toast('คำนวณลมไม่ได้: ' + e.message, true); res[ax] = null; }
    });
    if (!res.X && !res.Y) return;
    P.loads.windOut = { method: w.method, params: clone(w), X: res.X ? clone(res.X) : null, Y: res.Y ? clone(res.Y) : null };
    applyLateral('W', 'W', null, (ax) => (res[ax] ? res[ax].forces : []), 'wind');
    P.loads.windOut.hash = geomHash(); save();
    drawOut(); toast('สร้าง load case W_X / W_Y แล้ว (กระจายเท่ากันทุกโหนดของระดับพื้น)');
  }

  function seismicCard() {
    if (!P.loads.seismic) P.loads.seismic = { Ss: null, S1: null, site: 'D', Ie: 1, sysKey: 'RC_SMF', R: 8, Cd: 5.5, Omega0: 3, taType: 'concreteMF', TL: 4, weights: {}, llFrac: 0 };
    const s = P.loads.seismic, pr = provinceRow(P.meta.province), out = h('div');
    const host = card('5. แรงแผ่นดินไหว (ELF) - สร้างเป็น load case E_X / E_Y');
    if (needEngine(['loads.seismic']).length) host.appendChild(engineNotLoaded(['loads.seismic']));
    if (pr) {
      const z = pr.seismicZone2564;
      host.appendChild(note(`จังหวัด ${P.meta.province}: ` + (z === null || z === undefined || z === '' ? 'ไม่อยู่ในเขตควบคุม (กฎกระทรวงแผ่นดินไหว 2564)' : 'เขตแผ่นดินไหว ' + z + ' (กฎกระทรวงแผ่นดินไหว 2564)') + (pr.verified === false ? ' - ข้อมูลยังไม่ผ่านการตรวจสอบ' : ''), (z === null || z === undefined || z === '') ? '' : 'warn'));
    } else host.appendChild(note('ยังไม่ได้เลือกจังหวัดในแท็บโครงการ', 'warn'));
    const lv = levels().filter((z) => z > 0);
    if (s.weightsStale) host.appendChild(note('โมเดลมีการเปลี่ยนแปลงหลังกรอกน้ำหนักประกอบแผ่นดินไหว - ต้องประมาณ/กรอกน้ำหนักต่อระดับใหม่ก่อนคำนวณ', 'err'));
    const wtHost = h('div');
    function drawW() {
      clear(wtHost);
      wtHost.appendChild(editTable({
        cols: [{ key: 'z', label: 'ระดับ z (m)', type: 'ro-num', dec: 2, get: (r) => r }, { key: 'w', label: 'น้ำหนักประกอบแผ่นดินไหว W (kg)', type: 'num', get: (r) => s.weights[r] || 0, set: (r, v) => { s.weights[r] = v; } }],
        rows: () => lv, onChange: () => { s.weightsStale = false; save(); }
      }));
    }
    drawW();
    addAll(host, h('div', { class: 'grid-form' },
      field('Ss (g)', s, 'Ss', { type: 'number' }), field('S1 (g)', s, 'S1', { type: 'number' }),
      field('Site class', s, 'site', { options: ['A', 'B', 'C', 'D', 'E', 'F'] }), field('Ie', s, 'Ie', { options: [1, 1.25, 1.5], num: true }),
      field('ระบบต้านแรงด้านข้าง', s, 'sysKey', { options: Object.keys(seismicSystems()), onChange: () => { const r = seismicSystems()[s.sysKey]; if (r) { s.R = r.R; s.Omega0 = r.Omega0; s.Cd = r.Cd; s.taType = r.period || 'other'; } renderTab('loads'); } }),
      field('R', s, 'R', { type: 'number' }), field('Ω0', s, 'Omega0', { type: 'number' }), field('Cd', s, 'Cd', { type: 'number' }),
      field('ชนิดระบบสำหรับ Ta', s, 'taType', { options: [{ v: 'concreteMF', t: 'โครงต้านแรงดัด คสล.' }, { v: 'steelMF', t: 'โครงต้านแรงดัด เหล็ก' }, { v: 'braced', t: 'EBF/BRBF' }, { v: 'other', t: 'อื่น ๆ' }] }),
      field('TL (s) - 4 วินาทีเป็น placeholder ต้องตรวจสอบ', s, 'TL', { type: 'number' }), field('สัดส่วน LL ที่นับเป็น W (0-1)', s, 'llFrac', { type: 'number' })),
      pr && (pr.Ss != null || pr.S1 != null) ? h('button', { class: 'btn btn-sm', type: 'button', text: 'ใช้ Ss/S1 จากตารางจังหวัด (ต้องตรวจสอบ)', onclick: () => { if (pr.Ss != null) s.Ss = toNum(pr.Ss); if (pr.S1 != null) s.S1 = toNum(pr.S1); renderTab('loads'); } }) : null,
      note('ค่า R/Ω0/Cd ตามตารางในสเปก - ผู้ออกแบบต้องยืนยันกับ มยผ. 1301/1302-61', 'warn'),
      h('h4', { text: 'น้ำหนักประกอบแผ่นดินไหวต่อระดับ' }),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', text: 'ประมาณจากโมเดล (DL+SDL)', onclick: () => { estimateWeights(s); s.weightsStale = false; renderTab('loads'); save(); } })), wtHost,
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'คำนวณและสร้างโหลดแผ่นดินไหว', onclick: () => runSeismic(s, lv, out, pr) })), out);
    drawSeismicOut(out);
    return host;
  }
  function estimateWeights(s) {
    const lv = levels().filter((z) => z > 0); const W = {}; lv.forEach((z) => { W[z] = 0; });
    const near = (z) => lv.find((q) => Math.abs(q - z) < 1e-3);
    const cs = P.loads.cases.filter((c) => c.type === 'D' || c.type === 'SD' || (c.type === 'L' && s.llFrac > 0));
    const nodeZ = {}; P.model.nodes.forEach((n) => { nodeZ[n.id] = n.z; });
    P.model.members.forEach((m) => {
      const sec = P.model.sections[m.section], mat = P.model.materials[m.material]; if (!sec || !mat) return;
      const L = memberLen(m), zi = nodeZ[m.i], zj = nodeZ[m.j]; if (zi === undefined || zj === undefined) return;
      const sw = (P.loads.cases.some((c) => c.selfWeight && c.type === 'D') ? sec.A * mat.density * L : 0);
      let ld = 0; cs.forEach((c) => { const f = c.type === 'L' ? s.llFrac : 1; c.member.filter((e) => e.member === m.id && e.kind === 'udl' && /Z/.test(e.dir)).forEach((e) => { ld += Math.abs(e.w) * L * f; }); });
      const tot = sw + ld;
      if (Math.abs(zi - zj) < 1e-6) { const k = near(zi); if (k !== undefined) W[k] += tot; }
      else { [zi, zj].forEach((z) => { const k = near(z); if (k !== undefined) W[k] += tot / 2; }); }
    });
    cs.forEach((c) => c.nodal.forEach((e) => { const k = near(nodeZ[e.node]); if (k !== undefined && e.src === undefined) W[k] += Math.abs(e.fz); }));
    s.weights = {}; lv.forEach((z) => { s.weights[z] = Math.round(W[z]); });
  }
  function runSeismic(s, lv, out, pr) {
    const L = SD().loads;
    if (!L || !L.seismic || !L.seismic.elf) { toast('engine แผ่นดินไหว (SD.loads.seismic.elf) ยังไม่พร้อม', true); return; }
    if (!lv.length) { toast('ไม่มีระดับพื้นในโมเดล', true); return; }
    if (s.Ss == null || s.S1 == null || s.Ss === '' || s.S1 === '') { toast('กรุณากรอก Ss และ S1 (หรือใช้ปุ่มดึงจากตารางจังหวัดแล้วตรวจสอบค่า) ก่อนคำนวณแผ่นดินไหว', true); return; }
    if (s.weightsStale) { toast('โมเดลเปลี่ยนไปแล้ว - กด "ประมาณจากโมเดล" หรือกรอกน้ำหนักต่อระดับใหม่ก่อน', true); return; }
    const storeys = lv.map((z) => ({ h: z, w: toNum(s.weights[z], 0) }));
    if (!storeys.some((x) => x.w > 0)) { toast('ระบุน้ำหนักประกอบแผ่นดินไหว (หรือกด "ประมาณจากโมเดล")', true); return; }
    try {
      const res = L.seismic.elf({ Ss: s.Ss, S1: s.S1, site: s.site, Ie: s.Ie, R: s.R, Cd: s.Cd, Omega0: s.Omega0, system: s.sysKey, periodType: s.taType, hn: lv[lv.length - 1], storeys, TL: s.TL });
      const forces = (res.forces || []).map((f, i) => ({ z: f.z !== undefined ? f.z : (f.h !== undefined ? f.h : lv[i]), h: lv[i], F: toNum(f.F !== undefined ? f.F : (f.Fx !== undefined ? f.Fx : f.force)) }));
      const z = pr ? pr.seismicZone2564 : undefined;
      P.loads.seismicOut = { params: { TL: s.TL }, res: clone(res), forces, zone: z === null || z === undefined || z === '' ? 'ไม่อยู่ในเขตควบคุม' : 'เขต ' + z };
      applyLateral('E', 'E', null, () => forces, 'eqk');
      P.loads.seismicOut.hash = geomHash(); save();
      drawSeismicOut(out); toast('สร้าง load case E_X / E_Y แล้ว');
    } catch (e) { toast('คำนวณแผ่นดินไหวไม่ได้: ' + e.message, true); }
  }
  function drawSeismicOut(out) {
    clear(out); const o = P.loads.seismicOut; if (!o || !o.res) return;
    const r = o.res;
    out.appendChild(h('div', { class: 'toolbar' }, ['SDS', 'SD1', 'Ta', 'T', 'Cs', 'V', 'k', 'SDC'].map((k) => badge(k + ' = ' + (typeof r[k] === 'number' ? fmt(r[k], k === 'V' ? 0 : 4) : r[k]), 'info'))));
    (r.warnings || []).forEach((x) => out.appendChild(note(x, 'warn')));
    const sv = stepsView(r.steps); if (sv) out.appendChild(sv);
    out.appendChild(roTable([{ label: 'ระดับ z (m)', get: (x) => x.h, num: true, dec: 2 }, { label: 'Fx (kg)', get: (x) => x.F, num: true, dec: 0 }], o.forces));
  }

  function comboCard() {
    const host = card('6. Load combinations (ชุด: ' + (SET_LABELS[P.method.comboSet] || P.method.comboSet) + ')');
    if (needEngine(['loads.combos']).length) host.appendChild(engineNotLoaded(['loads.combos']));
    const t = editTable({
      cols: [{ key: 'id', label: 'ID', w: '60px' }, { key: 'name', label: 'ชื่อ', w: '240px' }, { key: 'method', label: 'วิธี', type: 'select', options: ['SDM', 'WSD'] }, { key: 'set', label: 'ชุด', w: '80px' },
        { key: 'factors', label: 'ตัวคูณ (case:factor, ...)', w: '360px', get: (r) => Object.keys(r.factors).map((k) => k + ':' + r.factors[k]).join(', '), set: (r, v) => { r.factors = parseFactors(v); } }],
      rows: () => P.loads.combos, onChange: () => { P.loads.combosEdited = true; markStale(); save(); }, onAdd: () => { P.loads.combos.push({ id: 'U' + (P.loads.combos.length + 1), name: 'custom', method: 'SDM', set: P.method.comboSet, factors: { DL: 1.4, LL: 1.7 } }); P.loads.combosEdited = true; save(); },
      onDelete: (r) => { P.loads.combos.splice(P.loads.combos.indexOf(r), 1); P.loads.combosEdited = true; save(); }, addLabel: '+ เพิ่ม combination',
      extra: h('button', { class: 'btn btn-primary', type: 'button', text: 'สร้างอัตโนมัติ (SD.loads.combos)', onclick: () => { if (P.loads.combosEdited && !confirm('มีการแก้ไขเอง ต้องการแทนที่ด้วยค่าอัตโนมัติหรือไม่?')) return; regenCombos(); renderTab('loads'); } })
    });
    host.appendChild(t);
    host.appendChild(note('W และ E ใช้ได้ทั้ง ±X และ ±Y (ค่าตัวคูณติดลบ/หลาย combination ตามที่ engine สร้าง) ' + (P.method.allowIncrease ? '| เปิดใช้ allowable increase 1.33' : '| ไม่ใช้ allowable increase 1.33'), ''));
    return host;
  }

  /* =============================== Tab 4: Analysis =============================== */
  const FORCE_KEYS = ['N', 'Vy', 'Vz', 'T', 'My', 'Mz'];
  const FORCE_UNIT = { N: 'kg', Vy: 'kg', Vz: 'kg', T: 'kg-m', My: 'kg-m', Mz: 'kg-m' };
  function comboIds() { return P.loads.combos.map((c) => c.id).filter((id) => S.results && S.results.cases[id]); }

  function modelProblems(model) {
    const probs = [];
    model.members.forEach((m) => {
      const sec = model.sections[m.section], mat = model.materials[m.material];
      if (!sec || !['A', 'Iy', 'Iz', 'J'].every((p) => sec[p] > 0)) probs.push(`องค์อาคาร ${m.id}: หน้าตัด "${m.section}" ไม่มีค่า A/Iy/Iz/J ครบ`);
      if (!mat || !(mat.E > 0)) probs.push(`องค์อาคาร ${m.id}: วัสดุ "${m.material}" ไม่มีค่า E`);
    });
    return [...new Set(probs)].slice(0, 6);
  }
  function runAnalysis() {
    S.error = null;
    if (needEngine(['solver.analyze']).length) { toast('engine solver ยังไม่พร้อม (SD.solver)', true); return; }
    const model = buildEngineModel();
    if (!model.nodes.length || !model.members.length) { toast('ยังไม่มีโมเดล', true); return; }
    if (!model.supports.length) { toast('ยังไม่มีจุดรองรับ', true); return; }
    const probs = modelProblems(model); if (probs.length) { S.error = probs.join(' | '); renderTab('analysis'); return; }
    withBusy('กำลังวิเคราะห์โครงสร้าง...', () => {
      const t0 = performance.now();
      try {
        S.results = SD().solver.analyze(model);
        S.time = performance.now() - t0;
        S.analysis = { hash: stateHash(), id: 'A' + Date.now().toString(36), at: new Date().toISOString() };
        Object.keys(P.design.out).forEach((k) => { if (P.design.out[k].modelHash !== S.analysis.hash) delete P.design.out[k]; });
        save();
        S.eqErr = 0; Object.keys(S.results.cases).forEach((k) => { const e = S.results.cases[k].equilibrium; if (e && isFinite(e.error)) S.eqErr = Math.max(S.eqErr, e.error); });
        S.drift = computeDrift();
        const ids = Object.keys(S.results.cases);
        if (S.analysisSel !== '__env' && !ids.includes(S.analysisSel)) S.analysisSel = '__env';
        clearStale();
      } catch (e) { S.results = null; S.analysis = null; S.error = (e && e.message) || String(e); }
      renderTab('analysis');
    });
  }

  function computeDrift() {
    const rows = []; if (!S.results) return rows;
    const zs = levels(); if (zs.length < 2) return rows;
    const sc = P.loads.seismic || { Cd: 5.5, Ie: 1 };
    P.loads.cases.filter((c) => (c.type === 'W' || c.type === 'E') && S.results.cases[c.id]).forEach((c) => {
      const disp = S.results.cases[c.id].displacements || {};
      const dirs = /_X$/.test(c.id) ? ['ux'] : /_Y$/.test(c.id) ? ['uy'] : ['ux', 'uy'];
      dirs.forEach((dk) => {
        const avg = zs.map((z) => { const ns = levelNodes(z); const v = ns.map((n) => (disp[n.id] ? disp[n.id][dk] || 0 : 0)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
        for (let k = 1; k < zs.length; k++) {
          const hh = zs[k] - zs[k - 1]; let delta = avg[k] - avg[k - 1];
          let limit, shown = delta;
          if (c.type === 'E') { shown = sc.Cd * delta / (sc.Ie || 1); limit = 0.02; } else limit = 1 / 500;
          rows.push({ caseId: c.id + (dirs.length > 1 ? ' ' + dk : ''), z: zs[k], h: hh, u: avg[k], delta: shown, ratio: Math.abs(shown) / hh, limit, ok: Math.abs(shown) / hh <= limit });
        }
      });
    });
    return rows;
  }

  /* series along a member for current selection; env -> {max, min} across combos */
  function seriesFor(id, sel) {
    const R = S.results; if (!R) return null;
    const keys = [...FORCE_KEYS, 'dy', 'dz', 'dyc', 'dzc'];
    if (sel !== '__env') {
      const mr = R.cases[sel] && R.cases[sel].members[id]; if (!mr || !mr.stations) return null;
      const out = { x: mr.stations.map((s) => s.x) }; keys.forEach((k) => { out[k] = { max: mr.stations.map((s) => s[k] || 0) }; }); return out;
    }
    let ids = comboIds(); if (!ids.length) ids = Object.keys(R.cases);
    let out = null;
    ids.forEach((cid) => {
      const mr = R.cases[cid].members[id]; if (!mr || !mr.stations) return;
      if (out && mr.stations.length !== out.x.length) return;
      if (!out) { out = { x: mr.stations.map((s) => s.x) }; keys.forEach((k) => { out[k] = { max: mr.stations.map((s) => s[k] || 0), min: mr.stations.map((s) => s[k] || 0) }; }); return; }
      keys.forEach((k) => mr.stations.forEach((s, i) => { const v = s[k] || 0; if (v > out[k].max[i]) out[k].max[i] = v; if (v < out[k].min[i]) out[k].min[i] = v; }));
    });
    return out;
  }
  function updateViewerDiagram() {
    const v = S.viewers.analysis; if (!v) return;
    const R = S.results; const sel = S.analysisSel;
    if (!R) { v.setDiagram(null); v.setDeformed(null); return; }
    const m1 = {}, m2 = {}, env = sel === '__env';
    P.model.members.forEach((m) => { const s = seriesFor(m.id, sel); if (!s) return; m1[m.id] = s.x.map((x, i) => ({ x, v: s[S.diagKind].max[i] })); if (env) m2[m.id] = s.x.map((x, i) => ({ x, v: s[S.diagKind].min[i] })); });
    v.setDiagram(S.diagKind === 'none' ? null : { kind: S.diagKind, members: m1, members2: env ? m2 : null, mult: S.diagScale || 1 });
    if (!env && S.showDeformed && R.cases[sel]) {
      const dm = {}; P.model.members.forEach((m) => { const mr = R.cases[sel].members[m.id]; if (mr) dm[m.id] = mr.stations; });
      v.setDeformed({ nodes: R.cases[sel].displacements, members: dm, mult: S.defScale || 1 });
    } else v.setDeformed(null);
  }

  RENDER.analysis = function (p) {
    p.appendChild(h('h2', { text: 'การวิเคราะห์โครงสร้าง' }));
    const R = S.results;
    const miss = needEngine(['solver.analyze']);
    if (miss.length) p.appendChild(engineNotLoaded(['solver']));
    const nCombo = P.loads.combos.length;
    p.appendChild(h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', type: 'button', text: 'รันการวิเคราะห์', onclick: runAnalysis, disabled: !!miss.length }),
      R ? [badge('DOF ' + R.dofCount, 'info'), badge('เวลา ' + fmt(S.time || 0, 0) + ' ms', 'gray'), badge('Equilibrium error ' + (S.eqErr !== undefined ? S.eqErr.toExponential(2) : '-'), S.eqErr > 1e-3 ? 'ng' : 'ok'), badge((R.warnings || []).length + ' คำเตือน', (R.warnings || []).length ? 'warn' : 'ok')] : null,
      nCombo ? null : badge('ยังไม่มี combination - วิเคราะห์เฉพาะ load cases', 'warn')));
    if (S.error) p.appendChild(note('วิเคราะห์ไม่สำเร็จ: ' + S.error, 'err'));
    if (R && R.warnings && R.warnings.length) p.appendChild(note('คำเตือนจาก engine: ' + R.warnings.join(' | '), 'warn'));
    if (!R) { p.appendChild(note('ยังไม่มีผลวิเคราะห์ - กด "รันการวิเคราะห์" (ผลวิเคราะห์ไม่ถูกเก็บในไฟล์โครงการ ต้องรันใหม่หลังเปิดไฟล์)')); }
    const selOpts = [h('option', { value: '__env', text: 'Envelope (ทุก combination)', selected: S.analysisSel === '__env' })];
    if (R) {
      const cids = comboIds(), cases = Object.keys(R.cases).filter((k) => !cids.includes(k));
      selOpts.push(h('optgroup', { label: 'Combinations' }, cids.map((k) => h('option', { value: k, text: k + ' - ' + ((P.loads.combos.find((c) => c.id === k) || {}).name || ''), selected: S.analysisSel === k }))));
      selOpts.push(h('optgroup', { label: 'Load cases' }, cases.map((k) => h('option', { value: k, text: k, selected: S.analysisSel === k }))));
    }
    const selEl = h('select', null, selOpts); selEl.addEventListener('change', () => { S.analysisSel = selEl.value; renderTab('analysis'); });
    const kindEl = h('select', null, [...FORCE_KEYS, 'none'].map((k) => h('option', { value: k, text: k === 'none' ? 'ไม่แสดงแผนภาพ' : k, selected: S.diagKind === k }))); kindEl.addEventListener('change', () => { S.diagKind = kindEl.value; updateViewerDiagram(); renderTab('analysis'); });
    const defEl = h('input', { type: 'checkbox', checked: S.showDeformed }); defEl.addEventListener('change', () => { S.showDeformed = defEl.checked; updateViewerDiagram(); });
    const dsc = h('input', { type: 'range', min: 0.2, max: 4, step: 0.1, value: S.diagScale || 1 }); dsc.addEventListener('input', () => { S.diagScale = +dsc.value; updateViewerDiagram(); });
    const esc2 = h('input', { type: 'range', min: 0.2, max: 6, step: 0.2, value: S.defScale || 1 }); esc2.addEventListener('input', () => { S.defScale = +esc2.value; updateViewerDiagram(); });
    p.appendChild(h('div', { class: 'toolbar' }, h('label', { class: 'field' }, 'Case/Combo ', selEl), h('label', { class: 'field' }, 'แผนภาพแรง ', kindEl), h('label', { class: 'field' }, defEl, ' รูปโครงสร้างหลังเสียรูป'),
      h('label', { class: 'field' }, 'สเกลแผนภาพ ', dsc), h('label', { class: 'field' }, 'สเกลเสียรูป ', esc2), h('span', { class: 'muted small', text: 'เส้นเสียรูป = สีส้ม, แผนภาพ: แดง = ค่าบวก, น้ำเงิน = ค่าลบ (My วาดด้านที่รับแรงดึง)' })));
    const row = h('div', { class: 'row' });
    const vcol = h('div', { class: 'col', style: 'flex:3 1 600px' }, getViewer('analysis', true));
    const lcol = h('div', { class: 'col', style: 'flex:2 1 420px' });
    row.appendChild(vcol); row.appendChild(lcol); p.appendChild(row);
    // member table for selected force
    if (R) {
      const rows = P.model.members.map((m) => { const s = seriesFor(m.id, S.analysisSel); const k = S.diagKind === 'none' ? 'My' : S.diagKind; if (!s) return { id: m.id, kind: m.kind, max: 0, min: 0 }; const mx = Math.max(...s[k].max), mn = Math.min(...(s[k].min || s[k].max)); return { id: m.id, kind: m.kind, max: mx, min: mn }; });
      lcol.appendChild(h('h4', { text: `ค่าสูงสุด/ต่ำสุดของ ${S.diagKind === 'none' ? 'My' : S.diagKind} (${FORCE_UNIT[S.diagKind] || FORCE_UNIT.My}) - คลิกแถวเพื่อดูรายละเอียด` }));
      lcol.appendChild(roTable([{ label: 'องค์อาคาร', get: (r) => r.id }, { label: 'ชนิด', get: (r) => r.kind }, { label: 'สูงสุด', get: (r) => r.max, num: true, dec: 1 }, { label: 'ต่ำสุด', get: (r) => r.min, num: true, dec: 1 }], rows, { filter: true, tall: true, limit: 200, onRow: (r) => selectMember(r.id), isSel: (r) => r.id === S.selMember }));
    }
    p.appendChild(h('div', { id: 'member-detail' }));
    if (R) {
      p.appendChild(card('ปฏิกิริยาที่จุดรองรับ (kg, kg-m)', reactionsTable()));
      p.appendChild(card('Storey drift (กรณีแรงด้านข้าง W / E)', driftTable()));
    }
    updateViewerDiagram();
    renderMemberDetail();
  };
  function reactionsTable() {
    const R = S.results, sel = S.analysisSel;
    if (sel !== '__env') {
      const rr = R.cases[sel].reactions || {};
      const rows = Object.keys(rr).map((n) => Object.assign({ node: n }, rr[n]));
      const sum = { node: 'รวม' }; ['fx', 'fy', 'fz', 'mx', 'my', 'mz'].forEach((k) => { sum[k] = rows.reduce((a, r) => a + (r[k] || 0), 0); });
      return roTable([{ label: 'โหนด', get: (r) => r.node }].concat(['fx', 'fy', 'fz', 'mx', 'my', 'mz'].map((k) => ({ label: k.toUpperCase(), get: (r) => r[k] || 0, num: true, dec: 1 }))), rows.concat([sum]), { filter: true });
    }
    const rs = R_.reactionSummary(P, R);
    const rows = Object.keys(rs).map((n) => Object.assign({ node: n }, rs[n]));
    return roTable([{ label: 'โหนด', get: (r) => r.node }, { label: '|Fx| max', get: (r) => r.fx, num: true, dec: 0 }, { label: '|Fy| max', get: (r) => r.fy, num: true, dec: 0 }, { label: 'Fz max', get: (r) => r.fzmax, num: true, dec: 0 }, { label: 'combo', get: (r) => r.cmax },
      { label: 'Fz min', get: (r) => r.fzmin, num: true, dec: 0 }, { label: 'combo', get: (r) => r.cmin }, { label: '|Mx| max', get: (r) => r.mx, num: true, dec: 0 }, { label: '|My| max', get: (r) => r.my, num: true, dec: 0 }], rows, { filter: true });
  }
  function driftTable() {
    if (!S.drift.length) return note('ไม่มีผล drift - ต้องมี load case ประเภท W/E (เช่น W_X, E_X) และรันวิเคราะห์ (ลม: ขีดจำกัด h/500 ปรับได้ในโค้ด; แผ่นดินไหว: Δ = Cd·δe/Ie ≤ 0.020h)');
    return roTable([{ label: 'Case', get: (r) => r.caseId }, { label: 'ระดับ z (m)', get: (r) => r.z, num: true, dec: 2 }, { label: 'h (m)', get: (r) => r.h, num: true, dec: 2 }, { label: 'δ เฉลี่ยของระดับ (mm)', get: (r) => r.u * 1000, num: true, dec: 2 },
      { label: 'Δ ระหว่างชั้น (mm)', get: (r) => r.delta * 1000, num: true, dec: 2 }, { label: 'Δ/h', get: (r) => r.ratio, num: true, dec: 5 }, { label: 'ขีดจำกัด', get: (r) => r.limit, num: true, dec: 5 }, { label: 'ผล', get: (r) => badge(r.ok ? 'OK' : 'NG', r.ok ? 'ok' : 'ng') }], S.drift, { filter: true });
  }
  function renderMemberDetail() {
    const host = $('#member-detail'); if (!host) return; clear(host);
    const id = S.selMember; if (!id || !S.results) return;
    const m = P.model.members.find((x) => x.id === id); if (!m) return;
    const s = seriesFor(id, S.analysisSel); if (!s) { host.appendChild(note('ไม่มีผลของ ' + id, 'warn')); return; }
    const env = S.analysisSel === '__env';
    const c = card(`รายละเอียดองค์อาคาร ${id} (${m.kind}, ${m.section}, L = ${fmt(memberLen(m), 3)} m) - ${env ? 'Envelope' : S.analysisSel}`);
    const charts = h('div', { class: 'charts' });
    [...FORCE_KEYS, 'dyc', 'dzc'].forEach((k) => {
      const isD = k === 'dyc' || k === 'dzc', f = isD ? 1000 : 1;
      const ser = [{ x: s.x, v: s[k].max.map((v) => v * f) }]; if (env && s[k].min) ser.push({ x: s.x, v: s[k].min.map((v) => v * f) });
      const d = h('div'); d.innerHTML = R_.svgDiagram(ser, { title: isD ? (k === 'dyc' ? 'การโก่งตัว dy เทียบคอร์ด (local y)' : 'การโก่งตัว dz เทียบคอร์ด (local z)') : k, unit: isD ? 'mm' : FORCE_UNIT[k], dec: isD ? 2 : 0 }); // svg string built from numbers + static labels only
      charts.appendChild(d);
    });
    c.appendChild(charts);
    if (!env) {
      const rows = s.x.map((x, i) => ({ x, N: s.N.max[i], Vy: s.Vy.max[i], Vz: s.Vz.max[i], T: s.T.max[i], My: s.My.max[i], Mz: s.Mz.max[i], dyc: s.dyc.max[i] * 1000, dzc: s.dzc.max[i] * 1000 }));
      c.appendChild(h('h4', { text: 'ค่าที่แต่ละ station (kg, kg-m, mm)' }));
      c.appendChild(roTable([{ label: 'x (m)', get: (r) => r.x, num: true, dec: 3 }].concat([...FORCE_KEYS, 'dyc', 'dzc'].map((k) => ({ label: k + (k[0] === 'd' ? ' (mm)' : ''), get: (r) => r[k], num: true, dec: k[0] === 'd' ? 3 : 1 }))), rows));
    } else c.appendChild(note('เลือก combination/case เฉพาะเพื่อดูตารางค่าที่แต่ละ station'));
    host.appendChild(c);
  }

  /* =============================== Tab 5: Design =============================== */
  const REBAR_FY = [{ v: 2400, t: 'SR24 (2400)' }, { v: 3000, t: 'SD30 (3000)' }, { v: 4000, t: 'SD40 (4000)' }, { v: 5000, t: 'SD50 (5000)' }];
  const STEEL_FY = [{ v: 2450, t: 'SS400 (2450)' }, { v: 2530, t: 'A36 (2530)' }, { v: 3250, t: 'SM490 (3250)' }, { v: 3515, t: 'A572 Gr50 (3515)' }];
  const NUM = { type: 'number' };
  const SUPPORT_OPTS = [{ v: 'simple', t: 'ช่วงเดียว' }, { v: 'oneEnd', t: 'ต่อเนื่องปลายเดียว' }, { v: 'both', t: 'ต่อเนื่องสองปลาย' }, { v: 'cantilever', t: 'ยื่น' }];
  function fcLabel() { return "fc' (" + (P.method.strengthBasis === 'cube' ? 'cube' : 'cylinder') + ') [ksc]'; }
  function slabCaseOpts() {
    const cs = SD().rc && SD().rc.twoWayCoefTable && SD().rc.twoWayCoefTable.cases;
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
      const c = cs && cs[n];
      return { v: n, t: c ? `กรณี ${n}: ขอบช่วงสั้น (a) ไม่ต่อเนื่อง ${c.aDisc} ด้าน, ขอบช่วงยาว (b) ไม่ต่อเนื่อง ${c.bDisc} ด้าน` : `กรณี ${n}` };
    });
  }
  const DESIGN_TYPES = {
    rcBeam: { label: 'คาน คสล.', member: true, fields: () => [['b', 'b กว้าง [cm]'], ['h', 'h ลึก [cm]'], ['cover', 'ระยะหุ้ม [cm]'], ['fc', fcLabel()], ['fy', 'fy เหล็กเสริมหลัก [ksc]', REBAR_FY], ['fyv', 'fy เหล็กปลอก [ksc]', REBAR_FY],
      ['botN', 'เหล็กล่าง จำนวน [เส้น]'], ['botDb', 'เหล็กล่าง Ø [mm]'], ['topN', 'เหล็กบน จำนวน [เส้น]'], ['topDb', 'เหล็กบน Ø [mm]'], ['stirDb', 'ปลอก Ø [mm]'], ['stirS', 'ระยะปลอก [cm]'], ['legs', 'จำนวนขาปลอก'], ['L', 'ช่วงคาน (ยาวสุดในกลุ่ม) [m]'],
      ['cont', 'ความต่อเนื่อง', SUPPORT_OPTS], ['bf', 'bf ปีก T-beam (0=สี่เหลี่ยม) [cm]'], ['hf', 'hf ความหนาปีก [cm]']] },
    rcColumn: { label: 'เสา คสล.', member: true, fields: () => [['b', 'b [cm]'], ['h', 'h [cm] (ตามแนวแกน X ของอาคาร)'], ['cover', 'ระยะหุ้ม [cm]'], ['fc', fcLabel()], ['fy', 'fy [ksc]', REBAR_FY], ['fyv', 'fy เหล็กปลอก [ksc]', REBAR_FY], ['N', 'เหล็กยืน จำนวน [เส้น]'], ['db', 'เหล็กยืน Ø [mm]'],
      ['tieDb', 'ปลอก Ø [mm]'], ['tieS', 'ระยะปลอก [cm]'], ['ctype', 'ชนิดเสา', [{ v: 'tied', t: 'ปลอกเดี่ยว (tied)' }, { v: 'spiral', t: 'ปลอกเกลียว (spiral)' }]], ['lu', 'ความสูงอิสระ lu (ยาวสุดในกลุ่ม) [m]'], ['k', 'K factor'], ['sway', 'โครงยอมให้เคลื่อนที่ด้านข้าง (sway)', 'bool'], ['pDelta', 'ได้รวมผล P-Δ (second-order) แล้ว', 'bool']] },
    rcFooting: { label: 'ฐานราก คสล. (เสาเดี่ยว)', node: true, fields: () => [['B', 'B [cm] (0 = ให้โปรแกรมเสนอ)'], ['Lf', 'L [cm] (0 = ให้โปรแกรมเสนอ)'], ['t', 'ความหนา t [cm]'], ['colB', 'เสา b [cm] (ใช้เมื่อไม่พบเสาในโมเดล)'], ['colH', 'เสา h [cm] (ใช้เมื่อไม่พบเสาในโมเดล)'], ['cover', 'ระยะหุ้ม [cm]'], ['fc', fcLabel()], ['fy', 'fy [ksc]', REBAR_FY],
      ['qa', 'qa กำลังแบกทานดินที่ยอมให้ [ksc]'], ['dbX', 'เหล็กเสริม Ø [mm]'], ['position', 'ตำแหน่งเสา', [{ v: 'interior', t: 'ภายใน' }, { v: 'edge', t: 'ริม' }, { v: 'corner', t: 'มุม' }]]] },
    rcSlab: { label: 'พื้น คสล. (ป้อนเอง)', manual: true, fields: () => [['skind', 'ชนิดพื้น', [{ v: 'one', t: 'ทางเดียว' }, { v: 'two', t: 'สองทาง' }]], ['lx', 'ช่วงสั้น lx [m]'], ['ly', 'ช่วงยาว ly [m]'], ['h', 'ความหนา h [cm]'], ['cover', 'ระยะหุ้ม [cm]'], ['fc', fcLabel()], ['fy', 'fy [ksc]', REBAR_FY],
      ['wD', 'น้ำหนักคงที่เพิ่มเติม ไม่รวมน้ำหนักพื้น [kg/m²]'], ['wL', 'น้ำหนักจร [kg/m²]'], ['edge', 'กรณีขอบพื้นสองทาง (ความต่อเนื่องของขอบ)', slabCaseOpts()], ['support', 'ทางเดียว: การรองรับ', SUPPORT_OPTS], ['db', 'เหล็กเสริม Ø [mm]'], ['allowUnverified', 'ยอมรับใช้ตารางสัมประสิทธิ์ที่ยังไม่ตรวจสอบ (พื้นสองทาง)', 'bool']] },
    steelBeam: { label: 'คาน เหล็ก', member: true, fields: () => [['section', 'หน้าตัด (จาก library/โมเดล)'], ['Fy', 'Fy [ksc]', STEEL_FY], ['Lb', 'Lb ระยะค้ำยันด้านข้าง [m] (0 ได้)'], ['Cb', 'Cb'], ['L', 'ช่วงคาน (ยาวสุดในกลุ่ม) [m]']] },
    steelColumn: { label: 'เสา เหล็ก', member: true, fields: () => [['section', 'หน้าตัด (จาก library/โมเดล)'], ['Fy', 'Fy [ksc]', STEEL_FY], ['KLx', 'KLx [m]'], ['KLy', 'KLy [m]'], ['Lb', 'Lb [m]'], ['Cb', 'Cb']] }
  };
  function groupMembers(g) { return P.model.members.filter((m) => m.group === g); }
  function groupMaxLen(g) { return Math.max(0, ...groupMembers(g).map((m) => memberLen(m))); }
  function secOf(m) { return m ? P.model.sections[m.section] : null; }
  function defaultInputs(it) {
    const ms = groupMembers(it.group), m0 = ms[0], sec = secOf(m0), L = +groupMaxLen(it.group).toFixed(3) || 5;
    const b = sec && sec.b ? +(sec.b * 100).toFixed(2) : 30, hh = sec && sec.h ? +(sec.h * 100).toFixed(2) : 50;
    switch (it.type) {
      case 'rcBeam': return { b, h: hh, cover: 3, fc: 240, fy: 4000, fyv: 2400, botN: 3, botDb: 20, topN: 3, topDb: 20, stirDb: 9, stirS: 15, legs: 2, L, cont: 'both', bf: 0, hf: 0 };
      case 'rcColumn': return { b, h: hh, cover: 3, fc: 240, fy: 4000, fyv: 2400, N: 8, db: 20, tieDb: 9, tieS: 15, ctype: 'tied', lu: L, k: 1, sway: false, pDelta: false };
      case 'rcFooting': return { B: 0, Lf: 0, t: 50, colB: 40, colH: 40, cover: 7.5, fc: 240, fy: 4000, qa: 1.5, dbX: 16, position: 'interior' };
      case 'rcSlab': return { skind: 'two', lx: 4, ly: 5, h: 12, cover: 2, fc: 240, fy: 4000, wD: 150, wL: 250, edge: 1, support: 'simple', db: 10, allowUnverified: false };
      default: return { section: m0 ? m0.section : '', Fy: 2450, Lb: L, Cb: 1, L, KLx: L, KLy: L };
    }
  }
  function syncDesignItems() {
    const groups = [...new Set(P.model.members.map((m) => m.group).filter(Boolean))];
    P.design.items = P.design.items.filter((it) => !DESIGN_TYPES[it.type] || !DESIGN_TYPES[it.type].member || groups.includes(it.group));
    groups.forEach((g) => {
      if (P.design.items.some((it) => it.group === g)) return;
      const m = groupMembers(g)[0], sec = secOf(m);
      const steel = sec && sec.shape !== 'rect';
      const type = m.kind === 'column' ? (steel ? 'steelColumn' : 'rcColumn') : m.kind === 'brace' ? 'steelColumn' : (steel ? 'steelBeam' : 'rcBeam');
      const it = { id: uid('d'), type, label: g, group: g, node: '', inputs: {} }; it.inputs = defaultInputs(it); P.design.items.push(it);
    });
  }

  /* ---- consistency between design inputs and the analysed model ---- */
  function consistency(it) {
    const msgs = [], inp = it.inputs, ms = DESIGN_TYPES[it.type] && DESIGN_TYPES[it.type].member ? groupMembers(it.group) : [];
    if (it.type === 'rcBeam' || it.type === 'rcColumn') {
      ms.forEach((m) => {
        const s = secOf(m);
        if (!s || s.shape !== 'rect' || !s.b) { msgs.push(`${m.id}: หน้าตัดในโมเดลไม่ใช่สี่เหลี่ยมผืนผ้า`); return; }
        const b = s.b * 100, hh = s.h * 100;
        if (Math.abs(b - inp.b) > 0.5 || Math.abs(hh - inp.h) > 0.5) msgs.push(`${m.id}: หน้าตัดในโมเดล ${fmt(b, 1)}x${fmt(hh, 1)} ซม. ไม่ตรงกับที่ป้อนออกแบบ ${inp.b}x${inp.h} ซม.`);
      });
      const key = it.type === 'rcBeam' ? 'L' : 'lu', mx = groupMaxLen(it.group);
      if (inp[key] < mx - 0.01) msgs.push(`ความยาวที่ป้อน ${inp[key]} ม. สั้นกว่าองค์อาคารที่ยาวที่สุดในกลุ่ม ${fmt(mx, 2)} ม. (ไม่ปลอดภัย)`);
    }
    if (it.type === 'steelBeam' || it.type === 'steelColumn') {
      ms.forEach((m) => { if (m.section !== inp.section) msgs.push(`${m.id}: หน้าตัดในโมเดล ${m.section} ไม่ตรงกับที่ป้อนออกแบบ ${inp.section}`); });
      if (it.type === 'steelBeam' && inp.L < groupMaxLen(it.group) - 0.01) msgs.push(`ช่วงคานที่ป้อน ${inp.L} ม. สั้นกว่าองค์อาคารที่ยาวที่สุดในกลุ่ม ${fmt(groupMaxLen(it.group), 2)} ม.`);
    }
    return msgs;
  }

  /* ---- combinations & forces ---- */
  function comboSelect(method) { return P.loads.combos.filter((c) => c.method === method && (!c.set || c.set === P.method.comboSet) && S.results.cases[c.id]); }
  function groupsFor(method) {
    const cs = comboSelect(method); if (!cs.length) return [];
    if (method !== 'WSD' || !P.method.allowIncrease) return [{ key: 'all', inc: false, ids: cs.map((c) => c.id) }];
    const base = cs.filter((c) => !c.allowIncrease), inc = cs.filter((c) => c.allowIncrease), out = [];
    if (base.length) out.push({ key: 'base', inc: false, ids: base.map((c) => c.id) });
    if (inc.length) out.push({ key: 'inc', inc: true, ids: inc.map((c) => c.id) });
    return out;
  }
  const MDEFS = { Mpos: (s) => s.My, Mneg: (s) => -s.My, Vz: (s) => Math.abs(s.Vz), Vy: (s) => Math.abs(s.Vy), Tu: (s) => Math.abs(s.T), Pc: (s) => -s.N, Pt: (s) => s.N, Mux: (s) => Math.abs(s.My), Muy: (s) => Math.abs(s.Mz) };
  function memberForces(ms, ids) {
    const R = S.results, f = {}, gov = {};
    Object.keys(MDEFS).forEach((k) => { f[k] = 0; });
    ids.forEach((cid) => ms.forEach((m) => {
      const mr = R.cases[cid].members[m.id]; if (!mr) return;
      (mr.stations || []).forEach((s) => Object.keys(MDEFS).forEach((k) => { const v = MDEFS[k](s); if (v > f[k]) { f[k] = v; gov[k] = cid; } }));
    }));
    return { f, gov };
  }
  function reactionForces(node, items, tcm) {
    // Footing axis convention (verified against engine/rc.js header): B || global X, L || global Y; c1 along B, c2 along L;
    // M_service / Mu = moment about global X (mx + |fy| x depth) -> eccentricity along L; M_service_B / Mu_B = moment about Y (my + |fx| x depth).
    const R = S.results; const o = { Pmax: -Infinity, Pmin: Infinity, Mx: 0, My: 0, H: 0, gov: {}, has: false };
    items.forEach((it) => {
      let fx = 0, fy = 0, fz = 0, mx = 0, my = 0, any = false;
      it.parts.forEach(([cid, fac]) => { const r = ((R.cases[cid] || {}).reactions || {})[node]; if (r) { any = true; fx += fac * r.fx; fy += fac * r.fy; fz += fac * r.fz; mx += fac * r.mx; my += fac * r.my; } });
      if (!any) return; o.has = true;
      if (fz > o.Pmax) { o.Pmax = fz; o.gov.P = it.label; } if (fz < o.Pmin) { o.Pmin = fz; o.gov.Pmin = it.label; }
      const Mx = Math.abs(mx) + Math.abs(fy) * tcm / 100, My = Math.abs(my) + Math.abs(fx) * tcm / 100, H = Math.hypot(fx, fy);   // base moment includes H x footing depth
      if (Mx > o.Mx) { o.Mx = Mx; o.gov.Mx = it.label; } if (My > o.My) { o.My = My; o.gov.My = it.label; } if (H > o.H) { o.H = H; o.gov.H = it.label; }
    });
    o.P = !o.has ? 0 : (o.Pmin < 0 ? o.Pmin : o.Pmax);   // uplift is passed as a NEGATIVE load (engine hard-warns), never clipped
    return o;
  }
  function columnAtNode(node) {
    const cs = P.model.members.filter((m) => m.kind === 'column' && (m.i === node || m.j === node)).map((m) => ({ m, s: secOf(m) })).filter((x) => x.s && x.s.b && x.s.h);
    if (!cs.length) return null;
    cs.sort((a, b) => b.s.b * b.s.h - a.s.b * a.s.h);
    const s = cs[0].s;   // footing c1 is along B (global X) = column h (local z = -X); c2 along L (global Y) = column b
    return { c1: +(s.h * 100).toFixed(2), c2: +(s.b * 100).toFixed(2), id: cs[0].m.id };
  }
  function designMethod(it) {
    const steel = DESIGN_TYPES[it.type].label.includes('เหล็ก');
    return steel ? (P.method.steel === 'LRFD' ? 'SDM' : 'WSD') : (P.method.rc === 'SDM' ? 'SDM' : 'WSD');
  }
  function designGroups(it) {
    const R = S.results, out = { method: designMethod(it), G: [], notes: [] };
    if (it.type === 'rcSlab') { out.G = [{ key: 'all', inc: false, ids: [], f: {}, gov: {} }]; return out; }
    if (!R) { out.error = 'ยังไม่มีผลวิเคราะห์'; return out; }
    if (it.type === 'rcFooting') {
      if (!it.node) { out.error = 'เลือกโหนดจุดรองรับของฐานราก'; return out; }
      const t = toNum(it.inputs.t, 50), toItems = (ids) => ids.map((id) => ({ label: id, parts: [[id, 1]] }));
      const fac = comboSelect('SDM');
      if (!fac.length && P.method.rc === 'SDM') { out.error = 'ไม่พบผลของ combination วิธี SDM - สร้าง combination อัตโนมัติและรันวิเคราะห์ใหม่'; return out; }
      const F = reactionForces(it.node, toItems(fac.map((c) => c.id)), t);
      if (fac.length && !F.has) { out.error = 'ไม่พบปฏิกิริยาที่โหนด ' + it.node + ' (ไม่ใช่จุดรองรับ?)'; return out; }
      const wsd = comboSelect('WSD'); let svc = [];
      if (wsd.length) {
        const gs = P.method.rc === 'WSD' ? groupsFor('WSD') : [{ key: 'all', inc: false, ids: wsd.map((c) => c.id) }];
        svc = gs.map((g) => ({ g, f: reactionForces(it.node, toItems(g.ids), t) }));
      } else {
        const parts = P.loads.cases.filter((c) => (c.type === 'D' || c.type === 'SD' || c.type === 'L') && R.cases[c.id]).map((c) => [c.id, 1]);
        if (!parts.length) { out.error = 'ไม่มี combination วิธี WSD และไม่มีผล D/SD/L สำหรับคำนวณน้ำหนักใช้งานของฐานราก - กด "สร้างอัตโนมัติ" ใน combination แล้วรันวิเคราะห์ใหม่'; return out; }
        svc = [{ g: { key: 'unfactored', inc: false, ids: parts.map((p) => p[0]) }, f: reactionForces(it.node, [{ label: 'D+SD+L (ไม่คูณตัวคูณ)', parts }], t) }];
        out.notes.push('ไม่มี combination WSD ในผลวิเคราะห์ - ใช้น้ำหนักใช้งาน D+SD+L ไม่คูณตัวคูณเป็น P_service (ไม่รวมแรงด้านข้าง)');
      }
      if (svc.some((x) => !x.f.has)) { out.error = 'ไม่พบปฏิกิริยาของน้ำหนักใช้งานที่โหนด ' + it.node; return out; }
      out.G = svc.map((x) => ({ key: x.g.key, inc: x.g.inc, ids: x.g.ids,
        f: { Pu: F.P, Mux: F.Mx, Muy: F.My, Hu: F.H, Ps: x.f.P, Msx: x.f.Mx, Msy: x.f.My },
        gov: { Pu: F.gov.P, Mux: F.gov.Mx, Muy: F.gov.My, Ps: x.f.gov.P, Msx: x.f.gov.Mx, Msy: x.f.gov.My } }));
      if (F.Pmin < 0 || svc.some((x) => x.f.Pmin < 0)) out.notes.push('พบแรงยกขึ้น (uplift, fz < 0) ที่ฐานราก - ส่งค่าติดลบให้ engine ตรวจสอบ');
      return out;
    }
    const gs = groupsFor(out.method);
    if (!gs.length) { out.error = `ไม่พบผลของ combination ชุด ${P.method.comboSet} วิธี ${out.method} (สร้าง combination และรันวิเคราะห์ใหม่)`; return out; }
    const ms = groupMembers(it.group); if (!ms.length) { out.error = 'ไม่มีองค์อาคารในกลุ่ม'; return out; }
    out.G = gs.map((g) => { const r = memberForces(ms, g.ids); return { key: g.key, inc: g.inc, ids: g.ids, f: r.f, gov: r.gov }; });
    return out;
  }
  const FORCE_LABEL = { Mpos: 'M+ (บวก, kg-m)', Mneg: 'M- (ขนาด, kg-m)', Vz: 'Vz (kg)', Vy: 'Vy (kg)', Tu: 'T (kg-m)', Pc: 'P อัดสูงสุด (Pu = -N, บวก = อัด) (kg)', Pt: 'P ดึงสูงสุด (kg)', Mux: 'Mux (kg-m)', Muy: 'Muy (kg-m)', Pu: 'Pu ที่ฐาน (บวก = กด, ลบ = ยก) (kg)', Hu: 'H (kg)', Ps: 'P service (kg)', Msx: 'Mx service ที่ฐานราก (kg-m)', Msy: 'My service ที่ฐานราก (kg-m)' };
  function groupLabel(g) { return g.key === 'inc' ? 'combination ที่มี allowable increase 1.33' : g.key === 'base' ? 'combination แรงโน้มถ่วง (ไม่เพิ่มหน่วยแรง)' : g.key === 'unfactored' ? 'D+SD+L ไม่คูณตัวคูณ' : 'ทุก combination'; }
  function callEngine(fnPath, input) {
    const fn = fnPath.split('.').reduce((o, k) => (o ? o[k] : undefined), SD());
    if (typeof fn !== 'function') throw new Error('engine function SD.' + fnPath + ' ยังไม่พร้อม');
    return fn(input);
  }
  function barArea(n, db) { return n * Math.PI * Math.pow(db / 10, 2) / 4; }
  const SHEAR_RE = /shear|เฉือน|\bVu\b|φVn|\bVs\b|\bVc\b/i;
  function cmpRes(a, b) { return ((a.res.ok ? 1 : 0) - (b.res.ok ? 1 : 0)) || ((b.res.ratio || 0) - (a.res.ratio || 0)); }

  function runItem(it) {
    delete P.design.out[it.id];                                      // never keep an old result while computing a new one
    const manual = MANUAL_TYPES.includes(it.type);
    if (!manual && analysisStale()) throw new Error('ผลวิเคราะห์ล้าสมัยหรือยังไม่มี - รันการวิเคราะห์ใหม่ก่อนออกแบบ');
    const t = DESIGN_TYPES[it.type], inp = it.inputs, set = P.method.comboSet, qc = P.method.qc !== false, rcM = P.method.rc, stM = P.method.steel;
    const dg = designGroups(it); if (dg.error) throw new Error(dg.error);
    const msgs = consistency(it).map((m) => '[ไม่สอดคล้องกับโมเดล] ' + m);
    const common = { set, qc }, sdm = dg.method === 'SDM' && (t.label.includes('เหล็ก') ? stM === 'LRFD' : rcM === 'SDM');
    const runs = [], notes = dg.notes.slice(), govCombos = {};
    let forcesOut = null;
    const evalG = (fn, build, filter) => { const c = dg.G.filter(filter || (() => true)).map((g) => ({ g, res: callEngine(fn, build(g)) })); if (!c.length) return null; c.sort(cmpRes); return c[0]; };
    const add = (title, w, extra, govKeys) => {
      let r; try { r = JSON.parse(JSON.stringify(w.res)); } catch (e) { r = { ok: !!w.res.ok, ratio: w.res.ratio, checks: w.res.checks, steps: w.res.steps, warnings: w.res.warnings }; }
      const hard = (r.hardWarnings || []).slice(); if (r.error && !hard.includes(r.error)) hard.push(r.error);
      hard.push(...msgs);
      (govKeys || []).forEach((k) => { if (w.g.gov[k]) govCombos[(extra && extra.tag ? extra.tag + ':' : '') + k] = w.g.gov[k]; });
      (r.notes || []).forEach((n) => { if (!notes.includes(n)) notes.push(n); });
      runs.push(Object.assign({ title, ok: !!r.ok && !msgs.length, ratio: toNum(r.ratio), checks: r.checks || [], steps: r.steps || [], warnings: (r.warnings || []).filter((x) => !(r.hardWarnings || []).includes(x)), hard, inputs: r.inputs, sized: r.sized, governing: groupLabel(w.g) + (w.g.ids.length ? ` (${w.g.ids.length} combination)` : '') }, extra || {}));
      if (!forcesOut) { forcesOut = {}; Object.keys(w.g.f).forEach((k) => { if (FORCE_LABEL[k]) forcesOut[FORCE_LABEL[k]] = w.g.f[k]; }); }
    };
    const fc = fcCyl(inp.fc);
    const inc = (g) => (!sdm && g.inc ? { allowIncrease: 1.33 } : {});
    if (it.type === 'rcBeam') {
      const fn = sdm ? 'rc.beamSDM' : 'rc.beamWSD';
      const bot = { n: inp.botN, db: inp.botDb }, top = { n: inp.topN, db: inp.topDb };
      const base = (g) => Object.assign({}, common, { b: inp.b, h: inp.h, cover: inp.cover, fc, fy: inp.fy, fyv: inp.fyv, stirrup: { db: inp.stirDb, legs: inp.legs, s: inp.stirS }, span: inp.L, support: inp.cont }, inc(g));
      const posB = (g) => { const o = Object.assign(base(g), { bars: bot, barsComp: top }, sdm ? { Mu: g.f.Mpos, Vu: g.f.Vz, Tu: g.f.Tu } : { M: g.f.Mpos, V: g.f.Vz }); if (inp.bf > 0 && inp.hf > 0) o.flange = { bf: inp.bf, hf: inp.hf }; return o; };
      const negB = (g) => Object.assign(base(g), { bars: top, barsComp: bot }, sdm ? { Mu: g.f.Mneg, Vu: g.f.Vz, Tu: g.f.Tu } : { M: g.f.Mneg, V: g.f.Vz });
      add('ช่วงกลางคาน (โมเมนต์บวก, เหล็กล่างรับแรงดึง)', evalG(fn, posB), { tag: 'M+' }, ['Mpos', 'Vz', 'Tu']);
      add('หน้าตัดที่จุดรองรับ (โมเมนต์ลบ, เหล็กบนรับแรงดึง)', evalG(fn, negB), { tag: 'M-' }, ['Mneg', 'Vz', 'Tu']);
    } else if (it.type === 'rcColumn') {
      const fn = sdm ? 'rc.columnSDM' : 'rc.columnWSD';
      const build = (g, Pu) => Object.assign({}, common, { b: inp.b, h: inp.h, cover: inp.cover, fc, fy: inp.fy, bars: { n: inp.N, db: inp.db }, tie: inp.ctype, tieDb: inp.tieDb, tieS: inp.tieS, lu: inp.lu, k: inp.k, sway: !!inp.sway, pDelta: !!inp.pDelta },
        sdm ? { Pu, Mux: g.f.Mux, Muy: g.f.Muy } : { P: Pu, Mx: g.f.Mux, My: g.f.Muy }, inc(g));
      const w = evalG(fn, (g) => build(g, g.f.Pc));
      const res = w.res, curve = (ax) => ((res.curves && res.curves[ax] && res.curves[ax].points) || []).map((q) => ({ P: q.phiPn, M: q.phiMn }));
      add('เสา - แรงอัดสูงสุด (Pu = -N; บวก = อัด) พร้อม Mux, Muy', w, { pm: curve('x'), pmDemands: [{ M: w.g.f.Mux, P: w.g.f.Pc, label: 'Mux', ok: res.ok }], pmY: curve('y'), pmYDemands: [{ M: w.g.f.Muy, P: w.g.f.Pc, label: 'Muy', ok: res.ok }], tag: 'อัด' }, ['Pc', 'Mux', 'Muy']);
      if (dg.G.some((g) => g.f.Pt > 1)) {
        const wt = evalG(fn, (g) => build(g, -g.f.Pt), (g) => g.f.Pt > 1);
        add('เสา - แรงดึงสูงสุด (Pu ติดลบ = แรงดึง) พร้อม Mux, Muy', wt, { tag: 'ดึง' }, ['Pt', 'Mux', 'Muy']);
      }
      // column shear: checked with the beam shear routine (axial compression benefit ignored = conservative)
      const bfn = sdm ? 'rc.beamSDM' : 'rc.beamWSD'; const cands = [];
      [['Vz', inp.b, inp.h], ['Vy', inp.h, inp.b]].forEach(([k, bb, hh]) => dg.G.forEach((g) => {
        const V = g.f[k]; if (!(V > 0)) return;
        const rs = callEngine(bfn, Object.assign({}, common, { b: bb, h: hh, cover: inp.cover, fc, fy: inp.fy, fyv: inp.fyv, bars: { n: 2, db: inp.db }, barsComp: { n: 2, db: inp.db }, stirrup: { db: inp.tieDb, legs: 2, s: inp.tieS }, span: inp.lu }, sdm ? { Mu: 1, Vu: V, Tu: 0 } : { M: 1, V }, inc(g)));
        const ch = (rs.checks || []).filter((c) => SHEAR_RE.test(c.name)); if (rs.error || !ch.length) return;
        cands.push({ g, k, res: { ok: ch.every((c) => c.ok), ratio: Math.max(...ch.map((c) => c.ratio)), checks: ch, steps: (rs.steps || []).filter((st) => SHEAR_RE.test(st.label)), warnings: [], hardWarnings: [], inputs: { V, b: bb, h: hh } } });
      }));
      if (cands.length) { cands.sort(cmpRes); add('เสา - แรงเฉือน (ตรวจด้วยวิธีคานแบบเฉือนอย่างเดียว ไม่นับผลแรงอัด = อนุรักษ์นิยม)', cands[0], { tag: 'V' }, [cands[0].k]); }
      else runs[0].warnings.push('ไม่สามารถตรวจแรงเฉือนเสาโดยอัตโนมัติ (engine ไม่ส่งผลตรวจแรงเฉือน) - ต้องตรวจสอบแรงเฉือนของเสาแยกต่างหาก');
    } else if (it.type === 'rcFooting') {
      const fn = sdm ? 'rc.footingSDM' : 'rc.footingWSD';
      const col = columnAtNode(it.node) || { c1: inp.colH, c2: inp.colB, id: null };
      const build = (g) => { const o = Object.assign({}, common, { h: inp.t, cover: inp.cover, col: { c1: col.c1, c2: col.c2 }, fc, fy: inp.fy, qa: inp.qa, db: inp.dbX, position: inp.position, P_service: g.f.Ps, M_service: g.f.Msx, M_service_B: g.f.Msy, Pu: g.f.Pu, Mu: g.f.Mux, Mu_B: g.f.Muy }, inc(g)); if (inp.B > 0 && inp.Lf > 0) { o.B = inp.B; o.L = inp.Lf; } return o; };
      const w = evalG(fn, build);
      add('ฐานราก ' + it.node + ' (เสา c1=' + col.c1 + ' x c2=' + col.c2 + ' ซม.' + (col.id ? ' จาก ' + col.id : ' - ไม่พบเสาในโมเดล ใช้ค่าที่ป้อน') + ')' + (inp.B > 0 && inp.Lf > 0 ? '' : ' (ให้โปรแกรมเสนอขนาด)'), w, { tag: 'F' }, ['Pu', 'Mux', 'Muy', 'Ps', 'Msx', 'Msy']);
      if (!col.id) runs[0].warnings.push('ไม่พบเสาในโมเดลที่โหนดนี้ - ใช้ขนาดเสาที่ป้อนเอง');
    } else if (it.type === 'rcSlab') {
      const c2 = Object.assign({}, common, { h: inp.h, wD: inp.wD, wL: inp.wL, fc, fy: inp.fy, method: rcM, cover: inp.cover, db: inp.db, addSelfWeight: true });
      const res = inp.skind === 'one' ? callEngine('rc.slabOneWay', Object.assign(c2, { span: inp.lx, support: inp.support })) : callEngine('rc.slabTwoWay', Object.assign(c2, { la: Math.min(inp.lx, inp.ly), lb: Math.max(inp.lx, inp.ly), case: inp.edge, allowUnverified: !!inp.allowUnverified }));
      add('พื้น' + (inp.skind === 'one' ? 'ทางเดียว' : 'สองทาง'), { g: dg.G[0], res }, { slabApprox: inp.skind !== 'one', tag: 'S' }, []);
      forcesOut = { 'wD เพิ่มเติม (kg/m²)': inp.wD, 'wL (kg/m²)': inp.wL };
    } else if (it.type === 'steelBeam') {
      const build = (g) => { const m = Math.max(g.f.Mpos, g.f.Mneg); return Object.assign({}, common, { method: stM, section: inp.section, Fy: inp.Fy, Mu: m, Ma: m, Vu: g.f.Vz, Va: g.f.Vz, Lb: inp.Lb, Cb: inp.Cb, span: inp.L }, inc(g)); };
      add('คานเหล็ก', evalG('steel.beam', build), { tag: 'B' }, ['Mpos', 'Mneg', 'Vz']);
    } else if (it.type === 'steelColumn') {
      const build = (g, Pu) => Object.assign({}, common, { method: stM, section: inp.section, Fy: inp.Fy, Pu, Pa: Pu, Mux: g.f.Mux, Max: g.f.Mux, Muy: g.f.Muy, May: g.f.Muy, KLx: inp.KLx, KLy: inp.KLy, Lb: inp.Lb, Cb: inp.Cb }, inc(g));
      const hasM = dg.G.some((g) => g.f.Mux > 1 || g.f.Muy > 1), fn = hasM ? 'steel.beamColumn' : 'steel.column';
      add(hasM ? 'เสาเหล็ก - แรงอัดสูงสุด + โมเมนต์ (H1)' : 'เสาเหล็ก - แรงอัด', evalG(fn, (g) => build(g, g.f.Pc)), { tag: 'อัด' }, ['Pc', 'Mux', 'Muy']);
      if (dg.G.some((g) => g.f.Pt > 1)) add('เสาเหล็ก - แรงดึงสูงสุด (Pu ติดลบ = แรงดึง)', evalG(fn, (g) => build(g, -g.f.Pt), (g) => g.f.Pt > 1), { tag: 'ดึง' }, ['Pt', 'Mux', 'Muy']);
      runs[0].warnings.push('ไม่ได้ตรวจแรงเฉือนของเสาเหล็กในโปรแกรมรุ่นนี้ - ต้องตรวจสอบแยก');
    }
    const rec = { at: new Date().toISOString(), typeLabel: t.label, method: t.label.includes('เหล็ก') ? stM : rcM, set, qc, allowIncrease: !!P.method.allowIncrease, allowUnverified: !!inp.allowUnverified,
      forces: forcesOut || {}, govCombos, runs, notes, analysisId: manual ? '' : S.analysis.id, analysisAt: manual ? '' : S.analysis.at, modelHash: manual ? '' : S.analysis.hash, inputHash: itemHash(it) };
    P.design.out[it.id] = rec; save();
    return rec;
  }

  S.designSel = null;
  RENDER.design = function (p) {
    p.appendChild(h('h2', { text: 'ออกแบบองค์อาคาร' }));
    const miss = needEngine(['rc', 'steel']); if (miss.length) p.appendChild(engineNotLoaded(miss));
    if (!S.results) p.appendChild(note('ยังไม่มีผลวิเคราะห์ - ต้องรันวิเคราะห์ก่อนจึงจะดึงแรงออกแบบอัตโนมัติ (คุณยังตั้งค่าหน้าตัด/เหล็กเสริมได้)', 'warn'));
    else if (analysisStale()) p.appendChild(note('ผลวิเคราะห์ล้าสมัย (โมเดล/น้ำหนักบรรทุก/ตั้งค่าเปลี่ยนไป) - รันวิเคราะห์ใหม่ก่อนออกแบบ', 'err'));
    syncDesignItems();
    p.appendChild(note(`วิธี RC: ${P.method.rc} | วิธีเหล็ก: ${P.method.steel} | ชุด combination: ${SET_LABELS[P.method.comboSet]} | QC: ${P.method.qc !== false ? 'มี' : 'ไม่มี'} | allowable increase 1.33: ${P.method.allowIncrease ? 'ใช้ (ออกแบบแยก combination แรงโน้มถ่วง / combination ที่มี increase แล้วใช้ค่าที่วิกฤตกว่า)' : 'ไม่ใช้'}. แรงออกแบบดึงจากทุก combination ของวิธีที่เลือก; เสา Pu/Mux/Muy เป็นค่าสูงสุดแยกกัน (conservative)`));
    const row = h('div', { class: 'split' });
    const list = h('div'); const detail = h('div');
    function drawList() {
      clear(list);
      list.appendChild(h('div', { class: 'toolbar' },
        h('button', { class: 'btn btn-primary', type: 'button', text: 'คำนวณทั้งหมด', onclick: () => withBusy('กำลังออกแบบ...', () => { let n = 0, e = 0, msg = ''; P.design.items.forEach((it) => { try { runItem(it); n++; } catch (x) { e++; msg = x.message; console.warn(it.label, x); } }); renderTab('design'); toast(`ออกแบบแล้ว ${n} รายการ` + (e ? `, ผิดพลาด ${e}: ${msg}` : ''), e > 0); }) }),
        h('button', { class: 'btn', type: 'button', text: '+ ฐานราก', onclick: () => addItem('rcFooting') }), h('button', { class: 'btn', type: 'button', text: '+ พื้น', onclick: () => addItem('rcSlab') })));
      const box = h('div', { class: 'list' });
      P.design.items.forEach((it) => {
        const o = P.design.out[it.id]; const worst = o ? Math.max(0, ...o.runs.map((r) => r.ratio || 0)) : null; const ok = o ? o.runs.every((r) => r.ok) : null; const st = o && recordStale(it);
        box.appendChild(h('div', { class: 'list-item' + (S.designSel === it.id ? ' sel' : ''), onclick: () => { S.designSel = it.id; renderTab('design'); } },
          h('div', null, h('div', { text: it.label || it.id }), h('div', { class: 'muted small', text: DESIGN_TYPES[it.type] ? DESIGN_TYPES[it.type].label : it.type })),
          st ? badge('ไม่เป็นปัจจุบัน', 'warn') : (o ? badge((ok ? 'OK ' : 'NG ') + R_.fmtRatio(worst), ok ? 'ok' : 'ng') : badge('ยังไม่ได้ออกแบบ', 'gray'))));
      });
      list.appendChild(box);
    }
    function addItem(type) {
      const it = { id: uid('d'), type, label: DESIGN_TYPES[type].label + ' ' + (P.design.items.length + 1), group: '', node: type === 'rcFooting' ? ((P.model.supports[0] || {}).node || '') : '', inputs: {} };
      it.inputs = defaultInputs(it); P.design.items.push(it); S.designSel = it.id; save(); renderTab('design');
    }
    drawList();
    if (!S.designSel || !P.design.items.some((x) => x.id === S.designSel)) S.designSel = P.design.items[0] ? P.design.items[0].id : null;
    const it = P.design.items.find((x) => x.id === S.designSel);
    if (it) drawItem(detail, it);
    else detail.appendChild(note('ยังไม่มีกลุ่มองค์อาคาร - สร้างโมเดลก่อน'));
    row.appendChild(list); row.appendChild(detail); p.appendChild(row);
  };
  function drawItem(host, it) {
    const t = DESIGN_TYPES[it.type]; if (!t) return;
    const inval = () => { delete P.design.out[it.id]; save(); setTimeout(() => { if (S.tab === 'design') renderTab('design'); }, 0); };
    const groups = [...new Set(P.model.members.map((m) => m.group).filter(Boolean))];
    const head = card('ข้อมูลรายการ: ' + (it.label || it.id));
    head.appendChild(h('div', { class: 'grid-form' },
      field('ชื่อรายการ', it, 'label', { maxlength: 100 }),
      field('ชนิดการออกแบบ', it, 'type', { options: Object.keys(DESIGN_TYPES).map((k) => ({ v: k, t: DESIGN_TYPES[k].label })), onChange: () => { it.inputs = defaultInputs(it); inval(); } }),
      t.member ? field('กลุ่มองค์อาคาร', it, 'group', { options: groups, onChange: () => { it.inputs = defaultInputs(it); inval(); } }) : null,
      t.node ? field('โหนดจุดรองรับ', it, 'node', { options: P.model.supports.map((s) => s.node), onChange: inval }) : null));
    if (t.member) head.appendChild(h('div', { class: 'muted small', text: `สมาชิกในกลุ่ม: ${groupMembers(it.group).map((m) => m.id).join(', ')} | ความยาวสูงสุด ${fmt(groupMaxLen(it.group), 2)} m` }));
    if (t.node) head.appendChild(note('แกนฐานราก (ตรงกับ header ของ engine/rc.js): B ขนานแกน X ของโมเดล, L ขนานแกน Y; c1 = ขนาดเสาตามแนว B, c2 = ตามแนว L; M_service = โมเมนต์รอบแกน X ที่ทำให้เกิดความเยื้องศูนย์ตามแนว L (บวกค่า H x ความหนาฐานราก), M_service_B = โมเมนต์รอบแกน Y'));
    if (t.node) { const c = columnAtNode(it.node); head.appendChild(h('div', { class: 'muted small', text: c ? `เสาที่โหนด ${it.node}: ${c.id} (c1 = h = ${c.c1} ซม. ตามแกน X/B, c2 = b = ${c.c2} ซม. ตามแกน Y/L)` : 'ไม่พบเสาในโมเดลที่โหนดนี้ - ใช้ขนาดเสาที่ป้อน' })); }
    host.appendChild(head);
    const cons = consistency(it);
    cons.forEach((m) => host.appendChild(note('ไม่สอดคล้องกับโมเดล (ทำให้ NG): ' + m, 'err')));
    const inCard = card('ข้อมูลหน้าตัดและเหล็กเสริม');
    const form = h('div', { class: 'grid-form' });
    t.fields().forEach(([k, label, opts]) => {
      if (opts === 'bool') form.appendChild(field(label, it.inputs, k, { type: 'checkbox', onChange: inval }));
      else if (Array.isArray(opts)) form.appendChild(field(label, it.inputs, k, { options: opts, num: typeof opts[0].v === 'number', onChange: inval }));
      else if (k === 'section') {
        const names = [...new Set(Object.keys(P.model.sections).concat(steelLib().slice(0, 500).map((r) => r.name || r.id)))];
        form.appendChild(field(label, it.inputs, k, { options: names, onChange: inval }));
      } else form.appendChild(field(label, it.inputs, k, typeof it.inputs[k] === 'string' ? { onChange: inval } : { type: 'number', onChange: inval }));
    });
    inCard.appendChild(form);
    host.appendChild(inCard);
    const fc = card('แรงออกแบบจากผลวิเคราะห์ (envelope ต่อกลุ่ม combination)');
    if (it.type === 'rcSlab') fc.appendChild(note('พื้นป้อนข้อมูลเอง - ไม่ต้องใช้ผลวิเคราะห์โครงสร้าง'));
    else if (S.results) {
      let dg; try { dg = designGroups(it); } catch (e) { dg = { error: e.message, G: [], notes: [] }; }
      if (dg.error) fc.appendChild(note(dg.error, 'warn'));
      else {
        (dg.notes || []).forEach((n) => fc.appendChild(note(n, 'warn')));
        dg.G.forEach((g) => {
          fc.appendChild(h('div', { class: 'muted small', text: `${groupLabel(g)}${g.ids.length ? ' - ' + g.ids.length + ' combination' : ''}` }));
          const rows = Object.keys(FORCE_LABEL).filter((k) => g.f[k] !== undefined).map((k) => ({ k: FORCE_LABEL[k], v: g.f[k], c: g.gov[k] || '' }));
          if (rows.length) fc.appendChild(roTable([{ label: 'แรง', get: (r) => r.k }, { label: 'ค่า', get: (r) => r.v, num: true, dec: 1 }, { label: 'combination ที่ควบคุม', get: (r) => r.c }], rows));
        });
      }
    } else fc.appendChild(note('ยังไม่มีผลวิเคราะห์'));
    host.appendChild(fc);
    host.appendChild(h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'คำนวณรายการนี้', onclick: () => withBusy('กำลังออกแบบ...', () => { try { runItem(it); S.designErr = null; } catch (e) { S.designErr = e.message; toast(e.message, true); } renderTab('design'); }) })));
    if (S.designErr) { host.appendChild(note(S.designErr, 'err')); S.designErr = null; }
    const o = P.design.out[it.id];
    if (o) {
      if (recordStale(it)) host.appendChild(note('ผลออกแบบนี้ไม่เป็นปัจจุบัน (โมเดล/ข้อมูลออกแบบเปลี่ยนไป) - ต้องคำนวณใหม่', 'err'));
      host.appendChild(h('div', { class: 'muted small', text: `คำนวณเมื่อ ${new Date(o.at).toLocaleString('th-TH')} | ชุด ${SET_LABELS[o.set] || o.set} | QC ${o.qc ? 'มี' : 'ไม่มี'} | allowable increase ${o.allowIncrease ? '1.33' : 'ไม่ใช้'} | รหัสวิเคราะห์ ${o.analysisId}` }));
      (o.notes || []).forEach((n) => host.appendChild(note(n, 'warn')));
      if (Object.keys(o.govCombos || {}).length) host.appendChild(h('div', { class: 'muted small', text: 'combination ที่ควบคุม: ' + Object.keys(o.govCombos).map((k) => k + '=' + o.govCombos[k]).join(', ') }));
      const out = h('div');
      o.runs.forEach((r) => {
        const c = card(r.title + ' - D/C = ' + R_.fmtRatio(r.ratio));
        c.appendChild(h('div', { class: 'toolbar' }, badge(r.ok ? 'OK' : 'NG', r.ok ? 'ok' : 'ng'), r.governing ? h('span', { class: 'muted small', text: 'ควบคุมโดย: ' + r.governing }) : null));
        (r.hard || []).forEach((w) => c.appendChild(note('คำเตือนร้ายแรง (ทำให้ NG): ' + w, 'err')));
        (r.warnings || []).forEach((w) => c.appendChild(note(w, 'warn')));
        if (r.slabApprox) c.appendChild(note('ตารางสัมประสิทธิ์พื้นสองทางเป็นค่าประมาณ (verified:false) - ต้องตรวจสอบกับตารางต้นฉบับก่อนใช้งานจริง', 'err'));
        if (r.sized) c.appendChild(note('ขนาดที่โปรแกรมเสนอ: ' + JSON.stringify(r.sized)));
        c.appendChild(roTable([{ label: 'การตรวจสอบ', get: (x) => x.name }, { label: 'Demand', get: (x) => toNum(x.demand), num: true, dec: 2 }, { label: 'Capacity', get: (x) => toNum(x.capacity), num: true, dec: 2 }, { label: 'หน่วย', get: (x) => x.unit || '' },
          { label: 'D/C', get: (x) => ratioBar(toNum(x.ratio)) }, { label: 'ผล', get: (x) => badge(x.ok ? 'OK' : 'NG', x.ok ? 'ok' : 'ng') }, { label: 'อ้างอิง', get: (x) => x.clause || '' }], r.checks || []));
        if (r.pm && r.pm.length) { const d = h('div', { class: 'toolbar' }); d.innerHTML = R_.svgPM(r.pm, r.pmDemands || [], { title: 'P-M แกน x (φPn - φMn)' }) + (r.pmY && r.pmY.length ? R_.svgPM(r.pmY, r.pmYDemands || [], { title: 'P-M แกน y' }) : ''); c.appendChild(h('h4', { text: 'P-M interaction (จุดสีคือแรงออกแบบ)' })); c.appendChild(d); }
        c.appendChild(h('h4', { text: 'ขั้นตอนคำนวณ (สูตร -> แทนค่า -> ผลลัพธ์)' }));
        const sv = stepsView(r.steps); if (sv) c.appendChild(sv); else c.appendChild(note('engine ไม่ส่ง steps'));
        out.appendChild(c);
      });
      host.appendChild(out);
    }
  }
  function ratioBar(r) {
    const cls = r > 1 ? 'ng' : r > 0.9 ? 'near' : '';
    const bar = h('div', { class: 'ratio-bar ' + cls, title: 'D/C = ' + R_.fmtRatio(r) }, h('i'), h('b', { class: 'small', text: R_.fmtRatio(r) }));
    bar.firstChild.style.width = Math.min(100, Math.max(0, r * 100)) + '%';
    return bar;
  }

  /* =============================== Tab 7: Report =============================== */
  function reportCtx() {
    const pr = provinceRow(P.meta.province);
    return { results: S.results, drift: S.drift, eqErr: S.eqErr !== undefined ? S.eqErr.toExponential(2) : undefined, registry: effectiveRegistry(), today: todayISO(),
      fullForceTable: !!S.reportFull, stale: staleList(), staleDesignIds: P.design.items.filter(recordStale).map((i) => i.id), comboNotes: P.loads.comboNotes || [], provinceUnverified: !!(pr && pr.verified === false), analysisInfo: S.analysis };
  }
  RENDER.report = function (p) {
    const e = P.engineer;
    p.appendChild(h('h2', { text: 'รายการคำนวณ' }));
    const printBtn = h('button', { class: 'btn', type: 'button', text: 'พิมพ์ / บันทึกเป็น PDF', onclick: () => { refresh(); if (staleList().length) { toast('ผลลัพธ์ไม่เป็นปัจจุบัน - ต้องวิเคราะห์/ออกแบบใหม่ก่อนพิมพ์', true); return; } window.print(); } });
    p.appendChild(card('ข้อมูลวิศวกรผู้ออกแบบ (กรอกเอง - โปรแกรมไม่เติมให้)', h('div', { class: 'grid-form' },
      field('ชื่อ-สกุล วิศวกร', e, 'name', { maxlength: 120, onChange: refresh }), field('เลขที่ใบอนุญาต กว.', e, 'license', { maxlength: 40, onChange: refresh }),
      field('ระดับ', e, 'level', { options: [{ v: '', t: '- เลือก -' }, { v: 'associate', t: 'ภาคีวิศวกร' }, { v: 'ordinary', t: 'สามัญวิศวกร' }, { v: 'senior', t: 'วุฒิวิศวกร' }], onChange: refresh }),
      field('สาขา', e, 'discipline', { maxlength: 80, onChange: refresh }), field('วันที่ลงนาม', e, 'signDate', { type: 'date', onChange: refresh })),
      note('แนวทางระดับใบอนุญาต (เพื่อประกอบการพิจารณาเท่านั้น - ข้อบังคับสภาวิศวกร พ.ศ. 2566): ภาคี = อาคาร ≤ 4 ชั้น หรือความสูงต่อชั้น ≤ 5 ม. และไม่ใช่อาคารสาธารณะ; สามัญ/วุฒิ = ทุกงาน. ต้องตรวจสอบกับสภาวิศวกรก่อนใช้งานจริง', 'warn'),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'สร้าง/รีเฟรชรายงาน', onclick: refresh }), printBtn,
        h('span', { class: 'muted small', text: 'ในหน้าต่างพิมพ์เลือก "บันทึกเป็น PDF", กระดาษ A4, ปิด "ส่วนหัวและท้ายกระดาษ" ของเบราว์เซอร์' }))));
    const fullCb = h('input', { type: 'checkbox', checked: !!S.reportFull }); fullCb.addEventListener('change', () => { S.reportFull = fullCb.checked; refresh(); });
    p.appendChild(h('div', { class: 'toolbar' }, h('label', { class: 'field check' }, fullCb, h('span', { text: 'พิมพ์ตารางแรงสูงสุดของทุกองค์อาคาร (ค่าเริ่มต้น: สรุปเฉพาะองค์อาคารที่ควบคุมในแต่ละกลุ่ม)' }))));
    const staleHost = h('div'); p.appendChild(staleHost);
    if (!e.name || !e.license) p.appendChild(note('ยังไม่ได้กรอกชื่อ/เลขที่ใบอนุญาต - ช่องลงนามในรายงานจะเว้นว่างไว้ให้เซ็น', 'warn'));
    const root = h('div', { id: 'report-root' }); p.appendChild(root);
    function refresh() {
      const sl = staleList();
      clear(staleHost); printBtn.disabled = sl.length > 0;
      if (sl.length) staleHost.appendChild(note('ผลลัพธ์ไม่เป็นปัจจุบัน — ต้องวิเคราะห์/ออกแบบใหม่ (ปุ่มพิมพ์ถูกปิด และรายงานมีตราแดงทุกหน้า): ' + sl.join('; '), 'err'));
      try {
        root.innerHTML = R_.build(P, reportCtx()); // all dynamic strings are escaped inside report.js (raw HTML only via internal Raw wrapper)
      } catch (err) { console.error(err); clear(root); root.appendChild(note('สร้างรายงานไม่สำเร็จ: ' + err.message, 'err')); }
    }
    refresh();
  };

  /* =============================== Init =============================== */
  function init() {
    loadSaved();
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#btn-new').addEventListener('click', () => { if (!confirm('เริ่มโครงการใหม่? ข้อมูลปัจจุบันในเบราว์เซอร์จะถูกแทนที่ (ควรส่งออก JSON ก่อน)')) return; P = defaultProject(); S.results = null; S.analysis = null; S.error = null; S.drift = []; S.selMember = null; clearStale(); save(); renderAll(); });
    $('#btn-export').addEventListener('click', () => downloadJSON(P, ((P.meta.name || 'project').replace(/[^\w฀-๿-]+/g, '_')) + '.sdproj.json'));
    $('#btn-import').addEventListener('click', () => $('#file-import').click());
    $('#file-import').addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) importFile(f, false); ev.target.value = ''; });
    window.addEventListener('beforeunload', flushSave);
    updateEngineStatus();
    if (!P.loads.combos.length && SD().loads && SD().loads.combos) regenCombos(); else ensureBothMethods();
    if (S.loadWarn) toast(S.loadWarn, true);
    showTab('project');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.SDApp = { get project() { return P; }, get state() { return S; }, buildEngineModel, runAnalysis, normalizeProject };

})();
