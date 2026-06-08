/* TEAMCM BIM Dashboard — Mock data
   145 issues generated to match the Ananda S38 profile from spec:
   - Zone 1: 93, Zone 2: 52
   - EE:69, AC:19, AR:17, SN:15, FP:15, ST:7, LA:2, IN:1 (=145)
*/
const PROJECTS = [
  { id: 0, name: 'Sample Project A', code: 'DEMO-SAMPLE-A', desc: 'ตัวอย่างโปรเจค — สร้างโปรเจคของคุณเอง', active: true, phase: 'IFC50', status: 'Active' },
  { id: 1, name: 'Sample Project B', code: 'DEMO-SAMPLE-B', desc: 'ตัวอย่างที่ 2 — Import CSV ของคุณได้เลย', active: false, phase: 'IFC42', status: 'On Hold' }
];

// USERS list — populated from Firebase + auto-grows as new users sign in.
// Default seed: ระบบเจ้าของ (Admin) — คนอื่นจะถูก auto-add เป็น Viewer เมื่อ login ครั้งแรก
const USERS = [
  { id: 1, name: 'Nitid Saksittikan', email: 'nitid_s@teamcm.co.th', role: 'Admin', lastActive: 'just now' }
];

// ─── Role-based Permissions ──────────────────────────────────────────
// Action keys: create, edit, delete, import, report, users (manage users)
const PERMISSIONS = {
  'Admin':       { create: true,  edit: true,  delete: true,  import: true,  report: true,  users: true  },
  'BIM Manager': { create: true,  edit: true,  delete: false, import: true,  report: true,  users: false },
  'Coordinator': { create: false, edit: true,  delete: false, import: false, report: true,  users: false },
  'Viewer':      { create: false, edit: false, delete: false, import: false, report: true,  users: false }
};
const DEFAULT_ROLE = 'Viewer';   // role for first-time sign-ins
const VALID_ROLES = ['Admin','BIM Manager','Coordinator','Viewer'];

const DISC_TITLES = {
  EE: [
    'แนวท่อ EE ชนคานหลัก กริด',
    'รางเคเบิล EE ทับท่อ AC ที่ฝ้าชั้น',
    'ตู้ MDB ตำแหน่งใกล้ท่อระบายน้ำ ห้อง EE',
    'ท่อร้อยสายไฟ EE ขัดเสาโครงสร้าง',
    'หม้อแปลง EE ระยะห่างจากผนังไม่พอ',
    'EE conduit cross structural beam at',
    'ตำแหน่ง Lighting EE ติดท่อ FP sprinkler',
    'EE busway ระดับชนกับท่อ AC duct',
    'Cable tray EE ทะลุ Shear Wall ที่กริด'
  ],
  AC: [
    'AC duct ชนคานคอนกรีตที่ระดับฝ้า ห้อง',
    'FCU AC ตำแหน่งทับท่อระบายน้ำที่ฝ้า',
    'AC chiller pipe คลาดกับ Steel column',
    'Diffuser AC ตำแหน่งทับ Sprinkler head',
    'AC condensate drain ผ่าน Beam',
    'AC ductwork conflict with sprinkler at'
  ],
  AR: [
    'ผนัง AR ทับแนวท่อ ST ที่ห้องน้ำชั้น',
    'AR partition ขัดท่อ EE ที่ corridor',
    'AR ceiling clearance ไม่พอที่ห้อง',
    'AR door swing ชน FP cabinet',
    'AR opening คลาดกับ MEP riser shaft'
  ],
  SN: [
    'ท่อ SN drain ทับ Beam ที่ห้องน้ำ',
    'SN vent pipe ขัด AC duct ในฝ้า',
    'SN waste pipe ขัด structural slab opening',
    'SN cleanout ตำแหน่งใต้คาน clearance ไม่พอ'
  ],
  FP: [
    'FP main pipe ขัด Beam ที่กริด',
    'Sprinkler FP ตำแหน่งทับ Light fixture',
    'FP riser ผ่าน Shear wall ไม่มี opening',
    'FP hose cabinet ติดประตูทางหนีไฟ',
    'FP pipe routing conflict at corridor'
  ],
  ST: [
    'Beam ST ลึกกว่า ceiling clearance ที่',
    'ST column ชนแนวท่อ MEP ที่ riser shaft',
    'ST opening ใน Shear wall ต่ำกว่าท่อ'
  ],
  LA: [ 'Landscape LA planter ทับ MEP riser', 'LA drainage ขัดท่อ underground' ],
  IN: [ 'Interior IN built-in ขัดแนวท่อ EE conduit' ]
};

const ZONES = ['ZONE 1','ZONE 2'];
const PRIORITIES = ['Critical','Major','Minor'];
const STATUSES = ['NEW','ACTIVE','RESOLVED','Unknown'];
const COMMENTS = {
  EE: 'ให้ทีม EE ปรับแนว conduit หลบคาน ตามที่ตกลงในประชุม 25 Apr',
  AC: 'ให้ทีม AC ปรับ duct routing หลบโครงสร้าง รอตอบกลับภายใน 30 Apr',
  AR: 'ให้ทีม AR ปรับตำแหน่งผนัง / opening ให้สอดคล้องกับ MEP',
  SN: 'ให้ทีม SN ปรับ slope ท่อระบายและตำแหน่ง vent',
  FP: 'ให้ทีม FP ทบทวน routing pipe และตำแหน่ง sprinkler head',
  ST: 'ให้ทีม ST ทบทวน opening / sleeve ที่ต้องเพิ่มในแบบ shop',
  LA: 'ให้ทีม Landscape ปรับ planter หลบ MEP underground',
  IN: 'ให้ทีม Interior ปรับตำแหน่ง built-in หลบแนว conduit'
};

// Distribution targets (sum=145)
const DIST = { EE:69, AC:19, AR:17, SN:15, FP:15, ST:7, LA:2, IN:1 };
// Status distribution overall: RESOLVED 56, ACTIVE 48, NEW 33, Unknown 8
const STATUS_DIST = { RESOLVED:56, ACTIVE:48, NEW:33, Unknown:8 };
// Priority: Critical 22, Major 71, Minor 52
const PRIO_DIST = { Critical:22, Major:71, Minor:52 };

// Deterministic PRNG so dashboard looks the same each load
function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const rand = mulberry32(20260429);

function pickFromBag(bag){
  // bag is {key:count}; pick & decrement
  const total = Object.values(bag).reduce((a,b)=>a+b,0);
  let r = Math.floor(rand()*total);
  for(const k of Object.keys(bag)){
    if(r < bag[k]){ bag[k]--; return k; }
    r -= bag[k];
  }
  // fallback
  const keys = Object.keys(bag);
  return keys[0];
}

const discBag    = JSON.parse(JSON.stringify(DIST));
const statusBag  = JSON.parse(JSON.stringify(STATUS_DIST));
const prioBag    = JSON.parse(JSON.stringify(PRIO_DIST));

const ISSUES = [];
const PROJECT_ISSUES = { 0: ISSUES, 1: [] };
const TOTAL = 145;

// Grid letters for titles
const GRIDS = ['A-2','B-4','C-3','D-5','E-1','F-7','G-2','H-4','J-6','K-3','L-5','M-2','N-4'];
const FLOORS = ['B1','B2','GF','1F','2F','3F','4F','5F','7F','12F','18F','22F','28F','34F','RF'];

for (let i = 1; i <= TOTAL; i++) {
  const disc = pickFromBag(discBag);
  const status = pickFromBag(statusBag);
  const priority = pickFromBag(prioBag);
  // 64% Zone 1, 36% Zone 2 (93/52)
  const zone = rand() < 93/145 ? 'ZONE 1' : 'ZONE 2';
  const titles = DISC_TITLES[disc];
  const tBase = titles[Math.floor(rand()*titles.length)];
  const grid = GRIDS[Math.floor(rand()*GRIDS.length)];
  const floor = FLOORS[Math.floor(rand()*FLOORS.length)];
  const title = `${tBase} ${grid} ชั้น ${floor}`;
  // 12% of issues have multi-discipline tag (e.g. EE+AC)
  const extras = [];
  if (rand() < 0.12) {
    const others = Object.keys(DIST).filter(d => d !== disc);
    extras.push(others[Math.floor(rand()*others.length)]);
  }
  // Days open: resolved 4-30, active 2-18, new 0-7, unknown 1-25
  let daysOpen;
  if (status==='RESOLVED') daysOpen = 4 + Math.floor(rand()*27);
  else if (status==='ACTIVE') daysOpen = 2 + Math.floor(rand()*17);
  else if (status==='NEW') daysOpen = Math.floor(rand()*8);
  else daysOpen = 1 + Math.floor(rand()*25);

  // Author (rotate among coordinators/BIM manager)
  const authors = ['Nitid S.','Pasit C.','Wassana T.','Kittipong L.','Somchai N.'];
  const author = authors[i % authors.length];
  const assignees = ['EE Team','AC Team','AR Team','SN Team','FP Team','ST Team','MEP Lead','Site Eng.'];
  const assignee = assignees[Math.floor(rand()*assignees.length)];

  ISSUES.push({
    no: String(i),
    title,
    disc: extras.length ? `${disc}, ${extras.join(', ')}` : disc,
    discPrimary: disc,
    zone,
    floor,
    grid,
    priority,
    status,
    comment: COMMENTS[disc],
    daysOpen,
    author,
    assignee,
    createdAt: daysAgo(daysOpen)
  });
}

// === Generate smaller issue sets for other projects ===
function generateProjectIssues(seed, total, statusMix, prioMix, distMix) {
  const rand2 = mulberry32(seed);
  const issues = [];
  const dBag = JSON.parse(JSON.stringify(distMix));
  const sBag = JSON.parse(JSON.stringify(statusMix));
  const pBag = JSON.parse(JSON.stringify(prioMix));
  function pick(bag){
    const tot = Object.values(bag).reduce((a,b)=>a+b,0);
    let r = Math.floor(rand2()*tot);
    for(const k of Object.keys(bag)){ if(r<bag[k]){ bag[k]--; return k; } r-=bag[k]; }
    return Object.keys(bag)[0];
  }
  for (let i = 1; i <= total; i++) {
    const disc = pick(dBag);
    const status = pick(sBag);
    const priority = pick(pBag);
    const zone = rand2() < 0.6 ? 'ZONE 1' : 'ZONE 2';
    const titles = DISC_TITLES[disc];
    const tBase = titles[Math.floor(rand2()*titles.length)];
    const grid = GRIDS[Math.floor(rand2()*GRIDS.length)];
    const floor = FLOORS[Math.floor(rand2()*FLOORS.length)];
    const title = `${tBase} ${grid} ชั้น ${floor}`;
    let daysOpen;
    if (status==='RESOLVED') daysOpen = 4 + Math.floor(rand2()*27);
    else if (status==='ACTIVE') daysOpen = 2 + Math.floor(rand2()*17);
    else if (status==='NEW') daysOpen = Math.floor(rand2()*8);
    else daysOpen = 1 + Math.floor(rand2()*25);
    const authors = ['Nitid S.','Pasit C.','Wassana T.','Kittipong L.','Somchai N.'];
    const author = authors[i % authors.length];
    const assignees = ['EE Team','AC Team','AR Team','SN Team','FP Team','ST Team','MEP Lead','Site Eng.'];
    const assignee = assignees[Math.floor(rand2()*assignees.length)];
    issues.push({
      no: String(i), title, disc, discPrimary: disc, zone, floor, grid, priority, status,
      comment: COMMENTS[disc], daysOpen, author, assignee, createdAt: daysAgo(daysOpen)
    });
  }
  return issues;
}

// Project 1: 5 sample issues
PROJECT_ISSUES[1] = generateProjectIssues(
  20260330, 5,
  { RESOLVED:2, ACTIVE:2, NEW:1, Unknown:0 },
  { Critical:1, Major:2, Minor:2 },
  { EE:2, AC:1, AR:1, SN:0, FP:1, ST:0, LA:0, IN:0 }
);

// Reduce Project 0 (Sample Project A) — keep only first 8 as demo
PROJECT_ISSUES[0] = PROJECT_ISSUES[0].slice(0, 8);

function daysAgo(d) {
  const t = new Date('2026-04-29T10:00:00');
  t.setDate(t.getDate() - d);
  return t.toISOString();
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()%100).padStart(2,'0')}`;
}
function formatDateTime(iso) {
  const d = new Date(iso);
  return `${formatDate(iso)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  // Treat current date as 2026-04-29 baseline for the demo
  const base = new Date('2026-04-29T16:00:00').getTime();
  const diff = base - new Date(iso).getTime();
  const mins = Math.floor(diff/60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs/24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

// Audit log (recent)
const AUDIT_LOG = [
  { ts:'29/04/26 14:32', issueNo:'145', issueTitle:'แนวท่อ EE ชนคานหลัก กริด F-7', action:'Status Change', field:'status', oldVal:'NEW',     newVal:'ACTIVE',   user:'Nitid Saksittikan' },
  { ts:'29/04/26 14:18', issueNo:'142', issueTitle:'AC duct ชนคานคอนกรีตที่ระดับฝ้า', action:'Priority Change', field:'priority', oldVal:'Minor', newVal:'Major', user:'Pasit Charoenpong' },
  { ts:'29/04/26 13:55', issueNo:'138', issueTitle:'FP main pipe ขัด Beam ที่กริด',     action:'Comment Added',  field:'comment',  oldVal:'',        newVal:'…',          user:'Wassana Tongdee' },
  { ts:'29/04/26 13:40', issueNo:'129', issueTitle:'ตู้ MDB ตำแหน่งใกล้ท่อระบายน้ำ',     action:'Status Change',  field:'status',   oldVal:'ACTIVE',  newVal:'RESOLVED',  user:'Kittipong Lertsiri' },
  { ts:'29/04/26 12:05', issueNo:'126', issueTitle:'AR partition ขัดท่อ EE ที่ corridor', action:'Discipline Change', field:'disc', oldVal:'AR',   newVal:'AR, EE',     user:'Nitid Saksittikan' },
  { ts:'29/04/26 11:22', issueNo:'120', issueTitle:'SN waste pipe ขัด slab opening',     action:'Status Change',  field:'status',   oldVal:'NEW',     newVal:'ACTIVE',    user:'Somchai Nakorn' },
  { ts:'29/04/26 10:48', issueNo:'118', issueTitle:'Cable tray EE ทะลุ Shear Wall',     action:'Issue Created',  field:'',         oldVal:'',        newVal:'',          user:'Nitid Saksittikan' },
  { ts:'29/04/26 10:14', issueNo:'115', issueTitle:'Diffuser AC ตำแหน่งทับ Sprinkler',  action:'Image Updated',  field:'img',      oldVal:'',        newVal:'',          user:'Pasit Charoenpong' },
  { ts:'29/04/26 09:50', issueNo:'112', issueTitle:'EE busway ระดับชนกับท่อ AC duct',  action:'Status Change',  field:'status',   oldVal:'ACTIVE',  newVal:'RESOLVED',  user:'Wassana Tongdee' },
  { ts:'29/04/26 09:31', issueNo:'108', issueTitle:'AR ceiling clearance ไม่พอ',        action:'Priority Change',field:'priority', oldVal:'Major',   newVal:'Critical',  user:'Nitid Saksittikan' },
  { ts:'29/04/26 09:08', issueNo:'105', issueTitle:'Beam ST ลึกกว่า ceiling clearance', action:'Comment Added',  field:'comment',  oldVal:'',        newVal:'…',          user:'Kittipong Lertsiri' },
  { ts:'29/04/26 08:42', issueNo:'',    issueTitle:'BIM_Report_20260429.csv',           action:'CSV Import',     field:'',         oldVal:'',        newVal:'145 rows',   user:'Pasit Charoenpong' }
];

// Per-project audit logs (minimal demo)
const PROJECT_AUDIT = { 0: AUDIT_LOG.slice(0, 5), 1: [] };
[1].forEach(pIdx => {
  const sample = PROJECT_ISSUES[pIdx].slice(0, 6);
  sample.forEach((it, i) => {
    PROJECT_AUDIT[pIdx].push({
      ts: `${24-i}/${pIdx===1?'03':'02'}/26 ${10+i}:${String((15+i*7)%60).padStart(2,'0')}`,
      issueNo: it.no, issueTitle: it.title,
      action: ['Status Change','Comment Added','Priority Change','Issue Created','Status Change','Discipline Change'][i%6],
      field: ['status','comment','priority','','status','disc'][i%6],
      oldVal: it.status === 'RESOLVED' ? 'ACTIVE' : 'NEW',
      newVal: it.status,
      user: ['Nitid Saksittikan','Pasit Charoenpong','Wassana Tongdee'][i%3]
    });
  });
});

// Burndown data — 14 days, simulating resolution velocity
// Each day: { date, opened, resolved, openTotal }
const BURNDOWN = (function(){
  const out = [];
  let openTotal = 89; // 14 days ago we had 89 open
  // We've been resolving issues and creating new ones; today open = ACTIVE+NEW+Unknown
  const todayOpen = ISSUES.filter(i => i.status !== 'RESOLVED').length; // 89
  for (let d = 13; d >= 0; d--) {
    const date = new Date('2026-04-29');
    date.setDate(date.getDate() - d);
    // simulate some activity
    const opened = 3 + Math.floor(rand()*8);
    const resolved = 2 + Math.floor(rand()*7);
    openTotal = Math.max(0, openTotal + opened - resolved);
    out.push({
      date,
      label: `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}`,
      opened, resolved, openTotal
    });
  }
  // force last value to match real today
  out[out.length-1].openTotal = todayOpen;
  return out;
})();

// 12-week trend for analytics
const TREND_12W = (function(){
  const out = [];
  let totalCum = 0;
  let resolvedCum = 0;
  for (let w = 11; w >= 0; w--) {
    const newIssues = 8 + Math.floor(rand()*14);
    const resolved = 4 + Math.floor(rand()*12);
    totalCum += newIssues;
    resolvedCum += resolved;
    out.push({
      week: `W${52-w}`,
      newIssues,
      resolved,
      backlog: Math.max(0, totalCum - resolvedCum)
    });
  }
  return out;
})();
