/** MayMay 1.0 application records. Authentication credentials never belong here. */
export const DATA_SCHEMA_VERSION = 1;
export const collections = {
  users: 'users', admins: 'admins', families: 'families', memberships: 'memberships',
  patients: 'patients', relationships: 'relationships', invitations: 'invitations',
  trackers: 'trackers', observations: 'observations',
} as const;

// Readable only by signed-in users; writable only by the release/admin process.
export type DataConfiguration = { schemaVersion: typeof DATA_SCHEMA_VERSION; generation: string };
export type FamilyRole = 'Primary' | 'Caregiver' | 'Viewer';
export type MembershipStatus = 'Pending' | 'Active' | 'Rejected' | 'Disabled';
export type Sex = 'Female' | 'Male' | 'Intersex' | 'Unknown' | 'Prefer not to say';
export type AutismLevel = 'Level 1' | 'Level 2' | 'Level 3' | 'Unknown';

export type UserRecord = {
  userId: string; name: string; email: string; familyIds: string[];
  dataGeneration: string; dateCreated: unknown; dateUpdated: unknown;
};
/** Global account status, independent of membership in any family. */
export type AdminRecord = {
  userId: string; status: 'Active' | 'Disabled'; assignedBy: string;
  dateCreated: unknown; dateUpdated: unknown;
};
export type FamilyRecord = {
  familyId: string; name: string; creatorId: string; primaryId: string;
  dataGeneration: string; dateCreated: unknown;
  activeInviteId?: string;
};
export type FamilyMembership = {
  familyId: string; userId: string; role: FamilyRole; status: MembershipStatus;
  patientIds?: string[]; requestedAt?: unknown; dateJoined?: unknown;
  approvedAt?: unknown; approvedBy?: string; reviewedAt?: unknown; reviewedBy?: string;
  requesterName?: string; requesterEmail?: string; relationship?: string;
  invitationId?: string; proposedPatientIds?: string[]; requesterEmailVerified?: boolean;
};
export type PatientFields = {
  name: string; birthdate?: string; sex?: Sex; ethnicity?: string;
  autismLevel?: AutismLevel; supportNeeds?: string;
};
export type PatientRecord = PatientFields & {
  patientId: string; familyId: string; dateCreated: unknown; dateUpdated: unknown;
};
export type PatientAccess = {
  familyId: string; patientId: string; userId: string; relationship: string; canAccess: boolean;
};
export type FamilyInvitation = {
  inviteId: string; familyId: string; codeHash: string; expiresAt: unknown;
  revokedAt: unknown | null; createdBy: string; dateCreated: unknown; patientIds: string[];
  dataGeneration: string;
};
export type TrackerKind = 'mood' | 'good' | 'difficult' | 'checkin' | 'count';
export type MoodAnswer = 'Bad' | 'Poor' | 'Neutral' | 'OK' | 'Good';
export type TrackerAnswer = MoodAnswer | boolean | number;
export type RecordAudit = {
  familyId: string; patientId: string; dataGeneration: string;
  createdBy: string; updatedBy: string; createdAt: unknown; updatedAt: unknown;
  revision: number; deletedAt: unknown | null;
  /** Internal durable-save receipt identifier; absent on starter trackers. */
  mutationId?: string;
};
export type TrackerDefinition = {
  title: string; description: string; kind: TrackerKind; days: number[];
};
export function trackerValues(input: TrackerDefinition): TrackerDefinition {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!title || title.length > 100) throw new Error('Enter a title of up to 100 characters.');
  if (!description || description.length > 240) throw new Error('Enter a description of up to 240 characters.');
  if (!['mood', 'good', 'difficult', 'checkin', 'count'].includes(input.kind)) throw new Error('Choose a listed event type.');
  const days = [...new Set(input.days)].sort((a, b) => a - b);
  if (!days.length || days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose at least one weekday.');
  return { title, description, kind: input.kind, days };
}
export type TrackerRecord = TrackerDefinition & RecordAudit & { trackerId: string };
export type MeltdownDetails = {
  duration?: string; intensity?: string; trigger?: string; earlySigns?: string;
  aggression?: string; whatHelped?: string;
};
export type ObservationRecord = RecordAudit & {
  observationId: string; localDate: string; occurredAt: unknown;
  kind: 'answer' | 'good' | 'difficult' | 'meltdown' | 'other';
  trackerId: string | null;
  trackerSnapshot: Pick<TrackerDefinition, 'title' | 'description' | 'kind'> | null;
  value: TrackerAnswer | null; title: string; note: string; details: MeltdownDetails;
  /** Category plus normalized title for per-patient recurrence suggestions. */
  repeatKey?: string;
};

export function spontaneousRepeatKey(kind: 'good' | 'difficult' | 'meltdown' | 'other', title: string) {
  return `${kind}:${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/** One answer document per recurring tracker/day prevents duplicate daily answers. */
export function dailyObservationId(trackerId: string, localDate: string) {
  if (!trackerId || trackerId.includes('/') || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) throw new Error('Invalid tracker or date.');
  return `${trackerId}_${localDate}`;
}

export function patientAge(birthdate: string | undefined, today = new Date()): number | null {
  if (!birthdate || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  const date = new Date(`${birthdate}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || date > today) return null;
  const [year, month, day] = birthdate.split('-').map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return today.getFullYear() - year - Number(today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day));
}

export function patientValues(input: PatientFields): PatientFields {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new Error('Enter a patient name of up to 100 characters.');
  if (input.birthdate && patientAge(input.birthdate) === null) throw new Error('Enter a valid birthdate that is not in the future.');
  if (input.sex && !['Female', 'Male', 'Intersex', 'Unknown', 'Prefer not to say'].includes(input.sex)) throw new Error('Choose a listed sex option.');
  if (input.autismLevel && !['Level 1', 'Level 2', 'Level 3', 'Unknown'].includes(input.autismLevel)) throw new Error('Choose a listed support level.');
  if ((input.ethnicity?.trim().length ?? 0) > 100 || (input.supportNeeds?.trim().length ?? 0) > 1000) throw new Error('Shorten the optional profile details.');
  return {
    name,
    ...(input.birthdate ? { birthdate: input.birthdate } : {}),
    ...(input.sex ? { sex: input.sex } : {}),
    ...(input.ethnicity?.trim() ? { ethnicity: input.ethnicity.trim() } : {}),
    ...(input.autismLevel ? { autismLevel: input.autismLevel } : {}),
    ...(input.supportNeeds?.trim() ? { supportNeeds: input.supportNeeds.trim() } : {}),
  };
}
