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
      allow read: if request.auth != null &&
                     request.auth.token.email.matches('.*@teamcm[.]co[.]th$');
      allow write: if request.auth != null &&
                      request.auth.token.email.matches('.*@teamcm[.]co[.]th$') &&
                      request.resource.size < 100 * 1024 * 1024;
      allow delete: if request.auth != null &&
                       request.auth.token.email.matches('.*@teamcm[.]co[.]th$');
    }
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

## What this does and doesn't enforce

- **Read is locked to `@teamcm.co.th` accounts** — matches the "internal
  staff only" requirement, checked against the signed-in user's real email
  (Google/Microsoft OAuth token), not anything the client sends.
- **Upload/delete is also `@teamcm.co.th`-only**, but *not* narrowed further
  to Admin/BIM Manager — Storage rules can't read this app's `users` role
  data (that lives in Realtime Database; Storage rules can only call into
  Cloud Firestore, which this app doesn't use). The Admin/BIM Manager-only
  restriction is enforced by the app's UI (`hasPermission('library')`) —
  same category of limitation already noted for `projects`/`users` writes
  in `RTDB_RULES.md`. A Coordinator or Viewer technically could upload via
  the raw SDK; they just can't through the app itself.
- 100MB size cap on write (regulations/standards PDFs run bigger than the
  10MB image cap).
