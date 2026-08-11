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

const fbAuth    = firebase.auth();
const fbDb      = firebase.database();
const fbStorage = firebase.storage();

// ─── Auth providers ──────────────────────────────────────────────────
const googleProvider = new firebase.auth.GoogleAuthProvider();

const microsoftProvider = new firebase.auth.OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  // TEAM·CM Azure tenant — only @teamcm.co.th accounts can authenticate
  // via the OAuth flow itself (in addition to the app-level domain check).
  tenant: 'e13fef33-a530-4c08-b4d5-2e4711280b4d',
  prompt: 'select_account'
});
// Request email + profile scopes
microsoftProvider.addScope('email');
microsoftProvider.addScope('profile');
microsoftProvider.addScope('openid');

function fbSignIn() {
  return fbAuth.signInWithPopup(googleProvider);
}
function fbSignInMicrosoft() {
  return fbAuth.signInWithPopup(microsoftProvider);
}
function fbSignOut() {
  fbUnsubscribeAll();
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
  return Promise.all([
    fbDb.ref('users').set(data),
    fbSyncClientAccess(users)
  ]);
}

// ─── Report Templates (Realtime Database) ─────────────────────────────
// Shared across projects — a saved combination of sections/discipline/status
// filters from the Publish Report page, so it doesn't need to be rebuilt
// by hand each time.
async function fbLoadReportTemplates() {
  const snap = await fbDb.ref('report_templates').get();
  if (!snap.exists()) return null;
  return Object.values(snap.val()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

async function fbSaveReportTemplates(templates) {
  const data = {};
  templates.forEach(t => { data[String(t.id)] = t; });
  return fbDb.ref('report_templates').set(data);
}

function fbSubscribeReportTemplates(callback) {
  _unsubscribe('report_templates');
  const ref = fbDb.ref('report_templates');
  const fn = snap => {
    const data = snap.val();
    callback(data ? Object.values(data).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) : []);
  };
  ref.on('value', fn);
  _fbListeners.report_templates = { ref, fn };
}

// ─── Library (standards / regulations documents) ──────────────────────
// Metadata in Realtime Database, files in Cloud Storage under library/{docId}/.
// Internal staff only — see isAllowedLibraryReader() in app.js.
async function fbLoadLibraryDocs() {
  const snap = await fbDb.ref('library_docs').get();
  if (!snap.exists()) return null;
  return Object.values(snap.val()).sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

async function fbSaveLibraryDocs(docs) {
  const data = {};
  docs.forEach(d => { data[String(d.id)] = d; });
  return fbDb.ref('library_docs').set(data);
}

function fbSubscribeLibraryDocs(callback) {
  _unsubscribe('library_docs');
  const ref = fbDb.ref('library_docs');
  const fn = snap => {
    const data = snap.val();
    const list = data ? Object.values(data) : [];
    list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    callback(list);
  };
  ref.on('value', fn);
  _fbListeners.library_docs = { ref, fn };
}

/** Upload a document File to Cloud Storage. Returns its public download URL. */
async function fbUploadLibraryFile(docId, file) {
  if (!fbAuth.currentUser) throw new Error('User not authenticated');
  const safeName = file.name.replace(/[.$#[\]/]/g, '_');
  const path = `library/${docId}/${Date.now()}_${safeName}`;
  const ref = fbStorage.ref(path);
  const snapshot = await ref.put(file, { contentType: file.type || 'application/octet-stream' });
  return snapshot.ref.getDownloadURL();
}

async function fbDeleteLibraryFile(fileUrl) {
  try {
    await fbStorage.refFromURL(fileUrl).delete();
  } catch (e) {
    console.warn('fbDeleteLibraryFile:', e);
  }
}

/**
 * Mirrors {uid: projectCode} for every project-scoped user (Client Reviewer) into
 * client_access/ — keyed by Firebase Auth uid (not email, which needs awkward
 * dot-encoding to be a valid RTDB key). Security Rules read this node to decide
 * whether a signed-in user may see a given project's issues/audit, since rules
 * can't otherwise look up "what project does this user belong to".
 * Internal staff (no projectCode) are simply absent from this node.
 */
async function fbSyncClientAccess(users) {
  const data = {};
  users.forEach(u => {
    if (u.uid && u.projectCode) data[u.uid] = u.projectCode;
  });
  return fbDb.ref('client_access').set(data);
}

// ─── Real-time listeners (auto-sync across devices) ──────────────────
// Tracks active subscriptions so we can clean them up on project switch.
const _fbListeners = {};

function _unsubscribe(key) {
  const ent = _fbListeners[key];
  if (ent) { try { ent.ref.off('value', ent.fn); } catch (e) {} delete _fbListeners[key]; }
}

function fbUnsubscribeAll() {
  Object.keys(_fbListeners).forEach(_unsubscribe);
}

/** Subscribe to issues for a project — fires whenever any device writes. */
function fbSubscribeIssues(projIdx, callback) {
  _unsubscribe('issues');
  const ref = fbDb.ref(`issues/${fbPid(projIdx)}`);
  const fn = snap => {
    const data = snap.val();
    const arr = data ? Object.values(data).sort((a, b) => parseInt(a.no) - parseInt(b.no)) : [];
    callback(arr);
  };
  ref.on('value', fn);
  _fbListeners.issues = { ref, fn };
}

/** Subscribe to audit log for a project. */
function fbSubscribeAudit(projIdx, callback) {
  _unsubscribe('audit');
  const ref = fbDb.ref(`audit/${fbPid(projIdx)}`).orderByChild('_ts').limitToLast(100);
  const fn = snap => {
    const data = snap.val();
    if (!data) { callback([]); return; }
    const rows = Object.values(data).reverse();
    callback(rows.map(r => { const x = { ...r }; delete x._ts; return x; }));
  };
  ref.on('value', fn);
  _fbListeners.audit = { ref, fn };
}

/** Subscribe to global projects list. */
function fbSubscribeProjects(callback) {
  _unsubscribe('projects');
  const ref = fbDb.ref('projects');
  const fn = snap => {
    const data = snap.val();
    callback(data ? Object.values(data).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) : []);
  };
  ref.on('value', fn);
  _fbListeners.projects = { ref, fn };
}

/** Subscribe to global users list. */
function fbSubscribeUsers(callback) {
  _unsubscribe('users');
  const ref = fbDb.ref('users');
  const fn = snap => {
    const data = snap.val();
    callback(data ? Object.values(data).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)) : []);
  };
  ref.on('value', fn);
  _fbListeners.users = { ref, fn };
}

// ─── Cloud Storage (Firebase Storage SDK) ────────────────────────────
// Uses Firebase Storage compat SDK — handles auth + rules automatically.
// Path pattern: projects/{pid}/issues/{no}/images/{timestamp}_{no}.png
// Matches Security Rules:
//   match /projects/{projectId}/issues/{issueId}/images/{fileName}

/** Build the Storage path for an issue image */
function _fbStoragePath(projIdx, issueNo, fileName) {
  const safeNo = String(issueNo).replace(/[.$#[\]/]/g, '_');
  return `projects/${fbPid(projIdx)}/issues/${safeNo}/images/${fileName}`;
}

/** Upload image from data URL to Cloud Storage. Returns public download URL. */
async function fbUploadDataUrl(projIdx, issueNo, dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    return fbUploadBlob(projIdx, issueNo, blob);
  } catch (e) {
    console.error('fbUploadDataUrl error:', e);
    throw e;
  }
}

/** Upload image from Blob to Cloud Storage. Returns public download URL. */
async function fbUploadBlob(projIdx, issueNo, blob) {
  if (!fbAuth.currentUser) throw new Error('User not authenticated');

  const fileName = `${Date.now()}_${issueNo}.png`;
  const path = _fbStoragePath(projIdx, issueNo, fileName);

  // Use Firebase Storage SDK — handles auth, rules, and CORS automatically
  const ref = fbStorage.ref(path);
  const snapshot = await ref.put(blob, { contentType: blob.type || 'image/png' });
  const url = await snapshot.ref.getDownloadURL();
  console.log('Image uploaded:', url);
  return url;
}

/** Delete all images for an issue from Cloud Storage. */
async function fbDeleteImage(projIdx, issueNo) {
  if (!fbAuth.currentUser) {
    console.warn('User not authenticated, skipping delete');
    return;
  }
  try {
    const safeNo = String(issueNo).replace(/[.$#[\]/]/g, '_');
    const folderRef = fbStorage.ref(`projects/${fbPid(projIdx)}/issues/${safeNo}/images`);
    const list = await folderRef.listAll();
    await Promise.all(list.items.map(item => item.delete().catch(() => {})));
  } catch (e) {
    console.warn('fbDeleteImage error:', e);
  }
}
