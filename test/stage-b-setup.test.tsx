import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from '@/app/page';

const mocks = vi.hoisted(() => {
  const base = {
    app: { options: { projectId: 'demo-test' } }, db: {},
    accountName: 'Setup User',
    user: { uid: 'setup-user', email: 'setup@example.test', displayName: 'Setup User' },
  };
  const empty = {
    ...base, profile: { familyId: '', role: 'pending', active: false },
    patientId: '', families: [],
  };
  const family = {
    ...base, profile: { familyId: 'family-a', role: 'master', active: true },
    patientId: '', families: [{ familyId: 'family-a', name: 'Smith Family', role: 'Primary', patients: [] }],
  };
  const patient = { patientId: 'patient-a', familyId: 'family-a', name: 'Sam', sex: 'Female', ethnicity: 'Example', birthdate: '2018-01-02', supportNeeds: 'Allow extra response time' };
  const ready = {
    ...family, patientId: patient.patientId, patient,
    families: [{ ...family.families[0], patients: [patient] }],
  };
  return {
    empty, family, ready,
    restoreFirebase: vi.fn(async (): Promise<unknown> => empty),
    registerFirebaseAccount: vi.fn(async () => empty),
    resetFirebasePassword: vi.fn(async (_config: unknown, _email: string) => undefined),
    connectFirebase: vi.fn(async () => ready),
    disconnectFirebase: vi.fn(async () => undefined),
    createFamily: vi.fn(async () => family),
    createPatient: vi.fn(async () => ready),
    updatePatient: vi.fn(async (_connection: unknown, fields: Record<string, unknown>) => ({
      ...ready, patient: { ...patient, ...fields },
      families: [{ ...ready.families[0], patients: [{ ...patient, ...fields }] }],
    })),
    updateAccountName: vi.fn(async (_connection: unknown, name: string) => ({ ...ready, accountName: name })),
    updateFamilyName: vi.fn(async (_connection: unknown, _familyId: string, name: string) => ({
      ...ready, families: [{ ...ready.families[0], name }],
    })),
  };
});

vi.mock('@/lib/maymay-firebase', () => ({
  loadRuntimeConfig: vi.fn(async () => ({ firebase: { apiKey: 'test', authDomain: 'test', projectId: 'demo-test', appId: 'test' } })),
  restoreFirebase: mocks.restoreFirebase,
  createFamily: mocks.createFamily,
  createPatient: mocks.createPatient,
  updatePatient: mocks.updatePatient,
  updateAccountName: mocks.updateAccountName,
  updateFamilyName: mocks.updateFamilyName,
  refreshFirebaseConnection: vi.fn(async (connection: unknown) => connection),
  selectFamilyPatient: vi.fn(),
  connectFirebase: mocks.connectFirebase,
  connectFirebaseWithGoogle: vi.fn(),
  registerFirebaseAccount: mocks.registerFirebaseAccount,
  disconnectFirebase: mocks.disconnectFirebase,
  resetFirebasePassword: mocks.resetFirebasePassword,
}));

vi.mock('@/hooks/use-care-records', () => ({
  useCareRecords: () => ({ data: { trackers: [], answers: {}, spontaneous: [] },
    status: 'saved', message: 'Saved', conflicts: [], change: vi.fn(), retry: vi.fn(), choose: vi.fn() }),
}));
vi.mock('@/hooks/use-spontaneous-catalog', () => ({
  useSpontaneousCatalog: () => ({ previous: [], counts: {}, hasMore: false, loadMore: vi.fn() }),
}));

vi.mock('@/lib/maymay-invitations', () => ({
  getFamilyInvitation: vi.fn(async () => null),
  listFamilyMembers: vi.fn(async () => []),
  listPendingRequests: vi.fn(async () => []),
  watchPendingRequests: vi.fn((_connection, receive) => { receive([]); return () => undefined; }),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.restoreFirebase.mockClear();
  mocks.registerFirebaseAccount.mockClear();
  mocks.createFamily.mockClear();
  mocks.createPatient.mockClear();
  mocks.updatePatient.mockClear();
  mocks.updateAccountName.mockClear();
  mocks.updateFamilyName.mockClear();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Stage B setup', () => {
  it('edits account and family names through Settings and keeps reset and sign-out available', async () => {
    mocks.restoreFirebase.mockResolvedValueOnce(mocks.ready);
    render(<HomePage />);
    await screen.findByText('Daily check-in');
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(mocks.updateAccountName).toHaveBeenCalledWith(mocks.ready, 'New name'));
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'New family name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save family name' }));
    await waitFor(() => expect(mocks.updateFamilyName).toHaveBeenCalledWith(expect.any(Object), 'family-a', 'New family name'));
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Sign out' }).length).toBeGreaterThan(0);
  });

  it('shows permitted patient details read-only to a Viewer', async () => {
    mocks.restoreFirebase.mockResolvedValueOnce({ ...mocks.ready,
      profile: { ...mocks.ready.profile, role: 'viewer' },
      families: [{ ...mocks.ready.families[0], role: 'Viewer' }],
    } as typeof mocks.ready);
    render(<HomePage />);
    await screen.findByText('Daily check-in');
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByText('Allow extra response time')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save patient details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save family name' })).toBeNull();
  });
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
    await screen.findByRole('heading', { name: 'Your family’s care space' });
  });

  it('creates a family, saves optional patient data, and later removes an optional field', async () => {
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Create a family/ }));
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: 'Smith Family' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create family' }));
    await waitFor(() => expect(mocks.createFamily).toHaveBeenCalledWith(mocks.empty, 'Smith Family'));
    await screen.findByRole('heading', { name: 'Add a patient to Smith Family' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByText('Add optional details'));
    fireEvent.change(screen.getByLabelText('Birthdate'), { target: { value: '2018-01-02' } });
    fireEvent.change(screen.getByLabelText('Communication and support needs'), { target: { value: 'Allow extra response time' } });
    fireEvent.change(screen.getByLabelText('Sex'), { target: { value: 'Female' } });
    fireEvent.change(screen.getByLabelText('Ethnicity'), { target: { value: 'Example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    await waitFor(() => expect(mocks.createPatient).toHaveBeenCalledWith(mocks.family, 'family-a', {
      name: 'Sam', birthdate: '2018-01-02', sex: 'Female', ethnicity: 'Example', supportNeeds: 'Allow extra response time',
    }));
    await screen.findByText('Daily check-in');
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const editForm = screen.getByRole('button', { name: 'Save patient details' }).closest('form')!;
    const ethnicity = within(editForm).getByLabelText('Ethnicity');
    expect((ethnicity as HTMLInputElement).value).toBe('Example');
    fireEvent.change(ethnicity, { target: { value: '' } });
    fireEvent.change(within(editForm).getByLabelText('Communication and support needs'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save patient details' }));
    await waitFor(() => expect(mocks.updatePatient).toHaveBeenCalledWith(mocks.ready, {
      name: 'Sam', birthdate: '2018-01-02', sex: 'Female',
    }));
    expect((within(editForm).getByLabelText('Ethnicity') as HTMLInputElement).value).toBe('');
  });

  it('resets a password, returns to sign in, opens the patient directly, and signs out', async () => {
    mocks.restoreFirebase.mockResolvedValueOnce(null);
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Reset email'), { target: { value: 'setup@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText(/If an account uses that email/);
    expect(mocks.resetFirebasePassword).toHaveBeenCalledWith(expect.any(Object), 'setup@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'setup@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-test-password' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!);
    await screen.findByText('Daily check-in');
    expect(screen.queryByLabelText('Family')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to continue' });
    expect(mocks.disconnectFirebase).toHaveBeenCalled();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('offers a join path and allows returning to family creation', async () => {
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: /Enter family code/ }));
    expect(screen.getByLabelText('Family Code')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to setup options' }));
    fireEvent.click(screen.getByRole('button', { name: /Create a family/ }));
    fireEvent.change(screen.getByLabelText('Family name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create family' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a family name');
    expect(mocks.createFamily).not.toHaveBeenCalled();
  });

  it('allows retry after a password reset fails', async () => {
    mocks.restoreFirebase.mockResolvedValueOnce(null);
    mocks.resetFirebasePassword.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Reset email'), { target: { value: 'setup@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText(/If an account uses that email/);
  });
});
