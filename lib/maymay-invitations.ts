import {
  collection, doc, getDocs,
  onSnapshot, query, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { refreshFirebaseConnection, type FirebaseConnection, type FamilyOption } from './maymay-firebase';
import { reload, sendEmailVerification } from 'firebase/auth';
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
  invitationId?: string;
  proposedPatientIds?: string[];
  requesterEmailVerified?: boolean;
};
export type PendingRequest = FamilyMember & { familyName: string };

function requirePrimary(connection: FirebaseConnection, familyId: string): FamilyOption {
  const family = connection.families.find(item => item.familyId === familyId);
  if (!family || family.role !== 'Primary') throw new Error('Only a Primary caregiver can manage this family.');
  return family;
}

function membershipRef(connection: FirebaseConnection, familyId: string, userId: string) {
  return doc(connection.db, 'families', familyId, 'memberships', userId);
}

function accessRef(connection: FirebaseConnection, familyId: string, patientId: string, userId: string) {
  return doc(connection.db, 'families', familyId, 'patients', patientId, 'relationships', userId);
}

export type InvitationStatus = { inviteId: string; expiresAt: string; revoked: boolean; patientIds: string[] };

async function invitationRequest<T>(connection: FirebaseConnection, action: string, input: Record<string, unknown>): Promise<T> {
  const token = await connection.user.getIdToken();
  let response: Response;
  try {
    response = await fetch('/api/family-invitations/' + action, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      cache: 'no-store', body: JSON.stringify({ ...input, dataGeneration: connection.dataGeneration }),
    });
  } catch { throw new Error('Could not reach the MayMay host. Check your connection and try again.'); }
  const result = await response.json().catch(() => { throw new Error('The MayMay host does not have family invitations available yet.'); });
  if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
    ? result.error : 'Could not update family access.');
  return result as T;
}

export async function getFamilyInvitation(connection: FirebaseConnection, familyId: string) {
  requirePrimary(connection, familyId);
  return invitationRequest<InvitationStatus | null>(connection, 'status', { familyId });
}

export async function rotateFamilyCode(connection: FirebaseConnection, familyId: string, patientIds: string[]) {
  requirePrimary(connection, familyId);
  return invitationRequest<InvitationStatus & { code: string }>(connection, 'rotate', { familyId, patientIds });
}

export async function sendVerificationEmail(connection: FirebaseConnection) {
  await sendEmailVerification(connection.user);
}

export async function checkEmailVerification(connection: FirebaseConnection) {
  await reload(connection.user);
  await connection.user.getIdToken(true);
  return connection.user.emailVerified;
}

export async function requestFamilyAccess(connection: FirebaseConnection, code: string, relationship = '') {
  await invitationRequest(connection, 'request', { code: code.trim(), relationship: relationship.trim() });
  return refreshFirebaseConnection(connection);
}

export async function cancelFamilyRequest(connection: FirebaseConnection, familyId: string) {
  await invitationRequest(connection, 'cancel', { familyId });
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
      invitationId: value.invitationId, proposedPatientIds: value.proposedPatientIds,
      requesterEmailVerified: value.requesterEmailVerified === true,
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
          relationship: String(value.relationship || ''), requestedAt: value.requestedAt?.toDate?.().toISOString(),
          invitationId: value.invitationId, proposedPatientIds: value.proposedPatientIds,
          requesterEmailVerified: value.requesterEmailVerified === true,
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
  await invitationRequest(connection, 'approve', { familyId, userId, role, patientIds: ids });
}

export async function rejectFamilyRequest(connection: FirebaseConnection, familyId: string, userId: string) {
  requirePrimary(connection, familyId);
  await invitationRequest(connection, 'reject', { familyId, userId });
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
