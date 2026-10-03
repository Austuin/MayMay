'use client';

import { useState, type FormEvent } from 'react';
import type { FirebaseConnection, FamilyOption } from '@/lib/maymay-firebase';
import { patientAge, type PatientRecord } from '@/lib/maymay-schema';
import { PasswordResetForm } from './password-reset-form';

const input = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';

export function AccountProfile({ connection, onSave, onResetPassword, onSignOut }: {
  connection: FirebaseConnection;
  onSave: (name: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [name, setName] = useState(connection.accountName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resetting, setResetting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await onSave(name); setMessage('Account name saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save your name.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div><b>{connection.accountName}</b><p className="text-sm text-muted-foreground">{connection.user.email}</p></div>
    <form className="space-y-3" onSubmit={submit}>
      <label className="block text-sm font-medium">Your name
        <input className={input} value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
      </label>
      <button className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy || name.trim() === connection.accountName}>
        {busy ? 'Saving…' : 'Save name'}
      </button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
    {resetting ? <PasswordResetForm key={connection.user.email} initialEmail={connection.user.email ?? ''}
      onReset={onResetPassword} onBack={() => setResetting(false)} backLabel="Back to account" />
      : <button className="min-h-11 text-sm font-medium text-primary underline" onClick={() => setResetting(true)}>Reset password</button>}
    <div><button className="min-h-11 text-sm font-medium underline" onClick={onSignOut}>Sign out</button></div>
  </div>;
}

export function FamilyProfile({ family, onSave }: {
  family: FamilyOption;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(family.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await onSave(name); setMessage('Family name saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save the family name.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    <div><b>{family.name}</b><p className="text-sm text-muted-foreground">Your role: {family.role}</p></div>
    {family.role === 'Primary' && <form className="space-y-3" onSubmit={submit}>
      <label className="block text-sm font-medium">Family name
        <input className={input} value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
      </label>
      <button className="min-h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={busy || name.trim() === family.name}>
        {busy ? 'Saving…' : 'Save family name'}
      </button>
    </form>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}

export function PatientProfileReadOnly({ patient }: { patient: PatientRecord }) {
  const details: [string, string | number | null | undefined][] = [
    ['Birthdate', patient.birthdate], ['Age', patientAge(patient.birthdate)],
    ['Sex', patient.sex], ['Ethnicity', patient.ethnicity],
    ['Autism support level', patient.autismLevel], ['Communication and support needs', patient.supportNeeds],
  ];
  return <div className="space-y-3">
    <b>{patient.name}</b>
    <dl className="grid gap-2 text-sm">{details.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) =>
      <div key={label}><dt className="font-medium">{label}</dt><dd className="text-muted-foreground">{value}</dd></div>)}</dl>
  </div>;
}
