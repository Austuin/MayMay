import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';

const mocks = vi.hoisted(() => {
  const base = {
    app: { options: { projectId: 'demo-test' } }, db: {},
    user: { uid: 'setup-user', email: 'setup@example.test', displayName: 'Setup User' },
  };
  const empty = {
    ...base, profile: { familyId: '', role: 'pending', active: false },
    childId: '', families: [],
  };
  const family = {
    ...base, profile: { familyId: 'family-a', role: 'master', active: true },
    childId: '', families: [{ familyId: 'family-a', name: 'Smith Family', role: 'Primary', patients: [] }],
  };
  const patient = { patientId: 'patient-a', familyId: 'family-a', name: 'Sam', sex: 'Female', ethnicity: 'Example', age: 8 };
  const ready = {
    ...family, childId: patient.patientId, patient,
    families: [{ ...family.families[0], patients: [patient] }],
  };
  return {
    empty, family, ready,
    restoreFirebase: vi.fn(async () => empty),
    registerFirebaseAccount: vi.fn(async () => empty),
    createFamily: vi.fn(async () => family),
    createPatient: vi.fn(async () => ready),
    updatePatient: vi.fn(async (_connection: unknown, fields: Record<string, unknown>) => ({
      ...ready, patient: { ...patient, ...fields },
      families: [{ ...ready.families[0], patients: [{ ...patient, ...fields }] }],
    })),
  };
});

vi.mock('@/lib/maymay-firebase', () => ({
  loadRuntimeConfig: vi.fn(async () => ({ firebase: { apiKey: 'test', authDomain: 'test', projectId: 'demo-test', appId: 'test' } })),
  restoreFirebase: mocks.restoreFirebase,
  createFamily: mocks.createFamily,
  createPatient: mocks.createPatient,
  updatePatient: mocks.updatePatient,
  selectFamilyPatient: vi.fn(),
  connectFirebase: vi.fn(),
  connectFirebaseWithGoogle: vi.fn(),
  registerFirebaseAccount: mocks.registerFirebaseAccount,
  disconnectFirebase: vi.fn(),
}));

vi.mock('@/hooks/use-care-sync', () => ({
  useCareSync: () => ({
    entries: [], status: 'saved', message: 'Connected', conflicts: [],
    getEntries: () => [], replaceEntry: vi.fn(), retry: vi.fn(),
    acceptSaved: vi.fn(), saveDraft: vi.fn(), stop: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.restoreFirebase.mockClear();
  mocks.registerFirebaseAccount.mockClear();
  mocks.createFamily.mockClear();
  mocks.createPatient.mockClear();
  mocks.updatePatient.mockClear();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Stage B setup', () => {
  it('takes a newly registered account into family setup', async () => {
    mocks.restoreFirebase.mockResolvedValueOnce(null);
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Sign in to continue' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Setup User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'setup@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-test-password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-test-password' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create account' }).at(-1)!);
    await waitFor(() => expect(mocks.registerFirebaseAccount).toHaveBeenCalledWith(
      expect.any(Object), 'Setup User', 'setup@example.test', 'a-test-password',
    ));
    await screen.findByRole('heading', { name: 'Create a family' });
  });

  it('creates a family, saves optional patient data, and later removes an optional field', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Create a family' });
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Smith Family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create family' }));
    await waitFor(() => expect(mocks.createFamily).toHaveBeenCalledWith(mocks.empty, 'Smith Family'));
    await screen.findByRole('heading', { name: 'Add a patient to Smith Family' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText('Age, if birthdate is unknown'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Sex'), { target: { value: 'Female' } });
    fireEvent.change(screen.getByLabelText('Ethnicity'), { target: { value: 'Example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    await waitFor(() => expect(mocks.createPatient).toHaveBeenCalledWith(mocks.family, 'family-a', {
      name: 'Sam', age: 8, sex: 'Female', ethnicity: 'Example',
    }));
    await screen.findByText("Today's check-in");
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const editForm = screen.getByRole('button', { name: 'Save patient details' }).closest('form')!;
    const ethnicity = within(editForm).getByLabelText('Ethnicity');
    expect((ethnicity as HTMLInputElement).value).toBe('Example');
    fireEvent.change(ethnicity, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save patient details' }));
    await waitFor(() => expect(mocks.updatePatient).toHaveBeenCalledWith(mocks.ready, {
      name: 'Sam', age: 8, sex: 'Female',
    }));
    expect((within(editForm).getByLabelText('Ethnicity') as HTMLInputElement).value).toBe('');
  });
});
