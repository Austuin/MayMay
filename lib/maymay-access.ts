import { doc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore';

export type FamilyRole = 'Primary' | 'Caregiver' | 'Viewer';
export type MembershipStatus = 'Pending' | 'Active' | 'Rejected' | 'Disabled';

export type FamilyRecord = {
  familyId: string;
  name: string;
  creatorId: string;
  /** An active Primary who cannot be demoted without assigning a successor. */
  primaryId: string;
  dateCreated: unknown;
};

export type FamilyMembership = {
  familyId: string;
  userId: string;
  role: FamilyRole;
  status: MembershipStatus;
  requestedAt?: unknown;
  dateJoined?: unknown;
  approvedAt?: unknown;
  approvedBy?: string;
  reviewedAt?: unknown;
  reviewedBy?: string;
  requesterName?: string;
  requesterEmail?: string;
  joinSecret?: string;
  patientIds?: string[];
};

export type PatientRecord = {
  patientId: string;
  familyId: string;
  name: string;
  dateCreated: unknown;
  dateUpdated: unknown;
  age?: number;
  sex?: string;
  ethnicity?: string;
  autismLevel?: string;
  birthdate?: string;
  supportNeeds?: string;
};

export type PatientAccess = {
  familyId: string;
  patientId: string;
  userId: string;
  relationship: string;
  canAccess: boolean;
};

/** Used by Stage B setup. Rules require both writes in the same atomic commit. */
export async function createFamilyFoundation(db: Firestore, familyId: string, name: string, creatorId: string) {
  const batch = writeBatch(db);
  const familyRef = doc(db, 'families', familyId);
  const membershipRef = doc(familyRef, 'memberships', creatorId);
  batch.set(familyRef, {
    familyId, name, creatorId, primaryId: creatorId, dateCreated: serverTimestamp(),
  } satisfies FamilyRecord);
  batch.set(membershipRef, {
    familyId, userId: creatorId, role: 'Primary', status: 'Active',
    requestedAt: serverTimestamp(), dateJoined: serverTimestamp(),
  } satisfies FamilyMembership);
  await batch.commit();
}
