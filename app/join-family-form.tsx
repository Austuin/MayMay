'use client';

import { useState, type FormEvent } from 'react';
import { refreshFirebaseConnection, type FirebaseConnection } from '@/lib/maymay-firebase';
import { cancelFamilyRequest, requestFamilyAccess } from '@/lib/maymay-invitations';

export function JoinFamilyForm({ connection, onChanged }: {
  connection: FirebaseConnection;
  onChanged: (connection: FirebaseConnection) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const requests = connection.requests ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      onChanged(await requestFamilyAccess(connection, code));
      setCode('');
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

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-bold">Join a family</h2>
      <p className="mt-1 text-sm text-muted-foreground">Ask a Primary caregiver for their Family Code. Your request needs their approval before you can see any care records.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
        <label className="min-w-0 flex-1 text-sm font-medium">Family Code
          <input className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base" value={code} onChange={event => setCode(event.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false} required />
        </label>
        <button className="h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50" disabled={busy}>{busy ? 'Sending…' : 'Request access'}</button>
      </form>
      {message && <p className="mt-3 text-sm" role="status">{message}</p>}
      {requests.length > 0 && <div className="mt-5 space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Your requests</h3>
          <button type="button" className="text-sm underline disabled:opacity-50" disabled={busy} onClick={() => { void checkAccess(); }}>Check access</button>
        </div>
        {requests.map(request => <div key={request.familyId} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          <span>Family {request.familyId.slice(0, 8)}… · {request.status === 'Pending' ? 'Waiting for approval' : request.status}</span>
          {request.status === 'Pending' && <button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => { void cancel(request.familyId); }}>Cancel</button>}
        </div>)}
      </div>}
    </section>
  );
}
