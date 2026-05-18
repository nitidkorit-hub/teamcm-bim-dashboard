/* =============================================================
   TEAMCM BIM Dashboard — Firebase Integration Layer
   Uses: Auth + Realtime Database (Spark plan, no billing needed)
   Images: localStorage only (base64)
   ============================================================= */

const firebaseConfig = {
  apiKey:            'AIzaSyAiOO1C2Qeerdzps4lhD3F1659cdYFTIN4',
  authDomain:        'team-cmbimdashboard.firebaseapp.com',
  databaseURL:       'https://team-cmbimdashboard-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'team-cmbimdashboard',
  storageBucket:     'team-cmbimdashboard.firebasestorage.app',
  messagingSenderId: '1096318485456',
  appId:             '1:1096318485456:web:5ce67f881c7f38e211efd5'
};

firebase.initializeApp(firebaseConfig);

const fbAuth = firebase.auth();
const fbDb   = firebase.database();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ─── Auth ────────────────────────────────────────────────────────────
function fbSignIn() {
  return fbAuth.signInWithPopup(googleProvider);
}
function fbSignOut() {
  return fbAuth.signOut().then(() => location.reload());
}

// ─── Project key (safe for RTDB path) ────────────────────────────────
// Replaces '.' with '_' — RTDB keys cannot contain . $ # [ ] /
function fbPid(projIdx) {
  return ((PROJECTS[projIdx] || PROJECTS[0]).code).replace(/[.$#[\]/]/g, '_');
}

// ─── Issues (Realtime Database) ───────────────────────────────────────
/**
 * Load all issues for a project.
 * Returns null if no data exists (first run → need seeding).
 */
async function fbLoadIssues(projIdx) {
  const snap = await fbDb.ref(`issues/${fbPid(projIdx)}`).get();
  if (!snap.exists()) return null;
  const data = snap.val();
  // Sort by issue number numerically
  return Object.values(data).sort((a, b) => parseInt(a.no) - parseInt(b.no));
}

/** Save (upsert) a single issue. Fire-and-forget safe. */
async function fbSaveIssue(projIdx, issue) {
  const key = String(issue.no).replace(/[.$#[\]/]/g, '_');
  return fbDb.ref(`issues/${fbPid(projIdx)}/${key}`).set(issue);
}

/** Delete a single issue. Fire-and-forget safe. */
async function fbDeleteIssue(projIdx, no) {
  const key = String(no).replace(/[.$#[\]/]/g, '_');
  return fbDb.ref(`issues/${fbPid(projIdx)}/${key}`).remove();
}

/** Bulk-write all issues for a project (seed / full replace). */
async function fbSeedIssues(projIdx, issues) {
  const data = {};
  issues.forEach(iss => {
    const key = String(iss.no).replace(/[.$#[\]/]/g, '_');
    data[key] = iss;
  });
  return fbDb.ref(`issues/${fbPid(projIdx)}`).set(data);
}

// ─── Audit Log (Realtime Database) ───────────────────────────────────
async function fbLoadAudit(projIdx) {
  const snap = await fbDb.ref(`audit/${fbPid(projIdx)}`).orderByChild('_ts').limitToLast(100).get();
  if (!snap.exists()) return [];
  const rows = Object.values(snap.val()).reverse();
  return rows.map(r => { const x = { ...r }; delete x._ts; return x; });
}

async function fbAddAudit(projIdx, entry) {
  return fbDb.ref(`audit/${fbPid(projIdx)}`).push({ ...entry, _ts: Date.now() });
}

// ─── Projects (Realtime Database) ────────────────────────────────────
/** Load projects array. Returns null if not seeded yet. */
async function fbLoadProjects() {
  const snap = await fbDb.ref('projects').get();
  if (!snap.exists()) return null;
  const data = snap.val();
  // RTDB stores as object with numeric keys → array sorted by id
  return Object.values(data).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** Save the entire PROJECTS array. Used after any project mutation. */
async function fbSaveProjects(projects) {
  const data = {};
  projects.forEach((p, idx) => { data[idx] = p; });
  return fbDb.ref('projects').set(data);
}

// ─── Users (Realtime Database) ───────────────────────────────────────
async function fbLoadUsers() {
  const snap = await fbDb.ref('users').get();
  if (!snap.exists()) return null;
  return Object.values(snap.val()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

async function fbSaveUsers(users) {
  const data = {};
  users.forEach(u => { data[String(u.id)] = u; });
  return fbDb.ref('users').set(data);
}

// ─── Storage stubs (images stored in localStorage, not Firebase) ──────
// Returns rejected promise so callers' .catch() runs without side-effects
async function fbUploadDataUrl() { throw new Error('Storage not enabled'); }
async function fbUploadBlob()    { throw new Error('Storage not enabled'); }
async function fbDeleteImage()   { /* no-op */ }
