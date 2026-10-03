'use client';
import { ThemeToggle } from '@/components/theme-toggle';

import { useState, type FormEvent } from 'react';
import { HeartHandshake, LogOut } from 'lucide-react';
import { PatientForm } from './patient-form';
import { JoinFamilyForm } from './join-family-form';
import { FamilyAccess } from './family-access';
import { refreshFirebaseConnection, type FirebaseConnection, type PatientFields } from '@/lib/maymay-firebase';

export function FamilySetup({
  connection, onCreateFamily, onCreatePatient, onSelectFamily, onChanged, onMembershipsChanged, onSignOut,
}: {
  connection: FirebaseConnection;
  onCreateFamily: (name: string) => Promise<void>;
  onCreatePatient: (familyId: string, fields: PatientFields) => Promise<void>;
  onSelectFamily: (familyId: string) => void;
  onChanged: (connection: FirebaseConnection) => void;
  onMembershipsChanged: () => void;
  onSignOut: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'choose' | 'create' | 'join'>('choose');
  const family = connection.families.find(item => item.familyId === connection.profile.familyId);

  async function submitFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError('Enter a family name.'); return; }
    setBusy(true);
    setError('');
    try { await onCreateFamily(name); setName(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the family.'); }
    finally { setBusy(false); }
  }

  async function checkPatientAccess() {
    setBusy(true);
    setError('');
    try { onChanged(await refreshFirebaseConnection(connection)); }
    catch { setError('Could not check access. Check your connection and try again.'); }
    finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-xl font-bold"><HeartHandshake /> MayMay</div>
          <div className="flex items-center gap-3"><ThemeToggle /><button className="flex items-center gap-2 text-sm" onClick={onSignOut}><LogOut className="size-4" /> Sign out</button></div>
        </header>
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          {!family && step === 'choose' ? (
            <>
              <p className="mb-2 text-sm text-muted-foreground">Welcome to MayMay</p>
              <h1 className="text-2xl font-bold">Your family’s care space</h1>
              <p className="mt-2 text-muted-foreground">Start a family space, or join one using a code from a Primary caregiver.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button className="min-h-24 rounded-xl bg-primary p-4 text-left text-primary-foreground" onClick={() => setStep('create')}>
                  <b className="block">Create a family</b><span className="mt-1 block text-sm">Set up care for someone you support.</span>
                </button>
                <button className="min-h-24 rounded-xl border p-4 text-left hover:bg-muted" onClick={() => setStep('join')}>
                  <b className="block">Enter family code</b><span className="mt-1 block text-sm">Ask to join an existing family.</span>
                </button>
              </div>
            </>
          ) : !family && step === 'join' ? (
            <>
              <button className="mb-4 text-sm underline" onClick={() => setStep('choose')}>Back to setup options</button>
              <JoinFamilyForm connection={connection} onChanged={onChanged} />
            </>
          ) : !family ? (
            <>
              <button className="mb-4 text-sm underline" disabled={busy} onClick={() => setStep('choose')}>Back to setup options</button>
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
              <h1 className="text-2xl font-bold">{family.role === 'Primary' ? `Add a patient to ${family.name}` : 'Waiting for patient access'}</h1>
              {family.role === 'Primary' ? (
                <div className="mt-5"><PatientForm action="Add patient" onSave={fields => onCreatePatient(family.familyId, fields)} /></div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-muted-foreground">A Primary caregiver needs to grant you access to a patient.</p>
                  <button className="h-11 rounded-md border px-4 text-sm disabled:opacity-50" disabled={busy} onClick={() => { void checkPatientAccess(); }}>{busy ? 'Checking…' : 'Check patient access'}</button>
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                </div>
              )}
            </>
          )}
        </section>
        {family?.role === 'Primary' && <FamilyAccess connection={connection} onChanged={onMembershipsChanged} />}
        {(family || (step !== 'join' && (connection.requests ?? []).length > 0)) && <JoinFamilyForm connection={connection} onChanged={onChanged} />}
      </div>
    </main>
  );
}
