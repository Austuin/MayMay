import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';
import { createMeltdown, createPossibleTrigger, localDateValue } from '@/lib/maymay-types';

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

  it('records and clears answers and spontaneous events, preserving drafts across dates and tabs without saving to Firebase', async () => {
    render(<HomePage />);
    await screen.findByText("Today's check-in");
    expect(screen.getByRole('note').textContent).toContain('session only');
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-09-28' } });
    expect(screen.getByText('0 of 3 answered')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Morning Mood mood'), { target: { value: 'Good' } });
    fireEvent.change(screen.getByLabelText('Bowel Movements count'), { target: { value: '0' } });
    const school = screen.getByText('Went to School on Time').closest('article')!;
    fireEvent.click(within(school).getByRole('button', { name: 'No' }));
    expect(screen.getByText('3 of 3 answered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add spontaneous event' }));
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Calm walk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Today' }));
    expect(screen.getByText('3 of 3 answered')).toBeTruthy();
    expect(screen.getByText('Calm walk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText('0 of 3 answered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('3 of 3 answered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Calm walk' }));
    expect(screen.queryByText('Calm walk')).toBeNull();
    fireEvent.change(screen.getByLabelText('Morning Mood mood'), { target: { value: '' } });
    screen.getAllByRole('button', { name: 'Clear answer' }).forEach(button => fireEvent.click(button));
    expect(screen.getByText('0 of 3 answered')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect((screen.getByLabelText('Entry date') as HTMLInputElement).value).toBe(localDateValue());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('separates patient drafts and clears them on sign-out', async () => {
    mocks.connection.families[0].patients.push({ patientId: 'taylor', familyId: 'family-a', name: 'Taylor' });
    render(<HomePage />);
    await screen.findByText("Today's check-in");
    fireEvent.change(screen.getByLabelText('Morning Mood mood'), { target: { value: 'Good' } });
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'taylor' } });
    expect((screen.getByLabelText('Morning Mood mood') as unknown as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Patient'), { target: { value: 'sam' } });
    expect((screen.getByLabelText('Morning Mood mood') as unknown as HTMLSelectElement).value).toBe('Good');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText('Sign in to continue');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'mock-password' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!);
    await screen.findByText("Today's check-in");
    expect((screen.getByLabelText('Morning Mood mood') as unknown as HTMLSelectElement).value).toBe('');
  });

  it('allows viewers to browse dates while preventing editing', async () => {
    mocks.connection.profile.role = 'viewer';
    render(<HomePage />);
    await screen.findByText("Today's check-in");
    expect(screen.getByLabelText('Morning Mood mood').closest('fieldset')?.disabled).toBe(true);
    expect(screen.queryByLabelText('Tracker options')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add spontaneous event' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(screen.getByText('Past-day entry')).toBeTruthy();
  });
});
