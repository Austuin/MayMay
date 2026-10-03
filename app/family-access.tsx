'use client';

import { useEffect, useState } from 'react';
import type { FirebaseConnection, FamilyOption } from '@/lib/maymay-firebase';
import {
  approveFamilyRequest, changeFamilyMemberPatients, disableFamilyMember,
  getFamilyInvitation, listFamilyMembers, rejectFamilyRequest, restoreFamilyMember,
  rotateFamilyCode, setFamilyMemberRole, transferProtectedPrimary,
  type FamilyMember, type InvitationStatus,
} from '@/lib/maymay-invitations';
import type { FamilyRole } from '@/lib/maymay-access';

function PatientChoices({ family, selected, onChange }: {
  family: FamilyOption; selected: string[]; onChange: (ids: string[]) => void;
}) {
  if (!family.patients.length) return <p className="text-sm text-muted-foreground">No patients have been added yet.</p>;
  return <fieldset className="space-y-2">
    <legend className="mb-2 text-sm font-medium">Patient access</legend>
    {family.patients.map(patient => <label key={patient.patientId} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={selected.includes(patient.patientId)} onChange={event =>
        onChange(event.target.checked ? [...selected, patient.patientId] : selected.filter(id => id !== patient.patientId))
      } />
      {patient.name}
    </label>)}
  </fieldset>;
}

function PendingRow({ connection, family, member, invitation, onAction }: {
  connection: FirebaseConnection;
  family: FamilyOption;
  member: FamilyMember;
  invitation: InvitationStatus | null;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [role, setRole] = useState<'Caregiver' | 'Viewer'>('Caregiver');
  const [selected, setSelected] = useState<string[]>((member.proposedPatientIds ?? []).filter(id => family.patients.some(patient => patient.patientId === id)));
  return <div className="space-y-3 rounded-xl border p-4">
    <div><b>{member.requesterName}</b><p className="text-sm text-muted-foreground">{member.requesterEmail || member.userId}</p></div>
    <p className="text-xs text-muted-foreground">{member.requesterEmailVerified ? 'Email verified' : 'Email verification unavailable'}</p>
    {member.invitationId && invitation && (member.invitationId !== invitation.inviteId || invitation.revoked || new Date(invitation.expiresAt).getTime() <= Date.now()) && <p className="text-sm text-muted-foreground">This request used a code that has since expired or been replaced. You can still review it.</p>}
    {member.relationship && <p className="text-sm">Relationship: {member.relationship}</p>}
    {member.requestedAt && <p className="text-sm text-muted-foreground">Requested {new Date(member.requestedAt).toLocaleDateString()}</p>}
    <label className="block text-sm font-medium">Approve as
      <select className="ml-2 h-9 rounded-md border bg-background px-2" value={role} onChange={event => setRole(event.target.value as 'Caregiver' | 'Viewer')}>
        <option value="Caregiver">Caregiver</option><option value="Viewer">Viewer</option>
      </select>
    </label>
    <PatientChoices family={family} selected={selected} onChange={setSelected} />
    <div className="flex flex-wrap gap-2">
      <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" onClick={() =>
        void onAction(() => approveFamilyRequest(connection, family.familyId, member.userId, role, selected), 'Caregiver approved.')
      }>Approve</button>
      <button className="rounded-md border px-4 py-2 text-sm" onClick={() =>
        void onAction(() => rejectFamilyRequest(connection, family.familyId, member.userId), 'Request rejected.')
      }>Reject</button>
    </div>
  </div>;
}

function MemberRow({ connection, family, member, onAction }: {
  connection: FirebaseConnection;
  family: FamilyOption;
  member: FamilyMember;
  onAction: (action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const self = member.userId === connection.user.uid;
  const designated = family.primaryId === member.userId;
  const [selected, setSelected] = useState(member.patientIds.filter(id => family.patients.some(patient => patient.patientId === id)));
  return <div className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><b>{member.requesterName}{self ? ' (you)' : ''}</b><p className="text-sm text-muted-foreground">{member.requesterEmail || member.userId}</p></div>
      <span className="text-sm">{member.status === 'Disabled' ? 'Disabled' : designated ? 'Protected Primary' : member.role}</span>
    </div>
    {!self && member.status === 'Active' && <>
      <label className="block text-sm font-medium">Role
        <select className="ml-2 h-9 rounded-md border bg-background px-2" value={member.role} disabled={designated} onChange={event =>
          void onAction(() => setFamilyMemberRole(connection, family.familyId, member, event.target.value as FamilyRole), 'Role updated.')
        }>
          <option value="Primary">Primary</option><option value="Caregiver">Caregiver</option><option value="Viewer">Viewer</option>
        </select>
      </label>
      {member.role === 'Primary' && !designated && <button className="text-sm underline" onClick={() =>
        void onAction(() => transferProtectedPrimary(connection, family.familyId, member.userId), 'Protected Primary transferred.')
      }>Make protected Primary</button>}
      <details className="rounded-lg bg-muted/40 p-3">
        <summary className="cursor-pointer text-sm font-medium">Change patient access</summary>
        <div className="mt-3 space-y-3">
          <PatientChoices family={family} selected={selected} onChange={setSelected} />
          <button className="rounded-md border px-4 py-2 text-sm" onClick={() =>
            void onAction(() => changeFamilyMemberPatients(connection, family.familyId, member, selected), 'Patient access updated.')
          }>Save access</button>
        </div>
      </details>
      <button className="text-sm text-destructive underline" onClick={() =>
        void onAction(() => disableFamilyMember(connection, family.familyId, member), 'Caregiver disabled.')
      }>Disable access</button>
    </>}
    {member.status === 'Disabled' && <>
      <PatientChoices family={family} selected={selected} onChange={setSelected} />
      <button className="rounded-md border px-4 py-2 text-sm" onClick={() =>
        void onAction(() => restoreFamilyMember(connection, family.familyId, member, selected), 'Caregiver restored.')
      }>Restore access</button>
    </>}
  </div>;
}

export function FamilyAccess({ connection, onChanged }: {
  connection: FirebaseConnection;
  onChanged: () => void;
}) {
  const family = connection.families.find(item => item.familyId === connection.profile.familyId);
  const [issued, setIssued] = useState<{ familyId: string; generation: string; code: string; inviteId: string } | null>(null);
  const [invitation, setInvitation] = useState<InvitationStatus | null>(null);
  const [invitePatients, setInvitePatients] = useState<string[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const familyId = family?.role === 'Primary' ? family.familyId : '';
  const code = issued?.familyId === familyId && issued.generation === connection.dataGeneration && issued.inviteId === invitation?.inviteId ? issued.code : null;

  useEffect(() => {
    setIssued(null);
    setInvitePatients(connection.families.find(item => item.familyId === familyId)?.patients.map(patient => patient.patientId) ?? []);
  }, [familyId, connection.dataGeneration]);

  useEffect(() => {
    setMembers([]); setInvitation(null); setMessage('');
    if (!familyId) return;
    let alive = true;
    Promise.all([getFamilyInvitation(connection, familyId), listFamilyMembers(connection, familyId)])
      .then(([value, people]) => { if (alive) { setInvitation(value); setMembers(people); } })
      .catch(error => { if (alive) setMessage(error instanceof Error ? error.message : 'Could not load family access.'); });
    return () => { alive = false; };
  }, [connection, familyId]);

  if (!family || family.role !== 'Primary') return null;
  const pending = members.filter(member => member.status === 'Pending');
  const others = members.filter(member => member.status === 'Active' || member.status === 'Disabled');

  async function reload() {
    const [value, people] = await Promise.all([getFamilyInvitation(connection, family!.familyId), listFamilyMembers(connection, family!.familyId)]);
    setInvitation(value); setMembers(people); onChanged();
  }

  async function act(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await action(); await reload(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change family access.'); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6 rounded-2xl border bg-card p-6" aria-label="Family access">
    <div><h2 className="text-xl font-bold">Family access</h2><p className="text-sm text-muted-foreground">Only Primary caregivers can share codes or approve requests.</p></div>
    <fieldset disabled={busy} className="space-y-6 disabled:opacity-60">
    <div className="space-y-3 rounded-xl bg-muted/40 p-4">
      <h3 className="font-semibold">Family Code</h3>
      <p className="text-sm text-muted-foreground">Codes expire after 7 days. Copy a new code now; it cannot be shown again after you leave this page.</p>
      {invitation && <p className="text-sm">{invitation.revoked || new Date(invitation.expiresAt).getTime() <= Date.now() ? 'Code expired or revoked.' : 'Code active.'} Expires {new Date(invitation.expiresAt).toLocaleString()}.</p>}
      <PatientChoices family={family} selected={invitePatients} onChange={setInvitePatients} />
      <p className="text-xs text-muted-foreground">These patients are suggested for new requests. A Primary confirms access when approving.</p>
      {code ? <input aria-label="Current Family Code" className="w-full rounded-md border bg-background p-2 font-mono text-xs" value={code} readOnly onFocus={event => event.target.select()} /> : <p className="text-sm text-muted-foreground">{invitation ? 'Generate a replacement if you need a code to share. Existing requests remain for review.' : 'Generate a code when you are ready to invite someone.'}</p>}
      <div className="flex flex-wrap gap-2">
        {code && <button className="rounded-md border px-4 py-2 text-sm" onClick={() => {
          if (!navigator.clipboard) { setMessage('Select and copy the code above.'); return; }
          void navigator.clipboard.writeText(code).then(() => setMessage('Family Code copied.')).catch(() => setMessage('Select and copy the code above.'));
        }}>Copy code</button>}
        <button className="rounded-md border px-4 py-2 text-sm" disabled={busy} onClick={() =>
          void act(async () => {
            const result = await rotateFamilyCode(connection, family.familyId, invitePatients);
            setIssued({ familyId: family.familyId, generation: connection.dataGeneration, code: result.code, inviteId: result.inviteId });
            setInvitation(result);
          }, invitation ? 'Code replaced. The old code can no longer create requests.' : 'Family Code generated.')
        }>{invitation ? 'Replace code' : 'Generate code'}</button>
      </div>
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Notifications {pending.length ? `(${pending.length})` : ''}</h3>
        <button className="text-sm underline disabled:opacity-50" disabled={busy} onClick={() => { void act(async () => undefined, 'Requests refreshed.'); }}>Refresh requests</button>
      </div>
      {pending.length ? pending.map(member => <PendingRow key={member.userId} connection={connection} family={family} member={member} invitation={invitation} onAction={act} />)
        : <p className="text-sm text-muted-foreground">No requests are waiting.</p>}
    </div>
    <div className="space-y-3">
      <h3 className="font-semibold">People</h3>
      {others.map(member => <MemberRow key={member.userId + member.status + member.role + member.patientIds.join(',')} connection={connection} family={family} member={member} onAction={act} />)}
    </div>
    </fieldset>
    {message && <p role="status" className="text-sm">{message}</p>}
    {busy && <p className="text-sm text-muted-foreground">Saving…</p>}
  </section>;
}
