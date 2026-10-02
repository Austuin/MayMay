import {
  arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs,
  onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { refreshFirebaseConnection, type FirebaseConnection, type FamilyOption } from './maymay-firebase';
import type { FamilyRole, MembershipStatus } from './maymay-access';

export type FamilyMember = {
  familyId: string;
  userId: string;
  role: FamilyRole;
  status: MembershipStatus;
  patientIds: string[];
  requesterName: string;
  requesterEmail: string;
  relationship?: string;
  requestedAt?: string;
};
export type PendingRequest = FamilyMember & { familyName: string };

function requirePrimary(connection: FirebaseConnection, familyId: string): FamilyOption {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || family.role !== 'Primary') throw new Error('Only a Primary caregiver can manage this family.');
  return family;
}

function settingsRef(connection: FirebaseConnection, familyId: string) {
  return doc(connection.db, 'families', familyId, 'joinSettings', 'current');
}

function membershipRef(connection: FirebaseConnection, familyId: string, userId: string) {
  return doc(connection.db, 'families', familyId, 'memberships', userId);
}

function accessRef(connection: FirebaseConnection, familyId: string, patientId: string, userId: string) {
  return doc(connection.db, 'families', familyId, 'children', patientId, 'access', userId);
}

function codeFor(familyId: string, secret: string) {
  return `MM1.${familyId}.${secret}`;
}

export async function getFamilyCode(connection: FirebaseConnection, familyId: string) {
  requirePrimary(connection, familyId);
  const snapshot = await getDoc(settingsRef(connection, familyId));
  return snapshot.exists() ? codeFor(familyId, String(snapshot.data().secret)) : null;
}

export async function rotateFamilyCode(connection: FirebaseConnection, familyId: string) {
  requirePrimary(connection, familyId);
  if (!globalThis.crypto?.getRandomValues) throw new Error('This browser cannot generate a secure Family Code.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const secret = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  await setDoc(settingsRef(connection, familyId), { familyId, secret, updatedAt: serverTimestamp() });
  return codeFor(familyId, secret);
}

export async function requestFamilyAccess(connection: FirebaseConnection, code: string, relationship = '') {
  const match = /^MM1\.([A-Za-z0-9_-]{1,100})\.([0-9a-f]{32})$/.exec(code.trim());
  if (!match) throw new Error('Enter the complete Family Code. Ask a Primary caregiver to copy it again if needed.');
  const [, familyId, joinSecret] = match;
  const ref = membershipRef(connection, familyId, connection.user.uid);
  const existing = await getDoc(ref);
  if (existing.exists() && existing.data().status !== 'Rejected') {
    throw new Error(existing.data().status === 'Pending' ? 'Your request is already waiting for approval.' : 'This account already has a membership in that family.');
  }
  const batch = writeBatch(connection.db);
  batch.set(ref, {
    familyId, userId: connection.user.uid, role: 'Caregiver', status: 'Pending',
    patientIds: [], requestedAt: serverTimestamp(), relationship: relationship.trim(),
    requesterName: connection.user.displayName?.trim() || connection.user.email || 'Caregiver',
    requesterEmail: connection.user.email ?? '', joinSecret,
  });
  batch.update(doc(connection.db, 'users', connection.user.uid), {
    familyIds: arrayUnion(familyId), dateUpdated: serverTimestamp(),
  });
  await batch.commit();
  return refreshFirebaseConnection(connection);
}

export async function cancelFamilyRequest(connection: FirebaseConnection, familyId: string) {
  const batch = writeBatch(connection.db);
  batch.delete(membershipRef(connection, familyId, connection.user.uid));
  batch.update(doc(connection.db, 'users', connection.user.uid), {
    familyIds: arrayRemove(familyId), dateUpdated: serverTimestamp(),
  });
  await batch.commit();
  return refreshFirebaseConnection(connection);
}

export async function listFamilyMembers(connection: FirebaseConnection, familyId: string): Promise<FamilyMember[]> {
  requirePrimary(connection, familyId);
  const snapshot = await getDocs(collection(connection.db, 'families', familyId, 'memberships'));
  return snapshot.docs.map(item => {
    const value = item.data();
    return {
      familyId, userId: item.id, role: value.role as FamilyRole, status: value.status as MembershipStatus,
      patientIds: Array.isArray(value.patientIds) ? value.patientIds : [],
      requesterName: String(value.requesterName || (item.id === connection.user.uid ? connection.user.displayName || 'You' : 'Caregiver')),
      requesterEmail: String(value.requesterEmail || (item.id === connection.user.uid ? connection.user.email || '' : '')),
      relationship: String(value.relationship || ''),
      requestedAt: value.requestedAt?.toDate?.().toISOString(),
    };
  });
}

export async function listPendingRequests(connection: FirebaseConnection): Promise<PendingRequest[]> {
  const primaryFamilies = connection.families.filter(item => item.role === 'Primary');
  const groups = await Promise.all(primaryFamilies.map(async family =>
    (await listFamilyMembers(connection, family.familyId))
      .filter(member => member.status === 'Pending')
      .map(member => ({ ...member, familyName: family.name })),
  ));
  return groups.flat();
}

export function watchPendingRequests(connection: FirebaseConnection, receive: (requests: PendingRequest[]) => void, fail: (error: Error) => void) {
  const primaryFamilies = connection.families.filter(item => item.role === 'Primary');
  if (!primaryFamilies.length) { queueMicrotask(() => receive([])); return () => undefined; }
  const byFamily = new Map<string, PendingRequest[]>();
  const stop = primaryFamilies.map(family => onSnapshot(
    query(collection(connection.db, 'families', family.familyId, 'memberships'), where('status', '==', 'Pending')),
    snapshot => {
      byFamily.set(family.familyId, snapshot.docs.map(item => {
        const value = item.data();
        return {
          familyId: family.familyId, familyName: family.name, userId: item.id,
          role: value.role as FamilyRole, status: 'Pending' as const,
          patientIds: Array.isArray(value.patientIds) ? value.patientIds : [],
          requesterName: String(value.requesterName || 'Caregiver'),
          requesterEmail: String(value.requesterEmail || ''),
        };
      }));
      receive([...byFamily.values()].flat());
    },
    fail,
  ));
  return () => stop.forEach(unsubscribe => unsubscribe());
}

function selectedPatients(family: FamilyOption, ids: string[], requireOne = false) {
  const unique = [...new Set(ids)];
  if (requireOne && !unique.length && family.patients.length) throw new Error('Choose at least one patient.');
  if (unique.some(id => !family.patients.some(patient => patient.patientId === id))) {
    throw new Error('One of those patients is unavailable to you.');
  }
  return unique;
}

export async function approveFamilyRequest(
  connection: FirebaseConnection, familyId: string, userId: string,
  role: 'Caregiver' | 'Viewer', patientIds: string[],
) {
  const family = requirePrimary(connection, familyId);
  const ids = selectedPatients(family, patientIds, true);
  const ref = membershipRef(connection, familyId, userId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().status !== 'Pending') throw new Error('That request is no longer pending.');
  const batch = writeBatch(connection.db);
  batch.update(ref, {
    role, status: 'Active', patientIds: ids, dateJoined: serverTimestamp(),
    approvedAt: serverTimestamp(), approvedBy: connection.user.uid, joinSecret: deleteField(),
  });
  for (const patientId of ids) {
    batch.set(accessRef(connection, familyId, patientId, userId), {
      familyId, patientId, userId, relationship: String(snapshot.data().relationship || ''), canAccess: true,
    });
  }
  await batch.commit();
}

export async function rejectFamilyRequest(connection: FirebaseConnection, familyId: string, userId: string) {
  requirePrimary(connection, familyId);
  const ref = membershipRef(connection, familyId, userId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists() || snapshot.data().status !== 'Pending') throw new Error('That request is no longer pending.');
  await updateDoc(ref, {
    status: 'Rejected', reviewedAt: serverTimestamp(),
    reviewedBy: connection.user.uid, joinSecret: deleteField(),
  });
}

export async function setFamilyMemberRole(connection: FirebaseConnection, familyId: string, userId: string, role: FamilyRole) {
  requirePrimary(connection, familyId);
  if (userId === connection.user.uid) throw new Error('Another Primary must change your role.');
  await updateDoc(membershipRef(connection, familyId, userId), { role });
}

export async function transferProtectedPrimary(connection: FirebaseConnection, familyId: string, userId: string) {
  requirePrimary(connection, familyId);
  await updateDoc(doc(connection.db, 'families', familyId), { primaryId: userId });
}

export async function changeFamilyMemberPatients(connection: FirebaseConnection, familyId: string, member: FamilyMember, selectedIds: string[]) {
  const family = requirePrimary(connection, familyId);
  if (member.userId === connection.user.uid) throw new Error('Another Primary must change your patient access.');
  if (member.status !== 'Active') throw new Error('Only active members can be assigned patients.');
  const selected = selectedPatients(family, selectedIds);
  const visible = new Set(family.patients.map(patient => patient.patientId));
  const preserved = member.patientIds.filter(id => !visible.has(id));
  const nextIds = [...new Set([...preserved, ...selected])];
  const batch = writeBatch(connection.db);
  batch.update(membershipRef(connection, familyId, member.userId), { patientIds: nextIds });
  for (const patientId of selected.filter(id => !member.patientIds.includes(id))) {
    batch.set(accessRef(connection, familyId, patientId, member.userId), {
      familyId, patientId, userId: member.userId, relationship: '', canAccess: true,
    });
  }
  for (const patientId of member.patientIds.filter(id => visible.has(id) && !selected.includes(id))) {
    batch.delete(accessRef(connection, familyId, patientId, member.userId));
  }
  await batch.commit();
}

export async function disableFamilyMember(connection: FirebaseConnection, familyId: string, member: FamilyMember) {
  requirePrimary(connection, familyId);
  if (member.userId === connection.user.uid) throw new Error('Another Primary must disable your access.');
  const batch = writeBatch(connection.db);
  batch.update(membershipRef(connection, familyId, member.userId), { status: 'Disabled', patientIds: [] });
  for (const patientId of member.patientIds) {
    batch.delete(accessRef(connection, familyId, patientId, member.userId));
  }
  await batch.commit();
}

export async function restoreFamilyMember(connection: FirebaseConnection, familyId: string, member: FamilyMember, patientIds: string[]) {
  const family = requirePrimary(connection, familyId);
  if (member.status !== 'Disabled') throw new Error('That member is not disabled.');
  const ids = selectedPatients(family, patientIds, true);
  const batch = writeBatch(connection.db);
  batch.update(membershipRef(connection, familyId, member.userId), { status: 'Active', patientIds: ids });
  for (const patientId of ids) {
    batch.set(accessRef(connection, familyId, patientId, member.userId), {
      familyId, patientId, userId: member.userId, relationship: '', canAccess: true,
    });
  }
  await batch.commit();
}
