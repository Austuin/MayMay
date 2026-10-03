'use client';

import { useState, type FormEvent } from 'react';
import { patientAge, type Sex, type AutismLevel } from '@/lib/maymay-schema';
import { localDateValue } from '@/lib/maymay-types';
import type { PatientFields } from '@/lib/maymay-firebase';

const empty: PatientFields = { name: '' };

export function PatientForm({
  initial = empty, action, onSave, resetOnSave = false,
}: {
  initial?: PatientFields;
  action: string;
  onSave: (fields: PatientFields) => Promise<void>;
  resetOnSave?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [supportNeeds, setSupportNeeds] = useState(initial.supportNeeds ?? '');
  const [sex, setSex] = useState(initial.sex ?? '');
  const [ethnicity, setEthnicity] = useState(initial.ethnicity ?? '');
  const [autismLevel, setAutismLevel] = useState(initial.autismLevel ?? '');
  const [birthdate, setBirthdate] = useState(initial.birthdate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError('Enter a patient name.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        ...(supportNeeds.trim() ? { supportNeeds: supportNeeds.trim() } : {}),
        ...(sex ? { sex: sex as Sex } : {}),
        ...(ethnicity.trim() ? { ethnicity: ethnicity.trim() } : {}),
        ...(autismLevel ? { autismLevel: autismLevel as AutismLevel } : {}),
        ...(birthdate ? { birthdate } : {}),
      });
      if (resetOnSave) {
        setName(''); setSupportNeeds(''); setSex(''); setEthnicity(''); setAutismLevel(''); setBirthdate('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the patient.');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = 'h-11 w-full rounded-md border border-input bg-background px-3 text-base';
  return (
    <form className="space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium">Name
        <input className={inputStyle} value={name} onChange={event => setName(event.target.value)} required maxLength={100} />
      </label>
      <details className="rounded-xl border p-4" open={Boolean(initial.birthdate || initial.sex || initial.ethnicity || initial.autismLevel || initial.supportNeeds)}>
      <summary className="cursor-pointer font-medium">Add optional details</summary>
      <p className="my-3 text-sm text-muted-foreground">You can add, change, or clear these later.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Birthdate
          <input className={inputStyle} type="date" max={localDateValue()} value={birthdate} onChange={event => setBirthdate(event.target.value)} />
        </label>
        {birthdate && <p className="self-center text-sm text-muted-foreground">Age: {patientAge(birthdate)}</p>}
        <label className="block text-sm font-medium">Sex
          <select className={inputStyle} value={sex} onChange={event => setSex(event.target.value as Sex | '')}>
            <option value="">Not specified</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Intersex">Intersex</option>
            <option value="Unknown">Unknown</option>
            <option value="Prefer not to say">Prefer not to say</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Autism support level
          <select className={inputStyle} value={autismLevel} onChange={event => setAutismLevel(event.target.value as AutismLevel | '')}>
            <option value="">Not specified</option>
            <option value="Level 1">Level 1</option>
            <option value="Level 2">Level 2</option>
            <option value="Level 3">Level 3</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">Ethnicity
        <input className={inputStyle} value={ethnicity} onChange={event => setEthnicity(event.target.value)} maxLength={100} />
      </label>
      <label className="mt-4 block text-sm font-medium">Communication and support needs
        <textarea className="mt-1 min-h-24 w-full rounded-md border border-input bg-background p-3 text-base" value={supportNeeds} onChange={event => setSupportNeeds(event.target.value)} maxLength={1000} />
      </label>
      </details>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button className="h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50" type="submit" disabled={busy}>
        {busy ? 'Saving…' : action}
      </button>
    </form>
  );
}
