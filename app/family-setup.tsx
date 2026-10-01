'use client';

import { useState, type FormEvent } from 'react';
import { HeartHandshake, LogOut } from 'lucide-react';
import { PatientForm } from './patient-form';
import type { FirebaseConnection, PatientFields } from '@/lib/maymay-firebase';

export function FamilySetup({
  connection, onCreateFamily, onCreatePatient, onSelectFamily, onSignOut,
}: {
  connection: FirebaseConnection;
  onCreateFamily: (name: string) => Promise<void>;
  onCreatePatient: (familyId: string, fields: PatientFields) => Promise<void>;
  onSelectFamily: (familyId: string) => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const family = connection.families.find(item => item.familyId === connection.profile.familyId);

  async function submitFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onCreateFamily(name); setName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the family.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-xl font-bold"><HeartHandshake /> MayMay</div>
          <button className="flex items-center gap-2 text-sm" onClick={onSignOut}><LogOut className="size-4" /> Sign out</button>
        </header>
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          {!family ? (
            <>
              <h1 className="text-2xl font-bold">Create a family</h1>
              <p className="mt-2 text-muted-foreground">Give your family a name. You will be its first Primary caregiver.</p>
              <form className="mt-6 space-y-4" onSubmit={submitFamily}>
                <label className="block text-sm font-medium">Family name
                  <input className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base" value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
                </label>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button className="h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50" disabled={busy}>{busy ? 'Creating…' : 'Create family'}</button>
              </form>
            </>
          ) : (
            <>
              {connection.families.length > 1 && (
                <label className="mb-5 block text-sm font-medium">Family
                  <select className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3" value={family.familyId} onChange={event => onSelectFamily(event.target.value)}>
                    {connection.families.map(item => <option key={item.familyId} value={item.familyId}>{item.name}</option>)}
                  </select>
                </label>
              )}
              <h1 className="text-2xl font-bold">Add a patient to {family.name}</h1>
              {family.role === 'Primary' ? (
                <div className="mt-5"><PatientForm action="Add patient" onSave={fields => onCreatePatient(family.familyId, fields)} /></div>
              ) : (
                <p className="mt-3 text-muted-foreground">A Primary caregiver needs to grant you access to a patient. Check back after they do.</p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
