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

/**
 * What actually gets stored: the real status (`_base` — not the auto-derived ACTIVE DELAY
 * the UI may be showing) and none of the client-only `_` fields or undefined values.
 */
function fbSerializeIssue(issue) {
  const out = {};
  Object.keys(issue).forEach(k => {
    if (k[0] === '_' || issue[k] === undefined) return;
    out[k] = issue[k];
  });
  if (issue._base !== undefined) out.status = issue._base;
  return out;
}

/** Save (upsert) a single issue. Callers attach .catch(saveFail(...)) so a rejected write is visible. */
async function fbSaveIssue(projIdx, issue) {
  const key = String(issue.no).replace(/[.$#[\]/]/g, '_');
  return fbDb.ref(`issues/${fbPid(projIdx)}/${key}`).set(fbSerializeIssue(issue));
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
    data[key] = fbSerializeIssue(iss);
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

/**
 * Writes just the signed-in user's own USERS record (+ their own role_access
 * mirror entry) — used for self-registration on first login and for
 * refreshing lastActive/displayName on return visits. Deliberately NOT
 * fbSaveUsers(): that writes the whole org's user list in one call, which a
 * non-admin session touching only their own record has no business doing —
 * and under the role-gated rules below, a bulk write like that from a
 * non-admin is rejected outright once it touches anyone else's row.
 */
async function fbSaveOwnUser(userRecord) {
  // The user record itself is the only write that must succeed.
  const saved = fbDb.ref('users/' + userRecord.id).set(userRecord);
  // Access mirrors, best effort: under the current rules a user may only *create* their own
  // entry, with the least-privileged role. Anything beyond that (promotions, existing entries)
  // is applied by an Admin session via fbReconcileAccess(), so a rejection here is expected.
  if (userRecord.uid) {
    const selfRole = userRecord.role === 'Client Reviewer' ? 'Client Reviewer' : 'Viewer';
    fbDb.ref('role_access/' + userRecord.uid).set(selfRole).catch(() => {});
    if (userRecord.projectCode) {
      fbDb.ref('client_access/' + userRecord.uid).set(userRecord.projectCode).catch(() => {});
    }
  }
  return saved;
}

/**
 * Admin-only: pushes every known user's {uid: role} and {uid: projectCode} into the mirror
 * nodes the Security Rules read. This is what promotes someone from the Viewer entry they
 * created for themselves at first login to their real role, and what scopes a new client.
 */
async function fbReconcileAccess(users) {
  const roles = {};
  const clients = {};
  users.forEach(u => {
    if (!u.uid) return;
    // 'Admin' is deliberately never mirrored from here — it can only be granted by an Admin
    // editing the user (saveUserEdit), never inferred from a record anyone could have written.
    if (u.role && u.role !== 'Admin') roles[u.uid] = u.role;
    if (u.projectCode) clients[u.uid] = u.projectCode;
  });
  await Promise.all([
    Object.keys(roles).length ? fbDb.ref('role_access').update(roles) : null,
    fbDb.ref('client_access').set(clients)
  ]);
}

/**
 * Mirrors one user's {uid: role} into role_access/ — a single targeted write,
 * never a bulk sync. Security Rules can't look up a user's role from the
 * `users` node by field value, only by direct key lookup, so this gives rules
 * a uid-keyed node to check `root.child('role_access').child(auth.uid)`
 * against (same reasoning as the existing client_access mirror). Lets
 * `projects`/`library_docs` rules — and the `role`/`projectCode` fields
 * inside `users` — require a real, server-verified role instead of trusting
 * the client's state.user.role.
 */
async function fbSetRoleAccess(uid, role) {
  if (!uid || !role) return;
  return fbDb.ref('role_access/' + uid).set(role);
}

async function fbRemoveRoleAccess(uid) {
  if (!uid) return;
  return fbDb.ref('role_access/' + uid).remove();
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

// ─── Master data (dropdown options editable by Admin) ─────────────────
async function fbLoadMaster() {
  const snap = await fbDb.ref('master_data').get();
  return snap.exists() ? snap.val() : null;
}
async function fbSaveMaster(master) {
  return fbDb.ref('master_data').set(master);
}
function fbSubscribeMaster(callback) {
  _unsubscribe('master_data');
  const ref = fbDb.ref('master_data');
  const fn = snap => callback(snap.val());
  ref.on('value', fn);
  _fbListeners.master_data = { ref, fn };
}

// ─── Connection state (drives the sidebar sync indicator) ─────────────
function fbWatchConnection(callback) {
  fbDb.ref('.info/connected').on('value', snap => callback(snap.val() === true));
}

// ─── Backup ───────────────────────────────────────────────────────────
async function fbLoadBackupData(projects) {
  const get = async (path) => { const s = await fbDb.ref(path).get(); return s.exists() ? s.val() : null; };
  const out = {
    exportedAt: new Date().toISOString(),
    projects: await get('projects'),
    users: await get('users'),
    master_data: await get('master_data'),
    library_docs: await get('library_docs'),
    report_templates: await get('report_templates'),
    issues: {},
    audit: {}
  };
  for (const p of projects) {
    const pid = String(p.code).replace(/[.$#[\]/]/g, '_');
    out.issues[pid] = await get('issues/' + pid);
    out.audit[pid] = await get('audit/' + pid);
  }
  return out;
}

// ─── Library full-text index (extracted in the browser from the PDF's text layer) ───
// One RTDB node per document: { pages: ['line\nline…', …], emptyPages, indexedAt }.
async function fbSaveLibraryIndex(docId, index) {
  return fbDb.ref('library_index/' + docId).set(index);
}
async function fbLoadLibraryIndex(docId) {
  const snap = await fbDb.ref('library_index/' + docId).get();
  return snap.exists() ? snap.val() : null;
}
async function fbDeleteLibraryIndex(docId) {
  return fbDb.ref('library_index/' + docId).remove();
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
