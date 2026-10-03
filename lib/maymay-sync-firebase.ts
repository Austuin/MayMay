import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import type { FirebaseConnection } from './maymay-firebase';
import { historyCutoffDate } from './maymay-types';
import type { EventRecord } from './maymay-events';
import { matchesExpected, SaveConflict, type EventMutation } from './maymay-sync-model';

function events(connection: FirebaseConnection) {
  return collection(connection.db, 'families', connection.profile.familyId, 'patients', connection.childId, 'events');
}

function iso(value: unknown) {
  return (value as { toDate?: () => Date })?.toDate?.().toISOString() ?? '';
}

export function recordFromDocument(id: string, data: Record<string, unknown>): EventRecord {
  return {
    id, type: String(data.type), localDate: String(data.localDate),
    occurredAt: iso(data.occurredAt), data: (data.data ?? {}) as Record<string, unknown>,
    revision: typeof data.revision === 'number' ? data.revision : 0,
    updatedAt: iso(data.updatedAt), deletedAt: data.deletedAt ? iso(data.deletedAt) || 'deleted' : null,
  };
}

export function watchCareEvents(connection: FirebaseConnection, receive: (events: EventRecord[]) => void, fail: (error: Error) => void) {
  return onSnapshot(query(events(connection), where('localDate', '>=', historyCutoffDate())), { includeMetadataChanges: true }, snapshot => {
    // Do not turn a partial SDK cache into the baseline for edits or display it as synced.
    if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
      receive(snapshot.docs.map(item => recordFromDocument(item.id, item.data())));
    }
  }, fail);
}

/** Consecutive keystrokes for one event share a commit, but each intent gets a durable receipt. */
export async function commitEventMutations(connection: FirebaseConnection, group: EventMutation[]): Promise<EventRecord | null> {
  if (!['master', 'caregiver'].includes(connection.profile.role)) throw new Error('This account cannot change care records.');
  if (!group.length || group.length > 100 || group.some(item => item.eventId !== group[0].eventId || item.localDate !== group[0].localDate)) {
    throw new Error('Invalid event save.');
  }
  const eventRef = doc(events(connection), group[0].eventId);
  return runTransaction(connection.db, async transaction => {
    const receipts = await Promise.all(group.map(item => transaction.get(doc(eventRef, 'mutations', item.id))));
    const snapshot = await transaction.get(eventRef);
    const raw = snapshot.exists() ? snapshot.data() : null;
    const current = raw ? recordFromDocument(snapshot.id, raw) : null;
    const remaining = group.filter((_, index) => !receipts[index].exists());
    if (!remaining.length) return current; // Acknowledgement lost, or another tab already sent it.
    const first = remaining[0];
    const last = remaining[remaining.length - 1];
    const predecessor = first.predecessor
      ? await transaction.get(doc(eventRef, 'mutations', first.predecessor)) : null;
    const followsOwnSave = predecessor?.exists()
      && predecessor.data().createdBy === connection.user.uid
      && predecessor.data().revision === current?.revision;
    if (first.predecessor ? !followsOwnSave : !matchesExpected(current, first.expected)) {
      throw new SaveConflict(first.eventId, current);
    }
    for (let i = 1; i < remaining.length; i++) {
      if (remaining[i].predecessor !== remaining[i - 1].id) throw new SaveConflict(first.eventId, current);
    }
    const value = last.after ?? [...remaining].reverse().find(item => item.after)?.after ?? current;
    if (!value) throw new Error('Cannot remove an unknown event.');
    const revision = (current?.revision ?? 0) + 1;
    const payload = {
      ...(raw ?? {}), schemaVersion: 1, syncVersion: 2, revision,
      childId: connection.childId, localDate: first.localDate, type: value.type,
      occurredAt: Timestamp.fromDate(new Date(value.occurredAt)),
      data: { ...(raw?.data as Record<string, unknown> ?? {}), ...value.data },
      updatedAt: serverTimestamp(), updatedBy: connection.user.uid,
      mutationId: last.id, deletedAt: last.after ? null : serverTimestamp(),
      ...(!raw ? { createdBy: connection.user.uid, createdAt: serverTimestamp() } : {}),
    };
    transaction.set(eventRef, payload);
    for (const mutation of remaining) {
      transaction.set(doc(eventRef, 'mutations', mutation.id), {
        commitId: last.id, revision, createdBy: connection.user.uid, createdAt: serverTimestamp(),
      });
    }
    // The listener will supply server timestamps. Revision is sufficient for chained queued edits.
    return { ...value, data: payload.data, localDate: first.localDate, revision,
      updatedAt: '', deletedAt: last.after ? null : 'deleted' };
  });
}
