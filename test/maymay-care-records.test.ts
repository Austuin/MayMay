import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { CareConflict, commitCareMutation, type CareMutation, type ObservationDraft } from '../lib/maymay-care-records';
import { dailyObservationId, type TrackerDefinition } from '../lib/maymay-schema';

const fake = vi.hoisted(() => ({ documents: new Map<string, Record<string, unknown>>() }));
vi.mock('firebase/firestore', () => {
  const path = (base: string | { path: string }, ...segments: string[]) =>
    [typeof base === 'string' ? base : base.path, ...segments].filter(Boolean).join('/');
  const reference = (value: string) => ({ path: value, id: value.split('/').at(-1) });
  return {
    collection: (base: string | { path?: string }, ...segments: string[]) => reference(path(typeof base === 'string' ? base : base.path ?? '', ...segments)),
    doc: (base: string | { path?: string }, ...segments: string[]) => reference(path(typeof base === 'string' ? base : base.path ?? '', ...segments)),
    serverTimestamp: () => ({ toDate: () => new Date('2026-10-03T12:00:00Z') }),
    Timestamp: { fromDate: (date: Date) => ({ toDate: () => date }) },
    runTransaction: async (_db: unknown, execute: (transaction: unknown) => Promise<unknown>) => execute({
      get: async (ref: { path: string; id: string }) => {
        const data = fake.documents.get(ref.path);
        return { id: ref.id, exists: () => Boolean(data), data: () => data };
      },
      set: (ref: { path: string }, data: Record<string, unknown>) => fake.documents.set(ref.path, data),
    }),
  };
});

function connection(uid: string) {
  return { db: {}, user: { uid }, dataGeneration: 'generation-1', childId: 'patient-a',
    profile: { familyId: 'family-a', role: 'caregiver' } } as unknown as FirebaseConnection;
}
const date = '2026-10-03';
const trackerId = 'school';
const id = dailyObservationId(trackerId, date);
const draft = (value: boolean): ObservationDraft => ({ localDate: date,
  occurredAt: '2026-10-03T12:00:00Z', kind: 'answer', trackerId,
  trackerSnapshot: { title: 'School on time', description: 'Did they arrive on time?', kind: 'good' },
  value, title: 'School on time', note: '', details: {} });
const mutation = (uid: string, value: boolean | null, expectedRevision: number | null, recordId = id): CareMutation => ({
  id: `${uid}-${recordId}-${value}-${expectedRevision}`, target: 'observation', recordId,
  expectedRevision, predecessor: null, queuedAt: Date.now(), after: value === null ? null : draft(value),
});
const recordPath = `families/family-a/patients/patient-a/observations/${id}`;

beforeEach(() => fake.documents.clear());

describe('Observation saves with isolated Firestore transactions', () => {
  it('keeps No distinct from unanswered, preserves the first tracker snapshot, and rejects stale edits', async () => {
    const first = mutation('alice', false, null);
    await commitCareMutation(connection('alice'), first);
    expect(fake.documents.get(recordPath)).toMatchObject({ value: false, revision: 1, trackerSnapshot: draft(false).trackerSnapshot });
    const changed = mutation('bob', true, 1);
    changed.after = { ...draft(true), trackerSnapshot: { title: 'Renamed', description: 'New description', kind: 'good' } };
    await commitCareMutation(connection('bob'), changed);
    expect(fake.documents.get(recordPath)).toMatchObject({ value: true, revision: 2, trackerSnapshot: draft(false).trackerSnapshot });
    await expect(commitCareMutation(connection('alice'), mutation('alice', false, 1))).rejects.toBeInstanceOf(CareConflict);
    await commitCareMutation(connection('bob'), changed);
    expect(fake.documents.get(recordPath)?.revision).toBe(2);
  });

  it('soft deletes only the selected answer and prevents an old device from restoring it', async () => {
    await commitCareMutation(connection('alice'), mutation('alice', false, null));
    const other = dailyObservationId('bowel', date);
    await commitCareMutation(connection('bob'), mutation('bob', true, null, other));
    const remove = mutation('alice', null, 1);
    await commitCareMutation(connection('alice'), remove);
    expect(fake.documents.get(recordPath)).toMatchObject({ revision: 2, value: false });
    expect(fake.documents.get(recordPath)?.deletedAt).toBeTruthy();
    expect(fake.documents.get(`families/family-a/patients/patient-a/observations/${other}`)?.deletedAt).toBeNull();
    await expect(commitCareMutation(connection('bob'), mutation('bob', true, 1))).rejects.toBeInstanceOf(CareConflict);
    await commitCareMutation(connection('alice'), remove);
    expect(fake.documents.get(recordPath)?.revision).toBe(2);
  });

  it('denies a viewer even when they know the record ID', async () => {
    const viewer = connection('viewer');
    viewer.profile.role = 'viewer';
    await expect(commitCareMutation(viewer, mutation('viewer', true, null))).rejects.toThrow(/cannot change/);
    expect(fake.documents.size).toBe(0);
  });

  it('soft deletes a tracker and rejects stale edits or type changes', async () => {
    const create: CareMutation = { id: 'tracker-create', target: 'tracker', recordId: 'school',
      expectedRevision: null, predecessor: null, queuedAt: 1,
      after: { title: 'School on time', description: 'Did they arrive on time?', kind: 'good', days: [1, 2, 3, 4, 5] } };
    await commitCareMutation(connection('alice'), create);
    const ref = 'families/family-a/patients/patient-a/trackers/school';
    expect(fake.documents.get(ref)).toMatchObject({ revision: 1, deletedAt: null });
    await expect(commitCareMutation(connection('bob'), { ...create, id: 'change-type', expectedRevision: 1,
      after: { ...create.after as TrackerDefinition, kind: 'count' } })).rejects.toThrow(/type cannot change/);
    const remove: CareMutation = { ...create, id: 'tracker-remove', expectedRevision: 1, after: null };
    await commitCareMutation(connection('alice'), remove);
    expect(fake.documents.get(ref)?.deletedAt).toBeTruthy();
    await expect(commitCareMutation(connection('bob'), { ...create, id: 'stale-tracker', expectedRevision: 1 })).rejects.toBeInstanceOf(CareConflict);
  });
});
