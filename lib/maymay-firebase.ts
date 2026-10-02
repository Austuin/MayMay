import { deleteApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider,
  sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, updateProfile, type User,
} from 'firebase/auth';
import {
  arrayUnion, collection, deleteField, doc, getDoc, getFirestore, serverTimestamp,
  setDoc, updateDoc, writeBatch, type Firestore,
} from 'firebase/firestore';
import type { FirebaseWebConfig } from './maymay-types';
import type { FamilyRole, PatientRecord } from './maymay-access';

// The tracker still uses these labels internally. Firestore memberships are the authority.
export type UserRole = 'pending' | 'master' | 'caregiver' | 'viewer';
export type UserProfile = { familyId: string; role: UserRole; active: boolean; displayName?: string; email?: string };
export type MayMayRuntimeConfig = { firebase: FirebaseWebConfig; familyId?: string; childId?: string };
export type FamilyOption = { familyId: string; name: string; role: FamilyRole; primaryId: string; patients: PatientRecord[] };
export type FamilyRequest = { familyId: string; status: 'Pending' | 'Rejected' | 'Disabled' };
export type PatientFields = {
  name: string;
  age?: number;
  sex?: string;
  ethnicity?: string;
  autismLevel?: string;
  birthdate?: string;
  supportNeeds?: string;
};
export type FirebaseConnection = {
  app: FirebaseApp;
  db: Firestore;
  user: User;
  profile: UserProfile;
  childId: string;
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

async function ensureIdentity(db: Firestore, user: User) {
  const ref = doc(db, 'users', user.uid);
  let snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    await setDoc(ref, {
      userId: user.uid,
      name: user.displayName?.trim() || user.email?.split('@')[0] || 'Caregiver',
      email: user.email ?? '',
      familyIds: [],
      dateCreated: serverTimestamp(),
      dateUpdated: serverTimestamp(),
    });
    snapshot = await getDoc(ref);
  }
  return snapshot.data() as { name?: string; familyIds?: string[] };
}

function selectionKey(app: FirebaseApp, user: User) {
  return `maymay.selection.${app.options.projectId}.${user.uid}`;
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
            const snapshot = await getDoc(doc(db, 'families', familyId, 'children', patientId));
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

function chooseConnection(base: Pick<FirebaseConnection, 'app' | 'db' | 'user' | 'families' | 'requests'>, preferred?: { familyId?: string; patientId?: string }): FirebaseConnection {
  let stored: { familyId?: string; patientId?: string } = {};
  try { if (typeof localStorage !== 'undefined') stored = JSON.parse(localStorage.getItem(selectionKey(base.app, base.user)) || '{}'); } catch { /* Ignore invalid device selection. */ }
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
      active: Boolean(family), displayName: base.user.displayName ?? undefined,
      email: base.user.email ?? undefined,
    },
    childId: patient?.patientId ?? '', patient,
  };
}

async function connectionFrom(db: Firestore, app: FirebaseApp, user: User, preferred?: { familyId?: string; patientId?: string }) {
  const identity = await ensureIdentity(db, user);
  const options = await familyOptions(db, user.uid, Array.isArray(identity.familyIds) ? identity.familyIds : []);
  return chooseConnection({ app, db, user, ...options }, preferred);
}

async function connectionFor(app: FirebaseApp, user: User, preferred?: { familyId?: string; patientId?: string }) {
  return connectionFrom(getFirestore(app), app, user, preferred);
}

export async function refreshFirebaseConnection(connection: FirebaseConnection, preferred?: { familyId?: string; patientId?: string }) {
  return connectionFrom(connection.db, connection.app, connection.user, preferred);
}

export function selectFamilyPatient(connection: FirebaseConnection, familyId: string, patientId = '') {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || (patientId && !family.patients.some(item => item.patientId === patientId))) {
    throw new Error('That family or patient is unavailable.');
  }
  const selected = { familyId, patientId };
  if (typeof localStorage !== 'undefined') localStorage.setItem(selectionKey(connection.app, connection.user), JSON.stringify(selected));
  return chooseConnection(connection, selected);
}

export async function createFamily(connection: FirebaseConnection, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a family name.');
  const familyRef = doc(collection(connection.db, 'families'));
  const membershipRef = doc(familyRef, 'memberships', connection.user.uid);
  const batch = writeBatch(connection.db);
  batch.set(familyRef, {
    familyId: familyRef.id, name: trimmed, creatorId: connection.user.uid,
    primaryId: connection.user.uid, dateCreated: serverTimestamp(),
  });
  batch.set(membershipRef, {
    familyId: familyRef.id, userId: connection.user.uid, role: 'Primary', status: 'Active',
    patientIds: [], requestedAt: serverTimestamp(), dateJoined: serverTimestamp(),
    requesterName: connection.user.displayName?.trim() || connection.user.email || 'Primary caregiver',
    requesterEmail: connection.user.email ?? '',
  });
  batch.update(doc(connection.db, 'users', connection.user.uid), {
    familyIds: arrayUnion(familyRef.id), dateUpdated: serverTimestamp(),
  });
  await batch.commit();
  return selectFamilyPatient(await refreshFirebaseConnection(connection, { familyId: familyRef.id }), familyRef.id);
}

function patientValues(input: PatientFields) {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a patient name.');
  if (input.age !== undefined && (!Number.isInteger(input.age) || input.age < 0 || input.age > 120)) {
    throw new Error('Age must be a whole number from 0 to 120.');
  }
  return {
    name,
    ...(input.age === undefined ? {} : { age: input.age }),
    ...(input.sex?.trim() ? { sex: input.sex.trim() } : {}),
    ...(input.ethnicity?.trim() ? { ethnicity: input.ethnicity.trim() } : {}),
    ...(input.autismLevel?.trim() ? { autismLevel: input.autismLevel.trim() } : {}),
    ...(input.birthdate?.trim() ? { birthdate: input.birthdate.trim() } : {}),
    ...(input.supportNeeds?.trim() ? { supportNeeds: input.supportNeeds.trim() } : {}),
  };
}

export async function createPatient(connection: FirebaseConnection, familyId: string, input: PatientFields) {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || family.role !== 'Primary') throw new Error('Only a Primary caregiver can add a patient.');
  const patientRef = doc(collection(connection.db, 'families', familyId, 'children'));
  const batch = writeBatch(connection.db);
  batch.set(patientRef, {
    patientId: patientRef.id, familyId, ...patientValues(input),
    dateCreated: serverTimestamp(), dateUpdated: serverTimestamp(),
  });
  batch.set(doc(patientRef, 'access', connection.user.uid), {
    familyId, patientId: patientRef.id, userId: connection.user.uid,
    relationship: 'Primary caregiver', canAccess: true,
  });
  batch.update(doc(connection.db, 'families', familyId, 'memberships', connection.user.uid), {
    patientIds: arrayUnion(patientRef.id),
  });
  await batch.commit();
  const refreshed = await refreshFirebaseConnection(connection, { familyId, patientId: patientRef.id });
  return selectFamilyPatient(refreshed, familyId, patientRef.id);
}

export async function updatePatient(connection: FirebaseConnection, input: PatientFields) {
  const family = connection.families.find(item => item.familyId === connection.profile.familyId);
  if (!family || family.role !== 'Primary' || !connection.childId) throw new Error('Only a Primary caregiver can edit this patient.');
  const values = patientValues(input);
  await updateDoc(doc(connection.db, 'families', family.familyId, 'children', connection.childId), {
    ...values,
    age: values.age ?? deleteField(), sex: values.sex ?? deleteField(),
    ethnicity: values.ethnicity ?? deleteField(), autismLevel: values.autismLevel ?? deleteField(),
    birthdate: values.birthdate ?? deleteField(), supportNeeds: values.supportNeeds ?? deleteField(), dateUpdated: serverTimestamp(),
  });
  return refreshFirebaseConnection(connection, { familyId: family.familyId, patientId: connection.childId });
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
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  if (auth.currentUser) await signOut(auth);
  const user = (await createUserWithEmailAndPassword(auth, caregiverEmail, password)).user;
  try { await updateProfile(user, { displayName: displayName.trim() }); } catch { /* Authentication still works without the optional display name. */ }
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

export { desiredEvents } from './maymay-events';

export async function disconnectFirebase(connection: FirebaseConnection) {
  await signOut(getAuth(connection.app));
}
