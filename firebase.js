/* =============================================================
   TEAMCM BIM Dashboard — Firebase Integration Layer
   Firebase compat SDK v12  (scripts loaded in dashboard.html)
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
const fbDb      = firebase.firestore();
const fbStorage = firebase.storage();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// ─── Auth ────────────────────────────────────────────────────────────
function fbSignIn() {
  return fbAuth.signInWithPopup(googleProvider);
}
function fbSignOut() {
  return fbAuth.signOut().then(() => location.reload());
}

// ─── Project document ID ─────────────────────────────────────────────
// Uses project code as Firestore doc ID, e.g. 'BIM-2026-04'
function fbPid(projIdx) {
  return (PROJECTS[projIdx] || PROJECTS[0]).code;
}

// ─── Issues ──────────────────────────────────────────────────────────
/**
 * Load all issues for a project.
 * Returns null if the collection is empty (first time → need seeding).
 */
async function fbLoadIssues(projIdx) {
  const snap = await fbDb
    .collection('issues').doc(fbPid(projIdx))
    .collection('items').orderBy('no').get();
  if (snap.empty) return null;
  return snap.docs.map(d => d.data());
}

/** Save (upsert) a single issue. Fire-and-forget safe. */
async function fbSaveIssue(projIdx, issue) {
  return fbDb
    .collection('issues').doc(fbPid(projIdx))
    .collection('items').doc(String(issue.no))
    .set(issue, { merge: true });
}

/** Delete a single issue. Fire-and-forget safe. */
async function fbDeleteIssue(projIdx, no) {
  return fbDb
    .collection('issues').doc(fbPid(projIdx))
    .collection('items').doc(String(no)).delete();
}

/** Bulk-write issues (seed or full replace). Splits into 400-write batches. */
async function fbSeedIssues(projIdx, issues) {
  for (let i = 0; i < issues.length; i += 400) {
    const batch = fbDb.batch();
    issues.slice(i, i + 400).forEach(iss => {
      const ref = fbDb
        .collection('issues').doc(fbPid(projIdx))
        .collection('items').doc(String(iss.no));
      batch.set(ref, iss);
    });
    await batch.commit();
  }
}

// ─── Audit Log ───────────────────────────────────────────────────────
async function fbLoadAudit(projIdx) {
  const snap = await fbDb
    .collection('audit').doc(fbPid(projIdx))
    .collection('logs').orderBy('_ts', 'desc').limit(100).get();
  return snap.docs.map(d => {
    const row = d.data();
    delete row._ts;   // remove server timestamp before returning
    return row;
  });
}

async function fbAddAudit(projIdx, entry) {
  return fbDb
    .collection('audit').doc(fbPid(projIdx))
    .collection('logs').add({
      ...entry,
      _ts: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// ─── Storage (images) ────────────────────────────────────────────────
/**
 * Upload a base64 data URL → Firebase Storage.
 * Returns the permanent download URL.
 */
async function fbUploadDataUrl(projIdx, no, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const ref = fbStorage.ref(`images/p${projIdx}_${no}.jpg`);
  await ref.put(blob, { contentType: 'image/jpeg' });
  return ref.getDownloadURL();
}

/**
 * Upload a Blob directly (from fetch of remote URL).
 * Returns the permanent download URL.
 */
async function fbUploadBlob(projIdx, no, blob) {
  const ref = fbStorage.ref(`images/p${projIdx}_${no}.jpg`);
  await ref.put(blob, { contentType: blob.type || 'image/jpeg' });
  return ref.getDownloadURL();
}

/** Delete image from Storage (ignore if not found). */
async function fbDeleteImage(projIdx, no) {
  try { await fbStorage.ref(`images/p${projIdx}_${no}.jpg`).delete(); } catch (e) { /* ok */ }
}
