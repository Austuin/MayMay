import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

import {
  emptyEntry,
  historyCutoffDate,
  type DailyEntry,
  type FirebaseWebConfig,
} from './maymay-types';

type UserRole = 'master' | 'caregiver' | 'viewer';

type UserProfile = {
  familyId: string;
  role: UserRole;
  active: boolean;
  displayName?: string;
};

export type MayMayRuntimeConfig = {
  firebase: FirebaseWebConfig;
  familyId: string;
  childId: string;
};

export type FirebaseConnection = {
  app: FirebaseApp;
  db: Firestore;
  user: User;
  profile: UserProfile;
  childId: string;
};

const DEFAULT_CHILD_ID = 'maymay';

function validWebConfig(value: unknown): value is FirebaseWebConfig {
  const config = value as Partial<FirebaseWebConfig> | null;
  return Boolean(
    config &&
      config.apiKey &&
      config.authDomain &&
      config.projectId &&
      config.appId,
  );
}

export async function loadRuntimeConfig(): Promise<MayMayRuntimeConfig> {
  const response = await fetch('/maymay-runtime.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('MayMay is not configured on the host computer.');
  }
  const value = (await response.json()) as Partial<MayMayRuntimeConfig>;
  if (!validWebConfig(value.firebase) || !value.familyId || !value.childId) {
    throw new Error('The host configuration is incomplete.');
  }
  return value as MayMayRuntimeConfig;
}

async function appFor(config: FirebaseWebConfig) {
  const existing = getApps().find((app) => app.name === 'maymay');
  if (existing) {
    const sameProject = existing.options.projectId === config.projectId;
    if (sameProject) return existing;
    await deleteApp(existing);
  }
  return initializeApp(config, 'maymay');
}

async function connectionFor(app: FirebaseApp, user: User, childId = DEFAULT_CHILD_ID) {
  const db = getFirestore(app);
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  if (!snapshot.exists()) {
    const identifier = user.email ?? user.uid;
    await signOut(getAuth(app));
    throw new Error(
      `This account is registered but is waiting for host approval. Ask the host owner to enter: caregiver ${identifier}`,
    );
  }
  const profile = snapshot.data() as Partial<UserProfile>;
  if (
    profile.active !== true ||
    !profile.familyId ||
    !['master', 'caregiver', 'viewer'].includes(profile.role ?? '')
  ) {
    await signOut(getAuth(app));
    throw new Error('This MayMay account is inactive or incomplete.');
  }
  return { app, db, user, profile: profile as UserProfile, childId };
}

export async function restoreFirebase(
  config: FirebaseWebConfig,
  childId = DEFAULT_CHILD_ID,
): Promise<FirebaseConnection | null> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  return auth.currentUser ? connectionFor(app, auth.currentUser, childId) : null;
}

export async function connectFirebase(
  config: FirebaseWebConfig,
  caregiverEmail: string,
  password?: string,
  childId = DEFAULT_CHILD_ID,
): Promise<FirebaseConnection> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();

  let user = auth.currentUser;
  if (user && user.email !== caregiverEmail) {
    await signOut(auth);
    user = null;
  }
  if (!user) {
    if (!password) throw new Error('Enter the caregiver password to connect this device.');
    const credential = await signInWithEmailAndPassword(auth, caregiverEmail, password);
    user = credential.user;
  }

  return connectionFor(app, user, childId);
}

export async function registerFirebaseAccount(
  config: FirebaseWebConfig,
  displayName: string,
  caregiverEmail: string,
  password: string,
) {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  if (auth.currentUser) await signOut(auth);

  const credential = await createUserWithEmailAndPassword(
    auth,
    caregiverEmail,
    password,
  );
  try {
    try {
      await updateProfile(credential.user, { displayName });
    } catch {
      // The login is still usable if Firebase cannot save the optional name.
    }
    return {
      uid: credential.user.uid,
      email: credential.user.email ?? caregiverEmail,
    };
  } finally {
    await signOut(auth);
  }
}

export async function connectFirebaseWithGoogle(
  config: FirebaseWebConfig,
  childId = DEFAULT_CHILD_ID,
): Promise<FirebaseConnection> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  auth.useDeviceLanguage();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return connectionFor(app, credential.user, childId);
}

function eventsCollection(connection: FirebaseConnection) {
  return collection(
    connection.db,
    'families',
    connection.profile.familyId,
    'children',
    connection.childId,
    'events',
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function dateFor(date: string, time = '12:00') {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '12:00';
  return new Date(`${date}T${safeTime}:00`);
}

function eventUpdatedAt(value: unknown) {
  const timestamp = value as { toDate?: () => Date } | undefined;
  return timestamp?.toDate?.().toISOString() ?? new Date(0).toISOString();
}

export async function pullRemoteEntries(connection: FirebaseConnection) {
  const snapshot = await getDocs(
    query(
      eventsCollection(connection),
      where('localDate', '>=', historyCutoffDate()),
    ),
  );
  const entries = new Map<string, DailyEntry>();

  for (const item of snapshot.docs) {
    const event = item.data();
    if (event.deletedAt) continue;
    const date = stringValue(event.localDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entry = entries.get(date) ?? emptyEntry(date);
    const data = (event.data ?? {}) as Record<string, unknown>;
    const updatedAt = eventUpdatedAt(event.updatedAt);
    if (updatedAt > entry.updatedAt) entry.updatedAt = updatedAt;

    if (event.type === 'mood') {
      const period = stringValue(data.period);
      if (period === 'morning' || period === 'afternoon' || period === 'evening') {
        entry.moods[period] = {
          score: typeof data.score === 'number' ? data.score : null,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        };
      }
    } else if (event.type === 'sleep') {
      entry.sleepQuality = typeof data.quality === 'number' ? data.quality : null;
      entry.sleepStart = stringValue(data.sleepStart);
      entry.wakeTime = stringValue(data.wakeTime);
      entry.wakeUps = stringValue(data.wakeUps);
    } else if (event.type === 'routine' && data.routine === 'school') {
      entry.schoolStatus = stringValue(data.status);
      entry.schoolNote = stringValue(data.notes);
    } else if (event.type === 'health') {
      entry.healthStatus = stringValue(data.status) || 'Great';
      entry.healthNotes = stringValue(data.notes);
    } else if (event.type === 'meal') {
      const meal = stringValue(data.meal);
      if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner' || meal === 'snacks') {
        entry.meals[meal] = stringValue(data.outcome) || stringValue(data.description);
      }
      if (typeof data.eatingOverall === 'string') {
        entry.eatingOverall = data.eatingOverall;
      }
    } else if (event.type === 'bathroom') {
      entry.bathroom = {
        bowelMovement: stringValue(data.bowelMovement),
        count: stringValue(data.count),
      };
    } else if (event.type === 'medication') {
      const medicationId = stringValue(data.medicationId);
      if (medicationId === 'melatonin' || medicationId === 'fluoxetine') {
        entry.medications[medicationId] = {
          status: stringValue(data.status),
          amount: stringValue(data.amount),
          time: stringValue(data.scheduledTime),
        };
      }
    } else if (event.type === 'trigger') {
      entry.possibleTriggers.push({
        id: stringValue(data.eventId) || item.id,
        time: stringValue(data.time),
        category: stringValue(data.category),
        categoryOther: stringValue(data.categoryOther),
        observedEffect: stringValue(data.observedEffect),
        notes: stringValue(data.notes),
      });
    } else if (event.type === 'meltdown') {
      entry.meltdowns.push({
        id: stringValue(data.eventId) || item.id,
        time: stringValue(data.time),
        duration: stringValue(data.duration),
        intensity: stringValue(data.intensity),
        trigger: stringValue(data.trigger),
        triggerOther: stringValue(data.triggerOther),
        earlySigns: stringValue(data.earlySigns),
        aggression: stringValue(data.aggression),
        whatHelped: stringValue(data.whatHelped),
        notes: stringValue(data.notes),
      });
    } else if (event.type === 'note') {
      entry.notes = stringValue(data.text);
    }
    entries.set(date, entry);
  }

  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}

type DesiredEvent = {
  id: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
};

function desiredEvents(entry: DailyEntry): DesiredEvent[] {
  const desired: DesiredEvent[] = [];
  const moodTimes = { morning: '08:00', afternoon: '14:00', evening: '20:00' };
  for (const period of ['morning', 'afternoon', 'evening'] as const) {
    const mood = entry.moods[period];
    if (mood.score !== null || mood.tags.length > 0) {
      desired.push({
        id: `${entry.date}_mood_${period}`,
        type: 'mood',
        occurredAt: dateFor(entry.date, moodTimes[period]),
        data: { period, score: mood.score, tags: mood.tags },
      });
    }
  }

  if (entry.sleepQuality !== null || entry.sleepStart || entry.wakeTime || entry.wakeUps) {
    desired.push({
      id: `${entry.date}_sleep`,
      type: 'sleep',
      occurredAt: dateFor(entry.date, entry.wakeTime || '07:00'),
      data: {
        quality: entry.sleepQuality,
        sleepStart: entry.sleepStart,
        wakeTime: entry.wakeTime,
        wakeUps: entry.wakeUps,
      },
    });
  }

  if (entry.schoolStatus || entry.schoolNote) {
    desired.push({
      id: `${entry.date}_routine_school`,
      type: 'routine',
      occurredAt: dateFor(entry.date, '08:00'),
      data: { routine: 'school', status: entry.schoolStatus, notes: entry.schoolNote },
    });
  }

  if (entry.healthStatus || entry.healthNotes) {
    desired.push({
      id: `${entry.date}_health`,
      type: 'health',
      occurredAt: dateFor(entry.date, '09:00'),
      data: { status: entry.healthStatus || 'Great', notes: entry.healthNotes },
    });
  }

  const mealTimes = { breakfast: '08:00', lunch: '12:00', dinner: '18:00', snacks: '15:00' };
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snacks'] as const) {
    if (entry.meals[meal] || (meal === 'breakfast' && entry.eatingOverall)) {
      desired.push({
        id: `${entry.date}_meal_${meal}`,
        type: 'meal',
        occurredAt: dateFor(entry.date, mealTimes[meal]),
        data: {
          meal,
          outcome: entry.meals[meal],
          ...(meal === 'breakfast' ? { eatingOverall: entry.eatingOverall } : {}),
        },
      });
    }
  }

  if (entry.bathroom.bowelMovement || entry.bathroom.count) {
    desired.push({
      id: `${entry.date}_bathroom`,
      type: 'bathroom',
      occurredAt: dateFor(entry.date),
      data: entry.bathroom,
    });
  }

  for (const medicationId of ['melatonin', 'fluoxetine'] as const) {
    const medication = entry.medications[medicationId];
    if (medication.status || medication.amount || medication.time) {
      desired.push({
        id: `${entry.date}_medication_${medicationId}`,
        type: 'medication',
        occurredAt: dateFor(entry.date, medication.time),
        data: {
          medicationId,
          status: medication.status,
          amount: medication.amount,
          scheduledTime: medication.time,
        },
      });
    }
  }

  for (const possibleTrigger of entry.possibleTriggers) {
    desired.push({
      id: `${entry.date}_trigger_${possibleTrigger.id}`,
      type: 'trigger',
      occurredAt: dateFor(entry.date, possibleTrigger.time),
      data: { ...possibleTrigger, eventId: possibleTrigger.id },
    });
  }

  for (const meltdown of entry.meltdowns) {
    desired.push({
      id: `${entry.date}_meltdown_${meltdown.id}`,
      type: 'meltdown',
      occurredAt: dateFor(entry.date, meltdown.time),
      data: { ...meltdown, eventId: meltdown.id },
    });
  }

  if (entry.notes) {
    desired.push({
      id: `${entry.date}_note`,
      type: 'note',
      occurredAt: dateFor(entry.date, '21:00'),
      data: { text: entry.notes },
    });
  }

  return desired;
}

export async function pushEntry(connection: FirebaseConnection, entry: DailyEntry) {
  if (connection.profile.role === 'viewer') {
    throw new Error('Viewer accounts cannot change care records.');
  }

  const events = eventsCollection(connection);
  const existingSnapshot = await getDocs(query(events, where('localDate', '==', entry.date)));
  const existing = new Map(existingSnapshot.docs.map((item) => [item.id, item]));
  const desired = desiredEvents(entry);
  const desiredIds = new Set(desired.map((event) => event.id));
  const batch = writeBatch(connection.db);

  for (const event of desired) {
    const exists = existing.has(event.id);
    batch.set(
      doc(events, event.id),
      {
        schemaVersion: 1,
        childId: connection.childId,
        localDate: entry.date,
        type: event.type,
        occurredAt: event.occurredAt,
        data: event.data,
        updatedAt: serverTimestamp(),
        deletedAt: deleteField(),
        ...(!exists
          ? { createdBy: connection.user.uid, createdAt: serverTimestamp() }
          : {}),
      },
      { merge: true },
    );
  }

  for (const item of existingSnapshot.docs) {
    if (!item.data().deletedAt && !desiredIds.has(item.id)) {
      batch.set(
        item.ref,
        { deletedAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true },
      );
    }
  }

  await batch.commit();
}

export async function disconnectFirebase(connection: FirebaseConnection) {
  await signOut(getAuth(connection.app));
}
