# MayMay 1.0 release and activation review

Use this procedure only for an explicitly authorized reset. No migration of old care records is planned. Reset authorization and permission to publish an installer are separate decisions.

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

## Review the live inventory

From the reviewed source checkout or prepared host:

```powershell
node scripts/reset-activate.mjs --project maymaydata-a6fda --credentials 'C:\path\to\firebase-admin.json' --dry-run
```

The dry run reads the exact document paths under the approved roots, lists other root collections, and prints a SHA-256 plan hash. It makes no Firestore or rules changes. Review and retain that output before approval. Re-run it if any approved path changes. A changed inventory yields a different hash and blocks execution.

## Authorized execution

Stop other privileged writers and pause caregiver activity. Choose either a managed Cloud Storage export or a private local JSON backup; a local backup requires no new cloud service. Keep it outside any web-served directory and outside Git. Use the reviewed hash and explicit project confirmation:

```powershell
node scripts/reset-activate.mjs --project maymaydata-a6fda --credentials 'C:\path\to\firebase-admin.json' --execute --confirm-project maymaydata-a6fda --confirm-plan REVIEWED_SHA256 --backup-uri gs://AGREED_BUCKET/MayMay/UNIQUE_EXPORT_PREFIX
```

For local backup, replace `--backup-uri ...` with `--backup-file 'C:\private\MayMay-before-reset.json'`. The parent directory must exist. Existing backup files are never overwritten. The JSON preserves Firestore's REST Value types, including timestamps, bytes, references, and large integers. A `.sha256` companion file verifies the saved bytes. All documents are backed up, including Admins and descendants beneath missing parents. These files contain private care data and must remain private.

The command compiles both rule sets first, then performs these phases in order and stops on failure:

1. Install `firebase.maintenance.rules`, verify the active ruleset, and wait 60 seconds for new-request propagation. Those rules deny all client writes. Existing listeners may take longer to detach, but cannot submit new writes through maintenance rules.
2. Complete and verify the full backup. Re-inventory the approved paths; any change stops the procedure before deletion.
3. Delete `system/data` to invalidate the old generation.
4. Recursively delete only the six approved roots above.
5. Install `firebase.rules` and wait until it is active. The current app needs no composite index; its date query uses the automatic single-field index.
6. Write `system/data` with schema version `1` and a new random generation.
7. Restart the prepared host, refresh caregiver devices, and require new family/patient setup and invitations.

If the backup fails, no data is deleted; maintenance rules remain active. If a later phase fails, stop and inspect the reported phase; do not rerun blindly. Maintenance rules or a missing `system/data` keep browser writes blocked until activation is repaired. Firebase Admin operations bypass client rules, so pause other Admin writers during the procedure. Keep the backup location, checksum or export operation result, and reset log with the release record. Do not restart an older installer that automatically deploys its legacy rules.

For recovery, keep maintenance active and stop privileged writers. Managed exports can be imported with Firestore's managed import tool. For local JSON, verify its SHA-256 and `projectId` first, then restore each document's `name` and `fields` through the Firestore REST `documents:commit` API using `writes: [{ update: { name, fields } }]` in batches of at most 500; omit the exported create/update timestamps. Review and clear any post-reset documents in the reset scope before restoring, so unrelated new records do not survive a rollback. Reinstall rules compatible with the restored schema only after verifying the recovered records. There is no automatic rollback that could silently overwrite subsequent care records.

## Release boundary

PRs into `DevBranch` and `main`, and pushes to those branches, run tests and typecheck. Only a successful push to `main` builds and publishes an installer. After implementation review, open the `DevBranch` → `main` release PR, wait for its required checks, and obtain permission before the release merge. An authorized database reset alone does not authorize publication.
