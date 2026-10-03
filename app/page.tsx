'use client';
import { describeCareVersion } from '@/lib/maymay-conflict';

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  AlertCircle,
  BarChart3,
  Bell,
  Cloud,
  CloudOff,
  HeartHandshake,
  History,
  Home,
  Info,
  LoaderCircle,
  LogOut,
  Settings2,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FamilySetup } from './family-setup';
import { FamilyAccess } from './family-access';
import { JoinFamilyForm } from './join-family-form';
import { PatientForm } from './patient-form';
import { PasswordResetForm } from './password-reset-form';
import { AccountProfile, FamilyProfile, PatientProfileReadOnly } from './profile-settings';
import { TodayTracker } from './today-tracker';
import { ObservationHistory, ObservationInsights } from './observation-history';
import {
  connectFirebase,
  connectFirebaseWithGoogle,
  createFamily,
  createPatient,
  disconnectFirebase,
  loadRuntimeConfig,
  registerFirebaseAccount,
  resetFirebasePassword,
  refreshFirebaseConnection,
  restoreFirebase,
  selectFamilyPatient,
  updatePatient,
  updateAccountName,
  updateFamilyName,
  watchFirebaseAccess,
  type FirebaseConnection,
  type MayMayRuntimeConfig,
  type PatientFields,
} from '@/lib/maymay-firebase';
import { watchPendingRequests, type PendingRequest } from '@/lib/maymay-invitations';
import { useCareRecords } from '@/hooks/use-care-records';
import { useObservationHistory } from '@/hooks/use-observation-history';
import { useSpontaneousCatalog } from '@/hooks/use-spontaneous-catalog';
import { historyCutoffDate, localDateValue } from '@/lib/maymay-types';
import { ActivationPendingError } from '@/lib/maymay-database';

type SyncState = 'starting' | 'signed-out' | 'connecting' | 'connected' | 'error' | 'host-error' | 'maintenance';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field-wrap">
      <span className="field-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  );
}

function AccessScreen({
  mode,
  email,
  password,
  name,
  confirmPassword,
  busy,
  hostUnavailable,
  error,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onNameChange,
  onConfirmPasswordChange,
  onGoogleSignIn,
  onResetPassword,
  onSubmit,
}: {
  mode: 'sign-in' | 'register';
  email: string;
  password: string;
  name: string;
  confirmPassword: string;
  busy: boolean;
  hostUnavailable: boolean;
  error: string;
  onModeChange: (mode: 'sign-in' | 'register') => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onGoogleSignIn: () => void;
  onResetPassword: (email: string) => Promise<void>;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const [resetting, setResetting] = useState(false);
  return (
    <main className="access-shell">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand">
          <span><HeartHandshake aria-hidden="true" /></span>
          <div><b>MayMay</b><small>Daily care notes</small></div>
          <ThemeToggle />
        </div>
        {hostUnavailable ? (
          <div className="access-message">
            <CloudOff aria-hidden="true" />
            <div><h1 id="access-title">MayMay is not available</h1><p>Ask the host computer owner to start MayMay, then refresh this page.</p></div>
          </div>
        ) : resetting ? (
          <PasswordResetForm initialEmail={email} onReset={onResetPassword} onBack={() => setResetting(false)} />
        ) : (
          <>
            <div className="access-mode" aria-label="Account access">
              <button type="button" disabled={busy} data-active={mode === 'sign-in'} onClick={() => onModeChange('sign-in')}>Sign in</button>
              <button type="button" disabled={busy} data-active={mode === 'register'} onClick={() => onModeChange('register')}>Create account</button>
            </div>
              <>
                <div className="access-heading">
                  <p className="eyebrow">Your care space</p>
                  <h1 id="access-title">{mode === 'register' ? 'Create your account' : 'Sign in to continue'}</h1>
                  <p>{mode === 'register' ? 'Create your own family space or join an existing family.' : 'Sign in to your MayMay account.'}</p>
                </div>
                <Button variant="outline" className="google-auth-button" type="button" disabled={busy} onClick={onGoogleSignIn}>
                  <span className="google-mark" aria-hidden="true">G</span>
                  {busy ? 'Connecting…' : 'Continue with Google'}
                </Button>
                <div className="access-divider"><span>or use email</span></div>
                <form className="access-form" onSubmit={onSubmit}>
                  {mode === 'register' && <Field label="Your name"><Input className="h-12 text-base" autoComplete="name" value={name} onChange={(event) => onNameChange(event.target.value)} required /></Field>}
                  <Field label="Email"><Input className="h-12 text-base" type="email" autoComplete="username" value={email} onChange={(event) => onEmailChange(event.target.value)} required /></Field>
                  <Field label="Password"><Input className="h-12 text-base" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => onPasswordChange(event.target.value)} minLength={6} required /></Field>
                  {mode === 'register' && <Field label="Confirm password"><Input className="h-12 text-base" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => onConfirmPasswordChange(event.target.value)} minLength={6} required /></Field>}
                  {error && <p className="access-error" role="alert"><AlertCircle />{error}</p>}
                  <Button className="h-12 w-full text-base" type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}{busy ? (mode === 'register' ? 'Creating account…' : 'Signing in…') : (mode === 'register' ? 'Create account' : 'Sign in')}</Button>
                </form>
                {mode === 'sign-in' && <button type="button" disabled={busy} className="mt-3 text-sm underline" onClick={() => setResetting(true)}>Forgot password?</button>}
                <p className="access-private"><ShieldCheck />Firebase keeps this trusted device signed in. MayMay never stores the password.</p>
              </>
          </>
        )}
      </section>
    </main>
  );
}

export default function HomePage() {
  const today = localDateValue();
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState(today);
  const [hydrated, setHydrated] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>('starting');
  const [runtimeConfig, setRuntimeConfig] = useState<MayMayRuntimeConfig | null>(null);
  const [firebaseConnection, setFirebaseConnection] = useState<FirebaseConnection | null>(null);
  const [accessMode, setAccessMode] = useState<'sign-in' | 'register'>('sign-in');
  const [caregiverEmail, setCaregiverEmail] = useState('');
  const [caregiverPassword, setCaregiverPassword] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState('');
  const [familyBusy, setFamilyBusy] = useState(false);
  const [familyMessage, setFamilyMessage] = useState('');
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const connectionRef = useRef<FirebaseConnection | null>(null);
  const careRecords = useCareRecords(firebaseConnection, selectedDate);
  const observationHistory = useObservationHistory(firebaseConnection, activeTab);
  const spontaneousCatalog = useSpontaneousCatalog(firebaseConnection,
    careRecords.data.spontaneous.filter(item => item.date === selectedDate), careRecords.status);
  const currentRole = firebaseConnection?.profile.role;
  const isMaster = currentRole === 'master';
  const selectedFamily = firebaseConnection?.families.find(item => item.familyId === firebaseConnection.profile.familyId);
  useEffect(() => {
    if (!firebaseConnection) return;
    return watchFirebaseAccess(firebaseConnection, message => {
      connectionRef.current = null;
      setFirebaseConnection(null);
      setPendingRequests([]);
      setAuthError(message);
      setSyncState('signed-out');
    });
  }, [firebaseConnection]);
  useEffect(() => {
    if (!firebaseConnection || !firebaseConnection.families.some(family => family.role === 'Primary')) {
      queueMicrotask(() => setPendingRequests([]));
      return;
    }
    let alive = true;
    const stop = watchPendingRequests(firebaseConnection,
      requests => { if (alive) setPendingRequests(requests); },
      () => { if (alive) setPendingRequests([]); });
    return () => { alive = false; stop(); };
  }, [firebaseConnection]);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setHydrated(true);
    });
    const start = async () => {
      let config: MayMayRuntimeConfig;
      try {
        config = await loadRuntimeConfig();
        if (!alive) return;
        setRuntimeConfig(config);
        setSyncState('connecting');
      } catch (error) {
        if (!alive) return;
        setAuthError(error instanceof Error ? error.message : 'MayMay could not start.');
        setSyncState('host-error');
        return;
      }
      try {
        const connection = await restoreFirebase(config.firebase);
        if (!alive) return;
        if (!connection) {
          setSyncState('signed-out');
          return;
        }
        if (!alive) return;
        connectionRef.current = connection;
        setFirebaseConnection(connection);
        setCaregiverEmail(connection.user.email ?? '');
        setSyncState('connected');
      } catch (error) {
        if (!alive) return;
        setAuthError(error instanceof Error ? error.message : 'Please sign in again.');
        setSyncState(error instanceof ActivationPendingError ? 'maintenance' : 'signed-out');
      }
    };
    void start();
    return () => { alive = false; };
  }, []);

  function openEntry(date: string) {
    setSelectedDate(date);
    setActiveTab('today');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startBackfill() {
    const previous = new Date(`${today}T12:00:00`);
    previous.setDate(previous.getDate() - 1);
    openEntry(localDateValue(previous));
  }

  function useConnection(connection: FirebaseConnection) {
    connectionRef.current = connection;
    setFirebaseConnection(connection);
    setSelectedDate(localDateValue());
  }

  async function refreshFamilyContext() {
    const connection = connectionRef.current;
    if (!connection) return;
    try {
      useConnection(await refreshFirebaseConnection(connection, {
        familyId: connection.profile.familyId, patientId: connection.patientId,
      }));
    } catch { /* The current access state will be checked again on the next refresh. */ }
  }

  async function handleCreateFamily(name: string) {
    const connection = connectionRef.current;
    if (!connection) return;
    const created = await createFamily(connection, name);
    useConnection(created);
    setFamilyMessage('');
  }

  async function handleCreatePatient(familyId: string, fields: PatientFields) {
    const connection = connectionRef.current;
    if (!connection) return;
    useConnection(await createPatient(connection, familyId, fields));
  }

  async function handleUpdatePatient(fields: PatientFields) {
    const connection = connectionRef.current;
    if (!connection) return;
    useConnection(await updatePatient(connection, fields));
    setFamilyMessage('Patient details saved.');
  }

  async function handleUpdateAccountName(name: string) {
    const connection = connectionRef.current;
    if (!connection) return;
    useConnection(await updateAccountName(connection, name));
  }

  async function handleUpdateFamilyName(familyId: string, name: string) {
    const connection = connectionRef.current;
    if (!connection) return;
    useConnection(await updateFamilyName(connection, familyId, name));
  }

  function handleSelectFamilyPatient(familyId: string, patientId = '') {
    const connection = connectionRef.current;
    if (!connection) return;
    useConnection(selectFamilyPatient(connection, familyId, patientId));
  }

  async function handleSignIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtimeConfig) return;
    if (accessMode === 'register') {
      if (!caregiverName.trim()) { setAuthError('Enter your name.'); return; }
      if (caregiverPassword !== confirmPassword) {
        setAuthError('The passwords do not match.');
        return;
      }
      setAuthBusy(true);
      setAuthError('');
      try {
        const connection = await registerFirebaseAccount(
          runtimeConfig.firebase,
          caregiverName.trim(),
          caregiverEmail.trim(),
          caregiverPassword,
        );
        useConnection(connection);
        setCaregiverEmail(connection.user.email ?? caregiverEmail.trim());
        setCaregiverPassword('');
        setConfirmPassword('');
        setAccessMode('sign-in');
        setSyncState('connected');
      } catch (error) {
        if (error instanceof ActivationPendingError) { setSyncState('maintenance'); return; }
        const code = (error as { code?: string })?.code;
        const message = code === 'auth/email-already-in-use'
          ? 'An account already uses this email. Return to Sign in instead.'
          : code === 'auth/invalid-email'
            ? 'Enter a valid email address.'
            : code === 'auth/weak-password'
              ? 'Choose a stronger password with at least six characters.'
              : code === 'auth/operation-not-allowed'
                ? 'Registration is not enabled yet. Ask the host owner to enable Email/Password in Firebase Authentication.'
                : code === 'auth/network-request-failed'
                  ? 'Registration could not reach Firebase. Check the internet connection and try again.'
                  : error instanceof Error ? error.message : 'The account could not be created.';
        setAuthError(message);
      } finally {
        setAuthBusy(false);
      }
      return;
    }
    setAuthBusy(true);
    setAuthError('');
    try {
      const connection = await connectFirebase(
        runtimeConfig.firebase,
        caregiverEmail.trim(),
        caregiverPassword,
      );
      useConnection(connection);
      setCaregiverEmail(connection.user.email ?? '');
      setCaregiverPassword('');
      setAccessMode('sign-in');
      setSyncState('connected');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed. Check the account details.');
      setSyncState(error instanceof ActivationPendingError ? 'maintenance' : 'signed-out');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!runtimeConfig) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const connection = await connectFirebaseWithGoogle(runtimeConfig.firebase);
      useConnection(connection);
      setCaregiverEmail(connection.user.email ?? '');
      setCaregiverPassword('');
      setAccessMode('sign-in');
      setSyncState('connected');
    } catch (error) {
      if (error instanceof ActivationPendingError) { setSyncState('maintenance'); return; }
      const code = (error as { code?: string })?.code;
      const message = code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
        ? 'Google sign-in was closed before it finished.'
        : code === 'auth/popup-blocked'
          ? 'The browser blocked the Google sign-in window. Allow pop-ups for MayMay and try again.'
          : code === 'auth/unauthorized-domain'
            ? 'This MayMay address is not authorized for Google sign-in yet. Ask the host owner to add it under Firebase Authentication → Settings → Authorized domains.'
            : code === 'auth/operation-not-allowed'
              ? 'Google sign-in is not enabled yet. Ask the host owner to enable Google under Firebase Authentication → Sign-in method.'
              : code === 'auth/account-exists-with-different-credential'
                ? 'This email already has a password account. Sign in with email and password instead.'
                : code === 'auth/network-request-failed'
                  ? 'Google sign-in could not reach Firebase. Check the internet connection and try again.'
                  : error instanceof Error ? error.message : 'Google sign-in could not be completed.';
      setAuthError(message);
      setSyncState('signed-out');
    } finally {
      setAuthBusy(false);
    }
  }

  function changeAccessMode(mode: 'sign-in' | 'register') {
    setAccessMode(mode);
    setAuthError('');
    setCaregiverPassword('');
    setConfirmPassword('');
  }

  async function handleSignOut() {
    const connection = connectionRef.current;
    connectionRef.current = null;
    setFirebaseConnection(null);
    setFamilyMessage('');
    setActiveTab('today');
    setCaregiverPassword('');
    setSyncState('signed-out');
    if (connection) {
      try { await disconnectFirebase(connection); }
      catch { setAuthError('Sign-out could not finish. Please retry before sharing this device.'); }
    }
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: 'open_daily_entry',
          title: 'Open daily entry',
          description: 'Open the MayMay daily check-in for a specific date without changing its saved information.',
          inputSchema: {
            type: 'object',
            properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
            required: ['date'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute(input) {
            const date = (input as { date?: unknown })?.date;
            if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must use YYYY-MM-DD');
            if (date > localDateValue()) throw new Error('Choose today or an earlier date');
            if (date < historyCutoffDate()) throw new Error('date must be within the last three years');
            setSelectedDate(date);
            setActiveTab('today');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return { opened: date };
          },
        },
        { signal: lifecycle.signal },
      );

    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  if (!hydrated || syncState === 'starting' || syncState === 'connecting'
    || (syncState === 'connected' && Boolean(firebaseConnection?.patientId) && careRecords.status === 'loading')) {
    return (
      <main className="access-shell">
        <output className="access-loading"><LoaderCircle className="animate-spin" /><span>Starting MayMay…</span></output>
      </main>
    );
  }

  if (syncState === 'signed-out' || syncState === 'host-error') {
    return (
      <AccessScreen
        mode={accessMode}
        email={caregiverEmail}
        password={caregiverPassword}
        name={caregiverName}
        confirmPassword={confirmPassword}
        busy={authBusy}
        hostUnavailable={syncState === 'host-error'}
        error={authError}
        onModeChange={changeAccessMode}
        onEmailChange={setCaregiverEmail}
        onPasswordChange={setCaregiverPassword}
        onNameChange={setCaregiverName}
        onConfirmPasswordChange={setConfirmPassword}
        onGoogleSignIn={handleGoogleSignIn}
        onResetPassword={email => resetFirebasePassword(runtimeConfig!.firebase, email)}
        onSubmit={handleSignIn}
      />
    );
  }

  if (syncState === 'maintenance') {
    return <main className="access-shell"><section className="access-card">
      <div className="access-message"><Info aria-hidden="true" /><div><h1>MayMay setup or maintenance</h1>
        <p>Data activation is pending. Ask the host owner to finish setup, then refresh this page.</p></div></div>
      <Button variant="outline" className="mt-5" onClick={() => window.location.reload()}>Refresh</Button>
    </section></main>;
  }

  if (firebaseConnection && !firebaseConnection.patientId) {
    return <FamilySetup
      connection={firebaseConnection}
      onCreateFamily={handleCreateFamily}
      onCreatePatient={handleCreatePatient}
      onSelectFamily={familyId => handleSelectFamilyPatient(familyId)}
      onChanged={useConnection}
      onMembershipsChanged={() => { void refreshFamilyContext(); }}
      onSignOut={() => { void handleSignOut(); }}
    />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="app-header">
        <div className="mx-auto flex w-full max-w-[1160px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="brand-mark" aria-hidden="true"><HeartHandshake className="size-5" strokeWidth={2.2} /></div>
            <div>
              <p className="font-heading text-[1.25rem] font-bold leading-none tracking-[-0.03em]">MayMay</p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">Daily care notes</p>
            </div>
          </div>
          <div className="header-actions">
            <ThemeToggle />
            {firebaseConnection?.families.some(family => family.role === 'Primary') && <details className="relative">
              <summary className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-2 text-sm" aria-label={`Approval notifications: ${pendingRequests.length}`}>
                <Bell className="size-4" />{pendingRequests.length > 0 && <b>{pendingRequests.length}</b>}
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-64 space-y-2 rounded-xl border bg-card p-3 shadow-lg">
                <b className="text-sm">Requests waiting</b>
                {pendingRequests.length ? pendingRequests.map(request => <button key={request.familyId + request.userId} className="block w-full rounded-md p-2 text-left text-sm hover:bg-muted" onClick={() => {
                  handleSelectFamilyPatient(request.familyId);
                  setActiveTab('settings');
                }}>{request.requesterName} · {request.familyName}</button>) : <p className="text-sm text-muted-foreground">No requests right now.</p>}
              </div>
            </details>}
            {firebaseConnection && firebaseConnection.families.length > 1 && <label className="text-xs font-medium">Family
              <select className="ml-2 h-9 rounded-md border bg-background px-2 text-sm" value={firebaseConnection.profile.familyId} onChange={event => handleSelectFamilyPatient(event.target.value)}>
                {firebaseConnection.families.map(family => <option key={family.familyId} value={family.familyId}>{family.name}</option>)}
              </select>
            </label>}
            {selectedFamily && selectedFamily.patients.length > 1 && <label className="text-xs font-medium">Patient
              <select className="ml-2 h-9 rounded-md border bg-background px-2 text-sm" value={firebaseConnection?.patientId ?? ''} onChange={event => handleSelectFamilyPatient(selectedFamily.familyId, event.target.value)}>
                {selectedFamily.patients.map(patient => <option key={patient.patientId} value={patient.patientId}>{patient.name}</option>)}
              </select>
            </label>}
            {activeTab !== 'today' && <div className="sync-pill" aria-live="polite" aria-label={`Data storage status: ${careRecords.status === 'saved' ? 'Firestore synced' : 'sync pending'}`}>
              {careRecords.status === 'saved' ? <Cloud /> : <CloudOff />}
              <span>{careRecords.status === 'saved' ? 'Firestore synced' : 'Sync pending'}</span>
            </div>}
            <Button variant="outline" size="icon-lg" aria-label="Sign out" onClick={handleSignOut}><LogOut /></Button>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-auto w-full max-w-[1160px] px-4 pb-28 pt-5 sm:px-6 sm:pb-10 lg:px-8">
        <TabsList className="top-nav" aria-label="MayMay sections">
          <TabsTrigger value="today" className="top-nav-item"><Home data-icon="inline-start" /> Today</TabsTrigger>
          <TabsTrigger value="insights" className="top-nav-item"><BarChart3 data-icon="inline-start" /> Insights</TabsTrigger>
          <TabsTrigger value="history" className="top-nav-item"><History data-icon="inline-start" /> History</TabsTrigger>
          <TabsTrigger value="settings" className="top-nav-item"><Settings2 data-icon="inline-start" /> Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-5">
          <TodayTracker
            key={`${firebaseConnection?.profile.familyId}:${firebaseConnection?.patientId}:${selectedDate}`}
            patientName={firebaseConnection?.patient?.name ?? 'Patient'}
            date={selectedDate} onDateChange={setSelectedDate}
            data={careRecords.data} onChange={careRecords.change}
            readOnly={currentRole === 'viewer'}
            saveStatus={careRecords.status} saveMessage={careRecords.message}
            previousEvents={spontaneousCatalog.previous}
            repeatCounts={spontaneousCatalog.counts}
            hasMorePreviousEvents={spontaneousCatalog.hasMore}
            onLoadMoreEvents={spontaneousCatalog.loadMore}
          />
          {careRecords.status === 'error' && <div role="alert" className="mx-auto mt-4 max-w-3xl rounded-xl border border-amber-300 bg-card p-4">
            <p>{careRecords.message}</p>
            <Button variant="outline" className="mt-2" onClick={careRecords.retry}>Retry</Button>
          </div>}
          {careRecords.conflicts.map(conflict => <section key={`${conflict.target}:${conflict.recordId}`} className="mx-auto mt-4 max-w-3xl rounded-xl border border-amber-300 bg-card p-4">
            <h2 className="font-semibold">Another caregiver changed this record</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><b>Saved version</b><p className="mt-1 whitespace-pre-wrap text-sm">{describeCareVersion(conflict.remote)}</p></div>
              <div><b>Your edit</b><p className="mt-1 whitespace-pre-wrap text-sm">{describeCareVersion(conflict.local)}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => careRecords.choose(conflict.recordId, conflict.target, false)}>Use saved version</Button>
              <Button variant="outline" onClick={() => careRecords.choose(conflict.recordId, conflict.target, true)}>Save my edit instead</Button>
            </div>
          </section>)}
        </TabsContent>

        <TabsContent value="insights" className="mt-5">
          <ObservationInsights observations={observationHistory.observations} loading={observationHistory.loading}
            error={observationHistory.error} rangeStart={observationHistory.windows.at(-1)?.start ?? null}
            rangeEnd={today} hasMore={observationHistory.hasMore} onLoadMore={() => { void observationHistory.loadMore(); }}
            onRefresh={observationHistory.refresh} onOpenDay={openEntry} />
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <ObservationHistory observations={observationHistory.observations} loading={observationHistory.loading}
            error={observationHistory.error} rangeStart={observationHistory.windows.at(-1)?.start ?? null}
            rangeEnd={today} hasMore={observationHistory.hasMore} onLoadMore={() => { void observationHistory.loadMore(); }}
            onRefresh={observationHistory.refresh} onOpenDay={openEntry} onAddPastDay={startBackfill} />
        </TabsContent>
        <TabsContent value="settings" className="mt-5">
          <div className="page-intro">
            <div><p className="eyebrow">Your care space</p><h1>Settings</h1><p>Manage your families and patient details.</p></div>
          </div>

          <div className="settings-grid mt-5">
            <Card>
              <CardHeader><CardTitle className="text-xl font-bold">Your account</CardTitle></CardHeader>
              <CardContent>{firebaseConnection && <AccountProfile key={`${firebaseConnection.user.uid}:${firebaseConnection.accountName}`}
                connection={firebaseConnection} onSave={handleUpdateAccountName}
                onResetPassword={email => resetFirebasePassword(runtimeConfig!.firebase, email)}
                onSignOut={() => { void handleSignOut(); }} />}</CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-xl font-bold">Families</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {selectedFamily && <FamilyProfile key={`${selectedFamily.familyId}:${selectedFamily.name}`} family={selectedFamily}
                  onSave={name => handleUpdateFamilyName(selectedFamily.familyId, name)} />}
                {firebaseConnection && firebaseConnection.families.length > 1 && <p className="text-sm text-muted-foreground">Use the family selector above to switch families.</p>}
                <form className="flex flex-wrap items-end gap-3" onSubmit={async event => {
                  event.preventDefault();
                  setFamilyBusy(true);
                  setFamilyMessage('');
                  try { await handleCreateFamily(newFamilyName); setNewFamilyName(''); }
                  catch (error) { setFamilyMessage(error instanceof Error ? error.message : 'Could not create the family.'); }
                  finally { setFamilyBusy(false); }
                }}>
                  <Field label="New family name"><Input value={newFamilyName} onChange={event => setNewFamilyName(event.target.value)} required maxLength={100} /></Field>
                  <Button type="submit" disabled={familyBusy}>{familyBusy ? 'Creating…' : 'Create family'}</Button>
                </form>
                {familyMessage && <output role="status">{familyMessage}</output>}
              </CardContent>
            </Card>
            {isMaster && firebaseConnection && <FamilyAccess connection={firebaseConnection} onChanged={() => { void refreshFamilyContext(); }} />}
            {firebaseConnection && <JoinFamilyForm connection={firebaseConnection} onChanged={useConnection} />}
            {selectedFamily && firebaseConnection?.patient && <Card>
              <CardHeader><CardTitle className="text-xl font-bold">Patient details</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {isMaster ? <PatientForm key={`${firebaseConnection.patient.patientId}:${String(firebaseConnection.patient.dateUpdated)}`} action="Save patient details" initial={firebaseConnection.patient} onSave={handleUpdatePatient} />
                  : <PatientProfileReadOnly patient={firebaseConnection.patient} />}
                {isMaster && <details className="border-t pt-4"><summary className="cursor-pointer font-medium">Add another patient</summary>
                  <div className="mt-4"><PatientForm key={selectedFamily.familyId + '-new'} action="Add patient" resetOnSave onSave={fields => handleCreatePatient(selectedFamily.familyId, fields)} /></div>
                </details>}
              </CardContent>
            </Card>}
          </div>
        </TabsContent>
      </Tabs>

    </main>
  );
}
