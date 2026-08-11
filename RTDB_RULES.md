# Realtime Database Security Rules

Current published rules only cover one narrow case:

```json
{
  "rules": {
    "issues": {
      "$pid": { "$no": { ".write": "auth != null" } }
    }
  }
}
```

Gaps: no `.read` rule anywhere (nothing under `issues` grants read, and
`projects`/`users`/`audit` have no rules at all), and no project-scoping —
any authenticated user, including a future Client Reviewer, could read or
write any project's `issues/$pid`.

## Replacement

Paste this into Console → Realtime Database → **Rules**, then test with the
**Rules Playground** (top-right of that screen) before hitting **Publish**:

```json
{
  "rules": {
    "client_access": {
      ".read": false,
      ".write": "auth != null"
    },
    "projects": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "users": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "report_templates": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "issues": {
      "$pid": {
        ".read":  "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)",
        ".write": "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)"
      }
    },
    "audit": {
      "$pid": {
        ".read":  "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)",
        ".write": "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)"
      }
    }
  }
}
```

## How the scoping works

`client_access/{uid}` is a new node this app now maintains automatically
(`fbSyncClientAccess()` in `firebase.js`, called from every `fbSaveUsers()`).
It mirrors `{firebaseUid: projectCode}` for every Client Reviewer only —
internal staff never appear in it.

The `issues`/`audit` rules read that node via `root.child(...)`, which rule
expressions can always do regardless of `.read` permissions elsewhere:

- **Not in `client_access`** (internal staff) → the `!exists()` branch is
  true → full access to every project, same as today.
- **In `client_access` with `client_access/{uid} === $pid`** → access to
  that one project.
- **In `client_access` with a different project code** → denied.

## What this does not fix yet

`projects` and `users` are left at `auth != null` for both read and write —
the same trust level the app already had. That means a Client Reviewer
could, via the raw SDK (not through the UI, which blocks this), still write
to `users` or `projects` — e.g. edit another project's name, or attempt to
change their own role. Closing that needs a second mirror (a role lookup,
same shape as `client_access`) plus care around the first-login
self-registration race (a brand-new user has to write themselves into
`users` before `client_access` exists for them). Worth a follow-up pass if
you want it — didn't want to bundle it into this change silently.

## One-time note

`client_access` only populates for users who've signed in *after* this
update (that's when `uid` gets attached to their `USERS` record). Any
Client Reviewer invited before today will get backfilled automatically on
their next login — no manual fix needed.
