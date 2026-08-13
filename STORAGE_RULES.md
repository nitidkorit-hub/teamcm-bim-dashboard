# Firebase Storage Security Rules — Library addition

Current published rules (Console → Storage → Rules) only cover issue images:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /projects/{projectId}/issues/{issueId}/images/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
                      request.resource.size < 10 * 1024 * 1024 &&
                      request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null;
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

The new Library feature uploads to `library/{docId}/{fileName}`, which the
catch-all `allow read, write: if false` at the bottom currently blocks
entirely. Replace the whole ruleset with this (test in the Rules Playground
before Publish, same as before):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /projects/{projectId}/issues/{issueId}/images/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
                      request.resource.size < 10 * 1024 * 1024 &&
                      request.resource.contentType.matches('image/.*');
      allow delete: if request.auth != null;
    }
    match /library/{docId}/{fileName} {
      allow read, delete: if request.auth != null;
      allow write: if request.auth != null &&
                      request.resource.size < 100 * 1024 * 1024;
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## What changed from the first version

The first draft locked read/write/delete to
`request.auth.token.email.matches('.*@teamcm[.]co[.]th$')`. Dropped that —
Firebase doesn't reliably populate `token.email` for every sign-in
provider the same way (Microsoft/Azure AD OAuth in particular can differ
from Google), and it's untestable from outside a real logged-in session.
An unpopulated/absent `email` claim makes the whole rule expression error,
which Storage Rules treats as `false` — silently denying everything on
this path, including uploads, no matter how large the file was.

Simplified to `auth != null` — the same trust level already used for
`projects`/`users`/`report_templates` in `RTDB_RULES.md`. "Internal staff
only" for the Library page is enforced by the app's UI (nav item + page
route hidden for Client Reviewer), not by Storage rules — same category of
trade-off already accepted elsewhere in this app. A Client Reviewer with a
direct file URL could technically still fetch it; they have no way to
discover that URL through the app itself.

- **Upload/delete is `auth != null`-only**, not narrowed to Admin/BIM
  Manager — Storage rules can't read this app's `users` role data (that
  lives in Realtime Database; Storage rules can only call into Cloud
  Firestore, which this app doesn't use). The Admin/BIM Manager-only
  restriction is enforced by the app's UI (`hasPermission('library')`).
- 100MB size cap on write (regulations/standards PDFs run bigger than the
  10MB image cap).
