# Realtime Database Security Rules

## Rev D — closes the remaining holes found in the system review

Rev C is the rules currently published. Rev D adds what the review found, plus the two
new nodes the app now uses (`master_data`, `library_index`). **Rev C stays below as the
rollback**: if anything misbehaves after publishing Rev D, paste Rev C back and Publish.

What changes compared with Rev C:

| # | Hole in Rev C | Rev D |
|---|---|---|
| 1 | Any signed-in user could delete/overwrite their own `client_access` entry — an unscoped account sees every project, defeating the Client Portal | Only an Admin can write `client_access`. A user may only *create* their own entry once (the app does this at first login) or re-write the same value |
| 2 | Any signed-in user could delete or overwrite the whole `users` list | Only an Admin can write the `users` node. A normal user can write only their own record (or an unclaimed one), and can never delete a record |
| 3 | A first-time user could create their own record with any role (e.g. Admin) | A self-created record may only be `Viewer` or `Client Reviewer`; role changes stay Admin-only |
| 4 | A Viewer / Client Reviewer could write or delete issues from devtools | `issues` writes need role `Admin`, `BIM Manager` or `Coordinator` (project scoping unchanged). Comments go to `audit`, so Client Reviewers can still comment |
| 5 | Client Reviewers could delete shared report templates | `report_templates` writes need a known non-Client role |
| + | `role_access` could be self-asserted as `BIM Manager`/`Coordinator` | A user may only create their own entry as `Viewer`/`Client Reviewer`; promotions are written by an Admin (Master Data → "Sync สิทธิ์") |
| + | new nodes | `master_data` (Admin write), `library_index` (Admin/BIM Manager write) |

```json
{
  "rules": {
    "client_access": {
      ".read": false,
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid && (!data.exists() || newData.val() === data.val())"
      }
    },
    "role_access": {
      ".read": false,
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'",
      "$uid": {
        ".write": "auth != null && auth.uid === $uid && !data.exists()",
        ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || newData.val() === 'Viewer' || newData.val() === 'Client Reviewer' || auth.token.email === 'nitid_s@teamcm.co.th'"
      }
    },
    "projects": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'"
    },
    "master_data": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'"
    },
    "users": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'",
      "$id": {
        ".write": "auth != null && newData.exists() && (!data.exists() || !data.child('uid').exists() || data.child('uid').val() === auth.uid)",
        "role": {
          ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || (!data.exists() && (newData.val() === 'Viewer' || newData.val() === 'Client Reviewer')) || newData.val() === data.val()"
        },
        "projectCode": {
          ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || !data.exists() || newData.val() === data.val()"
        }
      }
    },
    "report_templates": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('role_access').child(auth.uid).exists() && root.child('role_access').child(auth.uid).val() !== 'Client Reviewer'"
    },
    "library_docs": {
      ".read": "auth != null",
      ".write": "auth != null && (root.child('role_access').child(auth.uid).val() === 'Admin' || root.child('role_access').child(auth.uid).val() === 'BIM Manager')"
    },
    "library_index": {
      ".read": "auth != null",
      ".write": "auth != null && (root.child('role_access').child(auth.uid).val() === 'Admin' || root.child('role_access').child(auth.uid).val() === 'BIM Manager')"
    },
    "issues": {
      "$pid": {
        ".read":  "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)",
        ".write": "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid) && (root.child('role_access').child(auth.uid).val() === 'Admin' || root.child('role_access').child(auth.uid).val() === 'BIM Manager' || root.child('role_access').child(auth.uid).val() === 'Coordinator')"
      }
    },
    "audit": {
      "$pid": {
        ".indexOn": ["_ts"],
        ".read":  "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)",
        ".write": "auth != null && (!root.child('client_access').child(auth.uid).exists() || root.child('client_access').child(auth.uid).val() === $pid)"
      }
    }
  }
}
```

> `.indexOn: ["_ts"]` on `audit/$pid` removes the console warning and makes the "latest 100 entries" query run on the server instead of downloading the whole log. Optional, harmless to publish.

### Rollout (in this order)

1. Deploy the app version that ships with this file (it already tolerates both Rev C and Rev D).
2. Console → Realtime Database → **Rules**: paste the JSON above → test in the **Rules Playground**
   (checklist below) → **Publish**.
3. Reload the dashboard as `nitid_s@teamcm.co.th`, open **Master Data** → **Sync สิทธิ์ตอนนี้** once.
   From then on, any Admin session keeps `role_access` / `client_access` in step with the Users page
   automatically. (Until you click it, nothing is auto-promoted — by design, because before Rev D the
   `users` list could be written by anyone.)
4. Check with real accounts: an Admin can create/delete a project and edit users; a Coordinator can edit an
   issue; a Viewer can *not* change an issue (a red "ไม่มีสิทธิ์เขียนข้อมูล" toast appears); a Client Reviewer
   sees only their project and can still comment.

**Rules Playground checklist** (simulate *Authenticated*, set the UID of the account being tested):
- `nitid_s` (role_access = Admin) `set /projects/0` → allowed
- Viewer `set /issues/P06428/1` → **denied**; Coordinator same path → allowed
- Any user `set /users` (whole node) → **denied**; same user `set /users/<own id>` → allowed; `remove /users/<other id>` → **denied**
- Client Reviewer `remove /client_access/<own uid>` → **denied**
- New user `set /users/99` with `role: "Admin"` → **denied**; with `role: "Viewer"` → allowed

**Known limits (unchanged by Rev D)**
- *Domain restriction is client-side only.* Firebase Auth lets any Google account sign in; the app signs
  non-`@teamcm.co.th` users out, but a hand-written client could still read data as "unscoped staff". The real
  fix is a rule on the sign-in e-mail (`auth.token.email.endsWith('@teamcm.co.th')`, plus an Admin-maintained list for
  invited externals / clients). It is **not** included because it locks out anyone whose provider doesn't put an
  e-mail claim in the token. To check first: Console → Authentication → Users — every Microsoft user must show
  an e-mail. If they all do, ask for the follow-up change.
- Storage rules still can't see roles (see `STORAGE_RULES.md`); upload/delete limits live in the UI.
- Coordinators can technically delete issues from devtools (rules can't tell create from edit by role here).

## Rev C — fixes a self-bootstrap lockout in Rev B

**If you published Rev B and then found project/user create-or-delete
"succeeds" in the UI but reverts after a page reload: this is why, and this
revision fixes it.**

Rev B's `role_access/$uid` `.validate` rule was:

```
"root.child('role_access').child(auth.uid).val() === 'Admin' || newData.val() !== 'Admin'"
```

The `.write` rule lets you write your *own* uid's entry at any time
(`auth.uid === $uid`), which was meant to let `nitid_s@teamcm.co.th` bootstrap
their own `role_access` entry to `"Admin"` on first login, before anyone
else could. But `.validate` runs independently and checks the pre-write
value at that same path — which, for a genuinely first-ever write, is
`null`, not `"Admin"`. So the very write meant to *create* the first Admin
entry fails its own validation: neither side of the OR is true. If that
bootstrap login didn't happen (or didn't persist) before Rev B was
published, there is no path back to Admin through the app at all — every
write that needs `role_access` to already say `"Admin"` now fails silently
(caught by a `.catch()`, so the UI's local state updates optimistically
and then reverts on the next reload once the real data reloads from
Firebase).

**The fix**: add a permanent, narrowly-scoped escape hatch for the one
real owner account, so this can never lock out for good:

```
"root.child('role_access').child(auth.uid).val() === 'Admin' || newData.val() !== 'Admin' || auth.token.email === 'nitid_s@teamcm.co.th'"
```

This only ever matters for setting a `role_access` entry **to** `"Admin"`
specifically for `nitid_s@teamcm.co.th`'s own signed-in session — it does
not grant that email anything it doesn't already have as the account this
whole rewrite was built to protect, and it does not touch any other path
or field.

Paste the rules below into Console → Realtime Database → **Rules**, test
in the **Rules Playground**, then **Publish** — this time there's no
rollout-order risk, since the one case that used to require perfect
ordering now has a permanent fallback.

## Rev B — role is now server-verified, not just trusted from the client

Previously `projects` and `users` were `auth != null` for both read and
write — any signed-in account, including an external Client Reviewer, could
write directly to `users` (e.g. set their own `role` to `"Admin"`) via the
raw SDK from devtools, and the app's own real-time listener would apply it
to their session immediately. Confirmed exploitable, not theoretical — see
the audit report. This revision closes that.

Paste this into Console → Realtime Database → **Rules**, test in the
**Rules Playground**, then **Publish** — but read "Rollout order" below
first, this one has a real bootstrap step.

```json
{
  "rules": {
    "client_access": {
      ".read": false,
      ".write": "auth != null"
    },
    "role_access": {
      ".read": false,
      "$uid": {
        ".write": "auth != null && (root.child('role_access').child(auth.uid).val() === 'Admin' || auth.uid === $uid)",
        ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || newData.val() !== 'Admin' || auth.token.email === 'nitid_s@teamcm.co.th'"
      }
    },
    "projects": {
      ".read": "auth != null",
      ".write": "auth != null && root.child('role_access').child(auth.uid).val() === 'Admin'"
    },
    "users": {
      ".read": "auth != null",
      ".write": "auth != null",
      "$id": {
        "role": {
          ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || !data.exists() || newData.val() === data.val()"
        },
        "projectCode": {
          ".validate": "root.child('role_access').child(auth.uid).val() === 'Admin' || !data.exists() || newData.val() === data.val()"
        }
      }
    },
    "report_templates": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "library_docs": {
      ".read": "auth != null",
      ".write": "auth != null && (root.child('role_access').child(auth.uid).val() === 'Admin' || root.child('role_access').child(auth.uid).val() === 'BIM Manager')"
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

## How it works

`role_access/{uid}` is a new mirror node (`fbSetRoleAccess()` in
`firebase.js`) — `{firebaseUid: role}` for every user, written as a
**single targeted entry at a time**, never a bulk sync of everyone (that
distinction matters — see below).

- **`users/$id/role` and `.../projectCode`** — the only two fields that
  actually decide what someone can do — can only be *changed* (to a
  different value than what's stored) by an account whose `role_access`
  entry already says `"Admin"`. Everything else about a user record
  (name, email, lastActive) is still freely writable by anyone signed in,
  matching how self-registration and login already work — this only
  narrows the two security-relevant fields.
- **`role_access/{uid}` itself** carries the same protection one level
  down: you can only write your *own* entry (or anyone's, if you're
  already an Admin per that same mirror), and you can never set an entry
  to `"Admin"` unless you already are one. That's what actually stops the
  self-promotion path, not just the `users` rule alone.
- **`projects`** now requires `role_access` to say `"Admin"` to write at
  all (nothing about project management needs a non-admin write path).
- **`library_docs`** requires `"Admin"` or `"BIM Manager"` — matches
  `PERMISSIONS.library` in `data.js` exactly, so BIM Managers keep the
  upload access the app already gives them in the UI.
- **`issues`/`audit`** project-scoping is unchanged from before.

## Why `fbSaveOwnUser()` exists now, separate from `fbSaveUsers()`

`fbSaveUsers(USERS)` writes the **entire** user list in one `.set()` — fine
for an Admin (their `role_access` check passes regardless of which `$id`
is being touched), but a non-admin session doing that same bulk write
during ordinary login (refreshing their own `lastActive`) would, under
these rules, also be attempting to touch *everyone else's* record in the
same operation — and Realtime Database rules evaluate a multi-child write
atomically, so the whole thing gets rejected the moment it touches a
record the caller isn't allowed to touch.

`fbSaveOwnUser()` writes only `users/{their own id}` plus their own
`role_access` entry — used for first-time self-registration and for the
"just logged in again" refresh. `fbSaveUsers()` stays as-is for the
admin-driven flows (invite/edit/delete another user), which are already
gated by `requirePermission('users', ...)` client-side and now backed by
the real rule server-side too.

## Rollout order — read this before publishing

Publishing the rules above before `role_access` has a real Admin entry in
it locks *everyone* out of admin actions, including you. Do this in order:

1. **Deploy the app code first** — this adds `fbSetRoleAccess`/
   `fbSaveOwnUser` without touching the rules yet, so nothing changes
   behavior-wise until you publish the new rules below.
2. **Log in as `nitid_s@teamcm.co.th`** (or just reload if already signed
   in) at least once. Under the *current* (still-permissive) rules, this
   writes `role_access/{their uid} = "Admin"` for the first time via the
   existing-user login path.
3. **Clean up who's Admin today**, while the old permissive rules are
   still live — open the Users page and set every account that shouldn't
   be Admin (e.g. `team_tcm001@teamgstart.com`) to a different role. This
   is the "only `nitid_s@teamcm.co.th` stays Admin" step — do it now,
   because after step 4 only an existing Admin can change anyone's role
   at all.
4. **Now publish the new rules above.** From this point on, only accounts
   with a confirmed `"Admin"` entry in `role_access` can manage
   users/projects/library uploads — which, if you did step 3 first, is
   just `nitid_s@teamcm.co.th`.
5. Test: log in as `nitid_s@teamcm.co.th`, confirm you can still edit a
   user's role and edit a project. Then (optionally) try the same as a
   non-admin account and confirm it's now blocked.

## What this still does not fix

`report_templates` write is still open to everyone (`auth != null`) — a
Client Reviewer can delete a shared template. Flagged separately in the
audit report as a small, standalone fix; not bundled in here.

## One-time note

`client_access` and `role_access` only populate for users who've signed in
*after* the update that added `uid` to their record. Anyone who hasn't
logged in since gets backfilled automatically on their next login — no
manual fix needed, just don't expect a stale, never-logged-in-since
account to already have a `role_access` entry before they sign in again.
