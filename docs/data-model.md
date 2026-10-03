# MayMay 1.0 data foundation

Stages 1–2 define the production records and connect account/family/patient setup. Nothing in these stages deploys rules, resets data, or activates the live database. Invitations are completed in Stage 3; tracker and observation persistence is connected to Today in Stage 4.

## Firestore layout

| Record | Path |
| --- | --- |
| Release metadata | `system/data` |
| User | `users/{UserId}` |
| Family | `families/{FamId}` |
| Family membership | `families/{FamId}/memberships/{UserId}` |
| Patient | `families/{FamId}/patients/{PatId}` |
| Patient relationship/access | `families/{FamId}/patients/{PatId}/relationships/{UserId}` |
| Family invitation | `families/{FamId}/invitations/{InviteId}` |
| Tracker | `families/{FamId}/patients/{PatId}/trackers/{TrackerId}` |
| Observation | `families/{FamId}/patients/{PatId}/observations/{ObservationId}` |

The TypeScript field definitions are in `lib/maymay-schema.ts`. Database field names use lower camel case (`familyId`, `patientId`, `userId`) for the IDs in the proposal. `supportNeeds` represents Communication and support needs. Sex and autism support level have explicit allowed values. Birthdate is optional; age is calculated and never stored.

Family creation atomically writes the Family, its Active Primary membership, and the user's family index. Patient creation atomically writes the Patient, the creator's relationship/access record, and membership patient index. Other caregivers are not automatically granted access to a new patient. Identity creation uses a transaction so simultaneous first sign-ins do not overwrite a profile or its family index.

Family and patient indexes are discovery hints only. Server rules require Active membership and an explicit patient relationship with `canAccess: true` before permitting care-record access.

Trackers define the schedule/input. Observations hold the recorded answer or spontaneous event. Daily observation IDs combine tracker ID and local date to prevent duplicate answers. Answer observations keep the original tracker title, description, and kind; edits cannot change that snapshot or move a record to another day. No and zero are actual values; no record means unanswered. Revisions and immutable creator information protect updates. Deletion is represented by `deletedAt`; physical deletion is denied.

## Release activation

The release process must explicitly create `system/data` with `{ schemaVersion: 1, generation: "<new unique release-reset identifier>" }` after the controlled reset. There is no automatic fallback or live initializer in the browser. Setup reads this metadata from the server before writing application records, and reports that activation is pending if it is missing. User/Family records carry `dataGeneration`; tracker/observation rules also enforce it. Client setup mutations recheck the generation and require sign-in again after a reset. Stored context selection and care cache scopes include generation.

Ordinary clients cannot write system metadata or invitation records. The existing `joinSettings` flow remains transitional until Stage 3 replaces it with trusted invitation hash/expiry validation. Legacy `events` readers remain temporarily under the canonical patient path for later history replacement; they are not the new Observation model. `FirebaseConnection.childId` remains a compatibility alias for the selected patient ID until those readers are retired.

No collection group queries or custom composite indexes are required for setup. Reads follow the user's membership indexes to authorized documents. Later tracker/history queries must add any indexes they actually require.

The standalone demo route has been removed. The reusable tracker UI remains ready for its Stage 4 connection; its sample fixture exists only under `test/fixtures`. Until that connection is implemented, Today shows the saved patient setup rather than accepting disposable care inputs.
