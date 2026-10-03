import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { CareRecordSession, careScope, type CareView } from '../lib/maymay-care-session';

const fake = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(), stops: [] as ReturnType<typeof vi.fn>[],
  commits: [] as string[],
}));
vi.mock('firebase/firestore', () => ({
  where: (_field: string, _operator: string, value: string) => ({ date: value }),
  query: (ref: { target: string }, filter: { date: string }) => ({ ...ref, ...filter }),
  onSnapshot: (ref: { target: string; date?: string }, _options: unknown, receive: (snapshot: unknown) => void) => {
    receive({ metadata: { fromCache: false, hasPendingWrites: false }, docs: [...fake.records.values()]
      .filter(item => ref.target === 'tracker' ? item.trackerId : item.observationId && item.localDate === ref.date)
      .map(item => ({ data: () => item })) });
    const stop = vi.fn(); fake.stops.push(stop); return stop;
  },
}));
vi.mock('../lib/maymay-care-records', () => ({
  CareConflict: class CareConflict extends Error {},
  careCollection: (_db: unknown, _family: string, _patient: string, target: string) => ({ target }),
  trackerFromDocument: (item: Record<string, unknown>) => item,
  observationFromDocument: (item: Record<string, unknown>) => item,
  commitCareMutation: async (_connection: unknown, mutation: { target: string; recordId: string; id: string; after: Record<string, unknown> | null }) => {
    fake.commits.push(mutation.recordId);
    const old = fake.records.get(mutation.recordId);
    const record = { ...old, ...mutation.after, [mutation.target === 'tracker' ? 'trackerId' : 'observationId']: mutation.recordId,
      revision: Number(old?.revision ?? 0) + 1, deletedAt: mutation.after ? null : 'deleted' };
    fake.records.set(mutation.recordId, record);
    return record;
  },
}));

const connection = { app: { options: { projectId: 'demo-test' } }, db: {},
  dataGeneration: 'generation-1', user: { uid: 'alice' }, patientId: 'patient-a',
  profile: { familyId: 'family-a', role: 'caregiver' },
} as unknown as FirebaseConnection;
const date = '2026-10-03';

beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); fake.records.clear(); fake.stops.length = 0; fake.commits.length = 0;
  fake.records.set('school', { trackerId: 'school', title: 'School on time', description: 'Did they arrive on time?',
    kind: 'good', days: [0, 1, 2, 3, 4, 5, 6], revision: 1, deletedAt: null });
});
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('durable patient-scoped care drafts', () => {
  it('projects the original snapshot of an answer after its tracker is deleted', async () => {
    fake.records.set('school', { ...fake.records.get('school'), title: 'Renamed later', deletedAt: 'deleted' });
    fake.records.set(`school_${date}`, { observationId: `school_${date}`, localDate: date, kind: 'answer',
      trackerId: 'school', trackerSnapshot: { title: 'School on time', description: 'Did they arrive on time?', kind: 'good' },
      value: false, revision: 1, deletedAt: null });
    let view: CareView | undefined;
    const session = new CareRecordSession(connection, date, next => { view = next; });
    session.start();
    expect(view?.data.historicalTrackers).toMatchObject([{ id: 'school', title: 'School on time' }]);
    expect(view?.data.answers[date].school).toBe(false);
    session.edit(current => ({ ...current, answers: { [date]: {} } }));
    await vi.advanceTimersByTimeAsync(400);
    expect(fake.records.get(`school_${date}`)?.deletedAt).toBe('deleted');
    session.dispose();
  });

  it('keeps an unanswered value empty, saves No, reloads it, and soft deletes it', async () => {
    let view: CareView | undefined;
    let session = new CareRecordSession(connection, date, next => { view = next; });
    session.start();
    expect(view?.data.answers[date]).toBeUndefined();
    session.edit(current => ({ ...current, answers: { [date]: { school: false } } }));
    expect(view?.data.answers[date].school).toBe(false);
    expect(localStorage.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(view?.status).toBe('saved');
    expect(fake.records.get(`school_${date}`)?.value).toBe(false);
    session.dispose();
    expect(fake.stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    session = new CareRecordSession(connection, date, next => { view = next; });
    session.start();
    expect(view?.data.answers[date].school).toBe(false);
    session.edit(current => ({ ...current, answers: { [date]: {} } }));
    await vi.advanceTimersByTimeAsync(400);
    expect(view?.data.answers[date]).toBeUndefined();
    expect(fake.records.get(`school_${date}`)?.deletedAt).toBe('deleted');
    session.dispose();
  });

  it('restores a pending draft after reload within the same scope without importing another patient', async () => {
    let view: CareView | undefined;
    const first = new CareRecordSession(connection, date, next => { view = next; });
    first.start();
    first.edit(current => ({ ...current, answers: { [date]: { school: true } } }));
    first.dispose();
    const second = new CareRecordSession(connection, date, next => { view = next; });
    second.start();
    expect(view?.data.answers[date].school).toBe(true);
    expect(view?.status).toBe('pending');
    const other = { ...connection, patientId: 'patient-b' };
    expect(careScope(other)).not.toBe(careScope(connection));
    const third = new CareRecordSession(other, date, next => { view = next; });
    third.start();
    expect(view?.data.answers[date]).toBeUndefined();
    second.dispose(); third.dispose();
  });
});
