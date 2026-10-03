import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import { createEventId } from '@/lib/maymay-types';

const mocks = vi.hoisted(() => {
  const makeConnection = () => {
    const patient = { patientId: 'sam', familyId: 'family-a', name: 'Sam' };
    return {
      app: { options: { projectId: 'demo-test' } }, db: {},
      accountName: 'Caregiver',
      user: { uid: 'caregiver', email: 'caregiver@example.test', displayName: 'Caregiver' },
      profile: { familyId: 'family-a', role: 'caregiver', active: true },
      patientId: 'sam', patient, requests: [],
      families: [{ familyId: 'family-a', name: 'Family A', role: 'Caregiver', patients: [patient] }],
    };
  };
  return { makeConnection, connection: makeConnection(), save: vi.fn() };
});
vi.mock('@/lib/maymay-firebase', () => ({
  watchFirebaseAccess: () => () => undefined,
  loadRuntimeConfig: async () => ({ firebase: { projectId: 'demo-test' } }),
  restoreFirebase: async () => mocks.connection,
  connectFirebase: async () => mocks.connection,
  disconnectFirebase: async () => undefined,
  selectFamilyPatient: (current: typeof mocks.connection, familyId: string, patientId: string) => {
    const patient = current.families.find(family => family.familyId === familyId)!.patients.find(item => item.patientId === patientId)!;
    return { ...current, patientId: patientId, patient };
  },
}));
vi.mock('@/hooks/use-care-records', () => ({
  useCareRecords: () => ({
    data: { trackers: [{ id: 'mood', title: 'Morning Mood', description: 'How was the morning?', kind: 'mood', days: [0, 1, 2, 3, 4, 5, 6] }], answers: {}, spontaneous: [] },
    status: 'saved', message: 'Saved', conflicts: [], change: mocks.save, retry: vi.fn(), choose: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-spontaneous-catalog', () => ({
  useSpontaneousCatalog: () => ({ previous: [], counts: {}, hasMore: false, loadMore: vi.fn() }),
}));
vi.mock('@/hooks/use-observation-history', () => ({
  useObservationHistory: () => ({ observations: [{ observationId: 'school_2026-10-01', localDate: '2026-10-01',
    kind: 'answer', trackerId: 'school', trackerSnapshot: { title: 'School on time', kind: 'good' },
    title: 'School on time', value: true, deletedAt: null }], windows: [{ start: '2026-07-04', end: '2026-10-01' }],
    loading: false, error: '', hasMore: false, loadMore: vi.fn(), refresh: vi.fn() }),
}));

const originalCrypto = globalThis.crypto;
beforeEach(() => { mocks.connection = mocks.makeConnection(); mocks.save.mockClear(); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => {
  cleanup(); localStorage.clear(); sessionStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
});

describe('MayMay Today inputs', () => {
  it('creates event IDs when Web Crypto is completely unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    expect(createEventId()).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
    expect(createEventId()).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('creates distinct event IDs on an HTTP LAN address without randomUUID', () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => { throw new DOMException('Not available'); },
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    } });
    const ids = [createEventId(), createEventId()];
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('shows the connected patient and recurring tracker', async () => {
    render(<HomePage />);
    await screen.findByLabelText('Morning Mood mood');
    expect(screen.getByText(/Sam ·/)).toBeTruthy();
    expect(screen.getByText('How was the morning?')).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('shows the same saved observation in History and Insights', async () => {
    render(<HomePage />);
    await screen.findByLabelText('Morning Mood mood');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('School on time')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Insights' }));
    expect(screen.getByText('1 Yes · 0 No')).toBeTruthy();
    expect(screen.getAllByText(/1 recorded day/).length).toBeGreaterThan(0);
  });
});
