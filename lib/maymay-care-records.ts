import { collection, doc, runTransaction, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import type { FirebaseConnection } from './maymay-firebase';
import { collections, type MeltdownDetails, type ObservationRecord, type TrackerAnswer, type TrackerDefinition, type TrackerRecord } from './maymay-schema';

export type CareRecord = TrackerRecord | ObservationRecord;
export type ObservationDraft = {
  localDate: string; occurredAt: string; kind: ObservationRecord['kind'];
  trackerId: string | null; trackerSnapshot: ObservationRecord['trackerSnapshot'];
  value: TrackerAnswer | null; title: string; note: string; details: MeltdownDetails;
};
export type CareMutation = {
  id: string; target: 'tracker' | 'observation'; recordId: string;
  expectedRevision: number | null; predecessor: string | null; queuedAt: number;
  after: TrackerDefinition | ObservationDraft | null;
};

export class CareConflict extends Error {
  constructor(public mutation: CareMutation, public remote: CareRecord | null) {
    super('Another caregiver changed this record. Choose which version to use.');
    this.name = 'CareConflict';
  }
}

export function careCollection(db: Firestore, familyId: string, patientId: string, target: CareMutation['target']) {
  return collection(db, collections.families, familyId, collections.patients, patientId,
    target === 'tracker' ? collections.trackers : collections.observations);
}

function iso(value: unknown): string {
  if (typeof value === 'string') return value;
  return (value as { toDate?: () => Date })?.toDate?.().toISOString() ?? '';
}

export function trackerFromDocument(data: Record<string, unknown>): TrackerRecord {
  return { ...data, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), deletedAt: data.deletedAt ? iso(data.deletedAt) || 'pending' : null } as TrackerRecord;
}
export function observationFromDocument(data: Record<string, unknown>): ObservationRecord {
  return { ...data, createdAt: iso(data.createdAt), updatedAt: iso(data.updatedAt), occurredAt: iso(data.occurredAt),
    deletedAt: data.deletedAt ? iso(data.deletedAt) || 'pending' : null } as ObservationRecord;
}

/** The expected revision is fixed when the edit is made, including across transaction retries. */
export async function commitCareMutation(connection: FirebaseConnection, mutation: CareMutation): Promise<CareRecord> {
  if (!['master', 'caregiver'].includes(connection.profile.role) || !connection.childId) throw new Error('This account cannot change care records.');
  const ref = doc(careCollection(connection.db, connection.profile.familyId, connection.childId, mutation.target), mutation.recordId);
  const receiptRef = doc(ref, 'mutations', mutation.id);
  return runTransaction(connection.db, async transaction => {
    const receipt = await transaction.get(receiptRef);
    const snapshot = await transaction.get(ref);
    const raw = snapshot.exists() ? snapshot.data() : null;
    const current = raw ? mutation.target === 'tracker' ? trackerFromDocument(raw) : observationFromDocument(raw) : null;
    if (receipt.exists()) {
      if (!current) throw new Error('A saved record is unavailable.');
      return current;
    }
    const predecessor = mutation.predecessor
      ? await transaction.get(doc(ref, 'mutations', mutation.predecessor)) : null;
    const matches = mutation.predecessor
      ? predecessor?.exists() && predecessor.data().createdBy === connection.user.uid && predecessor.data().revision === current?.revision
      : current?.revision === (mutation.expectedRevision ?? undefined)
        || (current === null && mutation.expectedRevision === null);
    if (!matches) throw new CareConflict(mutation, current);
    if (!raw && !mutation.after) throw new Error('There is no saved record to remove.');
    if (raw?.deletedAt && mutation.target === 'tracker') throw new CareConflict(mutation, current);
    const revision = (current?.revision ?? 0) + 1;
    const audit = {
      familyId: connection.profile.familyId, patientId: connection.childId,
      dataGeneration: connection.dataGeneration, updatedBy: connection.user.uid,
      updatedAt: serverTimestamp(), revision, mutationId: mutation.id,
      ...(!raw ? { createdBy: connection.user.uid, createdAt: serverTimestamp() } : {}),
    };
    let payload: Record<string, unknown>;
    if (mutation.target === 'tracker') {
      const after = mutation.after as TrackerDefinition | null;
      if (raw && after && after.kind !== raw.kind) throw new Error('Tracker type cannot change.');
      payload = { ...(raw ?? {}), ...audit, trackerId: mutation.recordId,
        ...(after ?? {}), deletedAt: after ? null : serverTimestamp() };
    } else {
      const after = mutation.after as ObservationDraft | null;
      if (raw && after && (after.localDate !== raw.localDate || after.kind !== raw.kind || after.trackerId !== raw.trackerId)) {
        throw new Error('The observation date and type cannot change.');
      }
      payload = { ...(raw ?? {}), ...audit, observationId: mutation.recordId,
        ...(after ? { ...after, occurredAt: Timestamp.fromDate(new Date(after.occurredAt)),
          trackerSnapshot: raw?.trackerSnapshot ?? after.trackerSnapshot } : {}),
        deletedAt: after ? null : serverTimestamp() };
    }
    transaction.set(ref, payload);
    transaction.set(receiptRef, { revision, createdBy: connection.user.uid, createdAt: serverTimestamp() });
    return mutation.target === 'tracker' ? trackerFromDocument(payload) : observationFromDocument(payload);
  });
}
