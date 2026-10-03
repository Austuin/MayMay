'use client';

import { useState, type FormEvent } from 'react';
import { refreshFirebaseConnection, type FirebaseConnection } from '@/lib/maymay-firebase';
import { cancelFamilyRequest, requestFamilyAccess, sendVerificationEmail, checkEmailVerification } from '@/lib/maymay-invitations';

export function JoinFamilyForm({ connection, onChanged }: {
  connection: FirebaseConnection;
  onChanged: (connection: FirebaseConnection) => void;
}) {
  const [code, setCode] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [verified, setVerified] = useState(connection.user.emailVerified);
  const requests = connection.requests ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!verified) { setMessage('Verify your email before requesting access.'); return; }
    if (!relationship.trim()) { setMessage('Enter your relationship to the patient.'); return; }
    setBusy(true);
    setMessage('');
    try {
      onChanged(await requestFamilyAccess(connection, code, relationship.trim()));
      setCode('');
      setRelationship('');
      setMessage('Request sent. A Primary caregiver will review it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send your request.');
    } finally { setBusy(false); }
  }

  async function cancel(familyId: string) {
    setBusy(true);
    setMessage('');
    try { onChanged(await cancelFamilyRequest(connection, familyId)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not cancel the request.'); }
    finally { setBusy(false); }
  }

  async function checkAccess() {
    setBusy(true);
    setMessage('');
    try {
      const refreshed = await refreshFirebaseConnection(connection);
      onChanged(refreshed);
      setMessage(refreshed.requests.some(request => request.status === 'Pending')
        ? 'Your request is still waiting for approval.' : 'Access status updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not check access.');
    } finally { setBusy(false); }
  }

  async function verification(check: boolean) {
    setBusy(true); setMessage('');
    try {
      if (check) {
        const ready = await checkEmailVerification(connection);
        setVerified(ready);
        setMessage(ready ? 'Email verified. You can request access now.' : 'Open the verification link in your email, then check again.');
      } else {
        await sendVerificationEmail(connection);
        setMessage('Verification email sent. Check your inbox and spam folder.');
      }
    } catch { setMessage('Could not verify your email right now. Please wait a moment and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-bold">Join a family</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ask a Primary caregiver for their Family Code. Your request needs their approval before you can see any care records.</p>
      {!verified && <div className="mt-4 space-y-2 rounded-xl border p-3">
        <p className="text-sm">Verify {connection.user.email} so the Primary knows who is requesting access.</p>
        <div className="flex flex-wrap gap-4">
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => void verification(false)}>Send verification email</button>
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => void verification(true)}>I have verified my email</button>
        </div>
      </div>}
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <label className="block text-sm font-medium">Family Code
          <input className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false} required />
        </label>
        <label className="block text-sm font-medium">Relationship
          <input className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base" placeholder="For example, parent or support worker" value={relationship} onChange={event => setRelationship(event.target.value)} required maxLength={100} />
        </label>
        <button className="h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50" disabled={busy || !verified}>{busy ? 'Please wait…' : 'Request access'}</button>
      </form>
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
      {requests.length > 0 && <div className="mt-5 space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Your requests</h3>
          <button type="button" className="text-sm underline disabled:opacity-50" disabled={busy} onClick={() => { void checkAccess(); }}>Check access</button>
        </div>
        {requests.map(request => <div key={request.familyId} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>Family {request.familyId.slice(0, 8)}… · {request.status === 'Pending' ? 'Waiting for approval' : request.status === 'Rejected' ? 'Request declined. Contact a Primary caregiver before trying again.' : 'Access disabled. Contact a Primary caregiver.'}</span>
          {request.status === 'Pending' && <button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => { void cancel(request.familyId); }}>Cancel</button>}
        </div>)}
      </div>}
    </section>
  );
}
