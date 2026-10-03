'use client';

import { useState, type FormEvent } from 'react';

export function PasswordResetForm({ initialEmail, onReset, onBack, backLabel = 'Back to sign in' }: {
  initialEmail: string;
  onReset: (email: string) => Promise<void>;
  onBack: () => void;
  backLabel?: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onReset(email.trim()); setSent(true); }
    catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code === 'auth/user-not-found') setSent(true);
      else setError(code === 'auth/invalid-email' ? 'Enter a valid email address.'
        : code === 'auth/too-many-requests' ? 'Please wait a little before trying again.'
          : 'Could not send the reset email. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <h1 id="access-title" className="text-xl font-semibold">Reset your password</h1>
    {sent ? <p role="status">If an account uses that email, you’ll receive a password reset link. Check your inbox and spam folder.</p> :
      <form className="space-y-4" onSubmit={submit}>
        <label className="block text-sm font-medium">Reset email
          <input className="mt-1 h-12 w-full rounded-md border border-input bg-background px-3 text-base" type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={busy} className="h-12 w-full rounded-md bg-primary px-4 text-primary-foreground disabled:opacity-50">{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>}
    <button type="button" disabled={busy} onClick={onBack} className="text-sm underline">{backLabel}</button>
  </div>;
}
