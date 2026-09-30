import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import { CareSyncSession, type CareSyncState } from '@/lib/maymay-sync-session';
import { careStorageScope, loadPendingMutations } from '@/lib/maymay-sync-storage';
import { mutationsForEdit, SaveConflict, type EventMutation } from '@/lib/maymay-sync-model';
import { emptyEntry } from '@/lib/maymay-types';
import { entriesFromEvents, type EventRecord } from '@/lib/maymay-events';

const mocks = vi.hoisted(() => ({
  receive: null as null | ((records: EventRecord[]) => void),
  records: [] as EventRecord[], commit: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock('@/lib/maymay-sync-firebase', () => ({
  watchCareEvents: (_connection: unknown, receive: (records: EventRecord[]) => void) => {
    mocks.receive = receive; receive(mocks.records); return mocks.unsubscribe;
  },
  commitEventMutations: (...args: unknown[]) => mocks.commit(...args),
}));
const day = '2026-09-30';
function connection(uid = 'alice', familyId = 'maymay', childId = 'maymay', projectId = 'demo-test'): FirebaseConnection {
  return { app: { options: { projectId } }, db: {}, user: { uid }, profile: { familyId, role: 'caregiver', active: true }, childId } as FirebaseConnection;
}
let sessions: CareSyncSession[];
function start(conn = connection()) {
  let state: CareSyncState;
  const session = new CareSyncSession(conn, next => { state = next; });
  sessions.push(session); session.start();
  return { session, state: () => state! };
}
function result(group: EventMutation[]): EventRecord {
  const last = group.at(-1)!;
  const value = last.after ?? mocks.records.find(record => record.id === last.eventId)!;
  const revision = (mocks.records.find(record => record.id === last.eventId)?.revision ?? 0) + 1;
  const record = { ...value, localDate: day, revision, updatedAt: '2026-09-30T12:00:00Z', deletedAt: last.after ? null : 'deleted' };
  mocks.records = [...mocks.records.filter(item => item.id !== last.eventId), record];
  return record;
}
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); sessions = [];
  mocks.records = []; mocks.receive = null; mocks.commit.mockReset(); mocks.unsubscribe.mockReset();
  mocks.commit.mockImplementation(async (_connection, group) => result(group));
});
afterEach(() => {
  sessions.forEach(session => session.dispose());
  vi.useRealTimers(); localStorage.clear();
});

describe('durable caregiver edits', () => {
  it('queues only the changed event, not untouched defaults or other caregivers’ events', () => {
    const before = emptyEntry(day);
    before.meltdowns = [{ id: 'someone-else', time: '10:00', notes: 'Existing', duration: '', intensity: '', trigger: '', triggerOther: '', earlySigns: '', aggression: '', whatHelped: '' }];
    const after = structuredClone(before); after.meals.breakfast = 'Ate well';
    const mutations = mutationsForEdit(before, after, [], []);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].eventId).toBe(`${day}_meal_breakfast`);
  });

  it('edits and removes legacy documents by their actual IDs without creating duplicates', () => {
    const records: EventRecord[] = [{ id: 'legacy-random-id', type: 'meltdown', localDate: day,
      revision: 0, updatedAt: 'legacy-time', occurredAt: `${day}T10:00:00Z`, deletedAt: null,
      data: { notes: 'Existing observation', intensity: 'Mild' } }];
    const before = entriesFromEvents(records)[0];
    const edited = structuredClone(before); edited.meltdowns[0].notes = 'Corrected observation';
    const edits = mutationsForEdit(before, edited, records, []);
    expect(edits).toHaveLength(1);
    expect(edits[0].eventId).toBe('legacy-random-id');
    expect(edits[0].after?.id).toBe('legacy-random-id');
    const deleted = mutationsForEdit(before, { ...before, meltdowns: [] }, records, []);
    expect(deleted[0]).toMatchObject({ eventId: 'legacy-random-id', after: null, expected: { revision: 0, updatedAt: 'legacy-time' } });
  });

  it('preserves failed saves across a restart and retries them instead of declaring success', async () => {
    mocks.commit.mockRejectedValue(new Error('Offline'));
    const first = start();
    first.session.edit({ ...emptyEntry(day), notes: 'Unsent test note' });
    await vi.advanceTimersByTimeAsync(500);
    expect(first.state().status).toBe('error');
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(1);
    first.session.dispose();
    mocks.commit.mockImplementation(async (_connection, group) => result(group));
    const restored = start();
    expect(restored.state().entries[0].notes).toBe('Unsent test note');
    await vi.advanceTimersByTimeAsync(500);
    expect(restored.state().status).toBe('saved');
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(0);
  });

  it('keeps edits typed during an in-flight save and chains them to that save', async () => {
    let finish!: (value: EventRecord) => void;
    mocks.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = start();
    view.session.edit({ ...emptyEntry(day), notes: 'First' });
    await vi.advanceTimersByTimeAsync(500);
    const firstGroup = mocks.commit.mock.calls[0][1] as EventMutation[];
    view.session.edit({ ...view.state().entries[0], notes: 'First and second' });
    finish(result(firstGroup));
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
    const secondGroup = mocks.commit.mock.calls[1][1] as EventMutation[];
    expect(secondGroup[0].predecessor).toBe(firstGroup[0].id);
    expect(view.state().entries[0].notes).toBe('First and second');
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(0);
  });

  it('retains both versions of a conflict, saves unrelated edits, and resolves only the chosen event', async () => {
    const remote: EventRecord = { id: `${day}_note`, type: 'note', localDate: day, revision: 2, updatedAt: 'now', occurredAt: `${day}T12:00:00Z`, deletedAt: null, data: { text: 'Someone else’s note' } };
    mocks.commit.mockImplementation(async (_connection, group: EventMutation[]) => {
      if (group[0].eventId === remote.id) throw new SaveConflict(remote.id, remote);
      return result(group);
    });
    const view = start();
    const edit = emptyEntry(day); edit.notes = 'My draft'; edit.meals.breakfast = 'Ate well';
    view.session.edit(edit);
    await vi.advanceTimersByTimeAsync(500);
    expect(view.state().conflicts).toEqual([{ eventId: remote.id, date: day, local: { text: 'My draft' }, remote: { text: 'Someone else’s note' } }]);
    expect(view.state().entries[0].meals.breakfast).toBe('Ate well');
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(1);
    view.session.useSaved(remote.id);
    expect(view.state().entries[0].notes).toBe('Someone else’s note');
    expect(view.state().conflicts).toHaveLength(0);
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(0);
  });

  it('never uploads an unscoped legacy cache or another account, family, person, or project’s draft', async () => {
    localStorage.setItem('maymay.entries.v3', JSON.stringify([{ ...emptyEntry(day), notes: 'Legacy data' }]));
    const first = start();
    first.session.edit({ ...emptyEntry(day), notes: 'Alice only' });
    first.session.dispose();
    for (const conn of [connection('bob'), connection('alice', 'other'), connection('alice', 'maymay', 'other'), connection('alice', 'maymay', 'maymay', 'other')]) {
      const other = start(conn);
      expect(other.state().entries).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(500);
      other.session.dispose();
    }
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(localStorage.getItem('maymay.entries.v3')).toContain('Legacy data');
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(1);
  });

  it('rebases a chosen draft against the displayed conflict, not a newer unseen live update', async () => {
    const remote: EventRecord = { id: `${day}_note`, type: 'note', localDate: day, revision: 2, updatedAt: 'then', occurredAt: `${day}T12:00:00Z`, deletedAt: null, data: { text: 'Shared' } };
    mocks.commit.mockRejectedValue(new SaveConflict(remote.id, remote));
    const view = start();
    view.session.edit({ ...emptyEntry(day), notes: 'Chosen draft' });
    await vi.advanceTimersByTimeAsync(500);
    mocks.receive?.([{ ...remote, revision: 3, data: { text: 'Even newer' } }]);
    view.session.useMyEdit(remote.id);
    const pending = loadPendingMutations(careStorageScope(connection()));
    expect(pending).toHaveLength(1);
    expect(pending[0].expected?.revision).toBe(2);
    expect(pending[0].after?.data.text).toBe('Chosen draft');
    expect(pending[0].predecessor).toBeNull();
  });

  it('does not continue the queue after sign-out during a save', async () => {
    let finish!: (value: EventRecord) => void;
    mocks.commit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = start();
    const edit = emptyEntry(day); edit.notes = 'Note'; edit.meals.breakfast = 'Ate well';
    view.session.edit(edit);
    await vi.advanceTimersByTimeAsync(500);
    const group = mocks.commit.mock.calls[0][1];
    view.session.dispose();
    finish(result(group));
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(loadPendingMutations(careStorageScope(connection()))).toHaveLength(1);
  });

  it('does not lose a local draft when a live update arrives', () => {
    const view = start();
    view.session.edit({ ...emptyEntry(day), notes: 'Draft' });
    mocks.receive?.([{ id: `${day}_meal_lunch`, type: 'meal', localDate: day, occurredAt: `${day}T12:00:00Z`, data: { meal: 'lunch', outcome: 'Ate some' }, revision: 1, updatedAt: 'now', deletedAt: null }]);
    expect(view.state().entries[0].notes).toBe('Draft');
    expect(view.state().entries[0].meals.lunch).toBe('Ate some');
  });

  it('reports a failed local write and does not claim the edit was saved', () => {
    const view = start();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    view.session.edit({ ...emptyEntry(day), notes: 'Not persisted' });
    expect(view.state().message).toContain('could not save');
    expect(view.state().entries).toHaveLength(0);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('preserves a malformed local queue and stops instead of silently discarding it', () => {
    const key = careStorageScope(connection()) + '.pending.broken';
    localStorage.setItem(key, '{"id":"broken"}');
    const view = start();
    expect(view.state().status).toBe('error');
    expect(view.state().message).toContain('preserved');
    expect(localStorage.getItem(key)).toBe('{"id":"broken"}');
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
