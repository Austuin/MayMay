# MayMay 1.0 release review — 2026-10-03

The reviewed application uses the family/user/patient model, independent Admin assignments, Primary-approved Family Codes, recurring Trackers, and dated Observations. Ordinary host startup does not provision or reset the database. Publishing remains a separate approval after this review.

## Corrections

- Patient-scoped Primaries cannot edit or grant access to patients outside their own scope. Browser clients cannot delete memberships and later revive leftover relationship grants.
- Role changes, patient assignments, disable/restore actions, and protected Primary transfers reject stale selections. Existing care-record revision checks and explicit conflict choices remain in place.
- Care caches and pending drafts stay hidden until both server queries authorize the selected patient. Revocation clears the visible session and cached records, including while viewing History or Settings. Account changes in another tab invalidate the session.
- Late history requests cannot restore another patient's records; failed access checks clear history. A storage failure cannot be reported as a saved edit.
- Mutation receipts must accompany a write by the current actor in the same commit. Listener snapshots cannot refill a revoked cache.
- Repeated spontaneous events use unique chooser keys; titles containing `|` retain their counts. Conflict choices show readable care values, including No and zero, instead of internal database JSON.
- Invitation request bodies preserve Unicode across network chunks and enforce their size limit by bytes.
- The reset freezes client writes before backing up, verifies its inventory, preserves Authentication and Admins, and activates a new generation. A verified private local export is supported when no Cloud Storage bucket exists. See [release-reset.md](release-reset.md).
- Removed 56 unused UI components, an unused hook, and their unused packages. Kept only the CSS variants needed by the remaining tabs.
- Patched React, Firebase, the build tools, and the separate installed host dependencies. Security overrides pin Firestore's Node gRPC dependency and the affected compression package; the older Gaxios dependency uses the patched UUID package's compatible `v4` export.
- Release artifacts use the `1.0.<workflow run>` version line. Only a successful push to `main` can publish an installer.

## Verification

- `npm test`: 72 passing tests.
- `npm run test:rules`: 20 passing tests against the isolated Firestore emulator, including approval, family/patient isolation, revocation, stale writes, concurrent care edits, and Unicode requests.
- `npm run typecheck`: passed.
- `npm run build`: completed with exit code 0 and generated the static site.
- Local offline installer packaging: passed using the built site and locked host dependencies.
- Fresh isolated Edge session against the built host: pointer switching between sign-in and registration worked; mobile layout at 390 px had no horizontal overflow; no browser errors. No account or care record was submitted to production by this check.
- `npm audit --prefix installer/runtime --omit=dev`: zero findings in the shipped Node host dependency tree.

Tests use synthetic records only in mocked services or the demo emulator, clear their state, and never add test records to the live database. The automated setup flow covers family creation, optional patient details, editing, event creation/deletion, and caregiver permissions. A real caregiver's complete post-reset setup on the sister's installed host still needs a release smoke check; no password or identity was fabricated for that purpose.

## Remaining dependency advisories

The full development dependency tree reports 14 findings (12 high, 2 moderate), cascading from three packages. This is not a claim that every repository dependency audits cleanly:

| Package | Exposure in this project | Disposition |
| --- | --- | --- |
| `braces` | Local build globs and Firebase CLI file watching; vulnerable to deeply nested patterns | No patched version is published. Caregiver inputs are never passed into these tools; they are absent from the installed host. |
| `basic-ftp` | Firebase CLI's optional proxy URI loader, not the application's request handler | Patched version requires replacing the consumer's major dependency. No FTP inputs are used by MayMay or its checks; absent from installed host. |
| `@opentelemetry/core` | Firebase CLI Pub/Sub instrumentation | The older consumer still selects the affected major; absent from installed host and client bundle. |

Do not expose the development server as the installed service. The installer serves static assets and the small authenticated invitation API, with its own audited dependency lock. Revisit the remaining advisories when the upstream build/CLI packages release compatible fixes.

## Release boundary

All three existing Authentication accounts were assigned Active Admin records as requested. Admin status does not grant automatic access to families or patient care records. The authorized live reset completed after saving and verifying a 72-document local backup; it removed the old care/setup roots and activated schema 1 with a new generation. The initial reset attempt stopped before deletion because the compiled-rules inspection endpoint denied access; publication was verified through the release endpoint instead, with a regression test for propagation and inspection failures. Private inventory, backup, checksum, original rules, and execution logs remain in ignored `work/`; none belong in Git or the installer.

Merge the reviewed feature into `DevBranch` only after required checks pass, verify that combined state, and prepare the `DevBranch` to `main` release PR. Do not merge the release PR or publish an update until the owner approves it.
