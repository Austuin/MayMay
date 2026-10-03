# MayMay

MayMay is a private caregiver-facing tracker for morning, afternoon, and evening mood, routines, meals, sleep, medications, bathroom notes, triggers, and meltdown events.

> **Development status:** Release-plan Stages 1–3 define the final data model and connect account, family, patient setup, and trusted invitations/approvals. See [the data model](docs/data-model.md). Setup requires explicit release activation through `system/data`; it never initializes the live database automatically. The demo route has been removed, and Today will accept care records once its real persistence is connected in Stage 4. Do not run this branch's host against the live Firebase project: host startup still publishes rules and must be updated before release. Production remains on `main` until rollout is approved.

The application has two surfaces:

- The browser is the caregiver workspace for sign-in, family and patient setup, tracking, history, and insights.
- The host terminal owns Firebase configuration, database provisioning, and the web server. The Firebase Admin key never reaches a browser.

## Start MayMay on the host computer

Double-click `Start-MayMay.cmd`, or run:

```powershell
npm run host
```

The host terminal automatically:

1. Finds the `maymaydata-a6fda` Firebase Admin key in the host user's Downloads folder.
2. Verifies and provisions the Firestore structure.
3. Retrieves the existing MayMay Firebase Web app configuration.
4. Writes a browser-safe runtime configuration containing no Admin credentials.
5. Starts MayMay for the host and other devices on the same local network at `http://maymay.local/`.

If the Admin key is stored elsewhere:

```powershell
npm run host -- --credentials 'C:\path\to\your-firebase-adminsdk.json'
```

Keep the terminal open while MayMay is in use. Type `quit` to stop the website safely.

## Updates

The host terminal has one update action. Type `update` to check the latest GitHub release. When a newer release is found, the action changes to **Install update**; type `update` again to download it, verify its SHA-256 checksum, install it, and restart MayMay.

Automatic installation is available in packaged MayMay installations. A source checkout reports the release link instead so Git-managed source files are never overwritten. The GitHub repository must be public for installed hosts to check releases without storing a GitHub credential.

Pull requests and pushes to `main` run the automated input tests and TypeScript checks. A release is built and published only after those checks pass on `main`.

For an older installed copy that predates the host update command, email `MayMay-Legacy-Updater.zip`. The recipient extracts it and double-clicks `Update-MayMay.cmd` on the host computer. This one-time updater finds MayMay, downloads and verifies the latest release, preserves the Firebase Admin key, installs the release, and restarts into the permanently updateable version.

## Host terminal commands

- `status` — Check Firestore and the web server.
- `update` — Check for an update, or install it when one is available.
- `users` — List Firebase Authentication users and their MayMay roles.
- `master EMAIL_OR_UID` — Assign the Master role to an Authentication user.
- `caregiver EMAIL_OR_UID` — Approve a registered caregiver account.
- `viewer EMAIL_OR_UID` — Give a registered user read-only access.
- `disable EMAIL_OR_UID` — Disable a user's MayMay access without deleting their account.
- `provision` — Safely verify and update the database structure.
- `restart` — Restart the caregiver website.
- `quit` — Stop MayMay.

## Stage B account and family setup

A new account can be created with email/password or Google sign-in. The account then creates a family and becomes its first Active Primary caregiver. The Primary adds a patient; only the name is required. Birthdate, sex, ethnicity, autism support level, and communication/support needs can be supplied during creation, edited, or cleared later. Age is calculated from birthdate. Families and patient relationship records save atomically with their membership indexes. An account can create multiple families and patients and switch between them.

## Stage C family access

A Primary caregiver chooses proposed patient access and generates a Family Code valid for 7 days. Only its hash is stored; the code is displayed once for copying. Replacing it revokes the old code, while pending requests remain available with an old-code notice. A caregiver with a verified email enters the code and their relationship to request access. The request remains Pending until a Primary reviews it in the Family access area; it grants no care-record access while pending. Primary caregivers see a request count in the app and choose the caregiver's role and patient access when approving. They can later change roles or patient access, disable and restore access, and transfer the designated Primary role. Applicants can check their approval status from the Join a family area. A rejected applicant may request again with the current code. Duplicate requests preserve the original request. Approval, rejection, and cancellation are transactions, so concurrent decisions cannot overwrite each other. Approval records the Primary and timestamp, and creates explicit patient relationships.

The `/api/family-invitations/*` endpoint runs inside the existing Node host, verifies Firebase ID tokens (including revocation), and authorizes against current memberships and release generation. Code attempts are limited to 10 per verified account per 15 minutes. Browsers cannot write invitations or create/review pending memberships directly. No additional service or global-admin bypass is introduced. The installed static server handles these routes directly; source hosting passes a private loopback endpoint to Vite's same-origin proxy. Running `npm run dev` alone does not start the trusted API.

The host terminal's older role commands and provisioning script still belong to the production v1 flow and must be updated before a release. This stage does not deploy the new rules or app to the live host.

## Tracker interface

The reusable tracker interface is in `app/today-tracker.tsx`. It will be connected directly to Trackers and Observations in Stage 4. There is no user-facing demo route or temporary care saving. Starter trackers will be created as real records during patient setup when that stage is implemented.

## Firebase requirements

The `maymaydata-a6fda` project needs:

- One registered Firebase Web app.
- Google enabled under Firebase Authentication → Sign-in method.
- `maymay.local` and any fallback address used for sign-in listed under Firebase Authentication → Settings → Authorized domains.
- Email/Password enabled only if caregivers will use the email registration option.
- A Firestore database.
- The security rules from `firebase.rules` published in Firestore.

In Stage B, family creation atomically writes the family, its first active Primary membership, and the creator's family index. Patient creation atomically writes the patient, the creator's patient access, and their patient index.

## Firestore structure

Every occurrence is stored as its own event document:

```text
families/{familyId}
  memberships/{firebaseAuthenticationUid}
  joinSettings/current
  children/{patientId}
    access/{firebaseAuthenticationUid}
    events/{eventId}
    medications/{medicationId}
    daySummaries/{YYYY-MM-DD}

users/{firebaseAuthenticationUid}
system/schema
```

Event types include mood, trigger, meltdown, meal, bathroom, medication, sleep, health, routine, and note. Removing an event uses a soft-delete timestamp so the history remains recoverable. Daily summaries are derived caches; event documents are the source of truth.

Caregiver devices load and cache a rolling three-year history. Older event documents remain in Firestore and can be retained for future archival or reporting without slowing the everyday app.

Prediction inputs use consistent categories wherever practical: meal outcomes per meal, mood periods and tags, school status, sleep quality, bathroom status, medication status, Health status, and timestamped possible-trigger observations. Free-text fields remain optional context. Insights report personal associations and must not be treated as proof of causation or medical advice.

## Automated tests

Run `npm test` to exercise every daily tracking field, including possible-trigger and meltdown add/edit/remove flows. The tests mock Firebase, verify the saved local record and Firestore event mapping, then remove all temporary test data. They never write test records to the real MayMay database.

Run `npm run test:rules` with Java 21 or later to test simultaneous caregivers and the actual Firestore rules in a local emulator using the isolated `demo-maymay-test` project. These checks also run in GitHub Actions. The test runner refuses to run without the local emulator. Java and Firebase test tools are development dependencies and are not included in the installed MayMay runtime.

## Shared editing and the overwrite-safety update

MayMay saves only the events changed by an input, never a replacement snapshot of the whole day. Each save checks the event's revision in a Firestore transaction. Unrelated edits from different caregivers are preserved. Concurrent changes to the same event show the shared value and the local draft for review; choose **Use saved version** or **Save my edit instead**. Choosing a draft still checks the version shown in the comparison, so another intervening change requires another review. An explicit removal affects only that event and preserves its tombstone.

Unsent edits are saved before display, in a durable queue separated by Firebase project, account, family, and person. Failed saves retry while the app is open, on reconnection, or with **Retry sync**. Save receipts prevent a lost acknowledgement or a second tab from replaying an already committed edit. Sign-in never uploads cached whole days, and sign-out stops dispatching further queued writes. Edits already submitted to the server can finish for the original account; unsent edits remain available only when that account signs in again.

This update does not rewrite existing care records. Legacy events gain revision metadata when first edited. Older unscoped browser caches are preserved under their original keys (`maymay.entries.v3`, `maymay.entries.v2`, and `trackerV11`) for recovery, but are never automatically assigned to an account or uploaded. A notice appears when such a cache exists. Do not clear browser storage if there may be unsynced notes from before the update; recover and compare them separately with shared history.

Install through the normal host **update** command, then refresh caregiver browser tabs. The updated host publishes the accompanying rules before serving the updated app. Those rules require the new save protocol and block old-client event writes and legacy daily-record writes, including attempts to remove newer records. Keep the updated rules in place: reverting to an old host package that republishes old rules would remove this protection. No production provisioning or data migration is performed by the tests.

## Admin key safety

The downloaded JSON file containing `private_key`, `client_email`, or `type: "service_account"` is a powerful server credential. Keep it on the host computer only.

Never:

- Paste it into the caregiver website.
- Copy it to a phone or tablet.
- Commit it to source control.
- Send it to another caregiver.

The host terminal retrieves Firebase's public Web configuration and serves only that browser-safe information.
