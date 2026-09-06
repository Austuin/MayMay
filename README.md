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

## Host terminal commands

- `status` — Check Firestore and the web server.
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
3. Either method creates only a Firebase Authentication login; it does not grant access to care information.
4. In the host terminal, enter `users` to see the new unassigned account.
5. Enter `caregiver EMAIL`, replacing `EMAIL` with the registered address.
6. The caregiver can now return to **Sign in** and use MayMay.

The Firebase Console's **Authentication → Users → Add user** command remains available as an administrator fallback.

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

## Admin key safety

The downloaded JSON file containing `private_key`, `client_email`, or `type: "service_account"` is a powerful server credential. Keep it on the host computer only.

Never:

- Paste it into the caregiver website.
- Copy it to a phone or tablet.
- Commit it to source control.
- Send it to another caregiver.

The host terminal retrieves Firebase's public Web configuration and serves only that browser-safe information.
