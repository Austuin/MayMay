# MayMay 1.0 release and activation review

This is a prepared procedure for a later, explicitly authorized release. Do not run the execution command while reviewing this branch. No migration of old care records is planned.

## Boundaries

The ordinary host startup reads the existing Firebase Web app configuration and `system/data`. It serves a setup/maintenance state when activation is missing. It does not create a family, patient, medication, or identity, and it does not install rules or reset Firestore. Admin credentials stay on the host. The invitation API remains part of the installed package.

The controlled reset tool targets the Firebase project passed with `--project`. Its credential JSON must belong to that same project. It never deletes Authentication accounts, `admins` assignments, host configuration or credentials, or updater settings.

The **only approved delete roots** are:

| Root | Scope |
| --- | --- |
| `users` | Every document and descendant, including old local-day profiles |
| `families` | Every family document and descendant: memberships, patients, relationships, Trackers, Observations, invitations, and old care paths |
| `joinSettings` | Obsolete join settings and descendants |
| `system/data` | Old activation document and descendants |
| `system/schema` | Obsolete schema document and descendants |
| `system/invitationLimits` | Obsolete invitation attempt state and descendants, including `users/{uid}` |

Other root collections are inventoried and displayed but excluded from deletion. Firestore collections appear when documents are written; activation creates no empty family or patient.

## Review the live inventory later

On the host, after the final package is installed and only when a read-only inventory is authorized:

```powershell
node scripts/reset-activate.mjs --project maymaydata-a6fda --credentials 'C:\path\to\firebase-admin.json' --dry-run
```

The dry run reads the exact document paths under the approved roots, lists other root collections, and prints a SHA-256 plan hash. It makes no Firestore or rules changes. Review and retain that output before approval. Re-run it if any approved path changes. A changed inventory yields a different hash and blocks execution.

## Execution after separate authorization

Arrange a Cloud Storage bucket, permissions, and an agreed unique backup prefix. Stop other privileged writers and pause caregiver activity while taking the export; [Firestore exports can include changes made while an export runs](https://firebase.google.com/docs/firestore/manage-data/export-import). Then, with the reviewed hash and explicit project confirmation:

```powershell
node scripts/reset-activate.mjs --project maymaydata-a6fda --credentials 'C:\path\to\firebase-admin.json' --execute --confirm-project maymaydata-a6fda --confirm-plan REVIEWED_SHA256 --backup-uri gs://AGREED_BUCKET/MayMay/UNIQUE_EXPORT_PREFIX
```

The command performs these phases in order and stops on failure:

1. Request a managed Firestore export of the entire database, including preserved Admin records, and wait for its operation to complete successfully. Re-inventory the approved paths; any change stops the procedure before rules or data are modified.
2. Install `firebase.maintenance.rules` and wait until Firebase reports that ruleset as active. Those rules deny all client writes.
3. Delete `system/data` to invalidate the old generation.
4. Recursively delete only the six approved roots above.
5. Install `firebase.rules` and wait until it is active. The current app needs no composite index; its date query uses the automatic single-field index.
6. Write `system/data` with schema version `1` and a new random generation.
7. Restart the prepared host, refresh caregiver devices, and require new family/patient setup and invitations.

If the backup fails, no data or rules are changed. If a later phase fails, stop and inspect the reported phase; do not rerun blindly. Maintenance rules or a missing `system/data` keep browser writes blocked until activation is repaired. Firebase Admin operations bypass client rules, so pause other Admin writers during the procedure. Keep the backup export URI and operation result with the release record.

## Release boundary

PRs into `DevBranch` and `main`, and pushes to those branches, run tests and typecheck. Only a successful push to `main` builds and publishes an installer. After implementation review, open the `DevBranch` → `main` release PR, wait for its required checks, and obtain separate permission before any production reset or release merge. Do not merge `DevBranch` into `main` as part of this implementation stage.
