# MayMay

MayMay is a private caregiver-facing tracker for morning, afternoon, and evening mood, routines, meals, sleep, medications, bathroom notes, triggers, and meltdown events.

The application has two surfaces:

- The browser is the caregiver workspace. It contains only sign-in, tracking, history, and insights.
- The host terminal owns Firebase configuration, database provisioning, account roles, and the web server. The Firebase Admin key never reaches a browser.

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

## Add a caregiver

1. Give the caregiver `http://maymay.local/`, or the numbered fallback address printed by the host terminal.
2. The caregiver selects **Continue with Google** and chooses their Google account. Firebase creates their login automatically the first time. **Create account** remains available for an email/password login.
3. The new account receives a locked pending profile. It cannot see care records while waiting for a role.
4. A signed-in Master opens **Settings** in MayMay. The role controls are visible only to Masters.
5. Under **Waiting for a role**, select **Make caregiver** or **Make master** beside the new person.
6. The new person selects **Check access again**, or signs in again, to enter MayMay.

The host terminal's `users`, `caregiver EMAIL`, and `master EMAIL` commands remain available as administrator fallbacks.

## Firebase requirements

The `maymaydata-a6fda` project needs:

- One registered Firebase Web app.
- Google enabled under Firebase Authentication → Sign-in method.
- `maymay.local` and any fallback address used for sign-in listed under Firebase Authentication → Settings → Authorized domains.
- Email/Password enabled only if caregivers will use the email registration option.
- A Firestore database.
- The security rules from `firebase.rules` published in Firestore.

The initial Master profile is created by the trusted host command:

```text
users/YOUR_FIREBASE_AUTH_UID
  familyId: maymay
  role: master
  active: true
```

## Firestore structure

Every occurrence is stored as its own event document:

```text
families/maymay
  children/maymay
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

## Admin key safety

The downloaded JSON file containing `private_key`, `client_email`, or `type: "service_account"` is a powerful server credential. Keep it on the host computer only.

Never:

- Paste it into the caregiver website.
- Copy it to a phone or tablet.
- Commit it to source control.
- Send it to another caregiver.

The host terminal retrieves Firebase's public Web configuration and serves only that browser-safe information.
