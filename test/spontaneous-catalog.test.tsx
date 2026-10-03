import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { spontaneousRepeatKey } from '../lib/maymay-schema';
import { useSpontaneousCatalog } from '../hooks/use-spontaneous-catalog';

const fake = vi.hoisted(() => ({ documents: new Map<string, Record<string, unknown>[]>(), paths: [] as string[] }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  orderBy: (field: string, direction: string) => ({ type: 'orderBy', field, direction }),
  limit: (count: number) => ({ type: 'limit', count }),
  startAfter: (cursor: unknown) => ({ type: 'startAfter', cursor }),
  where: (field: string, operator: string, value: string) => ({ type: 'where', field, operator, value }),
  query: (ref: { path: string }, ...constraints: Record<string, unknown>[]) => ({ ...ref, constraints }),
  getDocsFromServer: async (request: { path: string; constraints: Record<string, unknown>[] }) => {
    fake.paths.push(request.path);
    let items = fake.documents.get(request.path) ?? [];
    const filter = request.constraints.find(item => item.type === 'where');
    if (filter) items = items.filter(item => item[String(filter.field)] === filter.value);
    const max = request.constraints.find(item => item.type === 'limit');
    if (max) items = items.slice(0, Number(max.count));
    return { docs: items.map((item, index) => ({ id: String(index), data: () => item })) };
  },
}));

function connection(patientId: string) {
  return { app: { options: { projectId: 'demo-test' } }, db: {}, dataGeneration: 'generation-1',
    user: { uid: 'alice' }, profile: { familyId: 'family-a' }, patientId: patientId } as unknown as FirebaseConnection;
}
const key = spontaneousRepeatKey('good', 'Calm bedtime');
const occurrence = (id: string, deletedAt: string | null = null) => ({
  observationId: id, localDate: '2026-10-01', occurredAt: '2026-10-01T18:00:00Z',
  kind: 'good', trackerId: null, title: 'Calm bedtime', note: 'Private note', details: {}, repeatKey: key,
  deletedAt,
});
const path = (patient: string) => `families/family-a/patients/${patient}/observations`;

beforeEach(() => { fake.documents.clear(); fake.paths.length = 0; });
afterEach(() => cleanup());

describe('spontaneous event catalog', () => {
  it('counts only nondeleted matching occurrences in one patient and refreshes after a save', async () => {
    fake.documents.set(path('patient-a'), [occurrence('one'), occurrence('two'), occurrence('three'), occurrence('deleted', 'yesterday')]);
    const event = { id: 'today', date: '2026-10-03', kind: 'good' as const,
      title: 'Calm bedtime', note: '', time: '18:00' };
    const first = connection('patient-a');
    const { result, rerender } = renderHook(({ status }) => useSpontaneousCatalog(first, [event], status),
      { initialProps: { status: 'saved' } });
    await waitFor(() => expect(result.current.counts[key]).toBe(3));
    expect(result.current.previous).toHaveLength(1);
    fake.documents.set(path('patient-a'), [...fake.documents.get(path('patient-a'))!, occurrence('four')]);
    rerender({ status: 'saving' });
    rerender({ status: 'saved' });
    await waitFor(() => expect(result.current.counts[key]).toBe(4));
    expect(fake.paths.every(item => item === path('patient-a'))).toBe(true);
  });

  it('does not show another patient’s prior events when the context changes', async () => {
    fake.documents.set(path('patient-a'), [occurrence('one')]);
    fake.documents.set(path('patient-b'), [{ ...occurrence('other'), title: 'Different event', repeatKey: 'other:different event' }]);
    const first = connection('patient-a');
    const second = connection('patient-b');
    const { result, rerender } = renderHook(({ selected }) => useSpontaneousCatalog(selected, [], 'saved'),
      { initialProps: { selected: first } });
    await waitFor(() => expect(result.current.previous[0]?.title).toBe('Calm bedtime'));
    rerender({ selected: second });
    await waitFor(() => expect(result.current.previous[0]?.title).toBe('Different event'));
    expect(result.current.previous).toHaveLength(1);
  });
});
