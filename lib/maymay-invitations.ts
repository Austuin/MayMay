import {
  collection, doc, getDocs,
  onSnapshot, query, where, runTransaction, getDocFromServer, serverTimestamp,
  Timestamp, arrayUnion, arrayRemove, deleteField, type Transaction,
} from 'firebase/firestore';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
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

const invitationRef = (connection: FirebaseConnection, familyId: string, inviteId: string) =>
  doc(connection.db, 'families', familyId, 'invitations', inviteId);

// getRandomValues works on local HTTP sites; SubtleCrypto does not. Never fall
// back to Math.random for an invitation secret. Hashing needs no host endpoint.
function randomHex(bytes: number) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('This browser cannot securely generate a Family Code. Please use a current browser.');
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}
const invitationProof = (secret: string) => bytesToHex(sha256(new TextEncoder().encode(secret)));

async function invitationContext(connection: FirebaseConnection, tx: Transaction) {
  const configuration = (await tx.get(doc(connection.db, 'system', 'data'))).data();
  const identity = (await tx.get(doc(connection.db, 'users', connection.user.uid))).data();
  if (configuration?.schemaVersion !== 1 || configuration.generation !== connection.dataGeneration
    || identity?.dataGeneration !== connection.dataGeneration) {
    throw new Error('MayMay data setup changed. Sign out and sign in again before continuing.');
  }
}

export async function getFamilyInvitation(connection: FirebaseConnection, familyId: string) {
  requirePrimary(connection, familyId);
  return runTransaction(connection.db, async tx => {
    await invitationContext(connection, tx);
    const family = (await tx.get(doc(connection.db, 'families', familyId))).data();
    if (!family?.activeInviteId) return null;
    const invitation = (await tx.get(invitationRef(connection, familyId, family.activeInviteId))).data();
    if (!invitation) return null;
    return { inviteId: family.activeInviteId, expiresAt: invitation.expiresAt.toDate().toISOString(),
      revoked: !!invitation.revokedAt, patientIds: invitation.patientIds } as InvitationStatus;
  });
}

export async function rotateFamilyCode(connection: FirebaseConnection, familyId: string, patientIds: string[]) {
  const ids = selectedPatients(requirePrimary(connection, familyId), patientIds);
  const inviteId = randomHex(12), secret = randomHex(16);
  const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await runTransaction(connection.db, async tx => {
    await invitationContext(connection, tx);
    const ref = doc(connection.db, 'families', familyId);
    const family = (await tx.get(ref)).data();
    if (family?.activeInviteId) tx.update(invitationRef(connection, familyId, family.activeInviteId), { revokedAt: serverTimestamp() });
    tx.set(invitationRef(connection, familyId, inviteId), {
      inviteId, familyId, codeHash: invitationProof(secret), expiresAt, patientIds: ids,
      revokedAt: null, createdBy: connection.user.uid, dateCreated: serverTimestamp(), dataGeneration: connection.dataGeneration,
    });
    tx.update(ref, { activeInviteId: inviteId });
  });
  return { inviteId, code: `MM1.${familyId}.${inviteId}.${secret}`, expiresAt: expiresAt.toDate().toISOString(), revoked: false, patientIds: ids };
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
  if (!connection.user.emailVerified) throw new Error('Verify your email before requesting family access.');
  const parsed = /^MM1\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{24})\.([a-f0-9]{32})$/.exec(code.trim());
  if (!parsed) throw new Error('That Family Code is invalid or expired. Ask a Primary for a new code.');
  const [, familyId, inviteId, secret] = parsed;
  const relation = relationship.trim();
  if (!relation || relation.length > 100) throw new Error('Enter your relationship to the family (up to 100 characters).');
  try {
    await runTransaction(connection.db, async tx => {
      await invitationContext(connection, tx);
      const ref = membershipRef(connection, familyId, connection.user.uid);
      const member = (await tx.get(ref)).data();
      if (member?.status === 'Pending') return;
      if (member && member.status !== 'Rejected') throw new Error('You already belong to this family or your access is disabled. Ask a Primary for help.');
      tx.set(ref, {
        familyId, userId: connection.user.uid, role: 'Caregiver', status: 'Pending', patientIds: [],
        invitationId: inviteId, invitationProof: invitationProof(secret), dataGeneration: connection.dataGeneration,
        requesterName: (connection.user.displayName || connection.user.email || 'Caregiver').slice(0, 100),
        requesterEmail: connection.user.email, requesterEmailVerified: true, relationship: relation, requestedAt: serverTimestamp(),
      });
      tx.update(doc(connection.db, 'users', connection.user.uid), { familyIds: arrayUnion(familyId), dateUpdated: serverTimestamp() });
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') throw new Error('That Family Code is invalid or expired, or your email is not verified. Ask a Primary for a new code.');
    throw error;
  }
  return refreshFirebaseConnection(connection);
}

export async function cancelFamilyRequest(connection: FirebaseConnection, familyId: string) {
  await runTransaction(connection.db, async tx => {
    await invitationContext(connection, tx);
    const ref = membershipRef(connection, familyId, connection.user.uid);
    if ((await tx.get(ref)).data()?.status !== 'Pending') throw new Error('This request is no longer pending. Refresh the list.');
    tx.delete(ref);
    tx.update(doc(connection.db, 'users', connection.user.uid), { familyIds: arrayRemove(familyId), dateUpdated: serverTimestamp() });
  });
  return refreshFirebaseConnection(connection);
}

export async function listFamilyMembers(connection: FirebaseConnection, familyId: string): Promise<FamilyMember[]> {
  requirePrimary(connection, familyId);
  const snapshot = await getDocs(collection(connection.db, 'families', familyId, 'memberships'));
  // Only Primaries can read invitation metadata. Resolve suggestions here so a
  // requester never needs to read the stored proof or patient scope.
  const suggestions = new Map<string, string[]>();
  await Promise.all([...new Set(snapshot.docs.filter(item => item.data().status === 'Pending')
    .map(item => item.data().invitationId).filter(Boolean))].map(async id => {
    const invitation = await getDocFromServer(invitationRef(connection, familyId, id));
    suggestions.set(id, invitation.data()?.patientIds ?? []);
  }));
  return snapshot.docs.map(item => {
    const value = item.data();
    return {
      familyId, userId: item.id, role: value.role as FamilyRole, status: value.status as MembershipStatus,
      patientIds: Array.isArray(value.patientIds) ? value.patientIds : [],
      requesterName: String(value.requesterName || (item.id === connection.user.uid ? connection.user.displayName || 'You' : 'Caregiver')),
      requesterEmail: String(value.requesterEmail || (item.id === connection.user.uid ? connection.user.email || '' : '')),
      relationship: String(value.relationship || ''),
      requestedAt: value.requestedAt?.toDate?.().toISOString(),
      invitationId: value.invitationId, proposedPatientIds: suggestions.get(value.invitationId) ?? value.proposedPatientIds,
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
  if (!['Caregiver', 'Viewer'].includes(role)) throw new Error('Choose Caregiver or Viewer.');
  await runTransaction(connection.db, async tx => {
    await invitationContext(connection, tx);
    const ref = membershipRef(connection, familyId, userId);
    const member = (await tx.get(ref)).data();
    if (member?.status !== 'Pending') throw new Error('This request is no longer pending. Refresh the list.');
    tx.update(ref, { status: 'Active', role, patientIds: ids, dateJoined: serverTimestamp(),
      approvedAt: serverTimestamp(), approvedBy: connection.user.uid, invitationProof: deleteField() });
    ids.forEach(patientId => tx.set(accessRef(connection, familyId, patientId, userId), {
      familyId, patientId, userId, relationship: member.relationship || '', canAccess: true,
    }));
  });
}

export async function rejectFamilyRequest(connection: FirebaseConnection, familyId: string, userId: string) {
  requirePrimary(connection, familyId);
  await runTransaction(connection.db, async tx => {
    await invitationContext(connection, tx);
    const ref = membershipRef(connection, familyId, userId);
    if ((await tx.get(ref)).data()?.status !== 'Pending') throw new Error('This request is no longer pending. Refresh the list.');
    tx.update(ref, { status: 'Rejected', reviewedAt: serverTimestamp(), reviewedBy: connection.user.uid, invitationProof: deleteField() });
  });
}

export async function setFamilyMemberRole(connection: FirebaseConnection, familyId: string, member: FamilyMember, role: FamilyRole) {
  requirePrimary(connection, familyId);
  if (member.userId === connection.user.uid) throw new Error('Another Primary must change your role.');
  await runTransaction(connection.db, async tx => {
    const ref = membershipRef(connection, familyId, member.userId);
    unchangedMember((await tx.get(ref)).data(), member);
    tx.update(ref, { role });
  });
}

export async function transferProtectedPrimary(connection: FirebaseConnection, familyId: string, userId: string) {
  const family = requirePrimary(connection, familyId);
  await runTransaction(connection.db, async tx => {
    const ref = doc(connection.db, 'families', familyId);
    if ((await tx.get(ref)).data()?.primaryId !== family.primaryId) throw new Error('The protected Primary changed elsewhere. Refresh before transferring.');
    tx.update(ref, { primaryId: userId });
  });
}

function unchangedMember(current: Record<string, unknown> | undefined, expected: FamilyMember) {
  const ids = (value: unknown) => JSON.stringify(Array.isArray(value) ? [...value].sort() : []);
  if (!current || current.status !== expected.status || current.role !== expected.role || ids(current.patientIds) !== ids(expected.patientIds)) {
    throw new Error('This caregiver changed elsewhere. Refresh the list before saving.');
  }
}

export async function changeFamilyMemberPatients(connection: FirebaseConnection, familyId: string, member: FamilyMember, selectedIds: string[]) {
  const family = requirePrimary(connection, familyId);
  if (member.userId === connection.user.uid) throw new Error('Another Primary must change your patient access.');
  if (member.status !== 'Active') throw new Error('Only active members can be assigned patients.');
  const selected = selectedPatients(family, selectedIds);
  const visible = new Set(family.patients.map(patient => patient.patientId));
  await runTransaction(connection.db, async tx => {
    const ref = membershipRef(connection, familyId, member.userId);
    const snapshot = await tx.get(ref);
    unchangedMember(snapshot.data(), member);
    const preserved = member.patientIds.filter(id => !visible.has(id));
    tx.update(ref, { patientIds: [...new Set([...preserved, ...selected])] });
    for (const patientId of selected.filter(id => !member.patientIds.includes(id))) {
      tx.set(accessRef(connection, familyId, patientId, member.userId), {
        familyId, patientId, userId: member.userId, relationship: member.relationship ?? '', canAccess: true,
      });
    }
    for (const patientId of member.patientIds.filter(id => visible.has(id) && !selected.includes(id))) {
      tx.delete(accessRef(connection, familyId, patientId, member.userId));
    }
  });
}

export async function disableFamilyMember(connection: FirebaseConnection, familyId: string, member: FamilyMember) {
  requirePrimary(connection, familyId);
  if (member.userId === connection.user.uid) throw new Error('Another Primary must disable your access.');
  await runTransaction(connection.db, async tx => {
    const ref = membershipRef(connection, familyId, member.userId);
    unchangedMember((await tx.get(ref)).data(), member);
    tx.update(ref, { status: 'Disabled', patientIds: [] });
    for (const patientId of member.patientIds) tx.delete(accessRef(connection, familyId, patientId, member.userId));
  });
}

export async function restoreFamilyMember(connection: FirebaseConnection, familyId: string, member: FamilyMember, patientIds: string[]) {
  const family = requirePrimary(connection, familyId);
  if (member.status !== 'Disabled') throw new Error('That member is not disabled.');
  const ids = selectedPatients(family, patientIds, true);
  await runTransaction(connection.db, async tx => {
    const ref = membershipRef(connection, familyId, member.userId);
    unchangedMember((await tx.get(ref)).data(), member);
    tx.update(ref, { status: 'Active', patientIds: ids });
    for (const patientId of ids) tx.set(accessRef(connection, familyId, patientId, member.userId), {
      familyId, patientId, userId: member.userId, relationship: member.relationship ?? '', canAccess: true,
    });
  });
}
