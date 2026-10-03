import { doc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';
import { readDataConfiguration } from './maymay-database';
import type { FamilyRecord, FamilyMembership } from './maymay-schema';
export type { FamilyRole, MembershipStatus, FamilyRecord, FamilyMembership, PatientRecord, PatientAccess } from './maymay-schema';

/** Used by Stage B setup. Rules require both writes in the same atomic commit. */
export async function createFamilyFoundation(db: Firestore, familyId: string, name: string, creatorId: string) {
  const { generation } = await readDataConfiguration(db);
  const batch = writeBatch(db);
  const familyRef = doc(db, 'families', familyId);
  const membershipRef = doc(familyRef, 'memberships', creatorId);
  batch.set(familyRef, {
    familyId, name, creatorId, primaryId: creatorId, dataGeneration: generation, dateCreated: serverTimestamp(),
  } satisfies FamilyRecord);
  batch.set(membershipRef, {
    familyId, userId: creatorId, role: 'Primary', status: 'Active',
    requestedAt: serverTimestamp(), dateJoined: serverTimestamp(),
  } satisfies FamilyMembership);
  await batch.commit();
}
