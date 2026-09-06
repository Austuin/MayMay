import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const FAMILY_ID = 'maymay';

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const uid = valueAfter('--uid');
const requestedDisplayName = valueAfter('--display-name');
const credentialsPath = valueAfter('--credentials');

if (!credentialsPath && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    'Pass the Admin key path with --credentials or set GOOGLE_APPLICATION_CREDENTIALS.',
  );
}

if (!uid || uid.length > 128 || uid.includes('/')) {
  throw new Error(
    'Pass the Firebase Authentication user UID: npm run firebase:set-master -- --uid YOUR_UID',
  );
}

if (getApps().length === 0) {
  const credential = credentialsPath
    ? cert(JSON.parse(await readFile(resolve(credentialsPath), 'utf8')))
    : applicationDefault();
  initializeApp({ credential });
}

const authUser = await getAuth().getUser(uid);
const displayName =
  requestedDisplayName?.trim() ||
  authUser.displayName?.trim() ||
  authUser.email?.split('@')[0] ||
  'Master';

const db = getFirestore();
const profileRef = db.doc(`users/${uid}`);
const existingProfile = await profileRef.get();

await profileRef.set(
  {
    schemaVersion: 1,
    familyId: FAMILY_ID,
    role: 'master',
    displayName,
    active: true,
    ...(existingProfile.data()?.createdAt
      ? {}
      : { createdAt: FieldValue.serverTimestamp() }),
    updatedAt: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

const profile = await profileRef.get();
if (!profile.exists || profile.data()?.role !== 'master') {
  throw new Error('Master profile verification failed.');
}

console.log(`Master profile created and verified at users/${uid}.`);
