# MayMay

MayMay is a private, patient-scoped care tracker. Caregivers can answer recurring check-ins, record spontaneous events, review History, and see descriptive Insights. Account, family, and patient profiles are managed in Settings.

**Development status:** MayMay 1.0 is prepared on `DevBranch` for final review. The new rules have not been deployed to production, the live data has not been reset, and no release has been published. Production remains on `main` until a separate authorization. See [release and activation review](docs/release-reset.md).

## Host and browser

The host serves the caregiver website and the `/api/family-invitations/*` endpoint. It reads the existing Firebase Web app configuration and activation state; ordinary startup does not provision records, publish rules, or reset data. It keeps the Firebase Admin JSON on the host and serves only the public Firebase Web configuration to browsers.

Start an installed copy with `Start-MayMay.cmd`, or start from a source checkout with:

```powershell
npm run host
```

The host checks for the `maymaydata-a6fda` Admin key in its installed configuration or the host user's Downloads folder. To specify a different location:

```powershell
npm run host -- --credentials 'C:\path\to\firebase-admin.json'
```

Keep the terminal open while MayMay is in use. The website is served at `http://maymay.local/` when local name discovery is available; the terminal also prints numbered LAN addresses. If `system/data` is missing or invalid, a signed-in browser shows a setup/maintenance state. A release operator must complete the separately reviewed activation procedure.

### Host commands

- `status` — Show activation and web server status.
- `users` — List Authentication users and their family counts.
- `update` — Check for an update, or install a verified available update.
- `restart` — Restart the website.
- `quit` — Stop MayMay.

Family roles, access grants, invitations, and member disabling are managed by a Primary in **Settings → Family Access**. The old host `master`, `caregiver`, `viewer`, `disable`, and `provision` commands are retired; they cannot write obsolete profile permissions.

## Care records

Each family can have multiple patients. Care access requires both an Active family membership and an explicit patient relationship. A Primary manages profiles and family access. Primary and Caregiver roles can manage Trackers and record Observations for permitted patients. A Viewer can read permitted patient information without changing it. Global Admin status does not grant family access.

Today reads the selected patient's Trackers and selected local day's Observations. Recurring check-ins include mood, Yes/No, and nonnegative counters. Every answer saves as its own Observation; spontaneous events have separate IDs. Saved answers keep their original tracker title, description, and type, including after a tracker is changed or deleted. An unanswered field differs from No or zero.

History reads that same patient's Observations in 90-day ranges within the last three years, newest first. Opening a day uses the connected Today editor. Insights shows separate mood patterns, Yes/No totals, counter totals and averages over recorded days, and spontaneous-event counts. It makes no causal predictions or medication recommendations.

Each care change is revision checked in a Firestore transaction and has a durable, patient-scoped draft. Conflicting changes require an explicit choice. A save receipt makes retries safe after a lost acknowledgement. Soft deletion preserves the historical record and its snapshot. The [data model](docs/data-model.md) describes records, paths, and access boundaries.

## Accounts and invitations

Accounts use Firebase Authentication with email/password or Google sign-in. The first caregiver creates a family and becomes its Primary. They add a patient; only Name is required. Optional birthdate, sex, ethnicity, autism support level, and communication/support needs can be added, edited, or cleared. Age is calculated rather than stored.

A Primary creates a seven-day Family Code with selected patient scope. A verified-email caregiver requests access, then waits for Primary approval. The host invitation API verifies identity, current generation, membership, and patient scope. Pending, Rejected, and Disabled users have no care access. Codes are hashed in Firestore; browsers cannot write invitation or pending-approval records directly.

## Updates and testing

The installed host checks public GitHub releases, verifies the installer ZIP's SHA-256 checksum, then runs the updater. Pull requests and pushes to `DevBranch` and `main` run automated tests and typecheck. Release packaging occurs only after a successful push to `main`.

```powershell
npm test
npm run typecheck
npm run build
npm run test:rules
```

The Firestore rules test uses the isolated `demo-maymay-test` emulator and requires Java 21 or later. No test writes care data to the live Firebase project. The production build may finish its static export and then hit a known Node/Vinext Windows shutdown assertion; the installer checks that fresh output exists before packaging.

The host package includes the static app, invitation API, final and maintenance rules, and the controlled reset tool. The [release procedure](docs/release-reset.md) details its dry run, exact approved deletion roots, backup, generation activation, and later approval boundary.

## Admin key safety

Keep the Firebase Admin JSON on the host computer only. Do not paste it into the caregiver website, copy it to a phone, commit it to source control, or send it to another caregiver.
