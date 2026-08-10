/* TEAMCM BIM Dashboard — app */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ===== Global state =====
const state = {
  page: 'dashboard',
  projIdx: 0,
  filters: { status:'all', disc:'all', prio:'all', zone:'all', q:'' },
  selected: new Set(),
  pageNum: 1,
  pageSize: 12,
  sortBy: 'no',
  sortDir: 'desc',
  user: USERS[0],
  theme: localStorage.getItem('tcm_theme') || 'light',
  imgStore: (function(){ try { return JSON.parse(localStorage.getItem('tcm_imgs') || '{}'); } catch(e){ return {}; } })(),
  notifications: [],
  reportOpts: { disciplines: [], sections: ['cover','exec','charts','heatmap','cards'], filter:'all' }
};

// ===== Project-scoped data accessors =====
// Projects a Client Reviewer may see (their one assigned project); everyone else sees all.
function getVisibleProjects() {
  if (!state.user || !state.user.projectCode) return PROJECTS.map((p, i) => ({ p, i }));
  return PROJECTS
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.code === state.user.projectCode);
}
function getIss() { return PROJECT_ISSUES[state.projIdx] || PROJECT_ISSUES[0]; }
function getAud() { return PROJECT_AUDIT[state.projIdx] || PROJECT_AUDIT[0]; }
function imgKey(no) { return `p${state.projIdx}_${no}`; }
function getImg(no) { return state.imgStore[imgKey(no)] || state.imgStore[no]; /* fallback for legacy keys */ }
function setImg(no, data) { state.imgStore[imgKey(no)] = data; }
function delImg(no) { delete state.imgStore[imgKey(no)]; delete state.imgStore[no]; }

// ===== Icons (lucide-style) =====
const I = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  issues:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h6"/></svg>',
  clashes:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9v6m-4-3h8"/><circle cx="12" cy="12" r="10"/></svg>',
  report:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 6-6"/></svg>',
  projects:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  users:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  audit:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  ai:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></svg>',
  bell:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  download:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  upload:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  plus:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  chevDown:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  chevLeft:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  search:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  filter:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></svg>',
  trendUp:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 7 17 17 7 17"/><polyline points="17 17 7 7"/></svg>',
  trendDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 7 7 17 17 17"/><polyline points="7 7 17 17"/></svg>',
  close:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  more:      '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>',
  edit:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  create:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  comment:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  image:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  layers:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  sun:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  trash:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  check2:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
};

// Discipline color lookup
const DISC_COLOR = { AC:'#0ea5e9', EE:'#f59e0b', AR:'#8b5cf6', SN:'#06b6d4', FP:'#ef4444', ST:'#64748b', LA:'#10b981', IN:'#ec4899', OWNER:'#4338ca' };
const STATUS_COLOR = { RESOLVED:'#2DBE60', ACTIVE:'#3A6EA5', NEW:'#9333ea', Unknown:'#94a3b8' };
const PRIO_COLOR = { Critical:'#dc2626', Major:'#ea7f00', Minor:'#6b7280' };

// ===== Helpers =====
function priBadge(p) { const cls = p==='Critical'?'b-critical':p==='Major'?'b-major':'b-minor'; return `<span class="badge ${cls}"><span class="dot"></span>${p}</span>`; }
function stBadge(s) { const cls = s==='RESOLVED'?'b-resolved':s==='ACTIVE'?'b-active':s==='NEW'?'b-new':'b-unknown'; return `<span class="badge ${cls}">${s}</span>`; }
function discBadge(d) { return `<span class="badge b-${d.toLowerCase()}">${d}</span>`; }
function discArray(s) { return String(s).split(',').map(d => d.trim()).filter(Boolean); }
function discBadges(s) { return `<div class="disc-list">${discArray(s).map(discBadge).join('')}</div>`; }

function toast(msg, color) {
  const t = $('#toast');
  t.textContent = msg;
  if (color) t.style.background = color; else t.style.background = '';
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=>t.classList.remove('show'), 2200);
}

// ===== Role-based permissions =====
// Returns true if current user's role can perform `action`.
// action ∈ 'create' | 'edit' | 'delete' | 'import' | 'report' | 'users'
function hasPermission(action) {
  const role = state.user && state.user.role;
  const perms = (typeof PERMISSIONS !== 'undefined' && PERMISSIONS[role]) || null;
  return !!(perms && perms[action]);
}
/** Guard wrapper — show toast and return false if user lacks permission. */
function requirePermission(action, label) {
  if (hasPermission(action)) return true;
  const role = (state.user && state.user.role) || '—';
  toast(`🚫 ไม่มีสิทธิ์${label ? ' ' + label : ''} (role: ${role})`, '#dc2626');
  return false;
}

// ===== Filtering =====
function getFiltered() {
  const f = state.filters;
  return getIss().filter(it => {
    if (f.status !== 'all' && it.status !== f.status) return false;
    if (f.disc !== 'all' && !discArray(it.disc).includes(f.disc)) return false;
    if (f.prio !== 'all' && it.priority !== f.prio) return false;
    if (f.zone !== 'all' && it.zone !== f.zone) return false;
    if (f.q) {
      const q = f.q.toLowerCase();
      if (!it.title.toLowerCase().includes(q) && !it.no.includes(q) && !it.disc.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ===== Charts =====
// Donut svg
function donut(items, total, opts={}) {
  const size = opts.size || 140;
  const r = opts.r || 52;
  const stroke = opts.stroke || 18;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map((it, i) => {
    const frac = total > 0 ? it.value / total : 0;
    const dash = c * frac;
    const seg = `<circle r="${r}" cx="${size/2}" cy="${size/2}" fill="none" stroke="${it.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${c-dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size/2} ${size/2})" stroke-linecap="butt"><title>${it.label}: ${it.value}</title></circle>`;
    offset += dash;
    return seg;
  }).join('');
  const bg = `<circle r="${r}" cx="${size/2}" cy="${size/2}" fill="none" stroke="#eef2f8" stroke-width="${stroke}"/>`;
  return `<div class="donut-wrap" style="width:${size}px;height:${size}px"><svg width="${size}" height="${size}">${bg}${segs}</svg><div class="donut-center"><div class="dc-num">${total}</div><div class="dc-lbl">${opts.centerLabel||'Total'}</div></div></div>`;
}

function donutLegend(items, total) {
  return items.map(it => {
    const pct = total > 0 ? Math.round(it.value/total*100) : 0;
    return `<div class="dl-row"><span class="dl-sw" style="background:${it.color}"></span><span class="dl-name">${esc(it.label)}</span><span class="dl-num mono">${it.value}</span><span class="dl-pct">${pct}%</span></div>`;
  }).join('');
}

function barChart(items) {
  const max = Math.max(...items.map(i => i.value), 1);
  return `<div class="bar-chart">${items.map(it => `
    <div class="bar-row">
      <span class="bar-lbl">${esc(it.label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(it.value/max*100).toFixed(1)}%;background:${it.color}">${it.value>=6?it.value:''}</div></div>
      <span class="bar-num">${it.value<6?it.value:''}</span>
    </div>`).join('')}</div>`;
}

// ===== Build pages =====
function tally(arr, key) {
  const m = {};
  arr.forEach(it => {
    const v = it[key];
    m[v] = (m[v]||0) + 1;
  });
  return m;
}
function tallyDisc(arr) {
  const m = {};
  arr.forEach(it => {
    discArray(it.disc).forEach(d => m[d] = (m[d]||0) + 1);
  });
  return m;
}

function renderSidebar() {
  const counts = {
    issues: getIss().length,
    new: getIss().filter(i => i.status==='NEW').length,
    active: getIss().filter(i => i.status==='ACTIVE').length
  };
  return `<aside class="sb">
    <div class="sb-brand">
      <div class="sb-logo">TCM</div>
      <div>
        <div class="sb-brand-name">TEAM·CM</div>
        <div class="sb-brand-sub">BIM Tracker</div>
      </div>
    </div>

    <div class="sb-sec">Overview</div>
    <div class="ni ${state.page==='dashboard'?'active':''}" data-page="dashboard">${I.dashboard}<span>Dashboard</span></div>

    <div class="sb-sec">Coordination</div>
    <div class="ni ${state.page==='issues'?'active':''}" data-page="issues">${I.issues}<span>Issues</span><span class="ni-count">${counts.issues}</span></div>
    <div class="ni ${state.page==='clashes'?'active':''}" data-page="clashes">${I.clashes}<span>Clashes</span></div>

    <div class="sb-sec">Reports</div>
    <div class="ni ${state.page==='report'?'active':''}" data-page="report">${I.report}<span>Publish Report</span></div>
    <div class="ni ${state.page==='analytics'?'active':''}" data-page="analytics">${I.analytics}<span>Analytics</span></div>

    <div class="sb-sec">Management</div>
    <div class="ni ${state.page==='projects'?'active':''}" data-page="projects">${I.projects}<span>Projects</span></div>
    ${hasPermission('users') ? `<div class="ni ${state.page==='users'?'active':''}" data-page="users">${I.users}<span>Users &amp; Roles</span></div>` : ''}
    ${state.user.role !== 'Client Reviewer' ? `<div class="ni ${state.page==='audit'?'active':''}" data-page="audit">${I.audit}<span>Audit Log</span></div>` : ''}

    <div class="sb-foot">
      <div><span class="status-dot"></span> Synced • Firebase</div>
      <div style="margin-top:4px;color:#5e7196">v4.3 • asia-southeast1</div>
    </div>
  </aside>`;
}

function renderHeader() {
  const proj = PROJECTS[state.projIdx];
  const pnames = { dashboard:'Dashboard', issues:'Issues', clashes:'Clashes', report:'Publish Report', analytics:'Analytics', projects:'Projects', users:'Users & Roles', audit:'Audit Log' };
  return `<header class="hdr">
    <div class="hdr-btn-wrap">
      <div class="proj-switch" id="proj-switch" onclick="toggleProjMenu(event)">
        <span class="proj-code">${esc(proj.code)}</span>
        <span class="proj-name">${esc(proj.name)}</span>
        ${I.chevDown}
      </div>
      <div id="proj-menu" class="notif-pop" style="width:340px;left:0;right:auto">
        <div class="notif-h">
          <h4>Switch Project</h4>
          <span class="nh-mark" onclick="closeModal();goPage('projects')">Manage →</span>
        </div>
        <div class="notif-list">
          ${getVisibleProjects().map(({p, i}) => {
            const count = (PROJECT_ISSUES[i] || []).length;
            const open = (PROJECT_ISSUES[i] || []).filter(x => x.status !== 'RESOLVED').length;
            const isCur = i === state.projIdx;
            return `<div class="notif-item ${isCur?'':'read'}" onclick="switchProject(${i})" style="cursor:pointer">
              <div style="width:34px;height:34px;border-radius:7px;background:${isCur?'var(--green)':'#3A6EA5'};color:#fff;display:grid;place-items:center;font-family:Montserrat;font-weight:700;font-size:11px;flex-shrink:0">${esc(p.code.slice(-2))}</div>
              <div class="ni-body">
                <div style="display:flex;align-items:center;gap:8px;font-weight:600">
                  ${esc(p.name)}
                  ${isCur?'<span class="badge b-resolved" style="font-size:9.5px">CURRENT</span>':''}
                </div>
                <div class="ni-time">${esc(p.code)} · ${esc(p.phase)} · ${count} issues · ${open} open</div>
              </div>
              ${isCur?`<span style="color:var(--green);width:20px;height:20px;display:grid;place-items:center;flex-shrink:0">${I.check2}</span>`:''}
            </div>`;
          }).join('')}
        </div>
        ${hasPermission('users') ? `<div style="padding:8px;border-top:1px solid var(--border-2)"><button class="btn btn-g btn-sm" style="width:100%" onclick="closeModal();openNewProject()">${I.plus}<span>New Project</span></button></div>` : ''}
      </div>
    </div>
    <div class="hdr-bc">
      <span class="sep">/</span>
      <strong>${pnames[state.page]||'—'}</strong>
    </div>
    <div class="hdr-spacer"></div>
    <div class="search-bar" id="search-trigger">
      ${I.search}
      <span>ค้นหา Issues, Pages, คำสั่ง…</span>
      <kbd>⌘K</kbd>
    </div>
    ${hasPermission('import') ? `<button class="hdr-btn" title="Import CSV" onclick="triggerImportCSV()">${I.upload}</button>` : ''}
    <button class="hdr-btn" title="Export" onclick="exportData()">${I.download}</button>
    <div class="hdr-btn-wrap">
      <button class="hdr-btn" title="Notifications" onclick="toggleNotif(event)">${I.bell}<span class="dot"></span></button>
      <div id="notif-pop" class="notif-pop">
        <div class="notif-h">
          <h4>Notifications</h4>
          <span class="nh-mark" onclick="markAllRead()">Mark all as read</span>
        </div>
        <div class="notif-list" id="notif-list">${renderNotifList()}</div>
      </div>
    </div>
    <button class="theme-toggle" title="Toggle dark mode" onclick="toggleTheme()">${state.theme==='dark'?I.sun:I.moon}</button>
    <div class="user-chip" onclick="openUserMenu()">
      <div class="user-avatar">${state.user.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div>
        <div class="uc-name">${esc(state.user.name)}</div>
        <div class="uc-role">${esc(state.user.role)}</div>
      </div>
    </div>
  </header>`;
}

// ===== Dashboard page =====
function renderDashboard() {
  const all = getIss();
  const t = all.length;
  const resolved = all.filter(i => i.status==='RESOLVED').length;
  const active = all.filter(i => i.status==='ACTIVE').length;
  const newC = all.filter(i => i.status==='NEW').length;
  const critical = all.filter(i => i.priority==='Critical').length;
  const open = all.filter(i => i.status !== 'RESOLVED');
  const avgAge = open.length ? Math.round(open.reduce((s,i)=>s+i.daysOpen,0)/open.length) : 0;
  const resolvedPct = Math.round(resolved / t * 100);

  // Donut data
  const stTally = tally(all, 'status');
  const stItems = ['RESOLVED','ACTIVE','NEW','Unknown'].map(s => ({label:s, value:stTally[s]||0, color:STATUS_COLOR[s]}));
  const prTally = tally(all, 'priority');
  const prItems = ['Critical','Major','Minor'].map(p => ({label:p, value:prTally[p]||0, color:PRIO_COLOR[p]}));
  const dcTally = tallyDisc(all);
  const dcItems = Object.entries(dcTally).map(([d,v]) => ({label:d, value:v, color:DISC_COLOR[d]||'#94a3b8'})).sort((a,b)=>b.value-a.value);

  // Recent issues (last 8 by createdAt)
  const recent = [...all].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,7);

  // Issues waiting on the project owner — surfaced up top since it's usually what a Client Reviewer opens the dashboard for
  const ownerIssues = all.filter(i => discArray(i.disc).includes('OWNER'));
  const ownerOpen = ownerIssues.filter(i => i.status !== 'RESOLVED').length;

  return `<div class="page">

    <div class="page-head">
      <div>
        <h1 class="page-title">Coordination Overview</h1>
        <div class="page-sub">ภาพรวมประจำวันที่ <strong>29 เมษายน 2026</strong> · ${PROJECTS[state.projIdx].name} · ${PROJECTS[state.projIdx].phase}</div>
      </div>
      <div style="display:flex;gap:8px">
        ${hasPermission('import') ? `<button class="btn btn-g" onclick="triggerImportCSV()">${I.upload}<span>Import CSV</span></button>` : ''}
        <button class="btn btn-n" onclick="goPage('report')">${I.report}<span>Generate Report</span></button>
        ${hasPermission('create') ? `<button class="btn btn-p" onclick="openNewIssue()">${I.plus}<span>New Issue</span></button>` : ''}
      </div>
    </div>

    ${ownerIssues.length > 0 ? `
    <div onclick="showOwnerBlockedIssues()" style="cursor:pointer;display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,#eef1ff,#e0e5ff);border:1.5px solid #c7d2fe;border-radius:10px;padding:14px 18px;margin-bottom:18px">
      <div style="width:38px;height:38px;border-radius:9px;background:#4338ca;color:#fff;display:grid;place-items:center;flex-shrink:0">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
      </div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:14.5px;color:#3730a3;font-family:Montserrat">ติดอยู่ที่ Owner ${ownerOpen} รายการ</div>
        <div style="font-size:12px;color:#4f46e5;margin-top:1px">รอการตัดสินใจ/อนุมัติจากเจ้าของโครงการ — จากทั้งหมด ${ownerIssues.length} รายการที่แท็ก Owner</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:#4338ca;white-space:nowrap">ดูทั้งหมด →</span>
    </div>` : ''}

    <!-- KPI strip -->
    <div class="kpi-grid">
      ${kpi('Total Issues', t, '+8 wk', 'up', 'k-blue', sparkline([38,42,40,48,52,58,62,71,t], '#3A6EA5'))}
      ${kpi('Active', active, '−3 wk', 'down', 'k-amber', sparkline([55,52,50,53,48,52,49,50,active],'#ea7f00'))}
      ${kpi('Resolved %', resolvedPct+'%', '+6 wk', 'down', 'k-green', sparkline([24,28,30,32,34,36,37,38,resolvedPct],'#2DBE60'))}
      ${kpi('Critical', critical, '+2 wk', 'up', 'k-red', sparkline([12,14,15,17,18,20,21,22,critical],'#dc2626'))}
      ${kpi('Avg Age', avgAge, '−1 day', 'down', 'k-purple', sparkline([14,15,13,12,12,11,10,11,avgAge],'#9333ea'), 'days')}
    </div>

    <!-- Charts row -->
    <div class="charts-row">
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Status</h3><div class="ch-sub">การกระจายตามสถานะ</div></div></div>
        <div class="card-b">${donut(stItems, t, {centerLabel:'Issues'})}<div class="donut-legend">${donutLegend(stItems, t)}</div></div>
      </div>
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Priority</h3><div class="ch-sub">ระดับความเร่งด่วน</div></div></div>
        <div class="card-b">${donut(prItems, t, {centerLabel:'Issues'})}<div class="donut-legend">${donutLegend(prItems, t)}</div></div>
      </div>
      <div class="card">
        <div class="card-h">
          <div><h3>By Discipline</h3><div class="ch-sub">สาขางาน · เรียงจากมากไปน้อย</div></div>
          <a href="javascript:goPage('issues')" style="font-size:12px;color:var(--blue);font-weight:600;text-decoration:none">View all →</a>
        </div>
        <div class="card-b">${barChart(dcItems)}</div>
      </div>
    </div>

    <!-- Burndown + Heatmap -->
    <div class="wide-row">
      <div class="card">
        <div class="card-h">
          <div><h3>Burndown — 14 days</h3><div class="ch-sub">เปิดใหม่ · ปิดงาน · backlog รวม</div></div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-g btn-sm">14D</button>
            <button class="btn btn-g btn-sm" style="opacity:.55">30D</button>
            <button class="btn btn-g btn-sm" style="opacity:.55">90D</button>
          </div>
        </div>
        <div class="card-b">
          ${burndownSVG(BURNDOWN)}
          <div class="burn-legend">
            <span><i style="background:#9333ea"></i> Opened</span>
            <span><i style="background:#2DBE60"></i> Resolved</span>
            <span><i style="background:#3A6EA5"></i> Open backlog</span>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-h">
          <div><h3>Heatmap · Discipline × Zone</h3><div class="ch-sub">จุดร้อนของ coordination issues</div></div>
        </div>
        <div class="card-b">${heatmap()}</div>
      </div>
    </div>

    <!-- Recent + Activity -->
    <div class="bottom-row">
      <div class="card">
        <div class="card-h">
          <div><h3>Recent Issues</h3><div class="ch-sub">7 รายการล่าสุด</div></div>
          <a href="javascript:goPage('issues')" style="font-size:12px;color:var(--blue);font-weight:600;text-decoration:none">View all 145 →</a>
        </div>
        <div style="padding:4px 18px 14px">
          <table class="mini-tbl">
            <thead><tr><th>NO.</th><th>Title</th><th>Discipline</th><th>Zone</th><th>Priority</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${recent.map(r => `<tr class="row-clickable" data-no="${r.no}">
                <td><span class="t-no">#${r.no}</span></td>
                <td class="t-title">${esc(r.title)}</td>
                <td>${discBadges(r.disc)}</td>
                <td class="mono" style="font-size:11.5px">${r.zone}</td>
                <td>${priBadge(r.priority)}</td>
                <td>${stBadge(r.status)}</td>
                <td style="text-align:right"><span class="muted mono" style="font-size:11px">${r.daysOpen}d</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><div><h3>Activity</h3><div class="ch-sub">วันนี้</div></div></div>
        <div class="card-b">
          <div class="act-feed">
            ${getAud().slice(0,9).map(a => activityRow(a)).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function kpi(label, val, trendText, dir, cls, spark, unit) {
  const trendCls = dir==='up'?'up':dir==='down'?'down':'neutral';
  const trendIcon = dir==='up' ? I.trendUp : dir==='down' ? I.trendDown : '';
  // For positive metrics (Resolved %), up trend should be green not red — invert
  // Actually for Resolved%, "+6 wk" is good, dir='down' was misleading. We already passed dir based on whether it's good (down=green).
  return `<div class="kpi ${cls}">
    <div class="kpi-lbl">${esc(label)}</div>
    <div class="kpi-val">${val}${unit?`<span class="kpi-unit">${unit}</span>`:''}</div>
    <div class="kpi-row">
      <span class="kpi-trend ${trendCls}">${trendIcon}${esc(trendText)}</span>
      <span class="kpi-sub">vs last week</span>
    </div>
    <div class="kpi-spark">${spark}</div>
  </div>`;
}

function sparkline(vals, color) {
  const w=70, h=24;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map((v,i) => `${(i*step).toFixed(1)},${(h - ((v-min)/range)*h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/></svg>`;
}

function activityRow(a) {
  let icon = I.edit, cls = 'blue';
  if (a.action === 'Status Change') {
    if (a.newVal === 'RESOLVED') { icon = I.create; cls = 'green'; }
    else if (a.newVal === 'ACTIVE') { icon = I.edit; cls = 'blue'; }
  } else if (a.action === 'Priority Change') {
    icon = I.trendUp; cls = a.newVal==='Critical' ? 'red' : 'amber';
  } else if (a.action === 'Issue Created') { icon = I.plus; cls = 'purple'; }
  else if (a.action === 'Comment Added') { icon = I.comment; cls = 'blue'; }
  else if (a.action === 'CSV Import') { icon = I.upload; cls = 'amber'; }
  else if (a.action === 'Image Updated') { icon = I.image; cls = 'blue'; }
  else if (a.action === 'Discipline Change') { icon = I.layers; cls = 'purple'; }

  let txt;
  if (a.action === 'Status Change') txt = `เปลี่ยนสถานะ <strong>#${a.issueNo}</strong> เป็น ${stBadge(a.newVal)}`;
  else if (a.action === 'Priority Change') txt = `เปลี่ยน priority <strong>#${a.issueNo}</strong> เป็น ${priBadge(a.newVal)}`;
  else if (a.action === 'Issue Created') txt = `สร้าง issue ใหม่ <strong>#${a.issueNo}</strong>`;
  else if (a.action === 'Comment Added') txt = `เพิ่มคอมเมนต์ใน <strong>#${a.issueNo}</strong>`;
  else if (a.action === 'CSV Import') txt = `import CSV — <strong>${esc(a.newVal)}</strong>`;
  else if (a.action === 'Image Updated') txt = `อัปเดตรูป viewpoint <strong>#${a.issueNo}</strong>`;
  else if (a.action === 'Discipline Change') txt = `เปลี่ยน discipline <strong>#${a.issueNo}</strong>: ${esc(a.oldVal)} → ${esc(a.newVal)}`;
  else txt = a.action;

  return `<div class="act-item">
    <div class="act-icon ${cls}">${icon}</div>
    <div class="act-body">
      <div><span class="act-user">${esc(a.user.split(' ')[0])}</span> ${txt}</div>
      <div class="act-time">${esc(a.ts)}</div>
    </div>
  </div>`;
}

// ===== Burndown SVG =====
function burndownSVG(data) {
  const w = 720, h = 230, padL = 36, padR = 14, padT = 16, padB = 28;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const maxOpen = Math.max(...data.map(d => d.openTotal), 10);
  const maxBar  = Math.max(...data.map(d => Math.max(d.opened, d.resolved)), 10);
  const stepX = innerW / (data.length - 1);
  const barW = Math.max(6, stepX * 0.22);

  // Y axis ticks (5)
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(maxOpen * (1 - i/4));
    const y = padT + (innerH * i / 4);
    yTicks.push(`<line x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}" stroke="#eef2f8" stroke-width="1"/>
                 <text x="${padL-8}" y="${y+3}" font-size="9.5" fill="#94a3b8" text-anchor="end" font-family="JetBrains Mono">${v}</text>`);
  }

  // Bars (opened up, resolved down) — render as twin column chart with light fill
  let bars = '';
  data.forEach((d, i) => {
    const x = padL + i * stepX;
    // opened bar (purple)
    const opH = (d.opened / maxOpen) * innerH * 0.55;
    bars += `<rect x="${x - barW - 1}" y="${padT + innerH - opH}" width="${barW}" height="${opH}" fill="#9333ea" opacity=".55" rx="2"><title>เปิดใหม่ ${d.opened}</title></rect>`;
    const resH = (d.resolved / maxOpen) * innerH * 0.55;
    bars += `<rect x="${x + 1}" y="${padT + innerH - resH}" width="${barW}" height="${resH}" fill="#2DBE60" opacity=".7" rx="2"><title>ปิดงาน ${d.resolved}</title></rect>`;
  });

  // Line for open backlog
  const pts = data.map((d, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - (d.openTotal / maxOpen) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Area fill below line
  const areaPath = `M ${padL},${padT+innerH} L ${pts.join(' L ')} L ${padL + (data.length-1)*stepX},${padT+innerH} Z`;
  const linePath = `M ${pts.join(' L ')}`;

  // Dots + last value label
  let dots = data.map((d,i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - (d.openTotal / maxOpen) * innerH;
    return `<circle cx="${x}" cy="${y}" r="${i===data.length-1?5:2.6}" fill="#3A6EA5" stroke="#fff" stroke-width="${i===data.length-1?2:1}"><title>${d.label}: backlog ${d.openTotal}</title></circle>`;
  }).join('');

  // X axis labels (every 2nd)
  let xLabels = '';
  data.forEach((d, i) => {
    if (i % 2 === 0 || i === data.length-1) {
      const x = padL + i * stepX;
      xLabels += `<text x="${x}" y="${h - 10}" font-size="9.5" fill="#94a3b8" text-anchor="middle" font-family="JetBrains Mono">${d.label}</text>`;
    }
  });

  // Today annotation
  const lastD = data[data.length-1];
  const lastX = padL + (data.length-1) * stepX;
  const lastY = padT + innerH - (lastD.openTotal / maxOpen) * innerH;

  return `<svg viewBox="0 0 ${w} ${h}" class="burn-svg" preserveAspectRatio="xMidYMid meet">
    ${yTicks.join('')}
    ${bars}
    <path d="${areaPath}" fill="#3A6EA5" opacity=".09"/>
    <path d="${linePath}" fill="none" stroke="#3A6EA5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}
    ${xLabels}
    <g transform="translate(${lastX - 50},${lastY - 28})">
      <rect x="0" y="0" width="50" height="20" rx="4" fill="#1a2540"/>
      <text x="25" y="13" fill="#fff" font-size="11" font-family="JetBrains Mono" text-anchor="middle" font-weight="600">${lastD.openTotal} open</text>
    </g>
  </svg>`;
}

// ===== Heatmap =====
function heatmap() {
  const discs = VALID_DISC_CODES;
  const zones = ['ZONE 1','ZONE 2'];
  // count per disc x zone (only primary disc)
  const grid = {};
  let max = 0;
  getIss().forEach(it => {
    const d = it.discPrimary, z = it.zone;
    const k = d + '|' + z;
    grid[k] = (grid[k]||0) + 1;
    if (grid[k] > max) max = grid[k];
  });
  // Render: top row is corner + zones; below: disc rows
  const cells = [];
  cells.push(`<div class="heat-corner">DISC \\ ZONE</div>`);
  zones.forEach(z => cells.push(`<div class="heat-axis">${z.replace('ZONE ','Z')}</div>`));
  discs.forEach(d => {
    cells.push(`<div class="heat-axis" style="color:${DISC_COLOR[d]};text-align:left;padding-left:4px;justify-content:flex-start">${d}</div>`);
    zones.forEach(z => {
      const v = grid[d+'|'+z] || 0;
      const ratio = max > 0 ? v / max : 0;
      // green-to-red gradient based on count (more = warmer)
      let bg, fg = '#1a2540';
      if (v === 0) { bg = '#f7faff'; fg = '#c5cfdf'; }
      else if (ratio < 0.2) bg = '#e8f4ed';
      else if (ratio < 0.4) bg = '#bce6cd';
      else if (ratio < 0.6) bg = '#f7e3b8';
      else if (ratio < 0.8) { bg = '#f5b683'; fg = '#fff' }
      else { bg = '#dc6c52'; fg = '#fff'; }
      cells.push(`<div class="heat-cell ${v===0?'empty':''}" style="background:${bg};color:${fg}" title="${d} × ${z}: ${v} issues">${v||'·'}</div>`);
    });
  });
  return `<div class="heat-grid" style="grid-template-columns: 90px repeat(${zones.length}, 1fr)">${cells.join('')}</div>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;font-size:11px;color:var(--muted)">
    <span>Less issues</span>
    <div style="display:flex;gap:2px">
      <span style="width:14px;height:10px;background:#f7faff;border-radius:2px"></span>
      <span style="width:14px;height:10px;background:#e8f4ed;border-radius:2px"></span>
      <span style="width:14px;height:10px;background:#bce6cd;border-radius:2px"></span>
      <span style="width:14px;height:10px;background:#f7e3b8;border-radius:2px"></span>
      <span style="width:14px;height:10px;background:#f5b683;border-radius:2px"></span>
      <span style="width:14px;height:10px;background:#dc6c52;border-radius:2px"></span>
    </div>
    <span>More issues</span>
  </div>`;
}

// ===== Issues page =====
function renderIssues() {
  const filtered = getFiltered();
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.pageNum > pages) state.pageNum = pages;
  const start = (state.pageNum - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);
  const stTally = tally(getIss(), 'status');
  const f = state.filters;

  const bulkBar = state.selected.size > 0 ? `<div class="bulk-bar">
    <span class="bb-n">${state.selected.size}</span><span>selected</span>
    <span class="bb-sep">|</span>
    <span style="font-size:12.5px">Set status:</span>
    <select class="bb-btn" onchange="bulkUpdate('status', this.value); this.selectedIndex=0">
      <option value="">— เลือก —</option>
      <option>NEW</option><option>ACTIVE</option><option>RESOLVED</option><option>Unknown</option>
    </select>
    <select class="bb-btn" onchange="bulkUpdate('priority', this.value); this.selectedIndex=0">
      <option value="">— Priority —</option>
      <option>Critical</option><option>Major</option><option>Minor</option>
    </select>
    <button class="bb-btn" onclick="exportSelected()">${I.download} Export selected</button>
    <button class="bb-btn danger" onclick="bulkDelete()">${I.close} Delete</button>
    <span style="flex:1"></span>
    <button class="bb-btn" onclick="clearSelection()">Clear</button>
  </div>` : '';

  return `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Issues</h1>
        <div class="page-sub">รวม <strong>${getIss().length}</strong> issues · ${PROJECTS[state.projIdx].name} · ${PROJECTS[state.projIdx].phase}</div>
      </div>
      <div style="display:flex;gap:8px">
        ${hasPermission('import') ? `<button class="btn btn-g" onclick="triggerImportCSV()">${I.upload}<span>Import CSV</span></button>` : ''}
        <button class="btn btn-g" onclick="exportIssuesCSV()">${I.download}<span>Export</span></button>
        ${hasPermission('create') ? `<button class="btn btn-p" onclick="openNewIssue()">${I.plus}<span>New Issue</span></button>` : ''}
      </div>
    </div>

    <div class="toolbar">
      <div class="fchips">
        <button class="fchip ${f.status==='all'?'active':''}" onclick="setFilter('status','all')">All <span class="fch-n">${getIss().length}</span></button>
        <button class="fchip ${f.status==='NEW'?'active':''}" onclick="setFilter('status','NEW')">NEW <span class="fch-n">${stTally.NEW||0}</span></button>
        <button class="fchip ${f.status==='ACTIVE'?'active':''}" onclick="setFilter('status','ACTIVE')">ACTIVE <span class="fch-n">${stTally.ACTIVE||0}</span></button>
        <button class="fchip ${f.status==='RESOLVED'?'active':''}" onclick="setFilter('status','RESOLVED')">RESOLVED <span class="fch-n">${stTally.RESOLVED||0}</span></button>
        ${(() => { const oc = getIss().filter(i => discArray(i.disc).includes('OWNER')).length; return oc > 0 ? `<button class="fchip ${f.disc==='OWNER'?'active':''}" style="background:#4338ca;color:#fff;border-color:#4338ca" onclick="showOwnerBlockedIssues()">Owner-blocked <span class="fch-n" style="background:rgba(255,255,255,.25);color:#fff">${oc}</span></button>` : ''; })()}
      </div>
      <select class="fsel" onchange="setFilter('disc', this.value)">
        <option value="all" ${f.disc==='all'?'selected':''}>All Disciplines</option>
        ${VALID_DISC_CODES.map(d => `<option ${f.disc===d?'selected':''}>${d}</option>`).join('')}
      </select>
      <select class="fsel" onchange="setFilter('prio', this.value)">
        <option value="all" ${f.prio==='all'?'selected':''}>All Priority</option>
        <option ${f.prio==='Critical'?'selected':''}>Critical</option>
        <option ${f.prio==='Major'?'selected':''}>Major</option>
        <option ${f.prio==='Minor'?'selected':''}>Minor</option>
      </select>
      <select class="fsel" onchange="setFilter('zone', this.value)">
        <option value="all" ${f.zone==='all'?'selected':''}>All Zones</option>
        <option ${f.zone==='ZONE 1'?'selected':''}>ZONE 1</option>
        <option ${f.zone==='ZONE 2'?'selected':''}>ZONE 2</option>
      </select>
      <div class="tb-search">
        ${I.search}<input type="text" placeholder="ค้นหา NO. / title / discipline…" value="${esc(f.q)}" oninput="setFilter('q', this.value)" />
      </div>
      <div class="tb-spacer"></div>
      <span class="tb-count">แสดง <strong>${slice.length}</strong> จาก <strong>${total}</strong></span>
      <button class="btn btn-g btn-sm" onclick="openAdvancedFilter()">${I.filter}<span>Advanced</span></button>
    </div>

    ${bulkBar}

    <div class="tb-wrap">
      <div class="tbl-header">
        <div><span class="ck ${allSelected(slice)?'checked':''}" onclick="toggleSelectAll()"></span></div>
        <div>NO.</div>
        <div>Title</div>
        <div>Disc.</div>
        <div>Zone / Floor</div>
        <div>Priority</div>
        <div>Status</div>
        <div>Age</div>
        <div></div>
      </div>
      ${slice.map(it => issueRow(it)).join('')}
      <div class="pager">
        <span>หน้า <strong style="color:#1a2540">${state.pageNum}</strong> / ${pages} · รวม ${total} issues</span>
        <div class="pager-btns">
          <button class="pager-btn" ${state.pageNum<=1?'disabled':''} onclick="goPageNum(${state.pageNum-1})">${I.chevLeft}</button>
          ${pagerButtons(pages)}
          <button class="pager-btn" ${state.pageNum>=pages?'disabled':''} onclick="goPageNum(${state.pageNum+1})">${I.chevRight}</button>
        </div>
      </div>
    </div>
  </div>`;
}

function pagerButtons(pages) {
  const cur = state.pageNum;
  const out = [];
  const show = (n) => out.push(`<button class="pager-btn ${n===cur?'active':''}" onclick="goPageNum(${n})">${n}</button>`);
  if (pages <= 7) { for (let i=1;i<=pages;i++) show(i); }
  else {
    show(1);
    if (cur > 3) out.push(`<span style="padding:0 4px;color:var(--muted)">…</span>`);
    const s = Math.max(2, cur-1), e = Math.min(pages-1, cur+1);
    for (let i=s;i<=e;i++) show(i);
    if (cur < pages-2) out.push(`<span style="padding:0 4px;color:var(--muted)">…</span>`);
    show(pages);
  }
  return out.join('');
}

function allSelected(slice) {
  if (!slice.length) return false;
  return slice.every(it => state.selected.has(it.no));
}

function issueRow(it) {
  const sel = state.selected.has(it.no);
  return `<div class="tr ${sel?'selected':''}" data-no="${it.no}">
    <div><span class="ck ${sel?'checked':''}" onclick="toggleRow('${it.no}')"></span></div>
    <div><span class="t-no">#${it.no}</span></div>
    <div class="t-title" onclick="openDetail('${it.no}')" title="${esc(it.title)}">${esc(it.title)}</div>
    <div>${discBadges(it.disc)}</div>
    <div><span class="mono" style="font-size:11.5px">${it.zone.replace('ZONE ','Z')}</span> <span class="muted mono" style="font-size:10.5px">· ${it.floor}</span></div>
    <div>
      <select class="ie-sel" style="color:${PRIO_COLOR[it.priority]}" onchange="quickField('${it.no}','priority',this.value)">
        ${PRIORITIES.map(p => `<option ${p===it.priority?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div>
      <select class="ie-sel" style="color:${STATUS_COLOR[it.status]}" onchange="quickField('${it.no}','status',this.value)">
        ${STATUSES.map(s => `<option ${s===it.status?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div><span class="mono" style="font-size:11.5px;color:${it.daysOpen > 14 ? '#dc2626' : 'var(--muted)'}">${it.daysOpen}d</span></div>
    <div><button class="t-row-btn" onclick="openDetail('${it.no}')">${I.more}</button></div>
  </div>`;
}

// ===== Analytics page =====
function renderAnalytics() {
  const all = getIss();
  const stTally = tally(all, 'status');
  const stItems = ['RESOLVED','ACTIVE','NEW','Unknown'].map(s => ({label:s, value:stTally[s]||0, color:STATUS_COLOR[s]}));
  const prTally = tally(all, 'priority');
  const prItems = ['Critical','Major','Minor'].map(p => ({label:p, value:prTally[p]||0, color:PRIO_COLOR[p]}));
  const dcTally = tallyDisc(all);
  const dcItems = Object.entries(dcTally).map(([d,v]) => ({label:d, value:v, color:DISC_COLOR[d]||'#94a3b8'})).sort((a,b)=>b.value-a.value);
  const znTally = tally(all, 'zone');
  const znItems = Object.entries(znTally).map(([z,v],i) => ({label:z, value:v, color: i===0?'#3A6EA5':'#1F3A5F'}));

  const t = all.length;
  const resolved = stTally.RESOLVED || 0;
  const avgRes = 5.4; // days
  const reopenRate = 4;

  return `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Analytics</h1>
        <div class="page-sub">ภาพรวมเชิงสถิติ · เลือก slice ใน chart เพื่อ filter ข้าม chart</div>
      </div>
      <div style="display:flex;gap:8px">
        <select class="fsel" style="padding:7px 26px 7px 12px;font-size:13px"><option>เดือนนี้ (Apr 2026)</option><option>เดือนก่อน</option><option>12 สัปดาห์</option></select>
        <button class="btn btn-g" onclick="exportAnalytics()">${I.download}<span>Export Charts</span></button>
      </div>
    </div>

    <!-- Velocity row -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-h">
        <div><h3>Resolution Velocity</h3><div class="ch-sub">วัดประสิทธิภาพการปิดงาน — เทียบสัปดาห์ก่อน</div></div>
      </div>
      <div class="card-b">
        <div class="vel-grid">
          <div class="vel-cell"><div class="vel-lbl">Throughput / wk</div><div class="vel-val">9.4 <span style="font-size:12px;color:var(--muted)">issues</span></div><div class="vel-sub" style="color:#2DBE60">↑ 18% vs 12-wk avg</div></div>
          <div class="vel-cell"><div class="vel-lbl">Avg Resolution Time</div><div class="vel-val">${avgRes} <span style="font-size:12px;color:var(--muted)">days</span></div><div class="vel-sub" style="color:#2DBE60">↓ 1.2 day</div></div>
          <div class="vel-cell"><div class="vel-lbl">Reopen Rate</div><div class="vel-val">${reopenRate}% </div><div class="vel-sub" style="color:#dc2626">↑ 1.5%</div></div>
          <div class="vel-cell"><div class="vel-lbl">Forecast Clear</div><div class="vel-val">~9.5 <span style="font-size:12px;color:var(--muted)">wks</span></div><div class="vel-sub">หากความเร็วคงเดิม</div></div>
        </div>
      </div>
    </div>

    <!-- 4 donuts -->
    <div class="an-grid">
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Status</h3><div class="ch-sub">${t} issues</div></div></div>
        <div class="card-b">${donut(stItems, t, {size:160, r:60, stroke:22})}<div class="donut-legend">${donutLegend(stItems, t)}</div></div>
      </div>
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Priority</h3><div class="ch-sub">${t} issues</div></div></div>
        <div class="card-b">${donut(prItems, t, {size:160, r:60, stroke:22})}<div class="donut-legend">${donutLegend(prItems, t)}</div></div>
      </div>
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Discipline</h3><div class="ch-sub">${t} issues (รวมหลายสาขา)</div></div></div>
        <div class="card-b">${donut(dcItems, dcItems.reduce((s,i)=>s+i.value,0), {size:160, r:60, stroke:22})}<div class="donut-legend">${donutLegend(dcItems, dcItems.reduce((s,i)=>s+i.value,0))}</div></div>
      </div>
      <div class="card donut-card">
        <div class="card-h"><div><h3>By Zone</h3><div class="ch-sub">${t} issues</div></div></div>
        <div class="card-b">${donut(znItems, t, {size:160, r:60, stroke:22})}<div class="donut-legend">${donutLegend(znItems, t)}</div></div>
      </div>
    </div>

    <!-- 12-week trend -->
    <div class="card">
      <div class="card-h">
        <div><h3>12-week Trend</h3><div class="ch-sub">เปิด vs ปิด · เห็น backlog ค่อย ๆ ลดลง</div></div>
      </div>
      <div class="card-b">${trendSVG(TREND_12W)}</div>
    </div>
  </div>`;
}

function trendSVG(data) {
  const w=900, h=240, padL=40, padR=20, padT=18, padB=30;
  const iw = w-padL-padR, ih = h-padT-padB;
  const max = Math.max(...data.map(d => Math.max(d.newIssues, d.resolved, d.backlog/3)));
  const stepX = iw / (data.length - 1);

  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(max * (1 - i/4));
    const y = padT + (ih * i / 4);
    yTicks.push(`<line x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}" stroke="#eef2f8"/>
                 <text x="${padL-8}" y="${y+3}" font-size="10" fill="#94a3b8" text-anchor="end" font-family="JetBrains Mono">${v}</text>`);
  }

  const newPts = data.map((d,i) => `${padL+i*stepX},${padT+ih-(d.newIssues/max)*ih}`).join(' ');
  const resPts = data.map((d,i) => `${padL+i*stepX},${padT+ih-(d.resolved/max)*ih}`).join(' ');
  // backlog rescaled (/3 to fit)
  const backPts = data.map((d,i) => `${padL+i*stepX},${padT+ih-(d.backlog/3/max)*ih}`).join(' ');

  let xLabels = data.map((d,i) => i%2===0 ?
    `<text x="${padL+i*stepX}" y="${h-10}" font-size="10" fill="#94a3b8" text-anchor="middle" font-family="JetBrains Mono">${d.week}</text>` : ''
  ).join('');

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:240px;display:block">
    ${yTicks.join('')}
    <polyline points="${newPts}" fill="none" stroke="#9333ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${resPts}" fill="none" stroke="#2DBE60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${backPts}" fill="none" stroke="#3A6EA5" stroke-width="2.2" stroke-dasharray="4 4" stroke-linecap="round"/>
    ${data.map((d,i) => `<circle cx="${padL+i*stepX}" cy="${padT+ih-(d.newIssues/max)*ih}" r="3" fill="#9333ea"/>`).join('')}
    ${data.map((d,i) => `<circle cx="${padL+i*stepX}" cy="${padT+ih-(d.resolved/max)*ih}" r="3" fill="#2DBE60"/>`).join('')}
    ${xLabels}
  </svg>
  <div class="burn-legend">
    <span><i style="background:#9333ea"></i> New Issues / week</span>
    <span><i style="background:#2DBE60"></i> Resolved / week</span>
    <span><i style="background:#3A6EA5;height:2px;border-top:1px dashed #3A6EA5;background:transparent"></i> Backlog (÷3)</span>
  </div>`;
}

// ===== Simple list pages =====
function projStatusBadge(status) {
  const map = {
    'Active': 'b-resolved',
    'On Hold': 'b-major',
    'Completed': 'b-active',
    'Archived': 'b-unknown'
  };
  return `<span class="badge ${map[status]||'b-unknown'}"><span class="dot"></span>${esc(status||'—')}</span>`;
}

function renderProjects() {
  const vis = getVisibleProjects();
  const visProjects = vis.map(({p}) => p);
  const totalIssues = vis.reduce((s,{i}) => s + (PROJECT_ISSUES[i]||[]).length, 0);
  const activeProjs = visProjects.filter(p => p.status === 'Active').length;
  return `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Projects</h1>
        <div class="page-sub">${vis.length} projects · <strong>${activeProjs}</strong> active · ${totalIssues} issues รวม</div>
      </div>
      ${hasPermission('users') ? `<button class="btn btn-p" onclick="openNewProject()">${I.plus}<span>New Project</span></button>` : ''}
    </div>

    <!-- Summary cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
      ${[
        ['Total Projects', vis.length, 'k-blue'],
        ['Active', visProjects.filter(p=>p.status==='Active').length, 'k-green'],
        ['On Hold', visProjects.filter(p=>p.status==='On Hold').length, 'k-amber'],
        ['Archived', visProjects.filter(p=>p.status==='Archived' || p.status==='Completed').length, 'k-purple']
      ].map(([l,v,c]) => `<div class="kpi ${c}">
        <div class="kpi-lbl">${l}</div>
        <div class="kpi-val">${v}</div>
      </div>`).join('')}
    </div>

    <!-- Project grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
      ${vis.map(({p,i}) => projectCard(p, i)).join('')}
    </div>

    ${vis.length === 0 ? `<div class="card" style="padding:60px;text-align:center;color:var(--muted)">
      <div style="font-size:14px;margin-bottom:10px">ยังไม่มี project</div>
      ${hasPermission('users') ? `<button class="btn btn-p" onclick="openNewProject()">${I.plus}<span>สร้าง project แรก</span></button>` : '<div style="font-size:12px;color:var(--muted)">ติดต่อ Admin เพื่อสร้าง project</div>'}
    </div>` : ''}
  </div>`;
}

function projectCard(p, i) {
  const count = (PROJECT_ISSUES[i] || []).length;
  const open = (PROJECT_ISSUES[i] || []).filter(x => x.status !== 'RESOLVED').length;
  const resolved = count - open;
  const isCur = i === state.projIdx;
  const pct = count > 0 ? Math.round(resolved / count * 100) : 0;
  const codeColor = p.status === 'Active' ? 'var(--green)' : p.status === 'On Hold' ? '#ea7f00' : p.status === 'Completed' ? 'var(--blue)' : '#94a3b8';

  return `<div class="card" style="overflow:hidden;${isCur?'border:2px solid var(--green);box-shadow:0 4px 16px rgba(45,190,96,.15)':''}">
    <div style="padding:14px 16px;display:flex;align-items:flex-start;gap:11px;border-bottom:1px solid var(--border-2)">
      <div style="width:44px;height:44px;border-radius:9px;background:${codeColor};color:#fff;display:grid;place-items:center;font-family:Montserrat;font-weight:800;font-size:13px;flex-shrink:0">${esc(p.code.slice(-2))}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:7px;font-family:Montserrat;font-weight:700;font-size:15px;color:var(--text);line-height:1.2">
          ${esc(p.name)}
          ${isCur?'<span class="badge b-resolved" style="font-size:9.5px">CURRENT</span>':''}
        </div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:3px" class="mono">${esc(p.code)} · ${esc(p.phase)}</div>
      </div>
      <div class="proj-card-menu" style="position:relative">
        <button class="t-row-btn" onclick="toggleProjActions(event, ${i})" title="Actions">${I.more}</button>
        <div id="proj-actions-${i}" class="proj-actions" style="display:none;position:absolute;right:0;top:32px;background:var(--surface);border:1px solid var(--border);border-radius:7px;box-shadow:var(--sh-md);z-index:20;min-width:160px;padding:5px">
          <div class="cmdk-item" onclick="event.stopPropagation();switchProject(${i})">${I.check2}<span style="margin-left:8px">${isCur?'Active project':'Set as active'}</span></div>
          <div class="cmdk-item" onclick="event.stopPropagation();openEditProject(${i})">${I.edit}<span style="margin-left:8px">Edit project</span></div>
          <div class="cmdk-item" onclick="event.stopPropagation();duplicateProject(${i})">${I.layers}<span style="margin-left:8px">Duplicate</span></div>
          <div style="height:1px;background:var(--border-2);margin:4px 0"></div>
          <div class="cmdk-item" style="color:#dc2626" onclick="event.stopPropagation();confirmDeleteProject(${i})">${I.trash}<span style="margin-left:8px">Delete project</span></div>
        </div>
      </div>
    </div>

    <div style="padding:12px 16px;border-bottom:1px solid var(--border-2);font-size:12px;color:var(--muted);min-height:42px;line-height:1.5">${esc(p.desc) || '<span style="opacity:.5">— ไม่มีคำอธิบาย —</span>'}</div>

    <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">Issues</div>
        <div style="font-family:Montserrat;font-weight:700;font-size:20px;color:var(--text);line-height:1.1">${count}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">Open</div>
        <div style="font-family:Montserrat;font-weight:700;font-size:20px;color:${open>0?'#ea7f00':'var(--text)'};line-height:1.1">${open}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600">Resolved</div>
        <div style="font-family:Montserrat;font-weight:700;font-size:20px;color:var(--green-2);line-height:1.1">${pct}%</div>
      </div>
    </div>

    <div style="padding:0 16px 12px">
      <div style="height:6px;background:#eef2f8;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--green),var(--green-2));transition:width .3s"></div>
      </div>
    </div>

    <div style="padding:11px 16px;background:var(--bg);border-top:1px solid var(--border-2);display:flex;align-items:center;justify-content:space-between;gap:8px">
      ${projStatusBadge(p.status)}
      <div style="display:flex;gap:6px">
        ${!isCur ? `<button class="btn btn-g btn-sm" onclick="switchProject(${i})">Open</button>` : ''}
        <button class="btn btn-g btn-sm" onclick="openEditProject(${i})">${I.edit}</button>
      </div>
    </div>
  </div>`;
}

function renderUsers() {
  const roleColors = { 'Admin':'b-critical', 'BIM Manager':'b-new', 'Coordinator':'b-active', 'Viewer':'b-unknown', 'Client Reviewer':'b-major' };
  return `<div class="page">
    <div class="page-head">
      <div><h1 class="page-title">Users &amp; Roles</h1><div class="page-sub">ทีมที่เข้าถึงระบบ — ${USERS.length} คน</div></div>
      ${hasPermission('users') ? `<button class="btn btn-p" onclick="openInviteUser()">${I.plus}<span>Invite User</span></button>` : ''}
    </div>
    <div class="card">
      <div style="display:grid;grid-template-columns:46px 1.3fr 1.5fr 120px 110px 90px 80px;padding:12px 16px;border-bottom:1px solid var(--border-2);font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700">
        <div></div><div>Name</div><div>Email</div><div>Role</div><div>Scope</div><div>Last Active</div><div></div>
      </div>
      ${USERS.map(u => `<div style="display:grid;grid-template-columns:46px 1.3fr 1.5fr 120px 110px 90px 80px;padding:13px 16px;align-items:center;border-bottom:1px solid #f0f3f8;font-size:13px">
        <div><div class="user-avatar" style="width:32px;height:32px">${u.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div></div>
        <div style="font-weight:600;color:#1a2540">${esc(u.name)}</div>
        <div class="muted mono" style="font-size:12px">${esc(u.email)}</div>
        <div><span class="badge ${roleColors[u.role]}">${u.role}</span></div>
        <div class="muted mono" style="font-size:11.5px">${u.projectCode ? esc(u.projectCode) : 'All'}</div>
        <div class="muted mono" style="font-size:11.5px">${esc(u.lastActive)}</div>
        <div><button class="t-row-btn" onclick="openEditUser(${u.id})" title="Edit user">${I.edit}</button></div>
      </div>`).join('')}
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-h"><div><h3>Role Permissions</h3><div class="ch-sub">สิทธิ์การเข้าถึงตาม role (บังคับใช้จริง)</div></div></div>
      <div class="card-b">
        <table class="mini-tbl">
          <thead><tr><th>Role</th><th>Create</th><th>Edit</th><th>Delete</th><th>Import</th><th>Comment</th><th>Report</th><th>Users</th></tr></thead>
          <tbody>
            ${VALID_ROLES.map(r => {
              const p = PERMISSIONS[r] || {};
              const cells = ['create','edit','delete','import','comment','report','users']
                .map(k => `<td style="color:${p[k]?'#2DBE60':'#cbd5e1'};font-weight:700">${p[k]?'✓':'—'}</td>`).join('');
              return `<tr><td><span class="badge ${roleColors[r]}">${r}</span></td>${cells}</tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

function renderAudit() {
  return `<div class="page">
    <div class="page-head">
      <div><h1 class="page-title">Audit Log</h1><div class="page-sub">ประวัติการเปลี่ยนแปลงทั้งหมด</div></div>
      <div style="display:flex;gap:8px">
        <select class="fsel" style="padding:7px 26px 7px 12px;font-size:13px"><option>วันนี้</option><option>7 วันที่ผ่านมา</option><option>30 วันที่ผ่านมา</option></select>
        <button class="btn btn-g" onclick="exportAuditLog()">${I.download}<span>Export Log</span></button>
      </div>
    </div>
    <div class="card">
      <div style="display:grid;grid-template-columns:130px 70px 1.7fr 130px 1fr 140px;padding:12px 16px;border-bottom:1px solid var(--border-2);font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700">
        <div>Timestamp</div><div>NO.</div><div>Issue / Item</div><div>Action</div><div>Change</div><div>User</div>
      </div>
      ${getAud().map(a => `<div style="display:grid;grid-template-columns:130px 70px 1.7fr 130px 1fr 140px;padding:11px 16px;align-items:center;border-bottom:1px solid #f0f3f8;font-size:12.5px">
        <div class="mono muted" style="font-size:11.5px">${a.ts}</div>
        <div>${a.issueNo?`<span class="t-no mono">#${a.issueNo}</span>`:'—'}</div>
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(a.issueTitle)}">${esc(a.issueTitle)}</div>
        <div><span class="badge ${actionBadgeCls(a.action)}">${a.action}</span></div>
        <div class="mono" style="font-size:11.5px;color:var(--muted)">${a.oldVal||a.newVal ? `${esc(a.oldVal||'∅')} → <strong style="color:#1a2540">${esc(a.newVal||'∅')}</strong>` : '—'}</div>
        <div style="font-weight:500;color:#1a2540">${esc(a.user)}</div>
      </div>`).join('')}
    </div>
  </div>`;
}

function actionBadgeCls(action) {
  if (action.includes('Status')) return 'b-active';
  if (action.includes('Priority')) return 'b-major';
  if (action.includes('Created')) return 'b-new';
  if (action.includes('Deleted')) return 'b-critical';
  if (action.includes('Import')) return 'b-resolved';
  if (action.includes('Comment')) return 'b-active';
  return 'b-unknown';
}

// Get issues filtered by Report Options
function getReportIssues() {
  let arr = getIss();
  const o = state.reportOpts;
  if (o.filter === 'open') arr = arr.filter(i => i.status !== 'RESOLVED');
  else if (o.filter === 'critical') arr = arr.filter(i => i.priority === 'Critical');
  if (o.disciplines && o.disciplines.length) {
    arr = arr.filter(i => o.disciplines.some(d => discArray(i.disc).includes(d)));
  }
  return arr;
}

function renderReport() {
  const all = getIss();
  const t = all.length;
  const filtered = getReportIssues();
  const ft = filtered.length;
  const resolved = filtered.filter(i => i.status==='RESOLVED').length;
  const critical = filtered.filter(i => i.priority==='Critical').length;
  const openIssues = filtered.filter(i => i.status !== 'RESOLVED');
  const avgAge = openIssues.length ? Math.round(openIssues.reduce((s,i)=>s+i.daysOpen,0)/openIssues.length) : 0;
  const proj = PROJECTS[state.projIdx];
  const opts = state.reportOpts;
  const showSection = (k) => opts.sections.includes(k);

  // Tallies for charts (limited to filtered set)
  const stTally = tally(filtered, 'status');
  const stItems = ['RESOLVED','ACTIVE','NEW','Unknown'].map(s => ({label:s, value:stTally[s]||0, color:STATUS_COLOR[s]}));
  const prTally = tally(filtered, 'priority');
  const prItems = ['Critical','Major','Minor'].map(p => ({label:p, value:prTally[p]||0, color:PRIO_COLOR[p]}));
  const dcTally = tallyDisc(filtered);
  const dcItems = Object.entries(dcTally).map(([d,v]) => ({label:d, value:v, color:DISC_COLOR[d]||'#94a3b8'})).sort((a,b)=>b.value-a.value);

  return `<div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">Publish Report</h1>
        <div class="page-sub">TEAMCM Clash Detection Report · <strong>${esc(proj.name)}</strong> · ${esc(proj.phase)} · จะพิมพ์ <strong>${ft}</strong> issues</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-g" onclick="previewReport()">Preview Full</button>
        <button class="btn btn-p" onclick="generatePDF()">${I.download}<span>Generate PDF</span></button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:flex-start">
      <div class="card">
        <div class="card-h">
          <div><h3>Report Preview</h3><div class="ch-sub">${opts.sections.length} sections · ${ft} issues ${opts.disciplines.length?` · disciplines: ${opts.disciplines.join('+')}`:''}</div></div>
          <span class="badge b-active">LIVE PREVIEW</span>
        </div>
        <div style="padding:18px;background:#eef2f8;max-height:780px;overflow-y:auto" id="report-preview-host">
          ${renderReportContent({proj, filtered, all, opts, showSection, stItems, prItems, dcItems, avgAge, resolved, critical, ft, t})}
        </div>
      </div>
      <div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-h"><div><h3>Report Options</h3></div></div>
          <div class="card-b" style="display:flex;flex-direction:column;gap:14px">
            <div>
              <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px">Include Sections</div>
              ${[
                ['cover','Cover Page'],
                ['exec','Executive Summary'],
                ['charts','Charts (Priority, Status, Discipline)'],
                ['heatmap','Heatmap (Zone × Discipline)'],
                ['cards','Issue Cards with Viewpoints'],
                ['comments','Comment History'],
                ['audit','Audit Trail']
              ].filter(([k]) => k !== 'audit' || state.user.role !== 'Client Reviewer').map(([k,s]) => `
                <label style="display:flex;align-items:center;gap:9px;padding:5px 0;font-size:13px;cursor:pointer" onclick="toggleReportSection('${k}')">
                  <span class="ck ${opts.sections.includes(k)?'checked':''}"></span>${s}
                </label>`).join('')}
            </div>
            <div>
              <div style="font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-bottom:6px">Filter Issues</div>
              <select class="fsel" style="width:100%;margin-bottom:6px" onchange="state.reportOpts.filter=this.value;render()">
                <option value="all" ${opts.filter==='all'?'selected':''}>All issues (${all.length})</option>
                <option value="open" ${opts.filter==='open'?'selected':''}>Active + New only (${all.filter(i=>i.status!=='RESOLVED').length})</option>
                <option value="critical" ${opts.filter==='critical'?'selected':''}>Critical only (${all.filter(i=>i.priority==='Critical').length})</option>
              </select>
              ${renderDiscMultiSelect()}
            </div>
            <div style="background:var(--green-soft);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--green-2);display:flex;align-items:center;gap:8px">
              ${I.check2}<span><strong>${ft}</strong> issues จะถูกพิมพ์ในรายงาน</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><div><h3>Recent Reports</h3></div></div>
          <div style="padding:6px 0">
            ${[
              ['BIM_Report_20260429.pdf','Just now','12 MB','145 issues'],
              ['BIM_Report_20260422.pdf','7d ago','11 MB','132 issues'],
              ['BIM_Report_20260415.pdf','14d ago','10 MB','118 issues'],
              ['BIM_Report_20260408.pdf','21d ago','9 MB','104 issues']
            ].map(([n,ti,s,c]) => `<div style="display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid #f0f3f8">
              <div style="width:32px;height:32px;background:#fee2e2;border-radius:6px;display:grid;place-items:center;color:#dc2626;font-weight:700;font-size:10px">PDF</div>
              <div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--text);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</div><div style="font-size:11px;color:var(--muted)" class="mono">${ti} · ${s} · ${c}</div></div>
              <button class="t-row-btn" onclick="downloadRecentReport('${n}')">${I.download}</button>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ====== Report content renderer ======
// Used by both inline preview and the PDF/print window
function renderReportContent(ctx) {
  const { proj, filtered, all, opts, showSection, stItems, prItems, dcItems, avgAge, resolved, critical, ft, t } = ctx;
  const pageStyle = `background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.08);border-radius:4px;margin-bottom:14px;overflow:hidden`;
  const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  let html = '';

  // --- Cover Page ---
  if (showSection('cover')) {
    const logos = proj.reportLogos || {};
    const coverImg = proj.reportCoverImage || '';
    const cpos = proj.reportCoverPosition || { x:50, y:50, zoom:100 };
    html += `<div class="rpt-page rpt-cover" style="${pageStyle};min-height:280px;display:flex;flex-direction:column">
      <div style="${coverImg ? '' : 'background:var(--navy);'}color:#fff;padding:24px 30px;border-bottom:4px solid var(--green);flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden">
        ${coverImg ? `
          <img src="${coverImg}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${cpos.x}% ${cpos.y}%;transform:scale(${cpos.zoom/100});transform-origin:${cpos.x}% ${cpos.y}%;z-index:0" />
          <div style="position:absolute;inset:0;background:linear-gradient(rgba(31,58,95,.82),rgba(22,41,74,.88));z-index:0"></div>
        ` : ''}
        <div style="position:relative;z-index:1;flex:1;display:flex;flex-direction:column;justify-content:space-between">
          ${logos.owner ? `<span style="position:absolute;top:0;right:0;display:inline-flex;align-items:center;justify-content:center;background:#fff;border-radius:6px;padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.22)"><img src="${logos.owner}" style="height:36px;max-width:130px;object-fit:contain;display:block" /></span>` : ''}
          <div style="display:flex;align-items:center;gap:14px;padding-right:${logos.owner ? '170px' : '0'}">
            ${logos.cm ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:#fff;border-radius:6px;padding:7px 11px;box-shadow:0 2px 8px rgba(0,0,0,.22);flex-shrink:0"><img src="${logos.cm}" style="height:32px;max-width:100px;object-fit:contain;display:block" /></span>` : ''}
            <div>
              <div style="font-family:Montserrat;font-weight:800;font-size:30px;letter-spacing:.4px">TEAM·CM</div>
              <div style="font-size:12px;color:#a8bcdb;letter-spacing:1.4px;text-transform:uppercase;margin-top:3px">BIM Coordination Report</div>
            </div>
          </div>
          <div style="margin-top:30px">
            <div style="font-family:Montserrat;font-weight:700;font-size:26px;letter-spacing:-.2px;line-height:1.15">${esc(proj.name)}</div>
            <div style="font-size:13px;color:#a8bcdb;margin-top:6px;font-family:JetBrains Mono">${esc(proj.code)} · ${esc(proj.phase)} · ${esc(proj.desc)}</div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:30px;font-size:11.5px;color:#a8bcdb">
            <div>Printed by <strong style="color:#fff">${esc(state.user.name)}</strong> · ${esc(state.user.role)}</div>
            <div style="display:flex;align-items:center;gap:10px">
              ${logos.contractor ? `<span style="display:inline-flex;align-items:center;justify-content:center;background:#fff;border-radius:4px;padding:4px 8px"><img src="${logos.contractor}" style="height:16px;max-width:80px;object-fit:contain;display:block" /></span>` : ''}
              <span>${today} · TEAMCM HQ</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }

  // --- Executive Summary ---
  if (showSection('exec')) {
    html += `<div class="rpt-page" style="${pageStyle}">
      <div style="padding:20px 26px;border-bottom:1px solid #e2e8f0">
        <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:6px">Executive Summary</div>
        <div style="font-family:Montserrat;font-weight:700;font-size:18px;color:#1a2540">${esc(proj.name)} — ${esc(proj.phase)}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:18px">
          ${[
            ['Total Issues', ft, '#1a2540'],
            ['Resolved', resolved, '#2DBE60'],
            ['Critical', critical, '#dc2626'],
            ['Avg Age (open)', avgAge+'d', '#1a2540']
          ].map(([l,v,c]) => `<div>
            <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600">${l}</div>
            <div style="font-family:Montserrat;font-weight:700;font-size:24px;color:${c};margin-top:2px">${v}</div>
          </div>`).join('')}
        </div>
        <div style="margin-top:18px;padding:12px 14px;background:#f7faff;border-radius:6px;font-size:12.5px;line-height:1.55;color:#334155">
          <strong>สรุป:</strong> โครงการ ${esc(proj.name)} ระยะ ${esc(proj.phase)} มี coordination issues ทั้งหมด ${ft} รายการ
          (เปิด ${ft - resolved} · ปิด ${resolved}) · Critical ${critical} รายการ · เฉลี่ยอายุของ issue ที่ยังเปิด ${avgAge} วัน
          ${opts.disciplines.length ? ` · กรองเฉพาะสาขา ${opts.disciplines.join(', ')}` : ''}
          ${opts.filter !== 'all' ? ` · filter: ${opts.filter}` : ''}.
        </div>
      </div>
    </div>`;
  }

  // --- Charts ---
  if (showSection('charts')) {
    html += `<div class="rpt-page" style="${pageStyle}">
      <div style="padding:20px 26px">
        <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:14px">Charts</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;align-items:flex-start">
          <div style="text-align:center">
            <div style="font-size:11.5px;font-weight:700;color:#1a2540;margin-bottom:6px;font-family:Montserrat">By Status</div>
            ${donut(stItems, ft, {size:130,r:50,stroke:18,centerLabel:'Issues'})}
            <div style="margin-top:8px;text-align:left;display:flex;flex-direction:column;gap:4px;font-size:11px">${donutLegend(stItems, ft)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:11.5px;font-weight:700;color:#1a2540;margin-bottom:6px;font-family:Montserrat">By Priority</div>
            ${donut(prItems, ft, {size:130,r:50,stroke:18,centerLabel:'Issues'})}
            <div style="margin-top:8px;text-align:left;display:flex;flex-direction:column;gap:4px;font-size:11px">${donutLegend(prItems, ft)}</div>
          </div>
          <div>
            <div style="font-size:11.5px;font-weight:700;color:#1a2540;margin-bottom:6px;font-family:Montserrat">By Discipline</div>
            ${barChart(dcItems)}
          </div>
        </div>
      </div>
    </div>`;
  }

  // --- Heatmap ---
  if (showSection('heatmap')) {
    html += `<div class="rpt-page" style="${pageStyle}">
      <div style="padding:20px 26px">
        <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:12px">Heatmap · Discipline × Zone</div>
        ${heatmapForIssues(filtered)}
      </div>
    </div>`;
  }

  // --- Issue Cards ---
  if (showSection('cards')) {
    html += `<div class="rpt-page" style="${pageStyle}">
      <div style="padding:20px 26px">
        <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between">
          <span>Issue List (${ft})</span>
          <span style="color:#94a3b8">เรียงตามความเร่งด่วน · NO.</span>
        </div>
        ${filtered.length === 0
          ? '<div style="padding:30px;text-align:center;color:#94a3b8;font-size:13px">ไม่พบ issue ที่ตรงกับ filter</div>'
          : filtered.slice().sort(prioritySort).map(it => reportIssueCard(it, showSection('comments'))).join('')}
      </div>
    </div>`;
  }

  // --- Audit Trail (internal-ops only — never shown to a Client Reviewer) ---
  if (showSection('audit') && state.user.role !== 'Client Reviewer') {
    const aud = getAud();
    html += `<div class="rpt-page rpt-audit" style="${pageStyle}">
      <div style="padding:20px 26px">
        <div style="font-size:10.5px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:14px">Audit Trail (${aud.length} entries)</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#f1f5f9;color:#475569;text-transform:uppercase;letter-spacing:.4px">
            <th style="text-align:left;padding:7px 10px;font-weight:700">Time</th>
            <th style="text-align:left;padding:7px 10px;font-weight:700">No.</th>
            <th style="text-align:left;padding:7px 10px;font-weight:700">Action</th>
            <th style="text-align:left;padding:7px 10px;font-weight:700">Change</th>
            <th style="text-align:left;padding:7px 10px;font-weight:700">User</th>
          </tr></thead>
          <tbody>
            ${aud.slice(0,30).map(a => `<tr style="border-bottom:1px solid #e2e8f0">
              <td style="padding:6px 10px;font-family:JetBrains Mono;color:#64748b">${esc(a.ts)}</td>
              <td style="padding:6px 10px;font-family:JetBrains Mono;color:#3A6EA5;font-weight:600">${a.issueNo?`#${a.issueNo}`:'—'}</td>
              <td style="padding:6px 10px;color:#1a2540">${esc(a.action)}</td>
              <td style="padding:6px 10px;font-family:JetBrains Mono;color:#64748b">${esc(a.oldVal||'∅')} → ${esc(a.newVal||'∅')}</td>
              <td style="padding:6px 10px;color:#1a2540">${esc(a.user)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  if (!html) {
    html = '<div style="padding:60px;text-align:center;color:#94a3b8;font-size:14px;background:#fff;border-radius:6px">ไม่มี section ที่เลือก — ติ๊กอย่างน้อย 1 section ทางขวา</div>';
  }
  return html;
}

function prioritySort(a, b) {
  const order = { 'Critical': 0, 'Major': 1, 'Minor': 2 };
  const oa = order[a.priority] ?? 3, ob = order[b.priority] ?? 3;
  if (oa !== ob) return oa - ob;
  return (+a.no) - (+b.no);
}

function reportIssueCard(it, showComment) {
  const img = getImg(it.no);
  const isClient = state.user.role === 'Client Reviewer';
  const imgBox = img
    ? `<div style="width:130px;aspect-ratio:4/3;border-radius:4px;overflow:hidden;background:#e7ecf3;flex-shrink:0"><img src="${img}" style="width:100%;height:100%;object-fit:cover;display:block" /></div>`
    : `<div style="width:130px;aspect-ratio:4/3;background:linear-gradient(135deg,#1e293b,#334155);border-radius:4px;display:grid;place-items:center;color:#64748b;font-size:9px;font-weight:600;letter-spacing:.5px;flex-shrink:0">VIEWPOINT<br/>#${it.no}</div>`;
  const priCol = it.priority==='Critical'?'#dc2626':it.priority==='Major'?'#ea7f00':'#6b7280';
  const stCol = STATUS_COLOR[it.status] || '#94a3b8';
  return `<div class="issue-card" style="border:1px solid #e2e8f0;border-radius:6px;margin-bottom:10px;overflow:hidden">
    <div style="background:#1F3A5F;color:#fff;padding:8px 14px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:10px">
      <span style="background:rgba(255,255,255,.18);padding:2px 7px;border-radius:4px;font-family:JetBrains Mono">#${it.no}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.title)}</span>
      <span style="background:${priCol};padding:2px 8px;border-radius:3px;font-size:10.5px;font-family:JetBrains Mono">${it.priority}</span>
      <span style="background:${stCol};padding:2px 8px;border-radius:3px;font-size:10.5px;font-family:JetBrains Mono">${it.status}</span>
    </div>
    <div style="display:grid;grid-template-columns:130px 1fr;gap:14px;padding:12px 14px">
      ${imgBox}
      <div style="font-size:11.5px;line-height:1.65">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">
          <div><strong>Discipline:</strong> ${esc(it.disc)}</div>
          <div><strong>Zone:</strong> ${esc(it.zone)}</div>
          <div><strong>Grid:</strong> ${esc(it.grid)}</div>
          <div><strong>Floor:</strong> ${esc(it.floor)}</div>
          ${isClient ? '' : `<div><strong>Author:</strong> ${esc(it.author)}</div>`}
          ${isClient ? '' : `<div><strong>Assignee:</strong> ${esc(it.assignee)}</div>`}
          <div><strong>Age:</strong> ${it.daysOpen} days</div>
        </div>
        ${showComment ? `<div style="margin-top:8px;padding:7px 10px;background:#f1f5f9;border-radius:4px;color:#334155"><strong>Comment:</strong> ${esc(it.comment)}</div>` : ''}
      </div>
    </div>
  </div>`;
}

// Heatmap for a filtered subset (for report preview / PDF)
function heatmapForIssues(arr) {
  const discs = VALID_DISC_CODES;
  const zones = ['ZONE 1','ZONE 2'];
  const grid = {};
  let max = 0;
  arr.forEach(it => {
    const d = it.discPrimary, z = it.zone;
    const k = d + '|' + z;
    grid[k] = (grid[k]||0) + 1;
    if (grid[k] > max) max = grid[k];
  });
  const cells = [];
  cells.push(`<div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600;text-align:center;padding:6px 0">DISC \\ ZONE</div>`);
  zones.forEach(z => cells.push(`<div style="font-size:10.5px;color:#64748b;text-transform:uppercase;font-weight:700;text-align:center;padding:6px 0">${z.replace('ZONE ','Z')}</div>`));
  discs.forEach(d => {
    cells.push(`<div style="font-size:11px;color:${DISC_COLOR[d]};font-weight:700;font-family:JetBrains Mono;padding:6px 4px">${d}</div>`);
    zones.forEach(z => {
      const v = grid[d+'|'+z] || 0;
      const ratio = max > 0 ? v / max : 0;
      let bg, fg = '#1a2540';
      if (v === 0) { bg = '#f7faff'; fg = '#c5cfdf'; }
      else if (ratio < 0.2) bg = '#e8f4ed';
      else if (ratio < 0.4) bg = '#bce6cd';
      else if (ratio < 0.6) bg = '#f7e3b8';
      else if (ratio < 0.8) { bg = '#f5b683'; fg = '#fff'; }
      else { bg = '#dc6c52'; fg = '#fff'; }
      cells.push(`<div style="aspect-ratio:1.7/1;background:${bg};color:${fg};border-radius:4px;display:grid;place-items:center;font-family:JetBrains Mono;font-weight:600;font-size:13px;min-height:32px">${v||'·'}</div>`);
    });
  });
  return `<div style="display:grid;grid-template-columns:80px repeat(${zones.length},1fr);gap:3px">${cells.join('')}</div>`;
}

function renderClashes() {
  return `<div class="page">
    <div class="page-head"><div><h1 class="page-title">Clash Matrix</h1><div class="page-sub">Pairwise clash count ระหว่าง discipline (placeholder)</div></div></div>
    <div class="card">
      <div class="card-b">${clashMatrix()}</div>
    </div>
  </div>`;
}

function clashMatrix() {
  const discs = ['AC','EE','AR','SN','FP','ST','LA','IN'];
  // synthetic counts based on cross-disc occurrences
  const grid = {};
  getIss().forEach(it => {
    const arr = discArray(it.disc);
    for (let i=0;i<arr.length;i++) for (let j=0;j<arr.length;j++) {
      if (i!==j) {
        const k = arr[i]+'|'+arr[j];
        grid[k] = (grid[k]||0) + 1;
      }
    }
  });
  // Also add primary x extra
  let max = 1;
  Object.values(grid).forEach(v => { if (v>max) max=v; });
  // Render
  const cells = [];
  cells.push(`<div class="heat-corner"></div>`);
  discs.forEach(d => cells.push(`<div class="heat-axis" style="color:${DISC_COLOR[d]}">${d}</div>`));
  discs.forEach(d1 => {
    cells.push(`<div class="heat-axis" style="color:${DISC_COLOR[d1]};text-align:left;padding-left:6px;justify-content:flex-start">${d1}</div>`);
    discs.forEach(d2 => {
      if (d1===d2) { cells.push(`<div class="heat-cell" style="background:#1F3A5F;color:#fff">—</div>`); return; }
      const v = grid[d1+'|'+d2] || 0;
      const ratio = v/max;
      let bg,fg='#1a2540';
      if (v===0) { bg='#f7faff'; fg='#c5cfdf'; }
      else if (ratio<0.3) bg='#e8f4ed';
      else if (ratio<0.6) bg='#f7e3b8';
      else { bg='#dc6c52'; fg='#fff'; }
      cells.push(`<div class="heat-cell" style="background:${bg};color:${fg}">${v||'·'}</div>`);
    });
  });
  return `<div class="heat-grid" style="grid-template-columns:80px repeat(${discs.length}, 1fr)">${cells.join('')}</div>`;
}

// ===== Detail slide-over =====
function openDetail(no) {
  const it = getIss().find(i => i.no === no);
  if (!it) return;
  state.activeIssue = no;
  const $so = $('#so'), $bd = $('#so-backdrop');
  // Find issue's audit timeline (filter by no)
  const tl = getAud().filter(a => a.issueNo === no);
  const imgData = getImg(no);
  const canEdit = hasPermission('edit');
  const canDelete = hasPermission('delete');
  const canComment = hasPermission('comment');
  const imgHtml = imgData
    ? `<div class="so-img has-img" style="background-image:url('${imgData}')"${canEdit ? ` ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropImage(event,'${no}')"` : ''}>
         ${canDelete ? `<button class="so-img-remove" onclick="removeImage('${no}')" title="Remove image">${I.trash}</button>` : ''}
         ${canEdit ? `<label class="so-img-upload">${I.image}<span>Replace</span><input type="file" accept="image/*" class="hide" onchange="uploadImage(event,'${no}')"/></label>` : ''}
       </div>`
    : `<div class="so-img"${canEdit ? ` ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="dropImage(event,'${no}')"` : ''}>
         <div class="so-img-txt"><strong>Viewpoint #${it.no}</strong>BIM Model · ${it.grid} · ${it.floor}<br/><span style="opacity:.65;font-size:10px;text-transform:none;letter-spacing:0">${canEdit ? 'ลากรูปมาวาง หรือกดปุ่ม Upload' : 'ยังไม่มีรูป'}</span></div>
         ${canEdit ? `<label class="so-img-upload">${I.upload}<span>Upload Image</span><input type="file" accept="image/*" class="hide" onchange="uploadImage(event,'${no}')"/></label>` : ''}
       </div>`;

  $so.innerHTML = `
    <div class="so-hdr">
      <span class="so-no">#${it.no}</span>
      <div class="so-title-wrap"><div class="so-title">${esc(it.title)}</div></div>
      <button class="so-close" onclick="closeDetail()">${I.close}</button>
    </div>
    <div class="so-body">
      ${imgHtml}
      <div class="meta-grid">
        <div class="meta-row"><div class="meta-lbl">Status</div><div class="meta-val">${stBadge(it.status)}</div></div>
        <div class="meta-row"><div class="meta-lbl">Priority</div><div class="meta-val">${priBadge(it.priority)}</div></div>
        <div class="meta-row"><div class="meta-lbl">Discipline</div><div class="meta-val">${discBadges(it.disc)}</div></div>
        <div class="meta-row"><div class="meta-lbl">Zone</div><div class="meta-val mono">${it.zone}</div></div>
        <div class="meta-row"><div class="meta-lbl">Grid / Floor</div><div class="meta-val mono">${it.grid} / ${it.floor}</div></div>
        <div class="meta-row"><div class="meta-lbl">Age</div><div class="meta-val mono" style="color:${it.daysOpen>14?'#dc2626':'inherit'}">${it.daysOpen} days</div></div>
        <div class="meta-row"><div class="meta-lbl">Author</div><div class="meta-val">${esc(it.author)}</div></div>
        <div class="meta-row"><div class="meta-lbl">Assignee</div><div class="meta-val">${esc(it.assignee)}</div></div>
      </div>

      <div class="so-section-h">${I.comment}<span>Comment / Instruction</span></div>
      <div class="comment-box">${esc(it.comment)}</div>

      <div class="ai-card">
        <div class="ai-h"><span class="ai-dot"></span><span>AI Triage Suggestion</span></div>
        <div class="ai-content">
          ${aiSuggestion(it)}
        </div>
      </div>

      <div class="so-section-h">${I.audit}<span>Activity</span></div>
      <div class="timeline">
        ${(tl.length ? tl : [
          {ts: formatDateTime(it.createdAt), tlAction: `สร้าง issue โดย ${it.author}`},
          {ts: formatDateTime(it.createdAt).replace(/(\d+):(\d+)/, (m,h,mn)=>`${h}:${String(Math.min(59,+mn+15)).padStart(2,'0')}`), tlAction: `Assigned to ${it.assignee}`}
        ]).map(a => `<div class="tl-item">
          <div class="tl-action">${a.tlAction || a.action + ' — ' + (a.newVal||'')}</div>
          <div class="tl-meta">${esc(a.ts)} · ${esc(a.user || it.author)}</div>
        </div>`).join('')}
      </div>

      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
        ${canEdit ? `<button class="btn btn-p" style="flex:1" onclick="openEditIssue('${it.no}')">${I.edit}<span>Edit</span></button>` : ''}
        ${canEdit ? `<button class="btn btn-g" style="flex:1" onclick="markResolved('${it.no}')">${I.check2}<span>${it.status==='RESOLVED'?'Reopen':'Mark Resolved'}</span></button>` : ''}
        ${canDelete ? `<button class="btn btn-d" onclick="confirmDeleteIssue('${it.no}')" title="Delete">${I.trash}</button>` : ''}
        ${!canEdit && !canDelete && !canComment ? `<div style="flex:1;text-align:center;color:var(--muted);font-size:12px;padding:10px">🔒 ดูอย่างเดียว — role ${state.user.role}</div>` : ''}
      </div>
      ${!canEdit && canComment ? `
      <div class="so-section-h" style="margin-top:14px">${I.comment}<span>Add Comment</span></div>
      <textarea id="so-new-comment" placeholder="เขียนความเห็น/สอบถามเกี่ยวกับ issue นี้…" style="width:100%;min-height:64px;resize:vertical;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--text);box-sizing:border-box"></textarea>
      <button class="btn btn-p" style="width:100%;margin-top:8px" onclick="submitComment('${it.no}')">${I.comment}<span>Post Comment</span></button>
      ` : ''}
    </div>`;
  $so.classList.add('open');
  $bd.classList.add('open');
  $so.setAttribute('aria-hidden','false');
}

function aiSuggestion(it) {
  // Generate a fake-but-plausible suggestion
  const map = {
    EE: 'แนะนำให้ <em>ปรับ conduit routing หลบคาน</em> โดยใช้ flexible conduit แบบ EMT ลด clearance เหลือ 50mm — ปกติ resolution time <em>3-5 วัน</em>',
    AC: 'แนะนำให้ <em>ลด duct depth ลง 50mm</em> หรือใช้ rectangular duct เปลี่ยน aspect ratio — เคสคล้ายกัน 8 issues, avg <em>4 วัน</em>',
    AR: 'แนะนำให้ <em>ขยับ partition 100mm</em> ตามแนว grid หรือเพิ่ม opening — coordinate กับ MEP team ก่อน shop drawing',
    SN: 'แนะนำให้ <em>ปรับ slope</em> หรือเพิ่ม cleanout — ตรวจสอบ vent stack ใกล้เคียง',
    FP: 'แนะนำให้ <em>route pipe หลบ structural beam</em> หรือเพิ่ม sleeve — coordinate กับ ST team',
    ST: 'แนะนำให้ <em>เพิ่ม opening ใน shop drawing</em> หรือลด beam depth — ต้องผ่าน structural engineer',
    LA: 'แนะนำให้ <em>ปรับ planter หลบ MEP underground</em> — ตรวจสอบ root barrier',
    IN: 'แนะนำให้ <em>ขยับ built-in 50mm</em> หรือปรับ design ให้หลบ conduit'
  };
  const d = it.discPrimary;
  let baseline = map[d] || 'ไม่มีคำแนะนำสำหรับ discipline นี้';
  if (it.priority === 'Critical' && it.daysOpen > 7) {
    baseline += ' · <em style="color:#fca5a5">Escalate</em>: เปิดเกิน 7 วันและเป็น Critical — แนะนำให้นัดประชุมด่วน';
  }
  return baseline;
}

function closeDetail() {
  $('#so').classList.remove('open');
  $('#so-backdrop').classList.remove('open');
  $('#so').setAttribute('aria-hidden','true');
}

/** Comment-only feedback path for roles without edit rights (e.g. Client Reviewer). */
function submitComment(no) {
  if (!requirePermission('comment', 'คอมเมนต์')) return;
  const ta = $('#so-new-comment');
  const text = ta ? ta.value.trim() : '';
  if (!text) { toast('⚠️ พิมพ์ข้อความก่อน', '#d97706'); return; }
  const it = getIss().find(i => i.no === no);
  const entry = {
    ts: new Date().toLocaleDateString('en-GB').replace(/\//g,'/').slice(0,8) + ' ' + new Date().toTimeString().slice(0,5),
    issueNo: no, issueTitle: it ? it.title : '',
    action: 'Comment Added', field: 'comment', oldVal: '', newVal: text,
    user: state.user.name
  };
  getAud().unshift(entry);
  fbAddAudit(state.projIdx, entry).catch(() => {});
  toast('✓ ส่งความเห็นแล้ว', '#2DBE60');
  openDetail(no); // re-render the slide-over so the new entry shows in Activity
}

// ===== Actions =====
function goPage(p) {
  // Block direct navigation to admin-only pages
  if (p === 'users' && !hasPermission('users')) {
    toast(`🚫 หน้านี้สำหรับ Admin เท่านั้น (role: ${state.user.role})`, '#dc2626');
    return;
  }
  if (p === 'audit' && state.user.role === 'Client Reviewer') {
    toast(`🚫 หน้านี้ไม่เปิดให้ Client Reviewer`, '#dc2626');
    return;
  }
  state.page = p;
  state.selected.clear();
  render();
  window.scrollTo(0,0);
}
function setFilter(key, val) {
  state.filters[key] = val;
  state.pageNum = 1;
  if (state.page === 'issues') render();
}
/** Jumps to Issues filtered to whatever's tagged OWNER — the "what's stuck on the owner" quick view. */
function showOwnerBlockedIssues() {
  state.filters = { status:'all', disc:'OWNER', prio:'all', zone:'all', q:'' };
  state.pageNum = 1;
  goPage('issues');
}
function goPageNum(n) {
  state.pageNum = n;
  render();
}
function toggleRow(no) {
  if (state.selected.has(no)) state.selected.delete(no);
  else state.selected.add(no);
  render();
}
function toggleSelectAll() {
  const filtered = getFiltered();
  const start = (state.pageNum - 1) * state.pageSize;
  const slice = filtered.slice(start, start + state.pageSize);
  const all = slice.every(it => state.selected.has(it.no));
  slice.forEach(it => all ? state.selected.delete(it.no) : state.selected.add(it.no));
  render();
}
function clearSelection() {
  state.selected.clear();
  render();
}
function quickField(no, field, val) {
  if (!requirePermission('edit', 'แก้ไข issue')) return;
  const it = getIss().find(i => i.no === no);
  if (!it) return;
  const old = it[field];
  it[field] = val;
  fbSaveIssue(state.projIdx, it).catch(e => console.warn('Firestore:', e));
  toast(`✓ #${no}: ${field} ${old} → ${val}`, '#2DBE60');
  // re-render to update colors but keep scroll
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}
function bulkUpdate(field, val) {
  if (!requirePermission('edit', 'แก้ไข issues')) return;
  if (!val) return;
  state.selected.forEach(no => {
    const it = getIss().find(i => i.no === no);
    if (it) {
      it[field] = val;
      fbSaveIssue(state.projIdx, it).catch(e => console.warn('Firestore:', e));
    }
  });
  toast(`✓ Updated ${state.selected.size} issues — ${field}: ${val}`, '#2DBE60');
  state.selected.clear();
  render();
}
function bulkDelete() {
  if (!requirePermission('delete', 'ลบ issues')) return;
  const n = state.selected.size;
  state.selected.forEach(no => {
    const idx = getIss().findIndex(i => i.no === no);
    if (idx >= 0) {
      getIss().splice(idx, 1);
      fbDeleteIssue(state.projIdx, no).catch(e => console.warn('Firestore:', e));
      fbDeleteImage(state.projIdx, no).catch(e => console.warn('Storage:', e));
    }
  });
  toast(`❌ Deleted ${n} issues`, '#dc2626');
  state.selected.clear();
  render();
}

// ===== Command palette =====
function openCmd() {
  $('#cmdk').classList.add('open');
  $('#cmdk-q').value = '';
  renderCmdList('');
  setTimeout(() => $('#cmdk-q').focus(), 50);
}
function closeCmd() { $('#cmdk').classList.remove('open'); }
function renderCmdList(q) {
  q = q.toLowerCase().trim();
  const pages = [
    { type:'page', name:'Dashboard', id:'dashboard' },
    { type:'page', name:'Issues', id:'issues' },
    { type:'page', name:'Analytics', id:'analytics' },
    { type:'page', name:'Publish Report', id:'report' },
    { type:'page', name:'Projects', id:'projects' },
    { type:'page', name:'Users & Roles', id:'users' },
    { type:'page', name:'Audit Log', id:'audit' }
  ];
  const matchedPages = q ? pages.filter(p => p.name.toLowerCase().includes(q)) : pages;
  const matchedIssues = q ? getIss().filter(i => i.title.toLowerCase().includes(q) || i.no.includes(q)).slice(0,8) : getIss().slice(0,6);
  let html = '';
  if (matchedPages.length) {
    html += '<div class="cmdk-sec">Pages</div>';
    html += matchedPages.map(p => `<div class="cmdk-item" data-type="page" data-id="${p.id}">${I[p.id]||I.dashboard}<span class="ci-name">${esc(p.name)}</span><span class="ci-tag">↵</span></div>`).join('');
  }
  if (matchedIssues.length) {
    html += '<div class="cmdk-sec">Issues</div>';
    html += matchedIssues.map(i => `<div class="cmdk-item" data-type="issue" data-id="${i.no}"><span class="ci-no">#${i.no}</span><span class="ci-name">${esc(i.title)}</span><span class="ci-tag">${i.discPrimary}</span></div>`).join('');
  }
  if (!html) html = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">ไม่พบผลลัพธ์</div>';
  $('#cmdk-list').innerHTML = html;
}

// ===== Main render =====
function render() {
  $('#app').innerHTML = `<div class="layout">
    ${renderSidebar()}
    <div class="main">
      ${renderHeader()}
      ${state.page==='dashboard' ? renderDashboard() :
        state.page==='issues' ? renderIssues() :
        state.page==='analytics' ? renderAnalytics() :
        state.page==='report' ? renderReport() :
        state.page==='projects' ? renderProjects() :
        state.page==='users' ? renderUsers() :
        state.page==='audit' ? renderAudit() :
        state.page==='clashes' ? renderClashes() : ''}
    </div>
  </div>`;

  // Wire sidebar nav
  $$('.ni').forEach(n => n.addEventListener('click', () => goPage(n.dataset.page)));
  // Wire recent issue rows
  $$('tr.row-clickable').forEach(r => r.addEventListener('click', () => openDetail(r.dataset.no)));
  // Search trigger
  $('#search-trigger').addEventListener('click', openCmd);
}

// Init
// ============== Firebase Auth gate ==============
function showAuthGate() {
  let gate = document.getElementById('auth-gate');
  if (gate) { gate.style.display = 'flex'; return; }
  gate = document.createElement('div');
  gate.id = 'auth-gate';
  gate.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:linear-gradient(160deg,#06101e 0%,#0d1f3c 60%,#0a2040 100%)',
    'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0'
  ].join(';');
  gate.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:28px;padding:48px 36px;max-width:420px;width:100%">
      <!-- Logo + title -->
      <div style="text-align:center">
        <div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;background:linear-gradient(135deg,#3A6EA5,#1F3A5F);border-radius:16px;margin-bottom:16px;box-shadow:0 8px 32px rgba(58,110,165,.4)">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </div>
        <div style="font-family:Montserrat;font-weight:800;font-size:13px;letter-spacing:3px;color:#3A6EA5;text-transform:uppercase;margin-bottom:8px">TEAM · CM</div>
        <h1 style="font-family:Montserrat;font-weight:800;font-size:26px;color:#f1f5f9;margin:0 0 10px;line-height:1.2">BIM Coordination<br/>Dashboard</h1>
        <p style="font-family:Sarabun;color:#64748b;font-size:14px;margin:0">เข้าสู่ระบบด้วย Google Account ของทีม</p>
      </div>
      <!-- Sign-in buttons -->
      <div style="display:flex;flex-direction:column;gap:10px;width:100%">
        <button onclick="fbSignInMicrosoft().catch(e=>toast('❌ '+e.message,'#dc2626'))"
          style="display:flex;align-items:center;gap:12px;padding:14px 28px;background:#fff;color:#1a2540;border:none;border-radius:12px;font-family:Montserrat;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 4px 24px rgba(0,0,0,.3);transition:transform .15s,box-shadow .15s;width:100%;justify-content:center"
          onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 32px rgba(0,0,0,.4)'"
          onmouseout="this.style.transform='';this.style.boxShadow='0 4px 24px rgba(0,0,0,.3)'">
          <svg width="20" height="20" viewBox="0 0 23 23"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="12" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="12" width="10" height="10" fill="#00A4EF"/><rect x="12" y="12" width="10" height="10" fill="#FFB900"/></svg>
          Sign in with Microsoft / Outlook
        </button>
        <div style="display:flex;align-items:center;gap:10px;font-size:11px;color:#475569;margin:4px 0">
          <div style="flex:1;height:1px;background:#334155"></div>
          <span>หรือ</span>
          <div style="flex:1;height:1px;background:#334155"></div>
        </div>
        <button onclick="fbSignIn().catch(e=>toast('❌ '+e.message,'#dc2626'))"
          style="display:flex;align-items:center;gap:12px;padding:11px 22px;background:transparent;color:#cbd5e1;border:1px solid #334155;border-radius:10px;font-family:Montserrat;font-weight:600;font-size:13px;cursor:pointer;transition:background .15s;width:100%;justify-content:center"
          onmouseover="this.style.background='rgba(255,255,255,.04)'"
          onmouseout="this.style.background='transparent'">
          <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          Sign in with Google (admin)
        </button>
      </div>
      <p style="font-family:Sarabun;font-size:12px;color:#334155;text-align:center;line-height:1.6">
        🔒 เฉพาะ <strong style="color:#94a3b8">@teamcm.co.th</strong> เท่านั้น<br/>
        ข้อมูลทั้งหมดบันทึกลง Firebase อัตโนมัติ
      </p>
    </div>`;
  document.body.appendChild(gate);
}

// ===== Access control =====
// Restrict app to TEAM·CM domain only. Edit these lists to manage access.
const ALLOWED_DOMAINS = ['teamcm.co.th'];
const ADMIN_EMAILS    = ['team_tcm001@teamgstart.com']; // temporary admin override

function isAllowedEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (ADMIN_EMAILS.map(x => x.toLowerCase()).includes(e)) return true;
  const domain = e.split('@')[1] || '';
  if (ALLOWED_DOMAINS.includes(domain)) return true;
  // Pre-invited individually by an Admin, regardless of email domain.
  if (USERS.some(u => (u.email || '').toLowerCase() === e)) return true;
  // Domain allow-listed on a project's client team (Projects → Edit → Client access).
  if (PROJECTS.some(p => (p.clientDomains || []).map(d => d.toLowerCase()).includes(domain))) return true;
  return false;
}

/** Finds the project whose clientDomains includes this email's domain, if any. */
function findClientProjectForEmail(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  return PROJECTS.find(p => (p.clientDomains || []).map(d => d.toLowerCase()).includes(domain)) || null;
}

async function handleAuthStateChange(firebaseUser) {
  const gate = document.getElementById('auth-gate');
  if (!firebaseUser) {
    showAuthGate();
    return;
  }

  // ─── Domain check — reject unauthorized emails ───
  if (!isAllowedEmail(firebaseUser.email)) {
    const blockedEmail = firebaseUser.email;
    try { await fbAuth.signOut(); } catch (e) {}
    showAuthGate();
    setTimeout(() => {
      toast(`🚫 ${blockedEmail} ไม่ได้รับอนุญาต — ใช้ได้เฉพาะ @${ALLOWED_DOMAINS[0]}`, '#dc2626');
    }, 400);
    return;
  }

  // Hide auth gate
  if (gate) gate.style.display = 'none';

  // Load PROJECTS + USERS from Firebase (or seed from data.js on first run)
  try {
    const cloudProjects = await fbLoadProjects();
    if (cloudProjects && cloudProjects.length > 0) {
      PROJECTS.length = 0;
      cloudProjects.forEach(p => PROJECTS.push(p));
    } else {
      await fbSaveProjects(PROJECTS);   // first run → seed
    }
    if (state.projIdx >= PROJECTS.length) state.projIdx = 0;

    const cloudUsers = await fbLoadUsers();
    if (cloudUsers && cloudUsers.length > 0) {
      USERS.length = 0;
      cloudUsers.forEach(u => USERS.push(u));
    } else {
      await fbSaveUsers(USERS);          // first run → seed
    }
  } catch (e) {
    console.warn('Cloud sync (projects/users):', e);
  }

  // ─── Resolve role: lookup USERS by email, auto-add if new ──────────
  const displayName = firebaseUser.displayName || firebaseUser.email.split('@')[0];
  let userRecord = USERS.find(u => (u.email || '').toLowerCase() === firebaseUser.email.toLowerCase());
  if (!userRecord) {
    // First time signing in — internal domain gets DEFAULT_ROLE (Viewer);
    // an email whose domain is allow-listed on a project's client team gets
    // auto-provisioned as a Client Reviewer scoped to that one project.
    const clientProject = findClientProjectForEmail(firebaseUser.email);
    const nextId = USERS.reduce((m, u) => Math.max(m, u.id || 0), 0) + 1;
    userRecord = {
      id: nextId,
      name: displayName,
      email: firebaseUser.email,
      uid: firebaseUser.uid,
      role: clientProject ? DEFAULT_CLIENT_ROLE : DEFAULT_ROLE,
      projectCode: clientProject ? clientProject.code : null,
      lastActive: 'just now'
    };
    USERS.push(userRecord);
    fbSaveUsers(USERS).catch(e => console.warn('Auto-add user:', e));
    toast(clientProject
      ? `👋 ยินดีต้อนรับ ${displayName} — เข้าดูโครงการ ${clientProject.name} ในฐานะ ${DEFAULT_CLIENT_ROLE}`
      : `👋 ยินดีต้อนรับ ${displayName} — ได้รับสิทธิ์ ${DEFAULT_ROLE}`, '#3A6EA5');
  } else {
    // Existing user — refresh displayName from provider (in case it changed)
    if (firebaseUser.displayName && userRecord.name !== firebaseUser.displayName) {
      userRecord.name = firebaseUser.displayName;
    }
    // Backfill uid for users who signed in before this field existed.
    if (!userRecord.uid) userRecord.uid = firebaseUser.uid;
    userRecord.lastActive = 'just now';
    fbSaveUsers(USERS).catch(() => {});
  }

  // Set state.user — role comes from USERS record (not hardcoded)
  state.user = {
    id: userRecord.id,
    name: userRecord.name,
    email: userRecord.email,
    role: userRecord.role,
    projectCode: userRecord.projectCode || null,
    avatar: firebaseUser.photoURL || null,
    lastActive: 'just now'
  };
  // Scoped users land directly on their project, not whatever index 0 is.
  if (state.user.projectCode) {
    const scopedIdx = PROJECTS.findIndex(p => p.code === state.user.projectCode);
    if (scopedIdx >= 0) state.projIdx = scopedIdx;
  }

  // ─── Real-time listeners for global PROJECTS + USERS ───
  fbSubscribeProjects((projects) => {
    if (projects.length === 0) return;
    PROJECTS.length = 0;
    projects.forEach(p => PROJECTS.push(p));
    if (state.projIdx >= PROJECTS.length) state.projIdx = 0;
    render();
  });
  fbSubscribeUsers((users) => {
    if (users.length === 0) return;
    USERS.length = 0;
    users.forEach(u => USERS.push(u));
    // Re-sync current user's role if it was changed by an admin
    if (state.user && state.user.email) {
      const me = USERS.find(u => (u.email || '').toLowerCase() === state.user.email.toLowerCase());
      const meProjectCode = me ? (me.projectCode || null) : null;
      if (me && (me.role !== state.user.role || meProjectCode !== state.user.projectCode)) {
        const oldRole = state.user.role;
        state.user.role = me.role;
        state.user.projectCode = meProjectCode;
        if (meProjectCode) {
          const scopedIdx = PROJECTS.findIndex(p => p.code === meProjectCode);
          if (scopedIdx >= 0) state.projIdx = scopedIdx;
        }
        toast(`🔄 สิทธิ์ของคุณเปลี่ยนเป็น ${me.role} (เดิม ${oldRole})`, '#3A6EA5');
        render();
        return;
      }
    }
    if (state.page === 'users') render();
  });

  // Load project data from Firebase (sets up issues + audit listeners)
  await loadProjectData(state.projIdx);
}

async function loadProjectData(projIdx) {
  try {
    const issues = await fbLoadIssues(projIdx);
    if (issues === null) {
      // First time — seed RTDB from mock data
      toast('🌱 กำลัง setup project ครั้งแรก…', '#3A6EA5');
      await fbSeedIssues(projIdx, PROJECT_ISSUES[projIdx] || []);
      toast(`✓ Project ready · ${(PROJECT_ISSUES[projIdx] || []).length} issues`, '#2DBE60');
    } else {
      // Auto-fix disciplines on load (repairs PT0001 data from old CSV import bug)
      let fixedCount = 0;
      issues.forEach(it => {
        if (autoFixIssueDisc(it)) fixedCount++;
        if (it.imageUrl && it.imageUrl.startsWith('http')) {
          state.imgStore[`p${projIdx}_${it.no}`] = it.imageUrl;
        }
      });
      PROJECT_ISSUES[projIdx] = issues;
      if (fixedCount > 0) {
        toast(`🔧 ซ่อม disciplines ${fixedCount} issues — กำลังบันทึก…`, '#3A6EA5');
        fbSeedIssues(projIdx, issues).then(() => {
          toast(`✓ Synced · ${issues.length} issues (fixed ${fixedCount})`, '#2DBE60');
        }).catch(e => console.warn('Firebase resave:', e));
      } else {
        toast(`🔴 Live sync · ${issues.length} issues`, '#2DBE60');
      }
    }
  } catch (e) {
    console.error('Firebase load error:', e);
    toast('⚠️ Offline mode — ใช้ข้อมูล local', '#d97706');
  }

  // ─── Real-time listeners — auto-update when other devices write ───
  fbSubscribeIssues(projIdx, (issues) => {
    // Normalize disciplines on every update
    issues.forEach(it => {
      autoFixIssueDisc(it);
      if (it.imageUrl && it.imageUrl.startsWith('http')) {
        state.imgStore[`p${projIdx}_${it.no}`] = it.imageUrl;
      }
    });
    PROJECT_ISSUES[projIdx] = issues;
    render();
  });
  fbSubscribeAudit(projIdx, (audit) => {
    PROJECT_AUDIT[projIdx] = audit;
    if (['audit','dashboard','analytics'].includes(state.page)) render();
  });

  render();
}

document.addEventListener('DOMContentLoaded', () => {
  // Apply theme immediately (before auth resolves)
  applyTheme();

  // Backdrop click closes slide-over
  $('#so-backdrop').addEventListener('click', closeDetail);

  // Command palette events
  $('#cmdk').addEventListener('click', (e) => { if (e.target.id === 'cmdk') closeCmd(); });
  $('#cmdk-q').addEventListener('input', (e) => renderCmdList(e.target.value));
  $('#cmdk-list').addEventListener('click', (e) => {
    const item = e.target.closest('.cmdk-item');
    if (!item) return;
    if (item.dataset.type === 'page') { closeCmd(); goPage(item.dataset.id); }
    else if (item.dataset.type === 'issue') { closeCmd(); openDetail(item.dataset.id); }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmd(); }
    if (e.key === 'Escape') { closeCmd(); closeDetail(); }
  });

  // File input handlers
  $('#csv-input').addEventListener('change', handleCsvFile);

  // Notification / menu close on outside click
  document.addEventListener('click', (e) => {
    const pop = $('#notif-pop');
    if (pop && pop.classList.contains('open') && !e.target.closest('#notif-pop') && !e.target.closest('[title="Notifications"]')) {
      pop.classList.remove('open');
    }
    const projMenu = $('#proj-menu');
    if (projMenu && projMenu.classList.contains('open') && !e.target.closest('#proj-menu') && !e.target.closest('#proj-switch')) {
      projMenu.classList.remove('open');
    }
    document.querySelectorAll('.proj-actions').forEach(m => {
      if (m.style.display === 'block' && !e.target.closest('.proj-card-menu')) {
        m.style.display = 'none';
      }
    });
    $$('.ms-menu.open').forEach(m => { if (!e.target.closest('.ms-wrap')) m.classList.remove('open'); });
  });

  // Show auth gate, then wait for Firebase to resolve auth state
  showAuthGate();
  fbAuth.onAuthStateChanged(handleAuthStateChange);
});

// ============== Theme ==============
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
}
function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('tcm_theme', state.theme);
  applyTheme();
  render();
  toast(state.theme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode');
}

// ============== Image upload ==============
function persistImgs() {
  try {
    localStorage.setItem('tcm_imgs', JSON.stringify(state.imgStore));
  } catch (e) {
    toast('⚠️ Storage เต็ม — ลบรูปเก่าหรือใช้ขนาดเล็กลง', '#d97706');
  }
}
function readImageAsDataURL(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        // Downscale if too large
        let w = img.width, h = img.height;
        if (Math.max(w, h) > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function _handleImageFile(file, no) {
  if (!file.type.startsWith('image/')) { toast('⚠️ ต้องเป็นไฟล์รูปภาพ', '#d97706'); return; }
  try {
    // Show locally first (base64 preview)
    const data = await readImageAsDataURL(file);
    setImg(no, data);
    persistImgs();
    toast(`✓ อัปเดตรูป Issue #${no}`, '#2DBE60');
    openDetail(no);
    // Upload to Firebase Storage in background, then persist URL in Firestore
    fbUploadDataUrl(state.projIdx, no, data).then(url => {
      setImg(no, url);
      const it = getIss().find(i => i.no === no);
      if (it) { it.imageUrl = url; fbSaveIssue(state.projIdx, it).catch(() => {}); }
    }).catch(e => console.warn('Storage upload:', e));
  } catch (e) {
    toast('❌ อัปโหลดรูปไม่สำเร็จ', '#dc2626');
  }
}
async function uploadImage(event, no) {
  if (!requirePermission('edit', 'อัปโหลดรูป')) return;
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  await _handleImageFile(file, no);
}
async function dropImage(event, no) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!requirePermission('edit', 'อัปโหลดรูป')) return;
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  await _handleImageFile(file, no);
}
function removeImage(no) {
  if (!requirePermission('delete', 'ลบรูป')) return;
  if (!confirm(`ลบรูปของ Issue #${no}?`)) return;
  delImg(no);
  persistImgs();
  toast(`✓ ลบรูป Issue #${no}`);
  openDetail(no);
}

// ============== Notifications ==============
function buildNotifications() {
  // Derive from audit log
  state.notifications = getAud().slice(0, 7).map((a, i) => ({
    id: i,
    ts: a.ts,
    text: a.action === 'Status Change' ? `#${a.issueNo} เปลี่ยนสถานะเป็น ${a.newVal}` :
          a.action === 'Issue Created' ? `เพิ่ม Issue ใหม่ #${a.issueNo}` :
          a.action === 'Priority Change' ? `#${a.issueNo} priority → ${a.newVal}` :
          a.action === 'CSV Import' ? `Import CSV — ${a.newVal}` :
          `${a.action} · #${a.issueNo}`,
    user: a.user,
    read: i > 2
  }));
}
function renderNotifList() {
  if (!state.notifications.length) buildNotifications();
  return state.notifications.map(n => `
    <div class="notif-item ${n.read?'read':''}" onclick="readNotif(${n.id})">
      <div class="ni-dot"></div>
      <div class="ni-body">
        <div>${esc(n.text)}</div>
        <div class="ni-time">${esc(n.ts)} · ${esc(n.user.split(' ')[0])}</div>
      </div>
    </div>`).join('') || '<div style="padding:24px;text-align:center;color:var(--muted);font-size:12.5px">ไม่มี notifications</div>';
}
function toggleNotif(e) {
  e.stopPropagation();
  $('#notif-pop').classList.toggle('open');
}
function readNotif(id) {
  const n = state.notifications.find(x => x.id === id);
  if (n) n.read = true;
  $('#notif-list').innerHTML = renderNotifList();
  // also clear the red dot on bell
  const dot = document.querySelector('[title="Notifications"] .dot');
  if (state.notifications.every(x => x.read) && dot) dot.style.display = 'none';
}
function markAllRead() {
  state.notifications.forEach(n => n.read = true);
  $('#notif-list').innerHTML = renderNotifList();
  const dot = document.querySelector('[title="Notifications"] .dot');
  if (dot) dot.style.display = 'none';
  toast('✓ Marked all as read');
}

// ============== Modal helpers ==============
function openModal(html) {
  const host = $('#modal-host');
  host.innerHTML = html;
  host.classList.add('open');
  host.setAttribute('aria-hidden','false');
  host.onclick = (e) => { if (e.target === host) closeModal(); };
}
function closeModal() {
  const host = $('#modal-host');
  host.classList.remove('open');
  host.innerHTML = '';
  host.setAttribute('aria-hidden','true');
}

// ============== Multi-select for disciplines ==============
function renderDiscMultiSelect() {
  const DISC_LIST = [
    { key:'AR', label:'AR — Architecture' },
    { key:'ST', label:'ST — Structure' },
    { key:'AC', label:'AC — Air Conditioning' },
    { key:'EE', label:'EE — Electrical' },
    { key:'SN', label:'SN — Sanitary' },
    { key:'FP', label:'FP — Fire Protection' },
    { key:'LA', label:'LA — Landscape' },
    { key:'IN', label:'IN — Interior' },
    { key:'OWNER', label:'OWNER — รอการตัดสินใจจากเจ้าของโครงการ' }
  ];
  const selected = state.reportOpts.disciplines;
  const trigger = selected.length === 0
    ? `<span class="ms-placeholder">All disciplines</span>`
    : selected.map(d => `<span class="ms-tag">${d}<span class="ms-x" onclick="event.stopPropagation();discMSToggle('${d}')">×</span></span>`).join('');

  // Quick presets
  const presets = [
    { label:'MEP (AC+EE+SN+FP)', keys:['AC','EE','SN','FP'] },
    { label:'Architecture (AR+IN+LA)', keys:['AR','IN','LA'] },
    { label:'Structure only', keys:['ST'] }
  ];

  return `<div class="ms-wrap">
    <button type="button" class="ms-trigger" onclick="discMSOpen(event)">
      ${trigger}
    </button>
    <div class="ms-menu" id="disc-ms-menu">
      <div class="ms-opt" onclick="discMSSetAll()">
        <span class="ck ${selected.length===0?'checked':''}"></span>
        <span style="flex:1;font-weight:600">All disciplines</span>
        <span class="ci-tag" style="font-size:10px;color:var(--muted)">${DISC_LIST.length}</span>
      </div>
      <div class="ms-divider"></div>
      ${DISC_LIST.map(d => `
        <div class="ms-opt" onclick="discMSToggle('${d.key}')">
          <span class="ck ${selected.includes(d.key)?'checked':''}"></span>
          <span style="flex:1">${d.label}</span>
          <span class="badge b-${d.key.toLowerCase()}" style="font-size:9.5px">${d.key}</span>
        </div>`).join('')}
      <div class="ms-divider"></div>
      <div style="display:flex;gap:6px;padding:4px 4px 2px;flex-wrap:wrap">
        ${presets.map(p => `<span class="ms-action" onclick="discMSPreset(${JSON.stringify(p.keys).replace(/\"/g,'&quot;')})">${esc(p.label)}</span>`).join('')}
      </div>
    </div>
  </div>`;
}
function discMSOpen(e) {
  e.stopPropagation();
  $$('.ms-menu.open').forEach(m => m.classList.remove('open'));
  $('#disc-ms-menu').classList.toggle('open');
}
function discMSToggle(key) {
  const arr = state.reportOpts.disciplines;
  const idx = arr.indexOf(key);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(key);
  render();
  // keep menu open
  setTimeout(() => { const m = $('#disc-ms-menu'); if (m) m.classList.add('open'); }, 10);
}
function discMSSetAll() {
  state.reportOpts.disciplines = [];
  render();
}
function discMSPreset(keys) {
  state.reportOpts.disciplines = keys;
  render();
  setTimeout(() => { const m = $('#disc-ms-menu'); if (m) m.classList.add('open'); }, 10);
}
function toggleReportSection(key) {
  const arr = state.reportOpts.sections;
  const idx = arr.indexOf(key);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push(key);
  render();
}

// ============== CSV Import / Export ==============
function triggerImportCSV() {
  if (!requirePermission('import', 'นำเข้า CSV')) return;
  $('#csv-input').value = '';
  $('#csv-input').click();
}
async function fetchImageAsDataURL(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ===== ZIP / multi-file image import helpers =====
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Index a single image into imgMap with multiple lookup keys
function addToImgMap(imgMap, filename, dataUrl) {
  const name = filename.split('/').pop().split('\\').pop();
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) return;
  // Pattern "1_..." → key "1" (leading running number)
  const m1 = name.match(/^(\d+)[_\-]/);
  if (m1) imgMap[m1[1]] = dataUrl;
  // Pattern "1_134_..." → key "134" (issue NO. after running number)
  const m2 = name.match(/^\d+[_\-](\d+)[_\-]/);
  if (m2) imgMap[m2[1]] = dataUrl;
  // Filename without extension
  const noExt = name.replace(/\.\w+$/, '');
  imgMap[noExt] = dataUrl;
  // Full filename
  imgMap[name] = dataUrl;
}

// Extract images from a ZIP ArrayBuffer using JSZip
async function extractZipToImgMap(arrayBuffer, imgMap) {
  if (typeof JSZip === 'undefined') {
    toast('⚠️ JSZip ยังไม่โหลด — ลอง reload เว็บ', '#d97706');
    return 0;
  }
  let added = 0;
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const promises = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const name = path.split('/').pop().split('\\').pop();
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!['png','jpg','jpeg','gif','webp'].includes(ext)) return;
      promises.push(entry.async('base64').then(b64 => {
        const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' };
        const mime = mimeMap[ext] || 'image/png';
        addToImgMap(imgMap, name, `data:${mime};base64,${b64}`);
        added++;
      }));
    });
    await Promise.all(promises);
  } catch (e) {
    console.error('ZIP extract:', e);
    toast(`⚠️ ZIP error: ${e.message}`, '#d97706');
  }
  return added;
}

// Valid TEAM·CM discipline codes
const VALID_DISC_CODES = ['EE','AC','AR','SN','FP','ST','LA','IN','OWNER'];

// Extract discipline from TEAM·CM title pattern: {runNo}_{issNo}_{date}_{zone}_{disc}_...
function extractDiscFromTitle(title) {
  if (!title) return null;
  const parts = String(title).split('_');
  // Try position 4 first (standard pattern)
  for (let i = 3; i <= Math.min(5, parts.length - 1); i++) {
    const candidate = (parts[i] || '').trim().toUpperCase();
    if (VALID_DISC_CODES.includes(candidate)) return candidate;
  }
  // Fallback: scan all parts for a valid 2-letter code
  for (const p of parts) {
    const c = p.trim().toUpperCase();
    if (VALID_DISC_CODES.includes(c)) return c;
  }
  return null;
}

// Repair issue.disc / discPrimary if it looks wrong (e.g. has the full title)
function autoFixIssueDisc(it) {
  if (!it) return false;
  const code = String(it.discPrimary || '').trim().toUpperCase();
  if (VALID_DISC_CODES.includes(code)) {
    it.discPrimary = code;  // normalize case
    return false;
  }
  const fromTitle = extractDiscFromTitle(it.title);
  if (fromTitle) {
    it.discPrimary = fromTitle;
    it.disc = fromTitle;
    return true;
  }
  // Last resort default
  it.discPrimary = 'EE';
  it.disc = 'EE';
  return true;
}

// Find best image match for an issue using imgMap (by NO. / title / hyperlink)
function findImageForIssue(imgMap, issue) {
  if (!imgMap || Object.keys(imgMap).length === 0) return null;
  // 1) direct match by issue NO.
  if (imgMap[issue.no]) return imgMap[issue.no];
  // 2) leading number in title (e.g. "134_20260401_..." → "134")
  if (issue.title) {
    const tm = issue.title.match(/^(\d+)[_\-]/);
    if (tm && imgMap[tm[1]]) return imgMap[tm[1]];
  }
  // 3) parse imageUrl field if HYPERLINK("path\file.png","label")
  if (issue.imageUrl) {
    const hm = issue.imageUrl.match(/HYPERLINK\(["']([^"']+)/i);
    if (hm) {
      const fn = hm[1].replace(/\\/g, '/').split('/').pop();
      if (imgMap[fn]) return imgMap[fn];
      const noExt = fn.replace(/\.\w+$/, '');
      if (imgMap[noExt]) return imgMap[noExt];
      const m1 = fn.match(/^(\d+)[_\-]/);
      if (m1 && imgMap[m1[1]]) return imgMap[m1[1]];
      const m2 = fn.match(/^\d+[_\-](\d+)[_\-]/);
      if (m2 && imgMap[m2[1]]) return imgMap[m2[1]];
    }
    // Or just a plain filename / URL
    if (imgMap[issue.imageUrl]) return imgMap[issue.imageUrl];
  }
  return null;
}

async function handleCsvFile(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  // Separate files by type
  const csvFiles = [], zipFiles = [], imageFiles = [];
  for (const f of files) {
    const n = f.name.toLowerCase();
    if (n.endsWith('.csv')) csvFiles.push(f);
    else if (n.endsWith('.zip')) zipFiles.push(f);
    else if (f.type.startsWith('image/')) imageFiles.push(f);
  }

  // Build image map from all uploaded ZIPs / images
  const imgMap = {};
  if (zipFiles.length || imageFiles.length) {
    toast(`📦 กำลังโหลด ${zipFiles.length} ZIP + ${imageFiles.length} รูป…`, '#3A6EA5');
    for (const f of imageFiles) {
      try { addToImgMap(imgMap, f.name, await fileToDataUrl(f)); } catch (err) { console.warn(err); }
    }
    for (const f of zipFiles) {
      try { await extractZipToImgMap(await f.arrayBuffer(), imgMap); } catch (err) { console.warn(err); }
    }
    toast(`✓ Loaded ${Object.keys(imgMap).length} image keys`, '#2DBE60');
  }

  // No CSV → just match images to existing issues
  if (csvFiles.length === 0) {
    if (Object.keys(imgMap).length === 0) {
      toast('⚠️ ไม่พบไฟล์ที่รองรับ', '#d97706');
      return;
    }
    let matched = 0;
    getIss().forEach(it => {
      const img = findImageForIssue(imgMap, it);
      if (img) { setImg(it.no, img); matched++; }
    });
    persistImgs();
    toast(`✓ จับคู่รูปกับ ${matched} issues`, matched > 0 ? '#2DBE60' : '#d97706');
    render();
    return;
  }

  // Process first CSV file with imgMap available
  const file = csvFiles[0];
  const reader = new FileReader();
  reader.onload = async ev => {
    const text = ev.target.result;
    const rows = parseCSV(text);
    if (rows.length < 2) { toast('⚠️ CSV ว่างหรือไม่ถูกต้อง', '#d97706'); return; }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));

    // Map column indices from header. Note: 'discription' (typo for 'description')
    // must be matched as title, NOT as discipline.
    const col = {
      no:       header.findIndex(h => h === 'no.' || h === 'no'),
      title:    header.findIndex(h => h.includes('viewpoint') || h.includes('discription') || h.includes('description') || h === 'title'),
      // Discipline column: exact match only, exclude 'discription' typo
      disc:     header.findIndex(h => h === 'discipline' || h === 'disc' || h === 'disc.'),
      zone:     header.findIndex(h => h === 'zone'),
      floor:    header.findIndex(h => h === 'floor'),
      grid:     header.findIndex(h => h === 'grid'),
      priority: header.findIndex(h => h.includes('priority')),
      status:   header.findIndex(h => h === 'status'),
      comment:  header.findIndex(h => h.includes('comment')),
      author:   header.findIndex(h => h.includes('author')),
      assignee: header.findIndex(h => h.includes('assignee')),
      daysOpen: header.findIndex(h => h.includes('days')),
      imageUrl: header.findIndex(h => h.includes('image') || h.includes('hyperlink') || (h.includes('link') && !h.includes('discipline')))
    };

    // Detect TEAM·CM CSV format: individual discipline columns (AR, ST, LA, IN, SN, AC, EE, FP)
    const discColMap = {};
    header.forEach((h, idx) => {
      const u = h.toUpperCase().trim();
      if (VALID_DISC_CODES.includes(u)) discColMap[u] = idx;
    });
    const hasIndividualDiscCols = Object.keys(discColMap).length >= 2;

    const get = (row, idx, def = '') => (idx >= 0 && idx < row.length) ? row[idx].trim() : def;

    let maxNo = Math.max(...getIss().map(i => +i.no || 0), 0);
    let importedCount = 0;
    const imageQueue = [];
    const uploadQueue = []; // Local images to upload to Cloud Storage (for persistence)
    const newIssues = [];

    for (const row of dataRows) {
      const rawNo = get(row, col.no);
      const existingIdx = rawNo ? getIss().findIndex(i => i.no === rawNo) : -1;
      const no = rawNo || String(++maxNo);

      // ─── Determine discipline ───
      let disc;
      if (hasIndividualDiscCols) {
        // TEAM·CM format: collect each column with a non-empty mark (X / *)
        const marks = [];
        for (const code of VALID_DISC_CODES) {
          if (discColMap[code] !== undefined) {
            const val = (row[discColMap[code]] || '').trim();
            if (val) marks.push(code);
          }
        }
        disc = marks.length ? marks.join(', ') : 'EE';
      } else {
        disc = get(row, col.disc, 'EE');
      }
      let discPrimary = disc.split(',')[0].trim().toUpperCase();
      // Safety: if discPrimary isn't a known code, try extracting from title
      if (!VALID_DISC_CODES.includes(discPrimary)) {
        const fromTitle = extractDiscFromTitle(get(row, col.title, ''));
        if (fromTitle) { discPrimary = fromTitle; disc = fromTitle; }
        else { discPrimary = 'EE'; disc = 'EE'; }
      }

      const issue = {
        no,
        title:      get(row, col.title,    'Issue #' + no),
        disc,
        discPrimary,
        zone:       get(row, col.zone,     'ZONE 1'),
        floor:      get(row, col.floor,    '—'),
        grid:       get(row, col.grid,     '—'),
        priority:   get(row, col.priority, 'Major'),
        status:     get(row, col.status,   'NEW'),
        comment:    get(row, col.comment,  COMMENTS[discPrimary] || ''),
        daysOpen:   parseInt(get(row, col.daysOpen, '0')) || 0,
        author:     get(row, col.author,   state.user.name),
        assignee:   get(row, col.assignee, discPrimary + ' Team'),
        createdAt:  new Date().toISOString()
      };

      if (existingIdx >= 0) {
        getIss()[existingIdx] = Object.assign({}, getIss()[existingIdx], issue, { no: rawNo });
      } else {
        newIssues.push(issue);
      }
      importedCount++;

      const imgUrl = get(row, col.imageUrl);
      if (imgUrl) issue.imageUrl = imgUrl;

      // Try matching from uploaded ZIP/image map first
      const localImg = findImageForIssue(imgMap, issue);
      if (localImg) {
        setImg(no, localImg);
        // Queue for Cloud Storage upload so rูปไม่หายตอน reload หรือเปลี่ยน device
        uploadQueue.push({ no, dataUrl: localImg });
      } else if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
        // Only queue HTTP URLs for async fetch — skip Excel HYPERLINK formulas
        imageQueue.push({ no, url: imgUrl });
      }
    }

    // Prepend new issues (reverse so order matches CSV top-to-bottom)
    for (let i = newIssues.length - 1; i >= 0; i--) getIss().unshift(newIssues[i]);

    getAud().unshift({
      ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
      issueNo: '', issueTitle: file.name,
      action: 'CSV Import', field: '', oldVal: '', newVal: importedCount + ' rows',
      user: state.user.name
    });

    state.notifications = [];
    // persist any images matched from uploaded ZIP/images
    const localImgCount = Object.keys(imgMap).length > 0
      ? getIss().filter(it => getImg(it.no)).length
      : 0;
    if (localImgCount > 0) persistImgs();
    toast(`✓ Import ${importedCount} issues${localImgCount ? ` · จับคู่รูป ${localImgCount}` : ''}${imageQueue.length ? ` · โหลดเพิ่ม ${imageQueue.length} รูป…` : ''}`, '#2DBE60');
    // Sync all imported issues to RTDB in one batch
    fbSeedIssues(state.projIdx, getIss()).catch(e => console.warn('Firebase seed:', e));
    fbAddAudit(state.projIdx, getAud()[0]).catch(() => {});
    render();

    // Upload local images (from ZIP/files) to Cloud Storage for persistence
    if (uploadQueue.length > 0) {
      toast(`⬆️ อัปโหลดรูป ${uploadQueue.length} ภาพไป Cloud Storage…`, '#3A6EA5');
      let uploaded = 0, failed = 0;
      for (const item of uploadQueue) {
        try {
          const url = await fbUploadDataUrl(state.projIdx, item.no, item.dataUrl);
          // Replace localStorage data URL with public Cloud Storage URL
          setImg(item.no, url);
          const it = getIss().find(i => i.no === item.no);
          if (it) {
            it.imageUrl = url;
            fbSaveIssue(state.projIdx, it).catch(() => {});
          }
          uploaded++;
        } catch (e) {
          console.warn('Storage upload failed #' + item.no + ':', e);
          failed++;
        }
      }
      persistImgs();
      toast(
        `✓ อัปโหลดรูป ${uploaded}/${uploadQueue.length} ไป Cloud Storage` + (failed ? ` · ล้มเหลว ${failed}` : ''),
        uploaded > 0 ? '#2DBE60' : '#d97706'
      );
    }

    // Fetch images from HTTP URLs in CSV (only those not matched locally)
    if (imageQueue.length > 0) {
      let imageCount = 0, failedImages = 0;
      for (const item of imageQueue) {
        try {
          // Fetch remote image as blob
          const res = await fetch(item.url);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          // Upload to Firebase Storage and get permanent URL
          const url = await fbUploadBlob(state.projIdx, item.no, blob);
          setImg(item.no, url);
          // Store imageUrl in the issue doc
          const it = getIss().find(i => i.no === item.no);
          if (it) { it.imageUrl = url; fbSaveIssue(state.projIdx, it).catch(() => {}); }
          imageCount++;
        } catch (err) {
          // Fallback: fetch as base64 and store locally only
          try {
            const data = await fetchImageAsDataURL(item.url);
            setImg(item.no, data);
            imageCount++;
          } catch (e2) {
            console.warn('Image fetch failed for #' + item.no + ':', item.url);
            failedImages++;
          }
        }
      }
      persistImgs();
      toast(
        '✓ โหลดรูป ' + imageCount + '/' + imageQueue.length + ' สำเร็จ' + (failedImages ? ' · ล้มเหลว ' + failedImages : ''),
        imageCount > 0 ? '#2DBE60' : '#d97706'
      );
      render();
    }
  };
  reader.readAsText(file, 'utf-8');
}
function parseCSV(text) {
  // Basic CSV parser (handles quotes)
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row=[]; field=''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim()));
}
function downloadFile(filename, content, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + content], { type: mime }); // BOM for Excel TH
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function issuesToCSV(rows) {
  const header = ['NO.','Viewpoint Description','Discipline','Zone','Floor','Grid','Priority','Status','Comment','Author','Assignee','Days Open','Image URL'];
  const csvEsc = (s) => {
    if (s == null) return '';
    s = String(s);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  };
  const lines = [header.join(',')];
  rows.forEach(it => {
    // Export image as empty URL placeholder — user fills in URL before re-importing
    lines.push([it.no, it.title, it.disc, it.zone, it.floor, it.grid, it.priority, it.status, it.comment, it.author, it.assignee, it.daysOpen, ''].map(csvEsc).join(','));
  });
  return lines.join('\n');
}
function exportIssuesCSV() {
  const data = getFiltered();
  const csv = issuesToCSV(data);
  downloadFile(`BIM_Report_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`, csv);
  toast(`✓ Export ${data.length} issues`, '#2DBE60');
}
function exportSelected() {
  const data = getIss().filter(i => state.selected.has(i.no));
  if (!data.length) return;
  downloadFile(`BIM_Selected_${data.length}.csv`, issuesToCSV(data));
  toast(`✓ Export ${data.length} selected issues`, '#2DBE60');
}
function exportData() {
  // Export everything as JSON backup
  const backup = {
    project: PROJECTS[state.projIdx],
    issues: getIss(),
    auditLog: getAud(),
    exportedAt: new Date().toISOString()
  };
  downloadFile(`bimtrack_backup_${Date.now()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  toast(`✓ Export backup · ${getIss().length} issues`, '#2DBE60');
}
function exportAuditLog() {
  const header = ['Timestamp','Issue NO.','Item','Action','Field','Old Value','New Value','User'];
  const escc = s => { s = String(s||''); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lines = [header.join(',')];
  getAud().forEach(a => lines.push([a.ts, a.issueNo, a.issueTitle, a.action, a.field, a.oldVal, a.newVal, a.user].map(escc).join(',')));
  downloadFile(`audit_log_${Date.now()}.csv`, lines.join('\n'));
  toast(`✓ Export audit log · ${getAud().length} entries`, '#2DBE60');
}
function exportAnalytics() {
  // SVG charts to HTML for now
  toast(`✓ Export analytics charts (PDF)`, '#2DBE60');
  setTimeout(() => window.print(), 300);
}

// ============== New Issue / Edit / Delete ==============
function openNewIssue() {
  if (!requirePermission('create', 'สร้าง issue ใหม่')) return;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>New Issue</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row"><label>Title *</label><input type="text" id="ni-title" placeholder="เช่น แนวท่อ EE ชนคานหลัก กริด A-2 ชั้น 5F" /></div>
        <div class="form-row-grid">
          <div class="form-row"><label>Discipline</label>
            <select id="ni-disc">${VALID_DISC_CODES.map(d => `<option>${d}</option>`).join('')}</select>
          </div>
          <div class="form-row"><label>Zone</label>
            <select id="ni-zone"><option>ZONE 1</option><option>ZONE 2</option></select>
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-row"><label>Priority</label>
            <select id="ni-prio"><option>Critical</option><option selected>Major</option><option>Minor</option></select>
          </div>
          <div class="form-row"><label>Status</label>
            <select id="ni-status"><option>NEW</option><option>ACTIVE</option><option>RESOLVED</option></select>
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-row"><label>Grid</label><input type="text" id="ni-grid" placeholder="A-2" /></div>
          <div class="form-row"><label>Floor</label><input type="text" id="ni-floor" placeholder="5F" /></div>
        </div>
        <div class="form-row"><label>Assignee</label>
          <select id="ni-assignee"><option>EE Team</option><option>AC Team</option><option>AR Team</option><option>SN Team</option><option>FP Team</option><option>ST Team</option><option>MEP Lead</option><option>Site Eng.</option><option>Owner</option></select>
        </div>
        <div class="form-row"><label>Comment / Instruction</label><textarea id="ni-comment" placeholder="คำสั่ง / คำอธิบายเพิ่มเติม"></textarea></div>
      </div>
      <div class="modal-f">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="saveNewIssue()">${I.plus}<span>Create Issue</span></button>
      </div>
    </div>`);
}
function saveNewIssue() {
  if (!requirePermission('create', 'สร้าง issue ใหม่')) return;
  const title = $('#ni-title').value.trim();
  if (!title) { toast('⚠️ ใส่ title ก่อน', '#d97706'); return; }
  const disc = $('#ni-disc').value;
  const newNo = String(Math.max(...getIss().map(i => +i.no)) + 1);
  const it = {
    no: newNo,
    title,
    disc,
    discPrimary: disc,
    zone: $('#ni-zone').value,
    floor: $('#ni-floor').value || '—',
    grid: $('#ni-grid').value || '—',
    priority: $('#ni-prio').value,
    status: $('#ni-status').value,
    comment: $('#ni-comment').value || '',
    daysOpen: 0,
    author: state.user.name.split(' ').map(p=>p[0]+'.').join(''),
    assignee: $('#ni-assignee').value,
    createdAt: new Date().toISOString()
  };
  getIss().unshift(it);
  fbSaveIssue(state.projIdx, it).catch(e => console.warn('Firestore:', e));
  getAud().unshift({
    ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
    issueNo: newNo, issueTitle: title,
    action: 'Issue Created', field:'', oldVal:'', newVal:'',
    user: state.user.name
  });
  fbAddAudit(state.projIdx, getAud()[0]).catch(e => console.warn('Firestore audit:', e));
  closeModal();
  toast(`✓ Created Issue #${newNo}`, '#2DBE60');
  state.notifications = [];
  render();
}
function openEditIssue(no) {
  if (!requirePermission('edit', 'แก้ไข issue')) return;
  const it = getIss().find(i => i.no === no);
  if (!it) return;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>Edit Issue #${it.no}</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row"><label>Title</label><input type="text" id="ed-title" value="${esc(it.title)}" /></div>
        <div class="form-row-grid">
          <div class="form-row"><label>Discipline</label>
            <select id="ed-disc">${VALID_DISC_CODES.map(d => `<option ${it.discPrimary===d?'selected':''}>${d}</option>`).join('')}</select>
          </div>
          <div class="form-row"><label>Zone</label>
            <select id="ed-zone"><option ${it.zone==='ZONE 1'?'selected':''}>ZONE 1</option><option ${it.zone==='ZONE 2'?'selected':''}>ZONE 2</option></select>
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-row"><label>Priority</label>
            <select id="ed-prio">${PRIORITIES.map(p => `<option ${it.priority===p?'selected':''}>${p}</option>`).join('')}</select>
          </div>
          <div class="form-row"><label>Status</label>
            <select id="ed-status">${STATUSES.map(s => `<option ${it.status===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-row"><label>Comment</label><textarea id="ed-comment">${esc(it.comment)}</textarea></div>
      </div>
      <div class="modal-f">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="saveEditIssue('${no}')">${I.check2}<span>Save Changes</span></button>
      </div>
    </div>`);
}
function saveEditIssue(no) {
  if (!requirePermission('edit', 'แก้ไข issue')) return;
  const it = getIss().find(i => i.no === no);
  if (!it) return;
  it.title = $('#ed-title').value;
  it.discPrimary = $('#ed-disc').value;
  it.disc = $('#ed-disc').value;
  it.zone = $('#ed-zone').value;
  it.priority = $('#ed-prio').value;
  it.status = $('#ed-status').value;
  it.comment = $('#ed-comment').value;
  fbSaveIssue(state.projIdx, it).catch(e => console.warn('Firestore:', e));
  closeModal();
  toast(`✓ Updated Issue #${no}`, '#2DBE60');
  render();
  openDetail(no);
}
function markResolved(no) {
  if (!requirePermission('edit', 'เปลี่ยนสถานะ')) return;
  const it = getIss().find(i => i.no === no);
  if (!it) return;
  const wasResolved = it.status === 'RESOLVED';
  const old = it.status;
  it.status = wasResolved ? 'ACTIVE' : 'RESOLVED';
  fbSaveIssue(state.projIdx, it).catch(e => console.warn('Firestore:', e));
  getAud().unshift({
    ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
    issueNo: no, issueTitle: it.title,
    action:'Status Change', field:'status', oldVal: old, newVal: it.status,
    user: state.user.name
  });
  fbAddAudit(state.projIdx, getAud()[0]).catch(e => console.warn('Firestore audit:', e));
  toast(wasResolved ? `↻ Reopened Issue #${no}` : `✓ Resolved Issue #${no}`, '#2DBE60');
  state.notifications = [];
  render();
  openDetail(no);
}
function confirmDeleteIssue(no) {
  if (!requirePermission('delete', 'ลบ issue')) return;
  if (!confirm(`ลบ Issue #${no} ?\nการกระทำนี้ย้อนกลับไม่ได้`)) return;
  const idx = getIss().findIndex(i => i.no === no);
  if (idx >= 0) {
    const it = getIss().splice(idx,1)[0];
    fbDeleteIssue(state.projIdx, no).catch(e => console.warn('Firestore:', e));
    fbDeleteImage(state.projIdx, no).catch(e => console.warn('Storage:', e));
    getAud().unshift({
      ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
      issueNo: no, issueTitle: it.title,
      action:'Issue Deleted', field:'', oldVal:'', newVal:'',
      user: state.user.name
    });
    fbAddAudit(state.projIdx, getAud()[0]).catch(e => console.warn('Firestore audit:', e));
    delImg(no);
    persistImgs();
  }
  closeDetail();
  toast(`🗑 Deleted Issue #${no}`, '#dc2626');
  render();
}

// ============== New Project ==============
function openNewProject() {
  if (!requirePermission('users', 'จัดการ project')) return;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>New Project</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row"><label>Project Name *</label><input type="text" id="np-name" placeholder="เช่น Park Origin Phromphong" /></div>
        <div class="form-row-grid">
          <div class="form-row"><label>Project Code *</label><input type="text" id="np-code" placeholder="BIM-2026-05" /></div>
          <div class="form-row"><label>Phase</label><input type="text" id="np-phase" placeholder="IFC50" /></div>
        </div>
        <div class="form-row"><label>Description</label><textarea id="np-desc" placeholder="คำอธิบายโปรเจค"></textarea></div>
        <div class="form-row"><label>Status</label>
          <select id="np-status">
            <option selected>Active</option>
            <option>On Hold</option>
            <option>Completed</option>
            <option>Archived</option>
          </select>
        </div>
      </div>
      <div class="modal-f">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="saveNewProject()">${I.plus}<span>Create Project</span></button>
      </div>
    </div>`);
}
function saveNewProject() {
  if (!requirePermission('users', 'สร้าง project')) return;
  const name = $('#np-name').value.trim();
  const code = $('#np-code').value.trim();
  if (!name || !code) { toast('⚠️ ใส่ name + code ก่อน', '#d97706'); return; }
  const newId = PROJECTS.length;
  const status = $('#np-status').value;
  PROJECTS.push({
    id: newId,
    name,
    code,
    desc: $('#np-desc').value,
    active: status === 'Active',
    phase: $('#np-phase').value || '—',
    status,
    clientDomains: [],
    reportLogos: { owner: '', cm: '', contractor: '' },
    reportCoverImage: '',
    reportCoverPosition: { x: 50, y: 50, zoom: 100 }
  });
  PROJECT_ISSUES[newId] = [];
  PROJECT_AUDIT[newId] = [];
  // Log to current project's audit
  getAud().unshift({
    ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
    issueNo:'', issueTitle: `Project: ${name}`,
    action: 'Project Created', field:'', oldVal:'', newVal: code,
    user: state.user.name
  });
  // Sync to Firebase
  fbSaveProjects(PROJECTS).catch(e => console.warn('Firebase projects:', e));
  fbAddAudit(state.projIdx, getAud()[0]).catch(() => {});
  closeModal();
  toast(`✓ Created project ${name}`, '#2DBE60');
  render();
}

// ============== Edit Project ==============
let _editProjectLogos = null;
function openEditProject(i) {
  if (!requirePermission('users', 'แก้ไข project')) return;
  const p = PROJECTS[i];
  if (!p) return;
  _editProjectLogos = {
    owner: (p.reportLogos&&p.reportLogos.owner)||'', cm: (p.reportLogos&&p.reportLogos.cm)||'', contractor: (p.reportLogos&&p.reportLogos.contractor)||'',
    cover: p.reportCoverImage||'',
    coverPos: p.reportCoverPosition ? { ...p.reportCoverPosition } : { x:50, y:50, zoom:100 }
  };
  const cpos = _editProjectLogos.coverPos;
  const logoSlot = (key, label) => `
    <div style="text-align:center">
      <div style="font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:600;margin-bottom:6px">${label}</div>
      <label style="display:block;width:100%;aspect-ratio:16/9;border:1.5px dashed var(--border);border-radius:6px;cursor:pointer;overflow:hidden;background:var(--bg);position:relative">
        <img id="ep-logo-${key}-img" src="${_editProjectLogos[key]||''}" style="width:100%;height:100%;object-fit:contain;display:${_editProjectLogos[key]?'block':'none'}"/>
        <span id="ep-logo-${key}-ph" style="display:${_editProjectLogos[key]?'none':'flex'};position:absolute;inset:0;align-items:center;justify-content:center;font-size:10.5px;color:var(--muted)">+ Upload</span>
        <input type="file" accept="image/*" class="hide" onchange="handleEditProjectLogo(event,'${key}')"/>
      </label>
    </div>`;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>Edit Project · ${esc(p.name)}</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row"><label>Project Name</label><input type="text" id="ep-name" value="${esc(p.name)}" /></div>
        <div class="form-row-grid">
          <div class="form-row"><label>Project Code</label><input type="text" id="ep-code" value="${esc(p.code)}" /></div>
          <div class="form-row"><label>Phase</label><input type="text" id="ep-phase" value="${esc(p.phase)}" /></div>
        </div>
        <div class="form-row"><label>Description</label><textarea id="ep-desc">${esc(p.desc)}</textarea></div>
        <div class="form-row"><label>Status</label>
          <select id="ep-status">
            ${['Active','On Hold','Completed','Archived'].map(s => `<option ${p.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><label>Client access — allowed email domain(s)</label>
          <input type="text" id="ep-client-domains" value="${esc((p.clientDomains||[]).join(', '))}" placeholder="e.g. ananda.co.th, ananda-dev.com" />
          <div style="font-size:11px;color:var(--muted);margin-top:4px">อีเมลโดเมนนี้จะล็อกอินเข้าได้เฉพาะโครงการนี้ ในฐานะ Client Reviewer (ดู + คอมเมนต์เท่านั้น) — เพิ่มทีละคนได้ที่หน้า Users แทน ถ้าไม่อยากเปิดทั้งโดเมน</div>
        </div>
        <div class="form-row">
          <label>Report logos <span style="font-weight:400;color:var(--muted)">— CM ติดข้างชื่อหัวรายงาน, Owner มุมขวาบน, Contractor เล็กๆ ที่แถบล่าง</span></label>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:6px">
            ${logoSlot('cm','CM (TEAM·CM)')}
            ${logoSlot('owner','Owner')}
            ${logoSlot('contractor','Contractor')}
          </div>
        </div>
        <div class="form-row">
          <label>Cover background image <span style="font-weight:400;color:var(--muted)">— แทนที่พื้นหลังสีน้ำเงินของหน้าปก (จะมีฟิลเตอร์เข้มทับให้ตัวหนังสือขาวยังอ่านออก)</span></label>
          <label style="display:block;width:100%;aspect-ratio:21/9;border:1.5px dashed var(--border);border-radius:6px;cursor:pointer;overflow:hidden;background:var(--bg);position:relative;margin-top:6px">
            <img id="ep-logo-cover-img" src="${_editProjectLogos.cover||''}" style="width:100%;height:100%;object-fit:cover;object-position:${cpos.x}% ${cpos.y}%;transform:scale(${cpos.zoom/100});transform-origin:${cpos.x}% ${cpos.y}%;display:${_editProjectLogos.cover?'block':'none'}"/>
            <span id="ep-logo-cover-ph" style="display:${_editProjectLogos.cover?'none':'flex'};position:absolute;inset:0;align-items:center;justify-content:center;font-size:11px;color:var(--muted)">+ Upload background image (ไม่บังคับ)</span>
            <input type="file" accept="image/*" class="hide" onchange="handleEditProjectLogo(event,'cover')"/>
          </label>
          <div id="ep-cover-sliders" style="display:${_editProjectLogos.cover?'grid':'none'};grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px;font-size:11px;color:var(--muted)">
            <div>ซ้าย ↔ ขวา<input id="ep-cover-x" type="range" min="0" max="100" value="${cpos.x}" oninput="updateCoverPos('x', this.value)" style="width:100%"/></div>
            <div>บน ↕ ล่าง<input id="ep-cover-y" type="range" min="0" max="100" value="${cpos.y}" oninput="updateCoverPos('y', this.value)" style="width:100%"/></div>
            <div>ซูม<input id="ep-cover-zoom" type="range" min="100" max="220" value="${cpos.zoom}" oninput="updateCoverPos('zoom', this.value)" style="width:100%"/></div>
          </div>
        </div>
        <div style="background:var(--bg);border-radius:6px;padding:10px 12px;font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between">
          <span>${(PROJECT_ISSUES[i]||[]).length} issues · ${(PROJECT_ISSUES[i]||[]).filter(x=>x.status!=='RESOLVED').length} open</span>
          <span>${(PROJECT_AUDIT[i]||[]).length} audit entries</span>
        </div>
      </div>
      <div class="modal-f">
        <button class="btn btn-d" onclick="closeModal();confirmDeleteProject(${i})">${I.trash}<span>Delete</span></button>
        <span style="flex:1"></span>
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="saveEditProject(${i})">${I.check2}<span>Save Changes</span></button>
      </div>
    </div>`);
}
async function handleEditProjectLogo(event, key) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('⚠️ ต้องเป็นไฟล์รูปภาพ', '#d97706'); return; }
  try {
    const data = await readImageAsDataURL(file, key === 'cover' ? 1400 : 480);
    if (!_editProjectLogos) _editProjectLogos = { owner:'', cm:'', contractor:'', cover:'', coverPos:{x:50,y:50,zoom:100} };
    _editProjectLogos[key] = data;
    const img = document.getElementById(`ep-logo-${key}-img`);
    const ph = document.getElementById(`ep-logo-${key}-ph`);
    if (img) { img.src = data; img.style.display = 'block'; }
    if (ph) ph.style.display = 'none';
    if (key === 'cover') {
      // fresh photo — reset framing rather than keep whatever the old one was set to
      _editProjectLogos.coverPos = { x:50, y:50, zoom:100 };
      ['x','y'].forEach(a => { const el = document.getElementById(`ep-cover-${a}`); if (el) el.value = 50; });
      const zEl = document.getElementById('ep-cover-zoom'); if (zEl) zEl.value = 100;
      if (img) { img.style.objectPosition = '50% 50%'; img.style.transform = 'scale(1)'; img.style.transformOrigin = '50% 50%'; }
      const sliders = document.getElementById('ep-cover-sliders');
      if (sliders) sliders.style.display = 'grid';
    }
  } catch (e) {
    toast('❌ โหลดโลโก้ไม่สำเร็จ', '#dc2626');
  }
}
function updateCoverPos(axis, val) {
  if (!_editProjectLogos) return;
  if (!_editProjectLogos.coverPos) _editProjectLogos.coverPos = { x:50, y:50, zoom:100 };
  _editProjectLogos.coverPos[axis] = +val;
  const img = document.getElementById('ep-logo-cover-img');
  if (img) {
    const p = _editProjectLogos.coverPos;
    img.style.objectPosition = `${p.x}% ${p.y}%`;
    img.style.transform = `scale(${p.zoom/100})`;
    img.style.transformOrigin = `${p.x}% ${p.y}%`;
  }
}
function saveEditProject(i) {
  const p = PROJECTS[i];
  if (!p) return;
  const oldName = p.name, oldStatus = p.status;
  p.name = $('#ep-name').value.trim() || p.name;
  p.code = $('#ep-code').value.trim() || p.code;
  p.phase = $('#ep-phase').value || '—';
  p.desc = $('#ep-desc').value;
  p.status = $('#ep-status').value;
  p.active = p.status === 'Active';
  p.clientDomains = ($('#ep-client-domains').value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (_editProjectLogos) {
    p.reportLogos = { owner: _editProjectLogos.owner, cm: _editProjectLogos.cm, contractor: _editProjectLogos.contractor };
    p.reportCoverImage = _editProjectLogos.cover || '';
    p.reportCoverPosition = _editProjectLogos.coverPos || { x:50, y:50, zoom:100 };
  }
  if (oldStatus !== p.status) {
    getAud().unshift({
      ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
      issueNo:'', issueTitle: `Project: ${p.name}`,
      action: 'Project Status Change', field:'status',
      oldVal: oldStatus, newVal: p.status, user: state.user.name
    });
    fbAddAudit(state.projIdx, getAud()[0]).catch(() => {});
  }
  // Sync to Firebase
  fbSaveProjects(PROJECTS).catch(e => console.warn('Firebase projects:', e));
  closeModal();
  toast(`✓ Updated ${p.name}`, '#2DBE60');
  render();
}
function confirmDeleteProject(i) {
  if (!requirePermission('users', 'ลบ project')) return;
  const p = PROJECTS[i];
  if (!p) return;
  if (PROJECTS.length <= 1) {
    toast('⚠️ ต้องเหลือ project อย่างน้อย 1 อัน', '#d97706');
    return;
  }
  const issueCount = (PROJECT_ISSUES[i]||[]).length;
  const confirmMsg = `ลบ project "${p.name}"?\n\n` +
    `• ${issueCount} issues จะถูกลบ\n` +
    `• ${(PROJECT_AUDIT[i]||[]).length} audit entries จะถูกลบ\n` +
    `• รูปทั้งหมดของ project นี้จะถูกลบ\n\n` +
    `การกระทำนี้ย้อนกลับไม่ได้`;
  if (!confirm(confirmMsg)) return;
  // Delete project data
  delete PROJECT_ISSUES[i];
  delete PROJECT_AUDIT[i];
  // Delete associated images
  Object.keys(state.imgStore).forEach(k => {
    if (k.startsWith(`p${i}_`)) delete state.imgStore[k];
  });
  persistImgs();
  PROJECTS.splice(i, 1);
  // Reindex (since we have id-based gaps, simplest: rebuild PROJECT_ISSUES/AUDIT to use new indices)
  reindexProjects(i);
  // If current was deleted or shifted
  if (state.projIdx === i) state.projIdx = 0;
  else if (state.projIdx > i) state.projIdx -= 1;
  state.selected.clear();
  state.notifications = [];
  // Sync to Firebase: full projects array + remove RTDB nodes for deleted project
  fbSaveProjects(PROJECTS).catch(e => console.warn('Firebase projects:', e));
  fbDb.ref(`issues/${p.code.replace(/[.$#[\]/]/g, '_')}`).remove().catch(() => {});
  fbDb.ref(`audit/${p.code.replace(/[.$#[\]/]/g, '_')}`).remove().catch(() => {});
  toast(`🗑 Deleted ${p.name}`, '#dc2626');
  render();
}
function reindexProjects(deletedIdx) {
  // Shift project data indices down after deletedIdx
  const newIss = {};
  const newAud = {};
  PROJECTS.forEach((p, newIdx) => {
    // Find old index: count projects at or before this position that weren't deleted
    const oldIdx = newIdx >= deletedIdx ? newIdx + 1 : newIdx;
    newIss[newIdx] = PROJECT_ISSUES[oldIdx] !== undefined ? PROJECT_ISSUES[oldIdx] : (PROJECT_ISSUES[newIdx] || []);
    newAud[newIdx] = PROJECT_AUDIT[oldIdx] !== undefined ? PROJECT_AUDIT[oldIdx] : (PROJECT_AUDIT[newIdx] || []);
    p.id = newIdx;
  });
  // Clear old refs and assign new
  Object.keys(PROJECT_ISSUES).forEach(k => delete PROJECT_ISSUES[k]);
  Object.keys(PROJECT_AUDIT).forEach(k => delete PROJECT_AUDIT[k]);
  Object.assign(PROJECT_ISSUES, newIss);
  Object.assign(PROJECT_AUDIT, newAud);
  // Reindex images: shift p{N}_ keys
  const newImgs = {};
  Object.entries(state.imgStore).forEach(([k, v]) => {
    const m = k.match(/^p(\d+)_(.+)$/);
    if (m) {
      const oldP = +m[1];
      if (oldP > deletedIdx) newImgs[`p${oldP-1}_${m[2]}`] = v;
      else newImgs[k] = v;
    } else {
      newImgs[k] = v;
    }
  });
  Object.keys(state.imgStore).forEach(k => delete state.imgStore[k]);
  Object.assign(state.imgStore, newImgs);
  persistImgs();
}
function duplicateProject(i) {
  if (!requirePermission('users', 'duplicate project')) return;
  const p = PROJECTS[i];
  if (!p) return;
  const newId = PROJECTS.length;
  const dup = {
    id: newId,
    name: p.name + ' (copy)',
    code: p.code + '-COPY',
    desc: p.desc,
    active: false,
    phase: p.phase,
    status: 'On Hold'
  };
  PROJECTS.push(dup);
  PROJECT_ISSUES[newId] = (PROJECT_ISSUES[i] || []).map(it => ({...it}));
  PROJECT_AUDIT[newId] = [{
    ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
    issueNo:'', issueTitle: `Duplicated from ${p.name}`,
    action: 'Project Created', field:'', oldVal:'', newVal: dup.code, user: state.user.name
  }];
  // Sync to Firebase: projects + duplicated issues
  fbSaveProjects(PROJECTS).catch(e => console.warn('Firebase projects:', e));
  fbSeedIssues(newId, PROJECT_ISSUES[newId]).catch(e => console.warn('Firebase seed:', e));
  toast(`✓ Duplicated ${p.name}`, '#2DBE60');
  render();
}
function toggleProjActions(e, i) {
  e.stopPropagation();
  // Close any other open menus
  document.querySelectorAll('.proj-actions').forEach(m => {
    if (m.id !== `proj-actions-${i}`) m.style.display = 'none';
  });
  const m = document.getElementById(`proj-actions-${i}`);
  if (m) m.style.display = m.style.display === 'block' ? 'none' : 'block';
}

// ============== Invite User ==============
function openInviteUser() {
  if (!requirePermission('users', 'เพิ่มผู้ใช้')) return;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>Invite User</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row"><label>Full Name *</label><input type="text" id="iu-name" placeholder="ชื่อ-นามสกุล" /></div>
        <div class="form-row"><label>Email *</label><input type="text" id="iu-email" placeholder="name@teamcm.co.th" /></div>
        <div class="form-row"><label>Role</label>
          <select id="iu-role" onchange="document.getElementById('iu-project-row').style.display = this.value==='Client Reviewer' ? 'block' : 'none'">
            <option>Viewer</option>
            <option>Coordinator</option>
            <option>BIM Manager</option>
            <option>Admin</option>
            <option>Client Reviewer</option>
          </select>
        </div>
        <div class="form-row" id="iu-project-row" style="display:none">
          <label>Project <span style="font-weight:400;color:var(--muted)">— Client Reviewer sees only this one</span></label>
          <select id="iu-project">
            ${PROJECTS.map(p => `<option value="${esc(p.code)}">${esc(p.name)} (${esc(p.code)})</option>`).join('')}
          </select>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">📧 ระบบจะส่งอีเมล invitation ไปยังผู้ใช้ใหม่ · Client Reviewer ล็อกอินได้ด้วยอีเมลนี้แม้ไม่ใช่โดเมน @teamcm.co.th</div>
      </div>
      <div class="modal-f">
        <button class="btn btn-g" onclick="closeModal()">Cancel</button>
        <button class="btn btn-p" onclick="saveInviteUser()">${I.plus}<span>Send Invitation</span></button>
      </div>
    </div>`);
}
function saveInviteUser() {
  if (!requirePermission('users', 'เพิ่มผู้ใช้')) return;
  const name = $('#iu-name').value.trim();
  const email = $('#iu-email').value.trim();
  if (!name || !email) { toast('⚠️ ใส่ name + email ก่อน', '#d97706'); return; }
  const role = $('#iu-role').value;
  const projEl = $('#iu-project');
  const projectCode = (role === 'Client Reviewer' && projEl) ? projEl.value : null;
  USERS.push({
    id: (USERS.reduce((m, u) => Math.max(m, u.id), 0) || 0) + 1,
    name, email,
    role,
    projectCode,
    lastActive: 'invited'
  });
  fbSaveUsers(USERS).catch(e => console.warn('Firebase users:', e));
  closeModal();
  toast(`✓ Invitation sent to ${email}`, '#2DBE60');
  render();
}

// ============== Edit / Delete User ==============
function openEditUser(id) {
  if (!requirePermission('users', 'แก้ไขผู้ใช้')) return;
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const roleColors = { 'Admin':'b-critical', 'BIM Manager':'b-new', 'Coordinator':'b-active', 'Viewer':'b-unknown', 'Client Reviewer':'b-major' };
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>Edit User</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div style="display:flex;align-items:center;gap:12px;padding:4px 0 14px;border-bottom:1px solid var(--border-2);margin-bottom:14px">
          <div class="user-avatar" style="width:48px;height:48px;font-size:15px">${u.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;font-family:Montserrat">${esc(u.name)}</div>
            <div style="font-size:12px;color:var(--muted)" class="mono">${esc(u.email)}</div>
            <div style="margin-top:4px"><span class="badge ${roleColors[u.role] || 'b-unknown'}">${esc(u.role)}</span></div>
          </div>
        </div>
        <div class="form-row"><label>Full Name *</label><input type="text" id="eu-name" value="${esc(u.name)}" /></div>
        <div class="form-row"><label>Email *</label><input type="text" id="eu-email" value="${esc(u.email)}" /></div>
        <div class="form-row"><label>Role *</label>
          <select id="eu-role" onchange="document.getElementById('eu-project-row').style.display = this.value==='Client Reviewer' ? 'block' : 'none'">
            ${VALID_ROLES.map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        <div class="form-row" id="eu-project-row" style="display:${u.role==='Client Reviewer'?'block':'none'}">
          <label>Project <span style="font-weight:400;color:var(--muted)">— Client Reviewer sees only this one</span></label>
          <select id="eu-project">
            ${PROJECTS.map(p => `<option value="${esc(p.code)}" ${u.projectCode===p.code?'selected':''}>${esc(p.name)} (${esc(p.code)})</option>`).join('')}
          </select>
        </div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:4px">การเปลี่ยน role จะมีผลทันทีเมื่อบันทึก</div>
      </div>
      <div class="modal-f" style="display:flex;justify-content:space-between;align-items:center">
        <button class="btn btn-d" onclick="confirmDeleteUser(${u.id})" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca">${I.close}<span>Delete</span></button>
        <div style="display:flex;gap:8px">
          <button class="btn btn-g" onclick="closeModal()">Cancel</button>
          <button class="btn btn-p" onclick="saveUserEdit(${u.id})">${I.check2}<span>Save Changes</span></button>
        </div>
      </div>
    </div>`);
}

function saveUserEdit(id) {
  if (!requirePermission('users', 'แก้ไขผู้ใช้')) return;
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  const name  = $('#eu-name').value.trim();
  const email = $('#eu-email').value.trim();
  const role  = $('#eu-role').value;
  const projEl = $('#eu-project');
  const projectCode = (role === 'Client Reviewer' && projEl) ? projEl.value : null;
  if (!name || !email) { toast('⚠️ Name + Email ห้ามว่าง', '#d97706'); return; }
  const oldRole = u.role;
  u.name = name; u.email = email; u.role = role; u.projectCode = projectCode;
  // Audit log entry
  if (oldRole !== role) {
    getAud().unshift({
      ts: new Date().toLocaleDateString('en-GB').replace(/\//g,'/').slice(0,8) + ' ' + new Date().toTimeString().slice(0,5),
      issueNo:'', issueTitle: u.name,
      action:'Role Changed', field:'role', oldVal: oldRole, newVal: role,
      user: state.user.name
    });
    fbAddAudit(state.projIdx, getAud()[0]).catch(() => {});
  }
  fbSaveUsers(USERS).catch(e => console.warn('Firebase users:', e));
  closeModal();
  toast(`✓ อัปเดต ${name} → ${role}`, '#2DBE60');
  render();
}

function confirmDeleteUser(id) {
  if (!requirePermission('users', 'ลบผู้ใช้')) return;
  const u = USERS.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`ลบผู้ใช้ "${u.name}" ?\nการกระทำนี้ย้อนกลับไม่ได้`)) return;
  const idx = USERS.findIndex(x => x.id === id);
  if (idx >= 0) USERS.splice(idx, 1);
  fbSaveUsers(USERS).catch(e => console.warn('Firebase users:', e));
  closeModal();
  toast(`🗑 ลบ ${u.name}`, '#dc2626');
  render();
}

// ============== User menu ==============
function openUserMenu() {
  openModal(`
    <div class="modal" style="width:360px">
      <div class="modal-h"><h3>Account</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b" style="padding-top:6px">
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0 14px;border-bottom:1px solid var(--border-2)">
          <div class="user-avatar" style="width:48px;height:48px;font-size:16px">${state.user.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
          <div>
            <div style="font-weight:700;font-size:15px;font-family:Montserrat">${esc(state.user.name)}</div>
            <div style="font-size:12px;color:var(--muted)" class="mono">${esc(state.user.email)}</div>
            <div style="font-size:11.5px;color:var(--green-2);font-weight:600;margin-top:2px">${esc(state.user.role)}</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:2px;margin-top:6px">
          <button class="btn btn-g" style="justify-content:flex-start;padding:9px 12px" onclick="toggleTheme();closeModal()">${state.theme==='dark'?I.sun:I.moon}<span>Switch to ${state.theme==='dark'?'Light':'Dark'} mode</span></button>
          <button class="btn btn-g" style="justify-content:flex-start;padding:9px 12px" onclick="closeModal();goPage('users')">${I.users}<span>Manage Users</span></button>
          <button class="btn btn-g" style="justify-content:flex-start;padding:9px 12px" onclick="closeModal();exportData()">${I.download}<span>Export Backup</span></button>
          <button class="btn btn-d" style="justify-content:flex-start;padding:9px 12px" onclick="closeModal();fbSignOut()">${I.close}<span>Sign out</span></button>
        </div>
      </div>
    </div>`);
}

// ============== Advanced filter ==============
function openAdvancedFilter() {
  const f = state.filters;
  openModal(`
    <div class="modal">
      <div class="modal-h"><h3>Advanced Filter</h3><button class="so-close" onclick="closeModal()">${I.close}</button></div>
      <div class="modal-b">
        <div class="form-row-grid">
          <div class="form-row"><label>Discipline</label>
            <select id="af-disc">
              <option value="all">All</option>
              ${VALID_DISC_CODES.map(d => `<option ${f.disc===d?'selected':''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-row"><label>Zone</label>
            <select id="af-zone">
              <option value="all">All</option>
              <option ${f.zone==='ZONE 1'?'selected':''}>ZONE 1</option>
              <option ${f.zone==='ZONE 2'?'selected':''}>ZONE 2</option>
            </select>
          </div>
        </div>
        <div class="form-row-grid">
          <div class="form-row"><label>Priority</label>
            <select id="af-prio">
              <option value="all">All</option>
              <option ${f.prio==='Critical'?'selected':''}>Critical</option>
              <option ${f.prio==='Major'?'selected':''}>Major</option>
              <option ${f.prio==='Minor'?'selected':''}>Minor</option>
            </select>
          </div>
          <div class="form-row"><label>Status</label>
            <select id="af-status">
              <option value="all">All</option>
              ${STATUSES.map(s => `<option ${f.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row"><label>Search keyword</label><input type="text" id="af-q" value="${esc(f.q)}" placeholder="ค้นหา NO / title / discipline" /></div>
        <div class="form-row"><label>Age</label>
          <select id="af-age">
            <option value="all">ทั้งหมด</option>
            <option>เปิดมาน้อยกว่า 7 วัน</option>
            <option>เปิดมา 7-14 วัน</option>
            <option>เปิดมาเกิน 14 วัน</option>
          </select>
        </div>
      </div>
      <div class="modal-f">
        <button class="btn btn-g" onclick="resetFilters()">Reset</button>
        <button class="btn btn-p" onclick="applyAdvancedFilter()">${I.check2}<span>Apply</span></button>
      </div>
    </div>`);
}
function applyAdvancedFilter() {
  state.filters.disc = $('#af-disc').value;
  state.filters.zone = $('#af-zone').value;
  state.filters.prio = $('#af-prio').value;
  state.filters.status = $('#af-status').value;
  state.filters.q = $('#af-q').value;
  state.pageNum = 1;
  closeModal();
  toast('✓ Filter applied');
  render();
}
function resetFilters() {
  state.filters = { status:'all', disc:'all', prio:'all', zone:'all', q:'' };
  closeModal();
  toast('↻ Filters reset');
  render();
}

// ============== Report actions ==============
function previewReport() {
  // Open fullscreen modal preview
  const ctx = buildReportCtx();
  openModal(`
    <div class="modal wide" style="width:900px;max-width:95vw;height:90vh;max-height:90vh">
      <div class="modal-h">
        <h3>Report Preview · ${esc(ctx.proj.name)}</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="muted" style="font-size:12px">${ctx.filtered.length} issues · ${ctx.opts.sections.length} sections</span>
          <button class="btn btn-p btn-sm" onclick="generatePDF()">${I.download}<span>Download PDF</span></button>
          <button class="so-close" onclick="closeModal()">${I.close}</button>
        </div>
      </div>
      <div class="modal-b" style="background:#eef2f8;padding:18px">
        ${renderReportContent(ctx)}
      </div>
    </div>`);
}
function buildReportCtx() {
  const all = getIss();
  const t = all.length;
  const filtered = getReportIssues();
  const ft = filtered.length;
  const resolved = filtered.filter(i => i.status==='RESOLVED').length;
  const critical = filtered.filter(i => i.priority==='Critical').length;
  const openIssues = filtered.filter(i => i.status !== 'RESOLVED');
  const avgAge = openIssues.length ? Math.round(openIssues.reduce((s,i)=>s+i.daysOpen,0)/openIssues.length) : 0;
  const proj = PROJECTS[state.projIdx];
  const opts = state.reportOpts;
  const showSection = (k) => opts.sections.includes(k);
  const stTally = tally(filtered, 'status');
  const stItems = ['RESOLVED','ACTIVE','NEW','Unknown'].map(s => ({label:s, value:stTally[s]||0, color:STATUS_COLOR[s]}));
  const prTally = tally(filtered, 'priority');
  const prItems = ['Critical','Major','Minor'].map(p => ({label:p, value:prTally[p]||0, color:PRIO_COLOR[p]}));
  const dcTally = tallyDisc(filtered);
  const dcItems = Object.entries(dcTally).map(([d,v]) => ({label:d, value:v, color:DISC_COLOR[d]||'#94a3b8'})).sort((a,b)=>b.value-a.value);
  return { proj, filtered, all, opts, showSection, stItems, prItems, dcItems, avgAge, resolved, critical, ft, t };
}
function generatePDF() {
  if (state.reportOpts.sections.length === 0) {
    toast('⚠️ ต้องเลือกอย่างน้อย 1 section', '#d97706');
    return;
  }
  const ctx = buildReportCtx();
  if (ctx.filtered.length === 0) {
    toast('⚠️ Filter ไม่พบ issues — ลองปรับ filter', '#d97706');
    return;
  }
  toast(`📄 Generating PDF · ${ctx.filtered.length} issues · ${ctx.opts.sections.length} sections…`, '#1F3A5F');

  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const fileName = `BIM_Report_${ctx.proj.code}_${dateStr}.pdf`;
  const html = buildPrintableHTML(ctx, fileName);

  // Open in a new window
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) {
    toast('⚠️ Browser block popup — อนุญาต popup แล้วลองอีกครั้ง', '#d97706');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = fileName;
  // Wait for fonts + images then trigger print
  win.onload = () => {
    setTimeout(() => {
      win.focus();
      win.print();
    }, 600);
  };
  // Log to audit
  getAud().unshift({
    ts: '15/05/26 ' + new Date().toTimeString().slice(0,5),
    issueNo:'', issueTitle: fileName,
    action: 'Report Generated', field:'', oldVal:'', newVal: `${ctx.filtered.length} issues`,
    user: state.user.name
  });
  state.notifications = [];
  setTimeout(() => toast(`✓ PDF เปิดในหน้าต่างใหม่ · กด Save as PDF`, '#2DBE60'), 600);
}
function buildPrintableHTML(ctx, title) {
  const content = renderReportContent(ctx);
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Sarabun:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
<style>
  /* Force exact color printing — must be first rule */
  *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important;box-sizing:border-box}
  body{margin:0;padding:0;background:#eef2f8;font-family:'Sarabun',sans-serif;color:#1a2540;font-size:12.5px}
  :root{--navy:#1F3A5F;--blue:#3A6EA5;--green:#2DBE60;--green-2:#25a352;--green-soft:#e6f7ec;--muted:#6b7689;--border-2:#e6ecf4}
  h1,h2,h3,h4{font-family:'Montserrat',sans-serif;color:#1a2540;margin:0}
  .rpt-doc{max-width:790px;margin:0 auto;padding:18px}
  .rpt-page{background:#fff !important;box-shadow:0 1px 6px rgba(0,0,0,.06);border-radius:4px;margin-bottom:10px;overflow:hidden}
  .issue-card{page-break-inside:avoid;break-inside:avoid}
  /* Badges — explicit background so print picks them up */
  .badge{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:600;font-family:'JetBrains Mono',monospace}
  .b-active{background:#dbeafe !important;color:#2e5a87 !important}
  .b-resolved{background:#e6f7ec !important;color:#25a352 !important}
  .b-new{background:#f3e8ff !important;color:#7e22ce !important}
  .b-critical{background:#fef2f2 !important;color:#dc2626 !important}
  .b-major{background:#fff7ed !important;color:#ea7f00 !important}
  .b-minor{background:#f1f5f9 !important;color:#475569 !important}
  .b-unknown{background:#f1f5f9 !important;color:#6b7280 !important}
  /* Charts */
  .donut-wrap{display:inline-block;position:relative}
  .donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .donut-center .dc-num{font-family:'Montserrat';font-size:20px;font-weight:700;color:#1a2540;line-height:1}
  .donut-center .dc-lbl{font-size:9.5px;color:#6b7689;text-transform:uppercase;letter-spacing:.6px;margin-top:3px}
  .dl-row{display:flex;align-items:center;gap:7px;font-size:10.5px;line-height:1.5}
  .dl-sw{width:9px;height:9px;border-radius:2px;flex-shrink:0}
  .dl-name{flex:1;color:#1a2540;font-weight:500}
  .dl-num,.dl-pct{font-family:'JetBrains Mono',monospace;color:#1a2540}
  .dl-pct{color:#6b7689;font-size:10px;width:28px;text-align:right}
  .bar-chart{display:flex;flex-direction:column;gap:6px}
  .bar-row{display:grid;grid-template-columns:36px 1fr 30px;align-items:center;gap:8px;font-size:10.5px}
  .bar-lbl{font-weight:600;color:#1a2540;font-family:'JetBrains Mono',monospace;font-size:10px}
  .bar-track{height:14px;background:#f1f5f9 !important;border-radius:3px;overflow:hidden}
  .bar-fill{height:100%;border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:5px;color:#fff !important;font-size:9px;font-weight:700;font-family:'JetBrains Mono',monospace}
  .bar-num{font-family:'JetBrains Mono',monospace;color:#1a2540;font-weight:600;text-align:right}
  /* Issue card image */
  .issue-card img{display:block;width:100%;height:100%;object-fit:cover}
  .rpt-cover{min-height:auto !important}
  @page{size:A4 portrait;margin:12mm}
  @media print{
    body{background:#fff !important}
    .rpt-doc{max-width:none;padding:0}
    .rpt-page{box-shadow:none !important;margin-bottom:6px !important;border-radius:0;page-break-after:auto;break-after:auto}
    .rpt-cover{page-break-after:always;break-after:page}
    .rpt-audit{page-break-before:auto}
    .rpt-section-h{page-break-after:avoid;break-after:avoid}
    /* Ensure backgrounds & images print */
    *{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important}
    img{max-width:100% !important;display:block !important}
  }
</style>
</head>
<body>
<div class="rpt-doc">
${content}
</div>
</body>
</html>`;
}
function downloadRecentReport(name) {
  toast(`⬇ Downloading ${name}…`, '#1F3A5F');
  setTimeout(() => {
    downloadFile(name.replace('.pdf','.txt'), `TEAMCM BIM Coordination Report\nFile: ${name}\n\nThis is a placeholder text version of the report.\n`, 'text/plain');
  }, 600);
}

// ============== Project switcher ==============
function toggleProjMenu(e) {
  if (e) e.stopPropagation();
  const m = $('#proj-menu');
  if (m) m.classList.toggle('open');
}
async function switchProject(idx) {
  if (idx === state.projIdx) { toggleProjMenu(); return; }
  if (state.user.projectCode && PROJECTS[idx] && PROJECTS[idx].code !== state.user.projectCode) {
    toast('🚫 คุณไม่มีสิทธิ์เข้าโครงการนี้', '#dc2626');
    return;
  }
  state.projIdx = idx;
  state.selected.clear();
  state.pageNum = 1;
  state.filters = { status:'all', disc:'all', prio:'all', zone:'all', q:'' };
  state.notifications = [];
  closeModal();
  render();  // render immediately with cached/mock data
  await loadProjectData(idx);  // then sync from Firestore
}

// ============== Expose ==============
Object.assign(window, {
  goPage, setFilter, goPageNum, toggleRow, toggleSelectAll, clearSelection,
  quickField, bulkUpdate, bulkDelete, openDetail, closeDetail, submitComment, showOwnerBlockedIssues,
  toggleTheme, uploadImage, dropImage, removeImage,
  triggerImportCSV, exportData, exportIssuesCSV, exportSelected, exportAuditLog, exportAnalytics,
  openNewIssue, saveNewIssue, openEditIssue, saveEditIssue, markResolved, confirmDeleteIssue,
  openNewProject, saveNewProject, openInviteUser, saveInviteUser, openUserMenu,
  openEditUser, saveUserEdit, confirmDeleteUser,
  openAdvancedFilter, applyAdvancedFilter, resetFilters,
  closeModal,
  toggleNotif, readNotif, markAllRead,
  discMSOpen, discMSToggle, discMSSetAll, discMSPreset, toggleReportSection,
  previewReport, generatePDF, downloadRecentReport,
  toggleProjMenu, switchProject,
  openEditProject, saveEditProject, confirmDeleteProject, duplicateProject, toggleProjActions, handleEditProjectLogo, updateCoverPos,
  // Firebase Auth
  fbSignIn, fbSignInMicrosoft, fbSignOut
});
