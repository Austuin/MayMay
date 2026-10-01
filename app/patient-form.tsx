'use client';

import { useState, type FormEvent } from 'react';
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
  const [age, setAge] = useState(initial.age?.toString() ?? '');
  const [sex, setSex] = useState(initial.sex ?? '');
  const [ethnicity, setEthnicity] = useState(initial.ethnicity ?? '');
  const [autismLevel, setAutismLevel] = useState(initial.autismLevel ?? '');
  const [birthdate, setBirthdate] = useState(initial.birthdate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        ...(age === '' ? {} : { age: Number(age) }),
        ...(sex ? { sex } : {}),
        ...(ethnicity.trim() ? { ethnicity: ethnicity.trim() } : {}),
        ...(autismLevel ? { autismLevel } : {}),
        ...(birthdate ? { birthdate } : {}),
      });
      if (resetOnSave) {
        setName(''); setAge(''); setSex(''); setEthnicity(''); setAutismLevel(''); setBirthdate('');
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
      <p className="text-sm text-muted-foreground">Everything below is optional. You can add or change it later.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Birthdate
          <input className={inputStyle} type="date" value={birthdate} onChange={event => setBirthdate(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">Age, if birthdate is unknown
          <input className={inputStyle} type="number" min="0" max="120" step="1" value={age} onChange={event => setAge(event.target.value)} />
        </label>
        <label className="block text-sm font-medium">Sex
          <select className={inputStyle} value={sex} onChange={event => setSex(event.target.value)}>
            <option value="">Not specified</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Intersex">Intersex</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Autism support level
          <select className={inputStyle} value={autismLevel} onChange={event => setAutismLevel(event.target.value)}>
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
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button className="h-11 rounded-md bg-primary px-5 font-medium text-primary-foreground disabled:opacity-50" type="submit" disabled={busy}>
        {busy ? 'Saving…' : action}
      </button>
    </form>
  );
}
