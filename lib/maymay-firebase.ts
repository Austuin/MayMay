import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User,
} from 'firebase/auth';
import {
  arrayUnion, collection, deleteField, doc, getDoc, getFirestore, serverTimestamp,
  runTransaction, writeBatch, type Firestore,
} from 'firebase/firestore';
import type { FirebaseWebConfig } from './maymay-types';
import type { FamilyRole, PatientRecord } from './maymay-access';
import { collections, patientValues, type AdminRecord, type PatientFields, type TrackerDefinition, type UserRecord } from './maymay-schema';
import { assertDataGeneration, readDataConfiguration } from './maymay-database';
export type { PatientFields } from './maymay-schema';

// The tracker still uses these labels internally. Firestore memberships are the authority.
export type UserRole = 'pending' | 'master' | 'caregiver' | 'viewer';
export type UserProfile = { familyId: string; role: UserRole; active: boolean; displayName?: string; email?: string };
export type MayMayRuntimeConfig = { firebase: FirebaseWebConfig };
export type FamilyOption = { familyId: string; name: string; role: FamilyRole; primaryId: string; patients: PatientRecord[] };
export type FamilyRequest = { familyId: string; status: 'Pending' | 'Rejected' | 'Disabled' };
export type FirebaseConnection = {
  app: FirebaseApp;
  db: Firestore;
  user: User;
  dataGeneration: string;
  accountName: string;
  admin: AdminRecord | null;
  profile: UserProfile;
  patientId: string;
  families: FamilyOption[];
  requests: FamilyRequest[];
  patient?: PatientRecord;
};

function validWebConfig(value: unknown): value is FirebaseWebConfig {
  const config = value as Partial<FirebaseWebConfig> | null;
  return Boolean(config?.apiKey && config.authDomain && config.projectId && config.appId);
}

export async function loadRuntimeConfig(): Promise<MayMayRuntimeConfig> {
  const response = await fetch('/maymay-runtime.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('MayMay is not configured on the host computer.');
  const value = (await response.json()) as Partial<MayMayRuntimeConfig>;
  if (!validWebConfig(value.firebase)) throw new Error('The host configuration is incomplete.');
  return value as MayMayRuntimeConfig;
}

async function appFor(config: FirebaseWebConfig) {
  const existing = getApps().find(app => app.name === 'maymay');
  if (existing) {
    if (existing.options.projectId === config.projectId) return existing;
    await deleteApp(existing);
  }
  return initializeApp(config, 'maymay');
}

async function ensureIdentity(db: Firestore, user: User, generation: string): Promise<UserRecord> {
  const ref = doc(db, collections.users, user.uid);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) {
      const identity = snapshot.data() as UserRecord;
      if (identity.dataGeneration !== generation) throw new Error('Your account profile belongs to an earlier data setup. Ask the host owner to finish the rollout.');
      return identity;
    }
    const identity: UserRecord = {
      userId: user.uid, name: user.displayName?.trim() || user.email?.split('@')[0] || 'Caregiver',
      email: user.email ?? '', familyIds: [], dataGeneration: generation,
      dateCreated: serverTimestamp(), dateUpdated: serverTimestamp(),
    };
    transaction.set(ref, identity);
    return identity;
  });
}

function selectionKey(app: FirebaseApp, user: User, generation: string) {
  return 'maymay.selection.' + encodeURIComponent(JSON.stringify([app.options.projectId, user.uid, generation]));
}

async function familyOptions(db: Firestore, userId: string, familyIds: string[]) {
  const families: FamilyOption[] = [];
  const requests: FamilyRequest[] = [];
  for (const familyId of new Set(familyIds)) {
    if (typeof familyId !== 'string' || !familyId) continue;
    try {
      const membership = await getDoc(doc(db, 'families', familyId, 'memberships', userId));
      if (!membership.exists()) continue;
      if (membership.data().status !== 'Active') {
        const status = membership.data().status;
        if (['Pending', 'Rejected', 'Disabled'].includes(status)) requests.push({ familyId, status: status as FamilyRequest['status'] });
        continue;
      }
      const role = membership.data().role as FamilyRole;
      if (!['Primary', 'Caregiver', 'Viewer'].includes(role)) continue;
      const family = await getDoc(doc(db, 'families', familyId));
      if (!family.exists()) continue;
      const patientIds = membership.data().patientIds;
      const patients: PatientRecord[] = [];
      if (Array.isArray(patientIds)) {
        for (const patientId of new Set(patientIds)) {
          if (typeof patientId !== 'string') continue;
          try {
            const snapshot = await getDoc(doc(db, 'families', familyId, collections.patients, patientId));
            if (snapshot.exists()) patients.push(snapshot.data() as PatientRecord);
          } catch (error) {
            if ((error as { code?: string }).code !== 'permission-denied') throw error;
            // A stale index cannot grant patient access.
          }
        }
      }
      families.push({ familyId, name: String(family.data().name || 'Family'), role, primaryId: String(family.data().primaryId || ''), patients });
    } catch (error) {
      if ((error as { code?: string }).code !== 'permission-denied') throw error;
      // A stale family hint cannot grant family access.
    }
  }
  return { families, requests };
}

function chooseConnection(base: Pick<FirebaseConnection, 'app' | 'db' | 'user' | 'families' | 'requests' | 'dataGeneration' | 'accountName' | 'admin'>, preferred?: { familyId?: string; patientId?: string }): FirebaseConnection {
  let stored: { familyId?: string; patientId?: string } = {};
  try { if (typeof localStorage !== 'undefined') stored = JSON.parse(localStorage.getItem(selectionKey(base.app, base.user, base.dataGeneration)) || '{}'); } catch { /* Ignore invalid device selection. */ }
  const choice = preferred ?? stored;
  const family = base.families.find(item => item.familyId === choice.familyId)
    ?? base.families.find(item => item.patients.length > 0)
    ?? base.families[0];
  const patient = family?.patients.find(item => item.patientId === choice.patientId) ?? family?.patients[0];
  const roles: Record<FamilyRole, UserRole> = { Primary: 'master', Caregiver: 'caregiver', Viewer: 'viewer' };
  return {
    ...base,
    profile: {
      familyId: family?.familyId ?? '', role: family ? roles[family.role] : 'pending',
      active: Boolean(family), displayName: base.accountName,
      email: base.user.email ?? undefined,
    },
    patientId: patient?.patientId ?? '', patient,
  };
}

async function connectionFrom(db: Firestore, app: FirebaseApp, user: User, preferred?: { familyId?: string; patientId?: string }) {
  const { generation } = await readDataConfiguration(db);
  const identity = await ensureIdentity(db, user, generation);
  if (user.displayName !== identity.name) {
    try { await updateProfile(user, { displayName: identity.name }); }
    catch { /* The users document remains the display authority. Retry on the next connection. */ }
  }
  const adminSnapshot = await getDoc(doc(db, collections.admins, user.uid));
  const admin = adminSnapshot.exists() ? adminSnapshot.data() as AdminRecord : null;
  const options = await familyOptions(db, user.uid, Array.isArray(identity.familyIds) ? identity.familyIds : []);
  return chooseConnection({ app, db, user, ...options, dataGeneration: generation, accountName: identity.name, admin }, preferred);
}

async function connectionFor(app: FirebaseApp, user: User, preferred?: { familyId?: string; patientId?: string }) {
  return connectionFrom(getFirestore(app), app, user, preferred);
}

export async function refreshFirebaseConnection(connection: FirebaseConnection, preferred?: { familyId?: string; patientId?: string }) {
  await assertDataGeneration(connection.db, connection.dataGeneration);
  return connectionFrom(connection.db, connection.app, connection.user, preferred);
}

export function selectFamilyPatient(connection: FirebaseConnection, familyId: string, patientId = '') {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || (patientId && !family.patients.some(item => item.patientId === patientId))) {
    throw new Error('That family or patient is unavailable.');
  }
  const selected = { familyId, patientId };
  if (typeof localStorage !== 'undefined') localStorage.setItem(selectionKey(connection.app, connection.user, connection.dataGeneration), JSON.stringify(selected));
  return chooseConnection(connection, selected);
}

export async function createFamily(connection: FirebaseConnection, name: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error('Enter a family name of up to 100 characters.');
  await assertDataGeneration(connection.db, connection.dataGeneration);
  const familyRef = doc(collection(connection.db, 'families'));
  const membershipRef = doc(familyRef, 'memberships', connection.user.uid);
  const batch = writeBatch(connection.db);
  batch.set(familyRef, {
    familyId: familyRef.id, name: trimmed, creatorId: connection.user.uid,
    primaryId: connection.user.uid, dataGeneration: connection.dataGeneration, dateCreated: serverTimestamp(),
  });
  batch.set(membershipRef, {
    familyId: familyRef.id, userId: connection.user.uid, role: 'Primary', status: 'Active',
    patientIds: [], requestedAt: serverTimestamp(), dateJoined: serverTimestamp(),
    approvedAt: serverTimestamp(), approvedBy: connection.user.uid,
    requesterName: connection.accountName,
    requesterEmail: connection.user.email ?? '',
  });
  batch.update(doc(connection.db, 'users', connection.user.uid), {
    familyIds: arrayUnion(familyRef.id), dateUpdated: serverTimestamp(),
  });
  await batch.commit();
  return selectFamilyPatient(await refreshFirebaseConnection(connection, { familyId: familyRef.id }), familyRef.id);
}

export async function createPatient(connection: FirebaseConnection, familyId: string, input: PatientFields) {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || family.role !== 'Primary') throw new Error('Only a Primary caregiver can add a patient.');
  const values = patientValues(input);
  await assertDataGeneration(connection.db, connection.dataGeneration);
  const patientRef = doc(collection(connection.db, 'families', familyId, collections.patients));
  const batch = writeBatch(connection.db);
  batch.set(patientRef, {
    patientId: patientRef.id, familyId, ...values,
    dateCreated: serverTimestamp(), dateUpdated: serverTimestamp(),
  });
  batch.set(doc(patientRef, collections.relationships, connection.user.uid), {
    familyId, patientId: patientRef.id, userId: connection.user.uid,
    relationship: 'Primary caregiver', canAccess: true,
  });
  batch.update(doc(connection.db, 'families', familyId, 'memberships', connection.user.uid), {
    patientIds: arrayUnion(patientRef.id),
  });
  const starters: TrackerDefinition[] = [
    { title: 'Morning Mood', description: 'How was the morning?', kind: 'mood', days: [0, 1, 2, 3, 4, 5, 6] },
    { title: 'Bowel Movements', description: 'How many times did they go today?', kind: 'count', days: [0, 1, 2, 3, 4, 5, 6] },
    { title: 'Went to School on Time', description: 'Did they arrive on time?', kind: 'good', days: [1, 2, 3, 4, 5] },
  ];
  for (const starter of starters) {
    const trackerRef = doc(collection(patientRef, collections.trackers));
    batch.set(trackerRef, {
      ...starter, trackerId: trackerRef.id, familyId, patientId: patientRef.id,
      dataGeneration: connection.dataGeneration, createdBy: connection.user.uid,
      updatedBy: connection.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      revision: 1, deletedAt: null,
    });
  }
  await batch.commit();
  const refreshed = await refreshFirebaseConnection(connection, { familyId, patientId: patientRef.id });
  return selectFamilyPatient(refreshed, familyId, patientRef.id);
}

export async function updatePatient(connection: FirebaseConnection, input: PatientFields) {
  const family = connection.families.find(item => item.familyId === connection.profile.familyId);
  if (!family || family.role !== 'Primary' || !connection.patientId) throw new Error('Only a Primary caregiver can edit this patient.');
  const values = patientValues(input);
  await assertDataGeneration(connection.db, connection.dataGeneration);
  const baseline = connection.patient;
  if (!baseline) throw new Error('Select a patient before editing.');
  const fields = ['name', 'birthdate', 'sex', 'ethnicity', 'autismLevel', 'supportNeeds'] as const;
  const changes = fields.filter(field => (values[field] ?? '') !== (baseline[field] ?? ''));
  if (!changes.length) return connection;
  const ref = doc(connection.db, 'families', family.familyId, collections.patients, connection.patientId);
  await runTransaction(connection.db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('This patient is no longer available.');
    const current = snapshot.data() as PatientRecord;
    if (changes.some(field => (current[field] ?? '') !== (baseline[field] ?? ''))) {
      throw new Error('Patient details changed elsewhere. Reload and review the latest details before saving.');
    }
    const patch: Record<string, unknown> = { dateUpdated: serverTimestamp() };
    for (const field of changes) patch[field] = values[field] ?? deleteField();
    transaction.update(ref, patch);
  });
  return refreshFirebaseConnection(connection, { familyId: family.familyId, patientId: connection.patientId });
}

export async function updateAccountName(connection: FirebaseConnection, input: string) {
  const name = input.trim();
  if (!name || name.length > 100) throw new Error('Enter your name using up to 100 characters.');
  await assertDataGeneration(connection.db, connection.dataGeneration);
  const ref = doc(connection.db, collections.users, connection.user.uid);
  await runTransaction(connection.db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().dataGeneration !== connection.dataGeneration) throw new Error('Account setup changed. Sign in again.');
    if (snapshot.data().name !== connection.accountName) throw new Error('Your name changed elsewhere. Reload and review it before saving.');
    transaction.update(ref, { name, dateUpdated: serverTimestamp() });
  });
  // The users document is the shared display authority; Auth mirrors it for future sign-ins.
  try { await updateProfile(connection.user, { displayName: name }); }
  catch { /* Keep the saved name visible and retry the Auth mirror on the next connection. */ }
  return refreshFirebaseConnection(connection, { familyId: connection.profile.familyId, patientId: connection.patientId });
}

export async function updateFamilyName(connection: FirebaseConnection, familyId: string, input: string) {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || family.role !== 'Primary') throw new Error('Only a Primary caregiver can edit the family name.');
  const name = input.trim();
  if (!name || name.length > 100) throw new Error('Enter a family name of up to 100 characters.');
  await assertDataGeneration(connection.db, connection.dataGeneration);
  const ref = doc(connection.db, collections.families, familyId);
  await runTransaction(connection.db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) throw new Error('This family is no longer available.');
    if (snapshot.data().name !== family.name) throw new Error('The family name changed elsewhere. Reload and review it before saving.');
    transaction.update(ref, { name });
  });
  return refreshFirebaseConnection(connection, { familyId, patientId: connection.patientId });
}

export async function resetFirebasePassword(config: FirebaseWebConfig, email: string) {
  const app = await appFor(config);
  await sendPasswordResetEmail(getAuth(app), email.trim());
}

export async function restoreFirebase(config: FirebaseWebConfig): Promise<FirebaseConnection | null> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  return auth.currentUser ? connectionFor(app, auth.currentUser) : null;
}

export async function connectFirebase(config: FirebaseWebConfig, caregiverEmail: string, password?: string): Promise<FirebaseConnection> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  let user = auth.currentUser;
  if (user && user.email !== caregiverEmail) { await signOut(auth); user = null; }
  if (!user) {
    if (!password) throw new Error('Enter your password to sign in.');
    user = (await signInWithEmailAndPassword(auth, caregiverEmail, password)).user;
  }
  return connectionFor(app, user);
}

export async function registerFirebaseAccount(config: FirebaseWebConfig, displayName: string, caregiverEmail: string, password: string) {
  const name = displayName.trim();
  if (!name || name.length > 100) throw new Error('Enter your name using up to 100 characters.');
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  if (auth.currentUser) await signOut(auth);
  const user = (await createUserWithEmailAndPassword(auth, caregiverEmail, password)).user;
  try { await updateProfile(user, { displayName: name }); }
  catch { throw new Error('Your account was created, but setup could not finish. Sign in to continue.'); }
  return connectionFor(app, user);
}

export async function connectFirebaseWithGoogle(config: FirebaseWebConfig): Promise<FirebaseConnection> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  auth.useDeviceLanguage();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const user = (await signInWithPopup(auth, provider)).user;
  return connectionFor(app, user);
}


export async function disconnectFirebase(connection: FirebaseConnection) {
  await signOut(getAuth(connection.app));
}
