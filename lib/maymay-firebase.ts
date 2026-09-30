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
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import {
  type FirebaseWebConfig,
} from './maymay-types';

export type UserRole = 'pending' | 'master' | 'caregiver' | 'viewer';

export type UserProfile = {
  familyId: string;
  role: UserRole;
  active: boolean;
  displayName?: string;
  email?: string;
};

export type ManagedUserProfile = UserProfile & {
  uid: string;
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

function pendingApprovalError(user: User) {
  const identifier = user.email ?? user.uid;
  return Object.assign(
    new Error(`Your account is waiting for a MayMay master to approve it. You cannot view or change care information yet.`),
    { code: 'maymay/pending-approval', identifier },
  );
}

async function ensurePendingProfile(db: Firestore, user: User, familyId: string) {
  const profileRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(profileRef);
  if (snapshot.exists()) return snapshot;

  await setDoc(profileRef, {
    schemaVersion: 1,
    familyId,
    role: 'pending',
    active: false,
    displayName: user.displayName?.trim() || user.email?.split('@')[0] || 'New caregiver',
    email: user.email ?? '',
    requestedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return getDoc(profileRef);
}

async function connectionFor(
  app: FirebaseApp,
  user: User,
  childId = DEFAULT_CHILD_ID,
  familyId = 'maymay',
) {
  const db = getFirestore(app);
  const snapshot = await ensurePendingProfile(db, user, familyId);
  if (!snapshot.exists()) {
    await signOut(getAuth(app));
    throw pendingApprovalError(user);
  }
  const profile = snapshot.data() as Partial<UserProfile>;
  const pendingReadOnly = profile.role === 'pending' && profile.active === false;
  const approved = profile.active === true
    && ['master', 'caregiver', 'viewer'].includes(profile.role ?? '');
  if (
    !profile.familyId || profile.familyId !== familyId ||
    (!pendingReadOnly && !approved)
  ) {
    await signOut(getAuth(app));
    throw new Error('This MayMay account is inactive or incomplete.');
  }
  await setDoc(
    doc(db, 'users', user.uid),
    {
      displayName: user.displayName?.trim() || profile.displayName || user.email?.split('@')[0] || 'Caregiver',
      email: user.email ?? profile.email ?? '',
      lastSignedInAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return { app, db, user, profile: profile as UserProfile, childId };
}

export async function restoreFirebase(
  config: FirebaseWebConfig,
  childId = DEFAULT_CHILD_ID,
  familyId = 'maymay',
): Promise<FirebaseConnection | null> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  await auth.authStateReady();
  return auth.currentUser ? connectionFor(app, auth.currentUser, childId, familyId) : null;
}

export async function connectFirebase(
  config: FirebaseWebConfig,
  caregiverEmail: string,
  password?: string,
  childId = DEFAULT_CHILD_ID,
  familyId = 'maymay',
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

  return connectionFor(app, user, childId, familyId);
}

export async function registerFirebaseAccount(
  config: FirebaseWebConfig,
  displayName: string,
  caregiverEmail: string,
  password: string,
  familyId = 'maymay',
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
    await ensurePendingProfile(getFirestore(app), credential.user, familyId);
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
  familyId = 'maymay',
): Promise<FirebaseConnection> {
  const app = await appFor(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  auth.useDeviceLanguage();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return connectionFor(app, credential.user, childId, familyId);
}

export async function listFamilyUsers(connection: FirebaseConnection) {
  if (connection.profile.role !== 'master') {
    throw new Error('Only a MayMay master can manage people.');
  }
  const snapshot = await getDocs(
    query(collection(connection.db, 'users'), where('familyId', '==', connection.profile.familyId)),
  );
  const roleOrder: Record<UserRole, number> = { pending: 0, master: 1, caregiver: 2, viewer: 3 };
  return snapshot.docs
    .map((item) => {
      const value = item.data() as Partial<UserProfile>;
      return {
        uid: item.id,
        familyId: value.familyId ?? connection.profile.familyId,
        role: value.role ?? 'pending',
        active: value.active === true,
        displayName: value.displayName || (item.id === connection.user.uid ? connection.user.displayName ?? undefined : undefined),
        email: value.email || (item.id === connection.user.uid ? connection.user.email ?? undefined : undefined),
      } satisfies ManagedUserProfile;
    })
    .sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || (a.displayName || a.email || a.uid).localeCompare(b.displayName || b.email || b.uid));
}

export async function assignFamilyRole(
  connection: FirebaseConnection,
  userId: string,
  role: 'master' | 'caregiver',
) {
  if (connection.profile.role !== 'master') {
    throw new Error('Only a MayMay master can change access.');
  }
  if (userId === connection.user.uid) {
    throw new Error('Use another master account to change your own access.');
  }
  await setDoc(
    doc(connection.db, 'users', userId),
    {
      role,
      active: true,
      approvedBy: connection.user.uid,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export { desiredEvents } from './maymay-events';

export async function disconnectFirebase(connection: FirebaseConnection) {
  await signOut(getAuth(connection.app));
}
