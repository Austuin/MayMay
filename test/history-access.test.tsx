import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import { useObservationHistory } from '@/hooks/use-observation-history';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/maymay-observation-history', async importOriginal => ({ ...await importOriginal<object>(), readObservationWindow: read }));
const connection = (patientId: string) => ({ app: { options: { projectId: 'demo-test' } }, dataGeneration: 'one',
  user: { uid: 'alice' }, profile: { familyId: 'family' }, patientId } as FirebaseConnection);
afterEach(() => { cleanup(); read.mockReset(); localStorage.clear(); });
describe('history access changes', () => {
  it('clears previously visible history when refresh access is denied', async () => {
    read.mockResolvedValueOnce([{ observationId: 'private', localDate: '2026-10-03' }]);
    const selected = connection('a');
    const { result } = renderHook(() => useObservationHistory(selected, 'history'));
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    read.mockRejectedValueOnce(new Error('permission-denied'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe('permission-denied'));
    expect(result.current.observations).toEqual([]);
  });
  it('ignores an old patient’s in-flight pagination result after switching patient', async () => {
    read.mockResolvedValueOnce([{ observationId: 'private', localDate: '2026-10-03' }]);
    const { result, rerender } = renderHook(({ selected }) => useObservationHistory(selected, 'history'), { initialProps: { selected: connection('a') } });
    await waitFor(() => expect(result.current.observations).toHaveLength(1));
    let complete!: (records: unknown[]) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.loadMore(); });
    read.mockResolvedValueOnce([]);
    rerender({ selected: connection('b') });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { complete([{ observationId: 'old-private', localDate: '2026-06-03' }]); await pending; });
    expect(result.current.observations).toEqual([]);
  });
});
