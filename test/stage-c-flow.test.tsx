import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyAccess } from '@/app/family-access';
import { JoinFamilyForm } from '@/app/join-family-form';
import { FamilySetup } from '@/app/family-setup';
import type { FirebaseConnection } from '@/lib/maymay-firebase';

const mocks = vi.hoisted(() => {
  let code: { code: string; inviteId: string; expiresAt: string; revoked: boolean; patientIds: string[] } | null = null;
  let members: Record<string, unknown>[] = [];
  return {
    getCode: vi.fn(async () => code ? { inviteId: code.inviteId, expiresAt: code.expiresAt, revoked: false, patientIds: code.patientIds } : null),
    rotateCode: vi.fn(async () => { code = { code: 'MM1.family-a.invite.0123456789abcdef0123456789abcdef', inviteId: 'invite', expiresAt: '2099-01-01T00:00:00Z', revoked: false, patientIds: ['patient-a'] }; return code; }),
    listMembers: vi.fn(async () => members),
    approve: vi.fn(async (_connection, _familyId, userId, role, patientIds) => {
      members = members.map(member => member.userId === userId ? { ...member, status: 'Active', role, patientIds } : member);
    }),
    reject: vi.fn(async (_connection, _familyId, userId) => {
      members = members.map(member => member.userId === userId ? { ...member, status: 'Rejected' } : member);
    }), changePatients: vi.fn(), disable: vi.fn(), restore: vi.fn(),
    setRole: vi.fn(), transfer: vi.fn(),
    request: vi.fn(), cancel: vi.fn(),
    refresh: vi.fn(),
    reset: () => { code = null; members = []; },
    setMembers: (next: Record<string, unknown>[]) => { members = next; },
  };
});

vi.mock('@/lib/maymay-invitations', () => ({
  getFamilyInvitation: mocks.getCode,
  sendVerificationEmail: vi.fn(),
  checkEmailVerification: vi.fn(async () => true),
  rotateFamilyCode: mocks.rotateCode,
  listFamilyMembers: mocks.listMembers,
  approveFamilyRequest: mocks.approve,
  rejectFamilyRequest: mocks.reject,
  changeFamilyMemberPatients: mocks.changePatients,
  disableFamilyMember: mocks.disable,
  restoreFamilyMember: mocks.restore,
  setFamilyMemberRole: mocks.setRole,
  transferProtectedPrimary: mocks.transfer,
  requestFamilyAccess: mocks.request,
  cancelFamilyRequest: mocks.cancel,
}));

vi.mock('@/lib/maymay-firebase', () => ({
  refreshFirebaseConnection: mocks.refresh,
}));

const patient = { familyId: 'family-a', patientId: 'patient-a', name: 'Sam' };
function connection(role: 'Primary' | 'Caregiver' = 'Primary', requests: unknown[] = []) {
  return {
    app: { options: { projectId: 'demo-test' } }, db: {},
    user: { uid: role === 'Primary' ? 'owner' : 'joining', email: 'joining@example.test', displayName: 'Joining', emailVerified: true },
    profile: { familyId: role === 'Primary' ? 'family-a' : '', role: role === 'Primary' ? 'master' : 'pending', active: role === 'Primary' },
    patientId: role === 'Primary' ? 'patient-a' : '',
    families: role === 'Primary' ? [{ familyId: 'family-a', name: 'Smith', role: 'Primary', primaryId: 'owner', patients: [patient] }] : [],
    requests,
  } as unknown as FirebaseConnection;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.reset();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('Stage C invitation controls', () => {
  it('requires email verification before submitting a join request', async () => {
    const unverified = connection('Caregiver');
    Object.assign(unverified.user, { emailVerified: false });
    render(<JoinFamilyForm connection={unverified} onChanged={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Request access' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'I have verified my email' }));
    await screen.findByText('Email verified. You can request access now.');
    expect((screen.getByRole('button', { name: 'Request access' }) as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('shows invitation metadata after reopening without recovering its secret', async () => {
    await mocks.rotateCode();
    mocks.setMembers([{ familyId: 'family-a', userId: 'joining', role: 'Caregiver', status: 'Pending', patientIds: [], proposedPatientIds: ['patient-a'], invitationId: 'previous', requesterName: 'Joining', requesterEmail: 'joining@example.test', requesterEmailVerified: true }]);
    render(<FamilyAccess connection={connection()} onChanged={vi.fn()} />);
    await screen.findByText(/This request used a code/);
    expect(screen.queryByLabelText('Current Family Code')).toBeNull();
    expect(screen.getByText('Email verified')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace code' })).toBeTruthy();
  });

  it('shows Primary member controls when the invitation endpoint is unavailable', async () => {
    const owner = connection();
    mocks.getCode.mockRejectedValueOnce(new Error('Family Codes are unavailable on this host.'));
    mocks.setMembers([
      { familyId: 'family-a', userId: 'owner', role: 'Primary', status: 'Active', patientIds: ['patient-a'], requesterName: 'Owner', requesterEmail: '' },
      { familyId: 'family-a', userId: 'joining', role: 'Caregiver', status: 'Active', patientIds: ['patient-a'], requesterName: 'Joining', requesterEmail: 'joining@example.test' },
    ]);
    render(<FamilyAccess connection={owner} onChanged={vi.fn()} />);
    expect(await screen.findByText('Joining')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Family members' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Requests to join' })).toBeTruthy();
    expect(screen.getByText('Family Codes are unavailable on this host.')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'Primary' } });
    await waitFor(() => expect(mocks.setRole).toHaveBeenCalledWith(owner, 'family-a', expect.objectContaining({ userId: 'joining' }), 'Primary'));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(mocks.disable).toHaveBeenCalledWith(owner, 'family-a', expect.objectContaining({ userId: 'joining' })));
  });

  it('submits a pasted code, shows the pending request, and cancels it', async () => {
    const initial = connection('Caregiver');
    const pending = connection('Caregiver', [{ familyId: 'family-a', status: 'Pending' }]);
    mocks.request.mockResolvedValue(pending);
    mocks.cancel.mockResolvedValue(initial);
    function Harness() {
      const [current, setCurrent] = useState(initial);
      return <JoinFamilyForm connection={current} onChanged={setCurrent} />;
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Family Code'), { target: { value: 'MM1.family-a.0123456789abcdef0123456789abcdef' } });
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'Sibling' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith(initial, 'MM1.family-a.0123456789abcdef0123456789abcdef', 'Sibling'));
    expect((screen.getByLabelText('Relationship') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(/Waiting for approval/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith(pending, 'family-a'));
    expect(screen.queryByText(/Waiting for approval/)).toBeNull();
  });

  it('generates a code and approves a requester for the selected patient', async () => {
    const owner = connection();
    mocks.setMembers([
      { familyId: 'family-a', userId: 'owner', role: 'Primary', status: 'Active', patientIds: ['patient-a'], requesterName: 'Owner', requesterEmail: '' },
      { familyId: 'family-a', userId: 'joining', role: 'Caregiver', status: 'Pending', patientIds: [], proposedPatientIds: ['patient-a'], requesterEmailVerified: true, invitationId: 'invite', requesterName: 'Joining', requesterEmail: 'joining@example.test' },
    ]);
    const onChanged = vi.fn();
    render(<FamilyAccess connection={owner} onChanged={onChanged} />);
    await screen.findByText('Joining');
    fireEvent.click(screen.getByRole('button', { name: 'Generate code' }));
    await waitFor(() => expect(mocks.rotateCode).toHaveBeenCalledWith(owner, 'family-a', ['patient-a']));
    await screen.findByText('Family Code generated.');
    expect((screen.getByLabelText('Current Family Code') as HTMLInputElement).value).toContain('MM1.family-a.');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith(owner, 'family-a', 'joining', 'Caregiver', ['patient-a']));
    expect(screen.getByText('No requests are waiting.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('checks a pending request and shows access after approval', async () => {
    const pending = connection('Caregiver', [{ familyId: 'family-a', status: 'Pending' }]);
    const approved = connection('Primary');
    mocks.refresh.mockResolvedValue(approved);
    const onChanged = vi.fn();
    render(<JoinFamilyForm connection={pending} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check access' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith(pending));
    expect(onChanged).toHaveBeenCalledWith(approved);
  });

  it('lets an approved caregiver without patients refresh their access', async () => {
    const ready = connection();
    const waiting = { ...ready, patientId: '', families: [{ ...ready.families[0], role: 'Caregiver' as const, patients: [] }] };
    mocks.refresh.mockResolvedValue(ready);
    const changed = vi.fn();
    render(<FamilySetup connection={waiting} onChanged={changed} onCreateFamily={vi.fn()} onCreatePatient={vi.fn()} onSelectFamily={vi.fn()} onMembershipsChanged={vi.fn()} onSignOut={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Check patient access' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith(ready));
  });

  it('shows relationship and date, rejects a request, and removes the notification', async () => {
    const owner = connection();
    mocks.setMembers([{ familyId: 'family-a', userId: 'joining', role: 'Caregiver', status: 'Pending', patientIds: [], requesterName: 'Joining', requesterEmail: 'joining@example.test', relationship: 'Sibling', requestedAt: '2026-10-01T12:00:00Z' }]);
    render(<FamilyAccess connection={owner} onChanged={vi.fn()} />);
    await screen.findByText('Relationship: Sibling');
    expect(screen.getByText(/^Requested /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await screen.findByText('No requests are waiting.');
    expect(mocks.reject).toHaveBeenCalledWith(owner, 'family-a', 'joining');
    expect(screen.queryByText('Joining')).toBeNull();
  });

  it('refreshes newly arrived requests while the Primary is signed in', async () => {
    render(<FamilyAccess connection={connection()} onChanged={vi.fn()} />);
    await screen.findByText('No requests are waiting.');
    mocks.setMembers([{ familyId: 'family-a', userId: 'joining', role: 'Caregiver', status: 'Pending', patientIds: [], requesterName: 'Joining', requesterEmail: 'joining@example.test' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
    expect(await screen.findByText('Joining')).toBeTruthy();
  });
});
