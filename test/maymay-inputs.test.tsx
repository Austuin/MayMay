import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import { createMeltdown, createPossibleTrigger } from '@/lib/maymay-types';

const mocks = vi.hoisted(() => {
  const makeConnection = () => {
    const patient = { patientId: 'sam', familyId: 'family-a', name: 'Sam' };
    return {
      app: { options: { projectId: 'demo-test' } }, db: {},
      user: { uid: 'caregiver', email: 'caregiver@example.test', displayName: 'Caregiver' },
      profile: { familyId: 'family-a', role: 'caregiver', active: true },
      childId: 'sam', patient, requests: [],
      families: [{ familyId: 'family-a', name: 'Family A', role: 'Caregiver', patients: [patient] }],
    };
  };
  return { makeConnection, connection: makeConnection(), save: vi.fn() };
});
vi.mock('@/lib/maymay-firebase', () => ({
  loadRuntimeConfig: async () => ({ firebase: { projectId: 'demo-test' } }),
  restoreFirebase: async () => mocks.connection,
  connectFirebase: async () => mocks.connection,
  disconnectFirebase: async () => undefined,
  selectFamilyPatient: (current: typeof mocks.connection, familyId: string, patientId: string) => {
    const patient = current.families.find(family => family.familyId === familyId)!.patients.find(item => item.patientId === patientId)!;
    return { ...current, childId: patientId, patient };
  },
}));
vi.mock('@/hooks/use-care-sync', () => ({
  useCareSync: () => ({ entries: [], status: 'saved', message: '', conflicts: [], getEntries: () => [], replaceEntry: mocks.save, stop: vi.fn() }),
}));
vi.mock('@/hooks/use-care-records', () => ({
  useCareRecords: () => ({
    data: { trackers: [{ id: 'mood', title: 'Morning Mood', description: 'How was the morning?', kind: 'mood', days: [0, 1, 2, 3, 4, 5, 6] }], answers: {}, spontaneous: [] },
    status: 'saved', message: 'Saved', conflicts: [], change: mocks.save, retry: vi.fn(), choose: vi.fn(),
  }),
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
    expect(createPossibleTrigger().id).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
    expect(createMeltdown().id).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('creates distinct event IDs on an HTTP LAN address without randomUUID', () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      randomUUID: () => { throw new DOMException('Not available'); },
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
    } });
    const ids = [createPossibleTrigger().id, createMeltdown().id];
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
});
