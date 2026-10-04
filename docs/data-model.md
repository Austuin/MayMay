# MayMay 1.0 data foundation

Stages 1–3 define the production records and connect account/family/patient setup and trusted invitations. Stages 4–7 connect Today, event management, profiles, History, and Insights to Trackers and Observations. None of these stages deploys rules, resets data, or activates the live database.

## Firestore layout

| Record | Path |
| --- | --- |
| Release metadata | `system/data` |
| User | `users/{UserId}` |
| Admin | `admins/{UserId}` |
| Family | `families/{FamId}` |
| Family membership | `families/{FamId}/memberships/{UserId}` |
| Patient | `families/{FamId}/patients/{PatId}` |
| Patient relationship/access | `families/{FamId}/patients/{PatId}/relationships/{UserId}` |
| Family invitation | `families/{FamId}/invitations/{InviteId}` |
| Tracker | `families/{FamId}/patients/{PatId}/trackers/{TrackerId}` |
| Observation | `families/{FamId}/patients/{PatId}/observations/{ObservationId}` |
| Tracker save receipt | `families/{FamId}/patients/{PatId}/trackers/{TrackerId}/mutations/{MutationId}` |
| Observation save receipt | `families/{FamId}/patients/{PatId}/observations/{ObservationId}/mutations/{MutationId}` |

The TypeScript field definitions are in `lib/maymay-schema.ts`. Database field names use lower camel case (`familyId`, `patientId`, `userId`) for the IDs in the proposal. `supportNeeds` represents Communication and support needs. Sex and autism support level have explicit allowed values. Birthdate is optional; age is calculated and never stored.

Family creation atomically writes the Family, its Active Primary membership, and the user's family index. Patient creation atomically writes the Patient, the creator's relationship/access record, and membership patient index. Other caregivers are not automatically granted access to a new patient. Identity creation uses a transaction so simultaneous first sign-ins do not overwrite a profile or its family index.

Family and patient indexes are discovery hints only. Server rules require Active membership and an explicit patient relationship with `canAccess: true` before permitting care-record access.

Admins are global account records with `userId`, `status` (Active/Disabled), `assignedBy`, `dateCreated`, and `dateUpdated`. An admin may also be a Primary, Caregiver, or Viewer in any family, or have no family membership. Sign-in loads the account's admin record independently. There is no self-assignment UI, and browser writes to Admins are denied. Only trusted administration can assign or revoke status. This stage grants no additional permissions; later admin abilities must receive explicit server authorization. Admin assignments should be preserved alongside Authentication accounts during the family/care-data reset.

Trackers define the schedule/input. Observations hold the recorded answer or spontaneous event. Daily observation IDs combine tracker ID and local date to prevent duplicate answers. Answer observations keep the original tracker title, description, and kind; edits cannot change that snapshot or move a record to another day. No and zero are actual values; no record means unanswered. Revisions and immutable creator information protect updates. Deletion is represented by `deletedAt`; physical deletion is denied.

Today listens to the selected patient's Trackers and selected local day's Observations. Each answer is a separate document; spontaneous events have distinct IDs. Care edits store immutable device drafts under a scope containing project, generation, account, family, and patient. A transaction compares the edit's original revision with the server record and writes a mutation receipt alongside the record. Receipts let a retry identify a save whose acknowledgment was lost. A conflicting edit requires the caregiver to choose the saved version or explicitly retry their own edit. Starter Trackers are written once in the patient-creation batch and have no answers.

Spontaneous Observations also carry `repeatKey`, made from their category and normalized title. Today queries that key within one patient to offer a regular event after the fourth nondeleted occurrence. Editing or soft deleting an occurrence updates the suggestion count without changing the IDs or snapshots of earlier records. The recent-event chooser reads Observations in pages of 100, ordered by occurrence time; selecting an event starts a new occurrence with a new ID and empty note/details.

History reads the selected patient's Observations in 90-day ranges, newest first, within the last three years. It excludes soft-deleted records and opens a day in the same Today editor. Saved answer snapshots remain visible after a tracker is deleted or its schedule changes. Insights uses those same loaded records for separate mood, Yes/No, and counter summaries and spontaneous-event counts. Unanswered days are not counted as No or zero.

## Release activation

The release process must explicitly create `system/data` with `{ schemaVersion: 1, generation: "<new unique release-reset identifier>" }` after the controlled reset. There is no automatic fallback or live initializer in the browser. Setup reads this metadata from the server before writing application records, and reports that activation is pending if it is missing. User/Family records carry `dataGeneration`; tracker/observation rules also enforce it. Client setup mutations recheck the generation and require sign-in again after a reset. Stored context selection and care cache scopes include generation.

Ordinary clients cannot write system metadata. The legacy `joinSettings` flow is denied. The website handles invitations and requests using Firestore transactions, with authorization enforced by database rules. Legacy patient `events`, `medications`, and `daySummaries` are readable only within an authorized patient scope for recovery; writes are denied. The application uses `FirebaseConnection.patientId` for the selected patient.

No collection group queries or custom composite indexes are required. Reads follow the user's membership indexes to authorized documents. The bounded history query filters and orders by the single `localDate` field within one patient.

The standalone demo route and legacy daily-entry runtime have been removed. The reusable tracker fixture exists only under `test/fixtures`.

## Invitations and approval (Stage 3)

A Family's Primary-managed `activeInviteId` points to its latest invitation. The website generates an `MM1.<familyId>.<inviteId>.<secret>` code using `crypto.getRandomValues`: a 96-bit invitation ID and 128-bit secret. Invitation records contain the SHA-256 hash of the secret, a 7-day expiry, proposed patient IDs, creator and generation. SHA-256 uses `@noble/hashes` so local HTTP sites do not need SubtleCrypto. There is no insecure random fallback. Rules bound expiry to seven days plus five minutes of device clock tolerance. Rotation creates a new invitation and revokes the previous one atomically. Plaintext codes exist only in the issuing page's memory and are never stored or returned by status reads. Primaries can read individual invitation records; other users and collection listing are denied.

Firestore rules verify the Firebase identity, current generation and Active Primary membership for management. Global Admin status does not bypass this. A join request requires a verified email token claim and relationship. The website submits `invitationProof` (the SHA-256 hash computed from the entered secret), `invitationId`, identity details, and the current generation, and updates its User family index atomically. Rules compare the proof with the current, unrevoked, unexpired invitation, enforce the token email and require Pending/Caregiver status with no patient access. The proof is itself a sensitive capability, readable only by the requester and Primaries, and is removed on browser approval/rejection. Primaries resolve patient suggestions from the invitation when loading requests; applicants cannot read them. Retrying a pending request preserves its original date and scope. A rejected request requires a valid current code to resubmit.

Primary notifications show name, verified email, relationship, date and whether the invitation has expired or been replaced. The Primary confirms patient access and chooses Caregiver or Viewer. Approval creates patient relationships and records `approvedBy`/`approvedAt`; rejection records `reviewedBy`/`reviewedAt`. The request must still be Pending within the transaction. Cancellation removes only a still-pending membership and its User index entry. Previously rejected or disabled users cannot bypass review by writing membership records directly. Existing protected-Primary rules remain in force.

The legacy Windows host API remains available for older clients, including its token revocation checks and 10-attempt/15-minute limiter under `system/invitationLimits/users/{UserId}`. Direct browser requests use Firebase Authentication and rules; denied writes cannot persist an attempt counter, so this legacy limiter does not apply to them. Unguessable random codes, restricted proof reads, expiry, and mandatory Primary approval protect browser requests. Existing codes, memberships, requests, and care data require no migration or reset. Deploy the matching rules before distributing the updated website.
