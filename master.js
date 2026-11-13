/* TEAM·CM BIM Dashboard — status model, master data, derived dates, issue progress,
   clash-rule matrix, backup/save-failure helpers. Loaded before app.js; everything
   here is called at runtime, after app.js has defined state / PROJECTS / getIss(). */

// ===== Status model =====
// The five core statuses drive the app's logic (open/closed, auto-delay), so they are
// locked in Master Data; admins can add extra statuses, which count as "still open".
const STATUS_CORE   = ['NEW', 'ACTIVE', 'ACTIVE DELAY', 'RESOLVED', 'APPROVED'];
const STATUS_CLOSED = ['RESOLVED', 'APPROVED'];
const STATUS_NUM    = { 'NEW': '01', 'ACTIVE': '02', 'ACTIVE DELAY': '03', 'RESOLVED': '04', 'APPROVED': '05' };
function statusLabel(s) { return STATUS_NUM[s] ? STATUS_NUM[s] + '_' + s : s; }
function isClosed(s) { return STATUS_CLOSED.includes(s); }

// ===== Master data (editable by Admin, stored in Firebase `master_data`) =====
const MASTER_DEFAULTS = {
  discipline: ['AR', 'FA', 'ST', 'LA', 'MEP', 'IN', 'CM', 'OWNER'],
  assignee:   ['AR', 'FA', 'ST', 'LA', 'MEP', 'IN', 'CM', 'OWNER'],
  priority:   ['Major', 'Minor'],
  status:     [...STATUS_CORE],
  cause: [
    'Design conflict (แบบขัดแย้งกัน)',
    'Missing information (ข้อมูลไม่ครบ)',
    'Design change (เปลี่ยนแบบ)',
    'Site condition (หน้างานไม่ตรงแบบ)',
    'Model error (โมเดลผิดพลาด)',
    'Clearance / space (ระยะหรือพื้นที่ไม่พอ)'
  ]
};
const MASTER = JSON.parse(JSON.stringify(MASTER_DEFAULTS));

function applyMasterFromCloud(data) {
  Object.keys(MASTER_DEFAULTS).forEach(k => {
    let v = data && data[k];
    if (v && !Array.isArray(v)) v = Object.values(v);   // RTDB may hand back an object for sparse arrays
    v = Array.isArray(v) ? v.filter(Boolean) : [];
    MASTER[k] = v.length ? v : [...MASTER_DEFAULTS[k]];
  });
  const extras = MASTER.status.filter(s => !STATUS_CORE.includes(s));
  MASTER.status = [...STATUS_CORE, ...extras];
}
const statusList   = () => MASTER.status;
const priorityList = () => MASTER.priority;
const causeList    = () => MASTER.cause;
const assigneeList = () => MASTER.assignee;

// Older imports used finer-grained / differently named codes. The stored data is left
// untouched; they are folded into the main disciplines wherever they are displayed,
// filtered, counted or reported.
const DISC_ALIAS = { EE: 'MEP', AC: 'MEP', SN: 'MEP', FP: 'MEP', FACADE: 'FA', PMC: 'CM', MG: 'CM' };
function mainDisc(code) {
  const c = String(code || '').trim().toUpperCase();
  return DISC_ALIAS[c] || c;
}
/** Discipline codes for a filter dropdown: the master list plus any other code actually present. */
function discFilterCodes() {
  const out = [...MASTER.discipline];
  getIss().forEach(it => discArray(it.disc).forEach(d => { if (!out.includes(d)) out.push(d); }));
  return out;
}

// ===== Dates =====
const pad2 = (n) => String(n).padStart(2, '0');
function localISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function todayISO() { return localISO(new Date()); }
function isoToDMY(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
/** Start date = the day the issue was added to the system. */
function startISO(it) {
  if (!it.createdAt) return '';
  const d = new Date(it.createdAt);
  return isNaN(d) ? '' : localISO(d);
}
function zoneFreeze(proj, zone) {
  const z = ((proj && proj.zones) || []).find(x => x.name === zone);
  return (z && z.freezeDate) || '';
}
/** Due date = the issue's own override, else the model-freeze date planned for its zone. */
function dueISO(it, proj) {
  return it.dueDate || zoneFreeze(proj || PROJECTS[state.projIdx], it.zone) || '';
}
function ageDays(it) {
  const base = it._base !== undefined ? it._base : it.status;
  if (isClosed(base) || !it.createdAt) return it.daysOpen || 0;
  const d = new Date(it.createdAt);
  if (isNaN(d)) return it.daysOpen || 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 864e5));
}

// ===== Auto "ACTIVE DELAY" =====
// `_base` holds the status that is actually stored; `status` is what the UI sees. An open
// issue past its due date is shown as ACTIVE DELAY without writing anything — extend the
// zone's freeze date and it goes back automatically.
function applyAutoDelay(issues, proj) {
  const today = todayISO();
  issues.forEach(it => {
    if (it._base === undefined) it._base = it.status;
    const due = dueISO(it, proj);
    const base = it._base;
    it.status = (due && due < today && !isClosed(base) && base !== 'ACTIVE DELAY') ? 'ACTIVE DELAY' : base;
  });
}
function reapplyAutoDelay() {
  const iss = PROJECT_ISSUES[state.projIdx];
  if (iss) applyAutoDelay(iss, PROJECTS[state.projIdx]);
}
function setIssueStatus(it, val) {
  it._base = val;
  it.status = val;
  applyAutoDelay([it], PROJECTS[state.projIdx]);
}
/** Normalise freshly loaded issues (legacy values) and compute the derived status. */
function prepareIssues(issues, projIdx) {
  issues.forEach(it => {
    if (it.priority === 'Critical') it.priority = 'Major';
    // `_base` survives a re-run (so a derived ACTIVE DELAY is never mistaken for the stored status);
    // objects fresh from the database or a CSV import don't have one yet.
    const raw = it._base !== undefined ? it._base : it.status;
    it._base = (!raw || raw === 'Unknown') ? 'NEW' : raw;
    it.status = it._base;
  });
  applyAutoDelay(issues, PROJECTS[projIdx]);
  return issues;
}

// ===== Issue Progress (real data) =====
function _dayNum(d) { return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 864e5); }
function _closedDay(it) {
  const base = it._base !== undefined ? it._base : it.status;
  if (!isClosed(base)) return null;
  const c = new Date(it.createdAt);
  if (isNaN(c)) return null;
  if (it.resolvedAt) {
    const r = new Date(it.resolvedAt);
    if (!isNaN(r)) return Math.max(_dayNum(r), _dayNum(c));
  }
  return _dayNum(c) + (it.daysOpen || 0);
}
/**
 * Points from the first issue to today, bucketed so there are at most ~36 points.
 * opened   = issues added during the bucket
 * resolved = issues closed (RESOLVED/APPROVED) during the bucket
 * openTotal = issues still open at the end of the bucket
 */
function buildProgress(issues) {
  const rows = issues
    .map(it => ({ c: new Date(it.createdAt), x: _closedDay(it) }))
    .filter(r => !isNaN(r.c))
    .map(r => ({ c: _dayNum(r.c), x: r.x }));
  if (!rows.length) return [];
  const today = _dayNum(new Date());
  const first = Math.min(...rows.map(r => r.c));
  const span = Math.max(1, today - first);
  const step = Math.max(1, Math.ceil(span / 36));
  const edges = [];
  for (let e = first; e < today; e += step) edges.push(e);
  edges.push(today);
  if (edges.length < 2) edges.unshift(first - 1);
  const out = [];
  edges.forEach((edge, k) => {
    const prev = k === 0 ? edge - 1 : edges[k - 1];
    const dt = new Date(edge * 864e5 + new Date().getTimezoneOffset() * 60000);
    out.push({
      label: step >= 28 ? `${pad2(dt.getMonth() + 1)}/${String(dt.getFullYear()).slice(2)}` : `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}`,
      opened: rows.filter(r => r.c > prev && r.c <= edge).length,
      resolved: rows.filter(r => r.x !== null && r.x > prev && r.x <= edge).length,
      openTotal: rows.filter(r => r.c <= edge && !(r.x !== null && r.x <= edge)).length
    });
  });
  return out;
}

// ===== Save-failure feedback =====
// Writes used to be fire-and-forget with the error swallowed, so a rejected save looked
// like it worked until the next refresh. Use as: promise.catch(saveFail('issue')).
let _saveFailLast = 0;
function saveFail(label) {
  return (e) => {
    console.warn('Save failed:', label, e);
    const raw = (e && e.message) || String(e);
    const msg = /permission|PERMISSION_DENIED/i.test(raw + ' ' + ((e && e.code) || ''))
      ? 'ไม่มีสิทธิ์เขียนข้อมูล (ระบบปฏิเสธ)'
      : raw;
    const now = Date.now();
    if (now - _saveFailLast > 2500) toast(`❌ บันทึก${label ? ' ' + label : ''}ไม่สำเร็จ — ${msg}`, '#dc2626', 5000);
    _saveFailLast = now;
  };
}

// ===== Master Data page (Admin) =====
function renderMaster() {
  if (!hasPermission('users')) {
    return `<div class="page"><div class="card" style="padding:50px;text-align:center;color:var(--muted)">หน้านี้สำหรับ Admin เท่านั้น</div></div>`;
  }
  const proj = PROJECTS[state.projIdx];
  const kinds = [
    { key: 'discipline', title: 'Discipline (สาขางาน)', hint: 'ตัวเลือกตอนสร้าง/แก้ issue, ตัวกรอง และรายงาน' },
    { key: 'assignee',   title: 'Assignee (ผู้รับผิดชอบ)', hint: 'ตัวเลือกผู้รับผิดชอบใน issue' },
    { key: 'priority',   title: 'Priority', hint: 'ระดับความสำคัญ' },
    { key: 'status',     title: 'Status', hint: 'สถานะหลัก 5 ตัวล็อกไว้เพราะระบบใช้คำนวณ (ปิดงาน / เกินกำหนด) — เพิ่มสถานะเสริมได้ และจะนับเป็น "ยังเปิดอยู่"', locked: STATUS_CORE },
    { key: 'cause',      title: 'สาเหตุการเกิด Issue', hint: 'ตัวเลือกสาเหตุ — แก้ไขได้ตามที่ทีมใช้จริง' }
  ];
  const chip = (kind, v, i, locked) => `<span class="mchip">${esc(kind === 'status' ? statusLabel(v) : v)}${
    locked ? '<span class="mlock" title="ล็อกไว้">🔒</span>' : `<span class="mx" title="ลบ" onclick="masterRemove('${kind}',${i})">×</span>`}</span>`;
  const zones = proj.zones || [];
  return `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Master Data</h1>
        <div class="page-sub">เพิ่ม-ลดข้อมูลหลังบ้านเอง · การลบตัวเลือกไม่ลบข้อมูลที่ issue เดิมใช้อยู่</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px;margin-bottom:14px">
      ${kinds.map(k => `<div class="card">
        <div class="card-h"><div><h3>${k.title}</h3><div class="ch-sub">${k.hint}</div></div></div>
        <div class="card-b">
          <div class="mchips">${MASTER[k.key].map((v, i) => chip(k.key, v, i, k.locked && k.locked.includes(v))).join('')}</div>
          <div style="display:flex;gap:6px;margin-top:12px">
            <input type="text" id="mi-${k.key}" class="m-input" placeholder="เพิ่มรายการใหม่…" onkeydown="if(event.key==='Enter')masterAdd('${k.key}')" />
            <button class="btn btn-g btn-sm" onclick="masterAdd('${k.key}')">${I.plus}<span>Add</span></button>
          </div>
        </div>
      </div>`).join('')}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><div>
        <h3>Zone &amp; Freeze date · ${esc(proj.name)}</h3>
        <div class="ch-sub">แต่ละโปรเจกต์มี Zone ของตัวเอง · Freeze date = วันที่ต้อง freeze model ตามแผนงานของโซนนั้น (ใช้เป็น Due date ของ issue) — เกินแล้วสถานะจะเป็น ACTIVE DELAY</div>
      </div>
      <button class="btn btn-g btn-sm" onclick="zonesImportFromIssues()">${I.download}<span>ดึง Zone จากข้อมูล issue</span></button></div>
      <div class="card-b">
        ${zones.length === 0 ? '<div style="color:var(--muted);font-size:13px;padding:6px 0 12px">ยังไม่ได้ตั้ง Zone — กด "ดึง Zone จากข้อมูล issue" หรือเพิ่มด้านล่าง</div>' : `
        <div class="zone-grid zone-head"><div>Zone</div><div>Freeze date (Due)</div><div></div></div>
        ${zones.map((z, i) => `<div class="zone-grid">
          <div class="mono" style="font-size:12.5px">${esc(z.name)}</div>
          <div><input type="date" class="m-input" value="${esc(z.freezeDate || '')}" onchange="zoneSetDate(${i}, this.value)" /></div>
          <div><button class="t-row-btn" title="ลบ Zone" onclick="zoneRemove(${i})">${I.trash}</button></div>
        </div>`).join('')}`}
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
          <input type="text" id="mi-zone-name" class="m-input" style="flex:1;min-width:220px" placeholder="ชื่อ Zone ใหม่…" onkeydown="if(event.key==='Enter')zoneAdd()" />
          <input type="date" id="mi-zone-date" class="m-input" />
          <button class="btn btn-g btn-sm" onclick="zoneAdd()">${I.plus}<span>Add Zone</span></button>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-h"><div><h3>ซิงก์สิทธิ์ผู้ใช้ไปยังกฎความปลอดภัย</h3><div class="ch-sub">ใช้หลัง publish Realtime Database Rules ชุด Rev D (ดู RTDB_RULES.md) — คัดลอก role และ project ของผู้ใช้แต่ละคนไปยังที่ที่กฎอ่านได้ (ไม่รวม Admin) · เปิดใช้แล้วระบบจะซิงก์ให้อัตโนมัติทุกครั้งที่ Admin เปิดแอปหรือรายชื่อผู้ใช้เปลี่ยน ${_accessSyncOn() ? '<strong style="color:var(--green-2)">(เปิดใช้อยู่)</strong>' : ''}</div></div>
        <button class="btn btn-g" onclick="syncAccessNow()">${I.check2}<span>Sync สิทธิ์ตอนนี้</span></button></div>
    </div>

    <div class="card">
      <div class="card-h"><div><h3>สำรองข้อมูล (Backup)</h3><div class="ch-sub">ดาวน์โหลดข้อมูลทั้งระบบเป็นไฟล์ JSON — projects, users, issues, audit, library, master data · ควรทำเป็นระยะ เพราะฐานข้อมูลแพ็กเกจฟรีไม่มี backup อัตโนมัติ</div></div>
        <button class="btn btn-n" onclick="exportBackup()">${I.download}<span>Export Backup (JSON)</span></button></div>
    </div>
  </div>`;
}
function _saveMaster() { fbSaveMaster(MASTER).catch(saveFail('Master Data')); }
function masterAdd(kind) {
  if (!requirePermission('users', 'แก้ Master Data')) return;
  const el = $('#mi-' + kind);
  const v = el ? el.value.trim() : '';
  if (!v) return;
  if (MASTER[kind].some(x => x.toLowerCase() === v.toLowerCase())) { toast('⚠️ มีรายการนี้อยู่แล้ว', '#d97706'); return; }
  MASTER[kind].push(kind === 'discipline' || kind === 'assignee' ? v.toUpperCase() : v);
  _saveMaster();
  render();
}
function masterRemove(kind, idx) {
  if (!requirePermission('users', 'แก้ Master Data')) return;
  const v = MASTER[kind][idx];
  if (kind === 'status' && STATUS_CORE.includes(v)) return;
  if (MASTER[kind].length <= 1) { toast('⚠️ ต้องเหลืออย่างน้อย 1 รายการ', '#d97706'); return; }
  if (!confirm(`ลบ "${v}" ออกจากตัวเลือก?\n(issue ที่ใช้ค่านี้อยู่ยังคงแสดงค่าเดิม)`)) return;
  MASTER[kind].splice(idx, 1);
  _saveMaster();
  render();
}
function _saveZones() {
  fbSaveProjects(PROJECTS).catch(saveFail('Zone'));
  reapplyAutoDelay();
  render();
}
function zoneAdd() {
  if (!requirePermission('users', 'แก้ Zone')) return;
  const name = ($('#mi-zone-name').value || '').trim();
  if (!name) return;
  const proj = PROJECTS[state.projIdx];
  proj.zones = proj.zones || [];
  if (proj.zones.some(z => z.name === name)) { toast('⚠️ มี Zone นี้อยู่แล้ว', '#d97706'); return; }
  proj.zones.push({ name, freezeDate: $('#mi-zone-date').value || '' });
  _saveZones();
}
function zoneSetDate(i, v) {
  if (!requirePermission('users', 'แก้ Zone')) return;
  // Typing a date by keyboard fires `change` as soon as the year is *any* valid number (0002…),
  // and re-rendering the page then destroys the input mid-typing. So: ignore half-typed years,
  // and don't re-render — just save, re-derive ACTIVE DELAY and confirm with a toast.
  if (v && !/^20\d{2}-\d{2}-\d{2}$/.test(v)) return;
  const z = PROJECTS[state.projIdx].zones[i];
  z.freezeDate = v || '';
  fbSaveProjects(PROJECTS)
    .then(() => toast(`✓ บันทึก Freeze date ของ "${z.name}" แล้ว${v ? ' · ' + isoToDMY(v) : ' (ล้างวันที่)'}`, '#2DBE60'))
    .catch(saveFail('Freeze date'));
  reapplyAutoDelay();
}
function zoneRemove(i) {
  if (!requirePermission('users', 'แก้ Zone')) return;
  const z = PROJECTS[state.projIdx].zones[i];
  if (!confirm(`ลบ Zone "${z.name}" ออกจากรายการ?\n(issue ที่อยู่ใน Zone นี้ยังคงอยู่ แต่จะไม่มี Freeze date)`)) return;
  PROJECTS[state.projIdx].zones.splice(i, 1);
  _saveZones();
}
function zonesImportFromIssues() {
  if (!requirePermission('users', 'แก้ Zone')) return;
  const proj = PROJECTS[state.projIdx];
  proj.zones = proj.zones || [];
  const have = new Set(proj.zones.map(z => z.name));
  let added = 0;
  [...new Set(getIss().map(i => i.zone).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .forEach(name => { if (!have.has(name)) { proj.zones.push({ name, freezeDate: '' }); added++; } });
  toast(added ? `✓ เพิ่ม ${added} Zone จากข้อมูล issue` : 'ไม่มี Zone ใหม่ให้ดึง', added ? '#2DBE60' : '#d97706');
  if (added) _saveZones();
}
// Access mirrors (role_access / client_access) are what the Security Rules actually check.
// They're only auto-synced after an Admin has opted in, i.e. after the matching rules are live.
let _accessSig = '';
function _accessSyncOn() { try { return localStorage.getItem('tcm_access_sync') === '1'; } catch (e) { return false; } }
function reconcileAccessIfEnabled() {
  if (!hasPermission('users') || !_accessSyncOn()) return;
  const sig = JSON.stringify(USERS.filter(u => u.uid).map(u => [u.uid, u.role, u.projectCode || '']));
  if (sig === _accessSig) return;
  _accessSig = sig;
  fbReconcileAccess(USERS).catch(saveFail('สิทธิ์ผู้ใช้'));
}
function syncAccessNow() {
  if (!requirePermission('users', 'ซิงก์สิทธิ์')) return;
  try { localStorage.setItem('tcm_access_sync', '1'); } catch (e) {}
  _accessSig = '';
  reconcileAccessIfEnabled();
  toast('✓ ซิงก์สิทธิ์ผู้ใช้แล้ว (และจะซิงก์อัตโนมัติต่อไป)', '#2DBE60');
  render();
}
async function exportBackup() {
  if (!requirePermission('users', 'สำรองข้อมูล')) return;
  toast('⏳ กำลังรวบรวมข้อมูลทั้งระบบ…', '#3A6EA5', 8000);
  try {
    const data = await fbLoadBackupData(PROJECTS);
    downloadFile(`TEAMCM_backup_${todayISO().replace(/-/g, '')}.json`, JSON.stringify(data), 'application/json');
    toast('✓ ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว', '#2DBE60');
  } catch (e) {
    saveFail('การสำรองข้อมูล')(e);
  }
}

// ===== Clash-rule matrix (tolerances between discipline elements) =====
// Transcribed from the BIMTracks comment sheet. Cell = [text, type]: 'H' hard clash (green),
// 'C' clearance clash (orange); the number is the tolerance in centimetres.
const CLASH_AR = ['Exterior door&window', 'Precast Façade (If any)', 'Architectural wall', 'Ceiling', 'Railing', 'Stair', 'All'];
const CLASH_IN = ['Interior door', 'Ceiling', 'Finish floor', 'Switch&Plug', 'AC equipment', 'Lighting Fixture', 'Plumbing Fixture'];
const CLASH_ST = ['Foundation&Pile', 'Column', 'Framing', 'Structural Floor', 'Structural wall', 'All'];
const CLASH_EE = ['Wireway', 'Earthing', 'BusDuct', 'Equipment and Fixture', 'Trench'];
const CLASH_SN = ['SN pipe and equipment', 'Site Drainage', 'Underground water tank'];
const CLASH_COL_GROUPS = [
  { g: 'AR', items: CLASH_AR }, { g: 'IN', items: CLASH_IN }, { g: 'STR', items: CLASH_ST },
  { g: 'MEP', sub: 'AC', items: ['AC Duct and equipment'] }, { g: 'MEP', sub: 'EE', items: CLASH_EE },
  { g: 'MEP', sub: 'FP', items: ['ALL FP pipe and Fixture'] }, { g: 'MEP', sub: 'SN', items: CLASH_SN },
  { g: 'LAN', items: ['Hardscape'] }
];
const CLASH_ROW_GROUPS = [
  { g: 'AR', items: CLASH_AR }, { g: 'IN', items: CLASH_IN }, { g: 'STR', items: CLASH_ST },
  { g: 'MEP', sub: 'AC', items: ['ALL HVAC'] }, { g: 'MEP', sub: 'EE', items: CLASH_EE },
  { g: 'MEP', sub: 'FP', items: ['ALL FP pipe and Fixture'] }, { g: 'MEP', sub: 'SN', items: CLASH_SN },
  { g: 'LAN', items: ['Hardscape'] }
];
const CLASH_CELLS = (function () {
  const m = {};
  const put = (r, c, text, type) => { m[r + ',' + c] = [text, type]; };
  put(1, 20, '1', 'H');
  put(2, 20, '?', 'C');
  [[17, '5*'], [18, '?*'], [22, '5*'], [24, '5*']].forEach(([c, t]) => put(4, c, t, 'C'));
  [[21, '1**'], [25, '1'], [26, '1'], [27, '1**'], [28, '1**'], [29, '1']].forEach(([c, t]) => put(7, c, t, 'H'));
  put(8, 20, '1', 'H');
  [17, 18, 21, 22, 24, 27, 28].forEach(c => put(9, c, c === 18 ? '?*' : '5*', 'C'));
  put(10, 14, '1', 'H'); put(10, 18, '1', 'H');
  put(11, 16, '0', 'H'); put(11, 19, '0', 'H');
  put(13, 19, '0', 'H'); put(13, 21, '1', 'H'); put(13, 27, '1', 'H'); put(13, 28, '1', 'H');
  [23, 26, 30, 31].forEach(c => put(15, c, '1', 'H'));
  [21, 22, 24, 25, 27, 28, 29].forEach(c => put(20, c, '1', 'H'));
  for (let c = 22; c <= 30; c++) put(21, c, '1', 'C');
  [22, 23, 24, 25].forEach(r => { put(r, 27, '1', 'C'); put(r, 28, '1', 'C'); });
  put(26, 31, '1', 'H');
  [28, 29, 30].forEach(c => put(27, c, '1', 'C')); put(27, 31, '1', 'H');
  put(28, 31, '1', 'H'); put(29, 31, '1', 'H');
  return m;
})();

function renderClashRules() {
  const nCols = CLASH_COL_GROUPS.reduce((s, g) => s + g.items.length, 0);
  const mepCols = CLASH_COL_GROUPS.filter(g => g.g === 'MEP').reduce((s, g) => s + g.items.length, 0);
  // header: group row (non-MEP groups span the sub row too), MEP sub-group row, rotated item labels
  let head1 = '<th colspan="3" rowspan="3" class="corner"></th>';
  let head2 = '';
  let head3 = '';
  let mepDone = false;
  CLASH_COL_GROUPS.forEach(g => {
    if (g.g === 'MEP') {
      if (!mepDone) { head1 += `<th colspan="${mepCols}" class="grp">MEP</th>`; mepDone = true; }
      head2 += `<th colspan="${g.items.length}" class="grp sub">${g.sub}</th>`;
    } else {
      head1 += `<th colspan="${g.items.length}" rowspan="2" class="grp">${g.g}</th>`;
    }
    g.items.forEach(l => { head3 += `<th class="vh">${esc(l)}</th>`; });
  });
  let body = '';
  let r = 0;
  CLASH_ROW_GROUPS.forEach(g => {
    const groupSize = g.items.length;
    // group cell is emitted on the first row of the whole group (MEP spans its sub-blocks)
    const rowsInGroup = g.g === 'MEP'
      ? CLASH_ROW_GROUPS.filter(x => x.g === 'MEP').reduce((s, x) => s + x.items.length, 0)
      : groupSize;
    const isFirstOfGroup = g.g !== 'MEP' || g.sub === 'AC';
    g.items.forEach((label, i) => {
      r++;
      let cells = '';
      if (i === 0 && isFirstOfGroup) cells += `<th rowspan="${rowsInGroup}" colspan="${g.g === 'MEP' ? 1 : 2}" class="grp">${g.g}</th>`;
      if (g.g === 'MEP' && i === 0) cells += `<th rowspan="${groupSize}" class="grp sub">${g.sub}</th>`;
      cells += `<th class="rl">${esc(label)}</th>`;
      for (let c = 1; c <= nCols; c++) {
        if (c <= r) { cells += '<td class="x"></td>'; continue; }
        const hit = CLASH_CELLS[r + ',' + c];
        cells += hit ? `<td class="${hit[1] === 'H' ? 'h' : 'c'}">${esc(hit[0])}</td>` : '<td></td>';
      }
      body += `<tr>${cells}</tr>`;
    });
  });
  return `<div class="clash-legend">
      <span><i class="lg-c"></i> Clearance Clash</span>
      <span><i class="lg-h"></i> Hard Clash</span>
      <span class="muted">ตัวเลขในช่องคือค่า tolerance หน่วยเซนติเมตร</span>
    </div>
    <div class="clash-wrap"><table class="clash-tbl">
      <thead><tr>${head1}</tr><tr>${head2}</tr><tr>${head3}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}
