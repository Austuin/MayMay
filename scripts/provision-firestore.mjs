import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const FAMILY_ID = 'maymay';
const CHILD_ID = 'maymay';
const SCHEMA_VERSION = 1;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const credentialsPath = valueAfter('--credentials');
if (!credentialsPath && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error(
    'Pass the Admin key path with --credentials or set GOOGLE_APPLICATION_CREDENTIALS.',
  );
}

if (getApps().length === 0) {
  const credential = credentialsPath
    ? cert(JSON.parse(await readFile(resolve(credentialsPath), 'utf8')))
    : applicationDefault();
  initializeApp({ credential });
}

const db = getFirestore();
const now = FieldValue.serverTimestamp();
const batch = db.batch();

const documents = [
  {
    ref: db.doc('system/schema'),
    data: {
      schemaVersion: SCHEMA_VERSION,
      status: 'active',
      familyId: FAMILY_ID,
      childId: CHILD_ID,
      eventPath: `families/${FAMILY_ID}/children/${CHILD_ID}/events/{eventId}`,
      daySummaryPath: `families/${FAMILY_ID}/children/${CHILD_ID}/daySummaries/{YYYY-MM-DD}`,
      allowedEventTypes: [
        'mood',
        'trigger',
        'meltdown',
        'meal',
        'bathroom',
        'medication',
        'sleep',
        'health',
        'routine',
        'note',
      ],
      eventFields: {
        mood: {
          required: ['period', 'score'],
          optional: ['tags'],
        },
        trigger: {
          required: ['category'],
          optional: ['eventId', 'time', 'categoryOther', 'observedEffect', 'notes'],
        },
        meltdown: {
          required: ['intensity'],
          optional: [
            'duration',
            'trigger',
            'triggerOther',
            'earlySigns',
            'aggression',
            'whatHelped',
            'notes',
          ],
        },
        meal: {
          required: ['meal'],
          optional: ['outcome', 'description', 'eatingOverall'],
        },
        bathroom: {
          required: ['bowelMovement'],
          optional: ['count', 'notes'],
        },
        medication: {
          required: ['medicationId', 'status'],
          optional: ['amount', 'unit', 'scheduledTime', 'notes'],
        },
        sleep: {
          required: [],
          optional: ['quality', 'sleepStart', 'wakeTime', 'wakeUps'],
        },
        health: {
          required: ['status'],
          optional: ['notes'],
        },
        routine: {
          required: ['routine'],
          optional: ['status', 'notes'],
        },
        note: {
          required: ['text'],
          optional: [],
        },
      },
      updatedAt: now,
    },
  },
  {
    ref: db.doc(`families/${FAMILY_ID}`),
    data: {
      schemaVersion: SCHEMA_VERSION,
      name: 'MayMay Family',
      timezone: 'America/New_York',
      active: true,
      updatedAt: now,
    },
  },
  {
    ref: db.doc(`families/${FAMILY_ID}/children/${CHILD_ID}`),
    data: {
      schemaVersion: SCHEMA_VERSION,
      nickname: 'MayMay',
      active: true,
      updatedAt: now,
    },
  },
  {
    ref: db.doc(
      `families/${FAMILY_ID}/children/${CHILD_ID}/medications/melatonin`,
    ),
    data: {
      schemaVersion: SCHEMA_VERSION,
      name: 'Melatonin',
      unit: 'mg',
      active: true,
      updatedAt: now,
    },
  },
  {
    ref: db.doc(
      `families/${FAMILY_ID}/children/${CHILD_ID}/medications/fluoxetine`,
    ),
    data: {
      schemaVersion: SCHEMA_VERSION,
      name: 'Fluoxetine',
      unit: 'mg',
      active: true,
      updatedAt: now,
    },
  },
];

const existingSnapshots = await db.getAll(...documents.map(({ ref }) => ref));
for (const [index, { ref, data }] of documents.entries()) {
  const createdAt = existingSnapshots[index].data()?.createdAt;
  batch.set(
    ref,
    createdAt ? data : { ...data, createdAt: now },
    { merge: true },
  );
}

await batch.commit();

const snapshots = await db.getAll(...documents.map(({ ref }) => ref));
const missing = snapshots.filter((snapshot) => !snapshot.exists);
if (missing.length > 0) {
  throw new Error(`Provisioning verification failed for ${missing.length} document(s).`);
}

console.log('MayMay Firestore schema provisioned and verified:');
for (const snapshot of snapshots) {
  console.log(`- ${snapshot.ref.path}`);
}
console.log(
  '- The events and daySummaries collections will be created automatically when the first real event and summary are saved.',
);
