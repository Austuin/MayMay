'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  HeartHandshake,
  History,
  Home,
  Info,
  LoaderCircle,
  LogOut,
  Moon,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Utensils,
  WifiOff,
  Zap,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  connectFirebase,
  connectFirebaseWithGoogle,
  disconnectFirebase,
  loadRuntimeConfig,
  pullRemoteEntries,
  pushEntry,
  registerFirebaseAccount,
  restoreFirebase,
  type FirebaseConnection,
  type MayMayRuntimeConfig,
} from '@/lib/maymay-firebase';
import { meltdownEstimate, summarizeEntries } from '@/lib/maymay-insights';
import { loadLocalEntries, mergeEntries, saveLocalEntries } from '@/lib/maymay-storage';
import {
  createPossibleTrigger,
  createMeltdown,
  emptyEntry,
  historyCutoffDate,
  localDateValue,
  type DailyEntry,
  type MeltdownEvent,
  type MoodPeriod,
  type PossibleTriggerEvent,
} from '@/lib/maymay-types';

const moods = [
  { score: 5, label: 'Great', face: '😊', tone: 'bg-sky-100 text-sky-950' },
  { score: 4, label: 'Good', face: '🙂', tone: 'bg-cyan-100 text-cyan-950' },
  { score: 3, label: 'Okay', face: '😐', tone: 'bg-amber-100 text-amber-950' },
  { score: 2, label: 'Struggling', face: '😟', tone: 'bg-orange-100 text-orange-950' },
  { score: 1, label: 'Hard', face: '😣', tone: 'bg-rose-100 text-rose-950' },
];

const moodTags = ['Calm', 'Energetic', 'Tired', 'Anxious', 'Irritable', 'Sad', 'Excited', 'Hard to tell'];
const schoolOptions = ['Attended', 'Stayed home', 'Not scheduled'];
const healthOptions = ['Great', 'A little unwell', 'Sick', 'Recovering', 'Not sure'];
const mealOutcomes = ['Ate well', 'Ate some', 'Very little', 'Refused', 'Not offered'];
const triggers = [
  'Change in routine',
  'Transition',
  'Sensory overload',
  'Communication difficulty',
  'Denied access / waiting',
  'Food / eating',
  'School',
  'Pain / illness',
  'Unknown',
  'Other',
];
const helpfulOptions = [
  'Quiet / space',
  'Comfort and reassurance',
  'Sensory support',
  'Food / drink',
  'Preferred activity / item',
  'Change of environment',
  'Time',
  'Nothing / not sure',
];
const durationOptions = ['Under 5 min', '5–15 min', '15–30 min', '30–60 min', '60+ min'];
const intensityOptions = ['Mild', 'Moderate', 'High'];
const observedEffectOptions = ['No visible effect', 'Mild stress', 'Moderate stress', 'Strong stress', 'Not sure'];

const chartConfig = {
  mood: { label: 'Mood', color: 'var(--chart-1)' },
  meltdowns: { label: 'Meltdowns', color: 'var(--chart-4)' },
} satisfies ChartConfig;

type SyncState = 'starting' | 'signed-out' | 'connecting' | 'connected' | 'error' | 'host-error';

function displayDate(date: string, includeWeekday = true) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Choose a date';
  return new Intl.DateTimeFormat('en-US', {
    ...(includeWeekday ? { weekday: 'long' as const } : {}),
    month: 'long',
    day: 'numeric',
    year: new Date().getFullYear() !== Number(date.slice(0, 4)) ? 'numeric' : undefined,
  }).format(new Date(`${date}T12:00:00`));
}

function entryMoodAverage(entry: DailyEntry) {
  const scores = Object.values(entry.moods).map((period) => period.score).filter((score): score is number => Boolean(score));
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

function entryMoodTags(entry: DailyEntry) {
  return [...new Set(Object.values(entry.moods).flatMap((period) => period.tags))];
}

function PillGroup({
  label,
  options,
  value,
  onChange,
  multiple = false,
}: {
  label: string;
  options: string[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <fieldset className="chip-group" aria-label={label}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            className="choice-chip"
            data-selected={active}
            aria-pressed={active}
            onClick={() => {
              if (!multiple) return onChange(option);
              onChange(active ? selected.filter((item) => item !== option) : [...selected, option]);
            }}
          >
            {active && <Check className="size-3.5" />}
            {option}
          </button>
        );
      })}
    </fieldset>
  );
}

function MoodPeriodPanel({
  period,
  value,
  onChange,
}: {
  period: 'morning' | 'afternoon' | 'evening';
  value: MoodPeriod;
  onChange: (next: MoodPeriod) => void;
}) {
  return (
    <section className="mood-period" aria-labelledby={`${period}-mood-heading`}>
      <div className="mood-period-heading">
        <span aria-hidden="true">{period === 'morning' ? '☀️' : period === 'afternoon' ? '🌤️' : '🌙'}</span>
        <div>
          <h3 id={`${period}-mood-heading`}>How did his {period} feel?</h3>
          <p>Choose the closest fit, then add any useful details.</p>
        </div>
      </div>
      <fieldset className="mood-grid" aria-label={`${period} mood`}>
        {moods.map((item) => {
          const selected = value.score === item.score;
          return (
            <button key={item.score} type="button" className="mood-option" data-selected={selected} aria-pressed={selected} onClick={() => onChange({ ...value, score: item.score })}>
              <span className={`mood-face ${item.tone}`} aria-hidden="true">{item.face}</span>
              <span>{item.label}</span>
              {selected && <Check className="mood-check" aria-hidden="true" />}
            </button>
          );
        })}
      </fieldset>
      <div className="mt-4">
        <p className="field-label">What else fits this {period}?</p>
        <PillGroup label={`${period} mood details`} options={moodTags} value={value.tags} multiple onChange={(tags) => onChange({ ...value, tags: tags as string[] })} />
      </div>
    </section>
  );
}

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

function SelectField({
  label,
  value,
  options,
  placeholder = 'Choose one',
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value || null} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger className="h-11 w-full bg-card text-base">
          <SelectValue placeholder={placeholder}>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function MeltdownCard({
  event,
  number,
  onChange,
  onRemove,
}: {
  event: MeltdownEvent;
  number: number;
  onChange: (patch: Partial<MeltdownEvent>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="meltdown-card">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(!open)}>
          <span className="section-icon bg-rose-100 text-rose-800"><Zap className="size-5" /></span>
          <span className="min-w-0">
            <b className="block text-base">Meltdown {number}</b>
            <small className="block truncate text-muted-foreground">
              {[event.time, event.trigger, event.duration].filter(Boolean).join(' · ') || 'Add what you noticed'}
            </small>
          </span>
          <ChevronDown className={`ml-auto size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <Button variant="destructive" size="icon" aria-label={`Remove meltdown ${number}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      {open && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Time" hint="optional">
            <Input className="h-11 bg-card text-base" type="time" value={event.time} onChange={(e) => onChange({ time: e.target.value })} />
          </Field>
          <SelectField label="Duration" value={event.duration} options={durationOptions} onChange={(duration) => onChange({ duration })} />
          <SelectField label="Intensity" value={event.intensity} options={intensityOptions} onChange={(intensity) => onChange({ intensity })} />
          <SelectField label="Likely trigger" value={event.trigger} options={triggers} onChange={(trigger) => onChange({ trigger })} />
          {event.trigger === 'Other' && (
            <Field label="Other trigger">
              <Input className="h-11 bg-card text-base" value={event.triggerOther} onChange={(e) => onChange({ triggerOther: e.target.value })} />
            </Field>
          )}
          <SelectField label="What helped most?" value={event.whatHelped} options={helpfulOptions} onChange={(whatHelped) => onChange({ whatHelped })} />
          <div className="sm:col-span-2">
            <Field label="Early signs" hint="optional">
              <Input className="h-11 bg-card text-base" placeholder="What happened just before?" value={event.earlySigns} onChange={(e) => onChange({ earlySigns: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <p className="field-label">Aggression or risk of harm?</p>
            <PillGroup label="Aggression or risk of harm" options={['No', 'Yes']} value={event.aggression} onChange={(aggression) => onChange({ aggression: String(aggression) })} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Event notes" hint="optional">
              <Textarea className="min-h-24 bg-card text-base" placeholder="Brief, factual notes about what happened and what helped…" value={event.notes} onChange={(e) => onChange({ notes: e.target.value })} />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}

function PossibleTriggerCard({
  event,
  number,
  onChange,
  onRemove,
}: {
  event: PossibleTriggerEvent;
  number: number;
  onChange: (patch: Partial<PossibleTriggerEvent>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="trigger-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="section-icon bg-amber-100 text-amber-900"><Info className="size-5" /></span>
          <span>
            <b className="block text-base">Possible trigger or change {number}</b>
            <small className="block text-muted-foreground">Record an observation without assuming it caused anything.</small>
          </span>
        </div>
        <Button variant="ghost" size="icon" aria-label={`Remove possible trigger ${number}`} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Time" hint="optional">
          <Input className="h-11 bg-card text-base" type="time" value={event.time} onChange={(e) => onChange({ time: e.target.value })} />
        </Field>
        <SelectField label="Category" value={event.category} options={triggers} onChange={(category) => onChange({ category })} />
        {event.category === 'Other' && (
          <Field label="Other category">
            <Input className="h-11 bg-card text-base" value={event.categoryOther} onChange={(e) => onChange({ categoryOther: e.target.value })} />
          </Field>
        )}
        <SelectField label="Observed effect" value={event.observedEffect} options={observedEffectOptions} onChange={(observedEffect) => onChange({ observedEffect })} />
        <div className="sm:col-span-2">
          <Field label="Brief context" hint="optional">
            <Input className="h-11 bg-card text-base" placeholder="What changed or happened nearby?" value={event.notes} onChange={(e) => onChange({ notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </div>
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
  registrationComplete,
  onModeChange,
  onEmailChange,
  onPasswordChange,
  onNameChange,
  onConfirmPasswordChange,
  onGoogleSignIn,
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
  registrationComplete: string;
  onModeChange: (mode: 'sign-in' | 'register') => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onGoogleSignIn: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="access-shell">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand">
          <span><HeartHandshake aria-hidden="true" /></span>
          <div><b>MayMay</b><small>Daily care notes</small></div>
        </div>
        {hostUnavailable ? (
          <div className="access-message">
            <CloudOff aria-hidden="true" />
            <div><h1 id="access-title">MayMay is not available</h1><p>Ask the host computer owner to start MayMay, then refresh this page.</p></div>
          </div>
        ) : (
          <>
            <div className="access-mode" aria-label="Account access">
              <button type="button" data-active={mode === 'sign-in'} onClick={() => onModeChange('sign-in')}>Sign in</button>
              <button type="button" data-active={mode === 'register'} onClick={() => onModeChange('register')}>Create account</button>
            </div>
            {mode === 'register' && registrationComplete ? (
              <div className="registration-complete">
                <CheckCircle2 aria-hidden="true" />
                <div>
                  <h1 id="access-title">Account created</h1>
                  <p>Ask the MayMay host owner to approve <b>{registrationComplete}</b>. They can enter <code>caregiver {registrationComplete}</code> in the host terminal.</p>
                  <Button className="mt-5 h-11" type="button" onClick={() => onModeChange('sign-in')}>Return to sign in <ArrowRight /></Button>
                </div>
              </div>
            ) : (
              <>
                <div className="access-heading">
                  <p className="eyebrow">Trusted caregivers</p>
                  <h1 id="access-title">{mode === 'register' ? 'Create a caregiver account' : 'Sign in to continue'}</h1>
                  <p>{mode === 'register' ? 'Register here, then ask the host owner to approve your account before signing in.' : 'Use your approved MayMay caregiver account.'}</p>
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
                <p className="access-private"><ShieldCheck />{mode === 'register' ? 'Registration does not grant access. The host owner must approve every new caregiver.' : 'Firebase keeps this trusted device signed in. MayMay never stores the password.'}</p>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default function HomePage() {
  const today = localDateValue();
  const historyCutoff = historyCutoffDate();
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState(today);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveMessage, setSaveMessage] = useState('Ready');
  const [syncState, setSyncState] = useState<SyncState>('starting');
  const [runtimeConfig, setRuntimeConfig] = useState<MayMayRuntimeConfig | null>(null);
  const [accessMode, setAccessMode] = useState<'sign-in' | 'register'>('sign-in');
  const [caregiverEmail, setCaregiverEmail] = useState('');
  const [caregiverPassword, setCaregiverPassword] = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registrationComplete, setRegistrationComplete] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const connectionRef = useRef<FirebaseConnection | null>(null);
  const pendingDates = useRef(new Set<string>());
  const entriesRef = useRef<DailyEntry[]>([]);
  const selectedDateRef = useRef(selectedDate);
  const sleepRef = useRef<HTMLDivElement>(null);
  const foodRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const meltdownRef = useRef<HTMLDivElement>(null);

  const entry = useMemo(
    () => entries.find((item) => item.date === selectedDate) ?? emptyEntry(selectedDate),
    [entries, selectedDate],
  );
  const summary = useMemo(() => summarizeEntries(entries), [entries]);
  const risk = useMemo(() => meltdownEstimate(entries, entry), [entries, entry]);
  const isBackfill = selectedDate < today;
  const progressItems = [
    entry.moods.morning.score,
    entry.moods.afternoon.score,
    entry.moods.evening.score,
    entry.schoolStatus,
    entry.healthStatus,
    entry.sleepQuality,
    Object.values(entry.meals).some(Boolean),
    entry.bathroom.bowelMovement,
  ];
  const progressCount = progressItems.filter(Boolean).length;

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    let alive = true;
    const local = loadLocalEntries();
    queueMicrotask(() => {
      if (!alive) return;
      setEntries(local);
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
        const connection = await restoreFirebase(config.firebase, config.childId);
        if (!alive) return;
        if (!connection) {
          setSyncState('signed-out');
          return;
        }
        const remote = await pullRemoteEntries(connection);
        if (!alive) return;
        connectionRef.current = connection;
        const merged = mergeEntries(local, remote);
        setEntries(merged);
        saveLocalEntries(merged);
        setCaregiverEmail(connection.user.email ?? '');
        setSyncState('connected');
        setSaveMessage('Connected and up to date');
      } catch (error) {
        if (!alive) return;
        setAuthError(error instanceof Error ? error.message : 'Please sign in again.');
        setSyncState('signed-out');
      }
    };
    void start();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!hydrated || pendingDates.current.size === 0) return;
    setSaveMessage('Saving…');
    const timer = window.setTimeout(async () => {
      const dates = [...pendingDates.current];
      pendingDates.current.clear();
      const currentEntries = entriesRef.current;
      saveLocalEntries(currentEntries);
      const connection = connectionRef.current;
      if (connection) {
        try {
          await Promise.all(
            dates.map((date) => currentEntries.find((item) => item.date === date))
              .filter((item): item is DailyEntry => Boolean(item))
              .map((item) => pushEntry(connection, item)),
          );
          setSaveMessage('Saved locally and synced');
        } catch {
          setSaveMessage('Saved locally · sync will retry after your next change');
          setSyncState('error');
        }
      } else {
        setSaveMessage('Saved on this device');
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [entries, hydrated]);

  function replaceEntry(next: DailyEntry) {
    pendingDates.current.add(next.date);
    setEntries((current) =>
      [...current.filter((item) => item.date !== next.date), next]
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  function updateEntry(patch: Partial<DailyEntry> | ((current: DailyEntry) => DailyEntry)) {
    const current = entriesRef.current.find((item) => item.date === selectedDate) ?? emptyEntry(selectedDate);
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    replaceEntry({ ...next, date: selectedDate, version: 3, updatedAt: new Date().toISOString() });
  }

  function updateMeltdown(id: string, patch: Partial<MeltdownEvent>) {
    updateEntry((current) => ({
      ...current,
      meltdowns: current.meltdowns.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function updatePossibleTrigger(id: string, patch: Partial<PossibleTriggerEvent>) {
    updateEntry((current) => ({
      ...current,
      possibleTriggers: current.possibleTriggers.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function addPossibleTrigger() {
    updateEntry((current) => ({
      ...current,
      possibleTriggers: [...current.possibleTriggers, createPossibleTrigger()],
    }));
    window.setTimeout(() => triggerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function addMeltdown() {
    updateEntry((current) => ({ ...current, meltdowns: [...current.meltdowns, createMeltdown()] }));
    window.setTimeout(() => meltdownRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

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

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtimeConfig) return;
    if (accessMode === 'register') {
      if (caregiverPassword !== confirmPassword) {
        setAuthError('The passwords do not match.');
        return;
      }
      setAuthBusy(true);
      setAuthError('');
      try {
        const account = await registerFirebaseAccount(
          runtimeConfig.firebase,
          caregiverName.trim(),
          caregiverEmail.trim(),
          caregiverPassword,
        );
        setRegistrationComplete(account.email);
        setCaregiverPassword('');
        setConfirmPassword('');
      } catch (error) {
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
        runtimeConfig.childId,
      );
      const remote = await pullRemoteEntries(connection);
      const merged = mergeEntries(entriesRef.current, remote);
      connectionRef.current = connection;
      setEntries(merged);
      saveLocalEntries(merged);
      if (connection.profile.role !== 'viewer') {
        await Promise.all(merged.map((item) => pushEntry(connection, item)));
      }
      setCaregiverPassword('');
      setSyncState('connected');
      setSaveMessage('Connected and up to date');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Sign-in failed. Check the account details.');
      setSyncState('signed-out');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleGoogleSignIn() {
    if (!runtimeConfig) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      const connection = await connectFirebaseWithGoogle(
        runtimeConfig.firebase,
        runtimeConfig.childId,
      );
      const remote = await pullRemoteEntries(connection);
      const merged = mergeEntries(entriesRef.current, remote);
      connectionRef.current = connection;
      setEntries(merged);
      saveLocalEntries(merged);
      setCaregiverEmail(connection.user.email ?? '');
      if (connection.profile.role !== 'viewer') {
        await Promise.all(merged.map((item) => pushEntry(connection, item)));
      }
      setAccessMode('sign-in');
      setSyncState('connected');
      setSaveMessage('Connected and up to date');
    } catch (error) {
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
    if (mode === 'register') setRegistrationComplete('');
  }

  async function handleSignOut() {
    if (connectionRef.current) await disconnectFirebase(connectionRef.current);
    connectionRef.current = null;
    setCaregiverPassword('');
    setSyncState('signed-out');
    setSaveMessage('Signed out');
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
            if (date < historyCutoffDate()) throw new Error('date must be within the last three years');
            setSelectedDate(date);
            setActiveTab('today');
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return { opened: date };
          },
        },
        { signal: lifecycle.signal },
      );
      await context.registerTool(
        {
          name: 'save_daily_checkin',
          title: 'Save daily check-in',
          description: 'Save morning, afternoon, and evening mood details plus school status and notes for one MayMay daily entry.',
          inputSchema: {
            type: 'object',
            properties: {
              date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
              morning: {
                type: 'object',
                properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, tags: { type: 'array', items: { type: 'string' } } },
                additionalProperties: false,
              },
              afternoon: {
                type: 'object',
                properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, tags: { type: 'array', items: { type: 'string' } } },
                additionalProperties: false,
              },
              evening: {
                type: 'object',
                properties: { score: { type: 'integer', minimum: 1, maximum: 5 }, tags: { type: 'array', items: { type: 'string' } } },
                additionalProperties: false,
              },
              schoolStatus: { type: 'string' },
              healthStatus: { type: 'string', enum: healthOptions },
              healthNotes: { type: 'string' },
              notes: { type: 'string' },
            },
            required: ['date'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute(input) {
            const value = input as {
              date?: string;
              morning?: Partial<MoodPeriod>;
              afternoon?: Partial<MoodPeriod>;
              evening?: Partial<MoodPeriod>;
              schoolStatus?: string;
              healthStatus?: string;
              healthNotes?: string;
              notes?: string;
            };
            if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) throw new Error('date must use YYYY-MM-DD');
            if (value.date < historyCutoffDate()) throw new Error('date must be within the last three years');
            for (const period of [value.morning, value.afternoon, value.evening]) {
              if (period?.score != null && (!Number.isInteger(period.score) || period.score < 1 || period.score > 5)) throw new Error('each mood score must be an integer from 1 to 5');
            }
            if (value.healthStatus && !healthOptions.includes(value.healthStatus)) throw new Error('healthStatus must be one of the available Health options');
            const current = entriesRef.current.find((item) => item.date === value.date) ?? emptyEntry(value.date);
            const next = {
              ...current,
              moods: {
                morning: value.morning ? { score: value.morning.score ?? current.moods.morning.score, tags: value.morning.tags?.map(String) ?? current.moods.morning.tags } : current.moods.morning,
                afternoon: value.afternoon ? { score: value.afternoon.score ?? current.moods.afternoon.score, tags: value.afternoon.tags?.map(String) ?? current.moods.afternoon.tags } : current.moods.afternoon,
                evening: value.evening ? { score: value.evening.score ?? current.moods.evening.score, tags: value.evening.tags?.map(String) ?? current.moods.evening.tags } : current.moods.evening,
              },
              ...(typeof value.schoolStatus === 'string' ? { schoolStatus: value.schoolStatus } : {}),
              ...(typeof value.healthStatus === 'string' ? { healthStatus: value.healthStatus } : {}),
              ...(typeof value.healthNotes === 'string' ? { healthNotes: value.healthNotes } : {}),
              ...(typeof value.notes === 'string' ? { notes: value.notes } : {}),
              updatedAt: new Date().toISOString(),
            };
            pendingDates.current.add(next.date);
            setEntries((currentEntries) =>
              [...currentEntries.filter((item) => item.date !== next.date), next]
                .sort((a, b) => a.date.localeCompare(b.date)),
            );
            setSelectedDate(value.date);
            setActiveTab('today');
            return { saved: value.date, storage: connectionRef.current ? 'local-and-firestore' : 'local-device' };
          },
        },
        { signal: lifecycle.signal },
      );
    };
    void register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  if (!hydrated || syncState === 'starting' || syncState === 'connecting') {
    return (
      <main className="access-shell">
        <div className="access-loading" role="status"><LoaderCircle className="animate-spin" /><span>Starting MayMay…</span></div>
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
        registrationComplete={registrationComplete}
        onModeChange={changeAccessMode}
        onEmailChange={setCaregiverEmail}
        onPasswordChange={setCaregiverPassword}
        onNameChange={setCaregiverName}
        onConfirmPasswordChange={setConfirmPassword}
        onGoogleSignIn={handleGoogleSignIn}
        onSubmit={handleSignIn}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="app-header">
        <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="brand-mark" aria-hidden="true"><HeartHandshake className="size-5" strokeWidth={2.2} /></div>
            <div>
              <p className="font-heading text-[1.25rem] font-bold leading-none tracking-[-0.03em]">MayMay</p>
              <p className="mt-1 text-xs font-medium text-muted-foreground">Daily care notes</p>
            </div>
          </div>
          <div className="header-actions">
            <div className="sync-pill" aria-live="polite" aria-label={`Data storage status: ${syncState === 'connected' ? 'Firestore synced' : 'saved locally; sync paused'}`}>
              {syncState === 'connected' ? <Cloud /> : <CloudOff />}
              <span>{syncState === 'connected' ? 'Firestore synced' : 'Saved locally · sync paused'}</span>
            </div>
            <Button variant="outline" size="icon-lg" aria-label="Sign out" onClick={handleSignOut}><LogOut /></Button>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mx-auto w-full max-w-[1160px] px-4 pb-28 pt-5 sm:px-6 sm:pb-10 lg:px-8">
        <TabsList className="top-nav" aria-label="MayMay sections">
          <TabsTrigger value="today" className="top-nav-item"><Home data-icon="inline-start" /> Today</TabsTrigger>
          <TabsTrigger value="insights" className="top-nav-item"><BarChart3 data-icon="inline-start" /> Insights</TabsTrigger>
          <TabsTrigger value="history" className="top-nav-item"><History data-icon="inline-start" /> History</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-5">
          <section className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-5">
              <div className="page-intro">
                <div>
                  <p className="eyebrow">{selectedDate === today ? "Today's check-in" : 'Past-day entry'}</p>
                  <h1>{displayDate(selectedDate)}</h1>
                  <p>Capture what matters now. You can come back all day.</p>
                </div>
                <div className="date-field">
                  <span className="sr-only">Entry date</span><CalendarDays className="size-4" />
                  <Input type="date" value={selectedDate} min={historyCutoff} max={today} onChange={(event) => setSelectedDate(event.target.value || today)} aria-label="Entry date" />
                </div>
              </div>

              {isBackfill && (
                <div className="backfill-note" role="note">
                  <Info /><span><b>Adding a past day.</b> Memory can blur details, so record only what you feel confident about.</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedDate(today)}>Return to today</Button>
                </div>
              )}

              <Card className="feature-card">
                <CardHeader className="gap-2">
                  <div className="section-icon bg-sky-100 text-sky-900"><Sparkles className="size-5" /></div>
                  <CardTitle className="text-xl font-bold tracking-[-0.02em]">Mood through the day</CardTitle>
                  <p className="text-base text-muted-foreground">Morning, afternoon, and evening can feel very different. Add each one when it makes sense.</p>
                </CardHeader>
                <CardContent className="mood-periods">
                  {(['morning', 'afternoon', 'evening'] as const).map((period) => (
                    <MoodPeriodPanel key={period} period={period} value={entry.moods[period]} onChange={(value) => updateEntry({ moods: { ...entry.moods, [period]: value } })} />
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-3 text-xl font-bold"><span className="section-icon bg-cyan-100 text-cyan-900"><CalendarDays className="size-5" /></span>Daily basics</CardTitle></CardHeader>
                <CardContent className="space-y-6">
                  <div>
                    <p className="field-label">School</p>
                    <PillGroup label="School attendance" options={schoolOptions} value={entry.schoolStatus} onChange={(schoolStatus) => updateEntry({ schoolStatus: String(schoolStatus) })} />
                  </div>
                  {entry.schoolStatus === 'Stayed home' && <Field label="Reason or context" hint="optional"><Input className="h-11 text-base" value={entry.schoolNote} onChange={(e) => updateEntry({ schoolNote: e.target.value })} /></Field>}
                  <div ref={sleepRef} className="form-subsection scroll-mt-28">
                    <div className="subsection-title"><Moon />Sleep <small>previous night</small></div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Fell asleep" hint="optional"><Input className="h-11 text-base" type="time" value={entry.sleepStart} onChange={(e) => updateEntry({ sleepStart: e.target.value })} /></Field>
                      <Field label="Woke up" hint="optional"><Input className="h-11 text-base" type="time" value={entry.wakeTime} onChange={(e) => updateEntry({ wakeTime: e.target.value })} /></Field>
                      <Field label="Wake-ups" hint="optional"><Input className="h-11 text-base" type="number" min="0" inputMode="numeric" value={entry.wakeUps} onChange={(e) => updateEntry({ wakeUps: e.target.value })} /></Field>
                    </div>
                    <div className="mt-4">
                      <p className="field-label">Sleep quality</p>
                      <fieldset className="rating-row" aria-label="Sleep quality from 1 to 5">
                        {[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" data-selected={entry.sleepQuality === rating} aria-pressed={entry.sleepQuality === rating} onClick={() => updateEntry({ sleepQuality: rating })}>{rating}<small>{rating === 1 ? 'Poor' : rating === 5 ? 'Great' : ''}</small></button>)}
                      </fieldset>
                    </div>
                  </div>

                  <div className="form-subsection">
                    <div className="subsection-title"><HeartHandshake />Health</div>
                    <SelectField label="How is his health today?" value={entry.healthStatus} options={healthOptions} onChange={(healthStatus) => updateEntry({ healthStatus })} />
                    {entry.healthStatus !== 'Great' && (
                      <div className="mt-4">
                        <Field label="Health context" hint="optional">
                          <Input className="h-11 text-base" placeholder="Brief symptoms or observations" value={entry.healthNotes} onChange={(event) => updateEntry({ healthNotes: event.target.value })} />
                        </Field>
                      </div>
                    )}
                  </div>

                  <div ref={foodRef} className="form-subsection scroll-mt-28">
                    <div className="subsection-title"><Utensils />Food &amp; appetite</div>
                    <p className="mb-4 text-sm text-muted-foreground">Choose an outcome for each meal so MayMay can learn consistent patterns.</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(['breakfast', 'lunch', 'dinner', 'snacks'] as const).map((meal) => <SelectField key={meal} label={meal[0].toUpperCase() + meal.slice(1)} value={entry.meals[meal]} options={mealOutcomes} placeholder="Choose meal outcome" onChange={(outcome) => updateEntry({ meals: { ...entry.meals, [meal]: outcome } })} />)}
                    </div>
                  </div>

                  <div className="form-subsection">
                    <div className="subsection-title">Bathroom</div>
                    <div className="grid items-end gap-4 sm:grid-cols-[1fr_150px]">
                      <div><p className="field-label">Bowel movement?</p><PillGroup label="Bowel movement" options={['Yes', 'No']} value={entry.bathroom.bowelMovement} onChange={(bowelMovement) => updateEntry({ bathroom: { ...entry.bathroom, bowelMovement: String(bowelMovement) } })} /></div>
                      {entry.bathroom.bowelMovement === 'Yes' && <Field label="How many?" hint="optional"><Input className="h-11 text-base" type="number" min="1" inputMode="numeric" value={entry.bathroom.count} onChange={(e) => updateEntry({ bathroom: { ...entry.bathroom, count: e.target.value } })} /></Field>}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-xl font-bold">Medications</CardTitle><p className="text-base text-muted-foreground">Track only what was given. This is a record, not a dosing guide.</p></CardHeader>
                <CardContent className="grid gap-5 sm:grid-cols-2">
                  {(['melatonin', 'fluoxetine'] as const).map((medication) => {
                    const item = entry.medications[medication];
                    const title = medication === 'melatonin' ? 'Melatonin' : 'Fluoxetine';
                    return <div key={medication} className="medication-panel"><p className="field-label">{title}</p><PillGroup label={`${title} status`} options={['Given', 'Not given']} value={item.status} onChange={(status) => updateEntry({ medications: { ...entry.medications, [medication]: { ...item, status: String(status) } } })} />{item.status === 'Given' && <div className="mt-4 grid grid-cols-2 gap-3"><Field label="Amount"><Input className="h-11 text-base" placeholder="e.g. 5 mg" value={item.amount} onChange={(e) => updateEntry({ medications: { ...entry.medications, [medication]: { ...item, amount: e.target.value } } })} /></Field><Field label="Time"><Input className="h-11 text-base" type="time" value={item.time} onChange={(e) => updateEntry({ medications: { ...entry.medications, [medication]: { ...item, time: e.target.value } } })} /></Field></div>}</div>;
                  })}
                </CardContent>
              </Card>

              <Card ref={triggerRef} className="scroll-mt-28">
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div><CardTitle className="flex items-center gap-3 text-xl font-bold"><span className="section-icon bg-amber-100 text-amber-900"><Info className="size-5" /></span>Possible triggers &amp; changes</CardTitle><p className="mt-2 text-base text-muted-foreground">Add structured observations such as transitions, sensory overload, waiting, illness, or food-related stress.</p></div>
                  <Button variant="outline" className="h-10" onClick={addPossibleTrigger}><Plus /> Add</Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entry.possibleTriggers.length ? entry.possibleTriggers.map((event, index) => <PossibleTriggerCard key={event.id} event={event} number={index + 1} onChange={(patch) => updatePossibleTrigger(event.id, patch)} onRemove={() => updateEntry((current) => ({ ...current, possibleTriggers: current.possibleTriggers.filter((item) => item.id !== event.id) }))} />) : <div className="quiet-empty"><Info /><div><b>No possible triggers or changes recorded</b><p>Add one when something notable happens, whether or not a meltdown follows.</p></div></div>}
                </CardContent>
              </Card>

              <Card ref={meltdownRef} className="scroll-mt-28">
                <CardHeader className="flex-row items-center justify-between gap-4">
                  <div><CardTitle className="flex items-center gap-3 text-xl font-bold"><span className="section-icon bg-rose-100 text-rose-800"><Zap className="size-5" /></span>Meltdowns</CardTitle><p className="mt-2 text-base text-muted-foreground">Add each event as it happens or soon after.</p></div>
                  <Button className="h-10" onClick={addMeltdown}><Plus /> Add</Button>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entry.meltdowns.length ? entry.meltdowns.map((event, index) => <MeltdownCard key={event.id} event={event} number={index + 1} onChange={(patch) => updateMeltdown(event.id, patch)} onRemove={() => updateEntry((current) => ({ ...current, meltdowns: current.meltdowns.filter((item) => item.id !== event.id) }))} />) : <div className="quiet-empty"><CheckCircle2 /><div><b>No meltdowns recorded for this day</b><p>Add one only if an event occurs.</p></div></div>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-xl font-bold">Notes</CardTitle><p className="text-base text-muted-foreground">Anything unusual, helpful, or worth remembering.</p></CardHeader>
                <CardContent><Textarea className="min-h-32 bg-card text-base" placeholder="Add a brief note…" value={entry.notes} onChange={(e) => updateEntry({ notes: e.target.value })} /></CardContent>
              </Card>

              <div className="save-bar" aria-live="polite"><CheckCircle2 /><span><b>{saveMessage}</b><small>Changes save automatically.</small></span></div>
            </div>

            <aside className="space-y-5 lg:sticky lg:top-24">
              <Card className="daily-progress-card">
                <CardHeader><p className="eyebrow text-sky-200">Today at a glance</p><CardTitle className="text-2xl font-bold text-white">A little at a time</CardTitle></CardHeader>
                <CardContent className="space-y-4 text-sky-50">
                  <p className="text-base leading-relaxed text-sky-100">Entries save as you go, so it&apos;s okay to stop and return later.</p>
                  <div className="rounded-2xl bg-white/10 p-4"><div className="flex items-center justify-between text-sm font-semibold"><span>Check-in progress</span><span>{progressCount} of 7</span></div><Progress value={(progressCount / 7) * 100} className="mt-3 [&_[data-slot=progress-track]]:bg-white/15 [&_[data-slot=progress-indicator]]:bg-[#ffcb69]" /></div>
                  <Button className="h-11 w-full bg-white text-slate-950 hover:bg-sky-50" onClick={() => document.querySelector('.form-subsection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Continue check-in <ArrowRight /></Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base font-bold">Quick add</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <button type="button" className="quick-link" onClick={addPossibleTrigger}><span className="event-icon bg-amber-100 text-amber-900"><Info /></span><span><b>Possible trigger</b><small>Time, category, observed effect</small></span><Plus /></button>
                  <button type="button" className="quick-link" onClick={addMeltdown}><span className="event-icon bg-rose-100 text-rose-800"><Zap /></span><span><b>Meltdown</b><small>Trigger, duration, support</small></span><Plus /></button>
                  <button type="button" className="quick-link" onClick={() => sleepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span className="event-icon bg-indigo-100 text-indigo-800"><Moon /></span><span><b>Sleep</b><small>Quality and wake-ups</small></span><ArrowRight /></button>
                  <button type="button" className="quick-link" onClick={() => foodRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><span className="event-icon bg-amber-100 text-amber-900"><Utensils /></span><span><b>Food</b><small>Meals and appetite</small></span><ArrowRight /></button>
                </CardContent>
              </Card>

              <Card className="border-dashed bg-transparent shadow-none"><CardContent className="flex gap-3 py-1"><div className="mt-0.5 rounded-full bg-secondary p-2 text-primary"><ShieldCheck className="size-4" /></div><div><p className="font-bold">Private by default</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Your notes stay on this device until you connect your private Firestore account.</p></div></CardContent></Card>
            </aside>
          </section>
        </TabsContent>

        <TabsContent value="insights" className="mt-5">
          <div className="page-intro"><div><p className="eyebrow">Patterns, not labels</p><h1>Insights</h1><p>Use trends as clues to support observation—not as medical advice.</p></div></div>
          {summary.totalDays === 0 ? <div className="empty-state mt-5"><BarChart3 /><h2>Insights begin with the first check-in</h2><p>Complete today&apos;s entry to start building a clearer picture.</p><Button onClick={() => setActiveTab('today')}>Go to today</Button></div> : <div className="mt-5 space-y-5">
            <div className="stats-grid">
              <Card><CardContent><small>Days recorded</small><strong>{summary.totalDays}</strong><span>in this device&apos;s history</span></CardContent></Card>
              <Card><CardContent><small>Average mood</small><strong>{summary.averageMood ? summary.averageMood.toFixed(1) : '—'}<i>/5</i></strong><span>on days with a mood entry</span></CardContent></Card>
              <Card><CardContent><small>Meltdown days</small><strong>{summary.meltdownDayPercent}%</strong><span>{summary.meltdownDays} of {summary.totalDays} recorded days</span></CardContent></Card>
              <Card><CardContent><small>Total events</small><strong>{summary.totalMeltdowns}</strong><span>detailed meltdowns recorded</span></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-xl font-bold">Mood by time of day</CardTitle><p className="text-muted-foreground">Separate periods make it easier to spot when support may be most useful.</p></CardHeader>
              <CardContent className="period-insights-grid">
                {summary.periodAverages.map((period) => (
                  <div key={period.period}>
                    <span className="period-symbol" aria-hidden="true">{period.period === 'morning' ? '☀️' : period.period === 'afternoon' ? '🌤️' : '🌙'}</span>
                    <b>{period.label}</b>
                    <strong>{period.days ? period.average.toFixed(1) : '—'}<small>/5</small></strong>
                    <p>{period.days ? `${period.difficultPercent}% of ${period.days} ${period.days === 1 ? 'entry' : 'entries'} felt hard or struggling` : 'No entries yet'}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
              <Card><CardHeader><CardTitle className="text-xl font-bold">Mood and event trend</CardTitle><p className="text-muted-foreground">Most recent 14 recorded days</p></CardHeader><CardContent>{summary.trend.filter((item) => item.mood).length >= 2 ? <ChartContainer config={chartConfig} className="h-[260px] w-full aspect-auto"><LineChart accessibilityLayer data={summary.trend} margin={{ left: -18, right: 12 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} /><YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Line type="monotone" dataKey="mood" stroke="var(--color-mood)" strokeWidth={3} dot={{ r: 4, fill: 'var(--color-mood)' }} connectNulls /></LineChart></ChartContainer> : <div className="quiet-empty"><TrendingUp /><div><b>One more mood entry will draw the trend.</b><p>The chart needs at least two recorded moods.</p></div></div>}</CardContent></Card>
              <Card className="risk-card"><CardHeader><p className="eyebrow text-amber-200">Today&apos;s pattern estimate</p><CardTitle className="text-white"><span className="risk-number">{risk.ready ? `${risk.percent}%` : '—'}</span><span className="block text-lg">{risk.ready ? 'estimated chance of a meltdown' : 'building a personal baseline'}</span></CardTitle></CardHeader><CardContent className="space-y-4 text-sky-50"><p className="text-sky-100">{risk.ready ? `Based on ${risk.historyDays} prior recorded days and today's information.` : `${risk.daysUntilEstimate} more prior ${risk.daysUntilEstimate === 1 ? 'day is' : 'days are'} needed before showing a percentage.`}</p>{risk.factors.length > 0 ? <div className="flex flex-wrap gap-2">{risk.factors.map((factor) => <span key={factor} className="risk-chip">{factor}</span>)}</div> : <p className="rounded-xl bg-white/10 p-3 text-sm">Add sleep, eating, school, or mood details to personalize this estimate.</p>}<div className="border-t border-white/15 pt-3 text-xs text-sky-200"><b>{risk.confidence} estimate.</b> This is a personal pattern summary, not a clinical forecast.</div></CardContent></Card>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-xl font-bold">Most common triggers</CardTitle><p className="text-muted-foreground">From detailed meltdown entries</p></CardHeader><CardContent>{summary.triggers.length ? <div className="rank-list">{summary.triggers.slice(0, 5).map((item, index) => <div key={item.label}><span>{index + 1}</span><b>{item.label}</b><strong>{item.count}</strong></div>)}</div> : <div className="quiet-empty"><Info /><div><b>No known triggers yet</b><p>Detailed events will build this list.</p></div></div>}</CardContent></Card>
              <Card><CardHeader><CardTitle className="text-xl font-bold">What has helped</CardTitle><p className="text-muted-foreground">Supports associated with recorded events</p></CardHeader><CardContent>{summary.helpful.length ? <div className="rank-list helpful">{summary.helpful.slice(0, 5).map((item, index) => <div key={item.label}><span>{index + 1}</span><b>{item.label}</b><strong>{item.count}</strong></div>)}</div> : <div className="quiet-empty"><HeartHandshake /><div><b>No supports recorded yet</b><p>Add what helped to future event details.</p></div></div>}</CardContent></Card>
            </div>
          </div>}
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <div className="page-intro"><div><p className="eyebrow">Review and continue</p><h1>History</h1><p>Edit a saved day or carefully add a day you missed.</p></div><Button variant="outline" className="h-11" onClick={startBackfill}><Plus /> Add past day</Button></div>
          <div className="backfill-note mt-5" role="note"><Info /><span><b>Backfilling is available, but today is best.</b> Past details may be less reliable. Add only what you clearly remember.</span></div>
          {!entries.length ? <div className="empty-state mt-5"><History /><h2>Your timeline starts today</h2><p>Saved days will appear here automatically.</p><Button onClick={() => setActiveTab('today')}>Start today&apos;s entry</Button></div> : <div className="history-list mt-5">{[...entries].sort((a, b) => b.date.localeCompare(a.date)).map((item) => {
            const moodAverage = entryMoodAverage(item);
            const tags = entryMoodTags(item);
            return <button key={item.date} type="button" className="history-item" onClick={() => openEntry(item.date)}><div className="history-date"><small>{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${item.date}T12:00:00`))}</small><strong>{new Date(`${item.date}T12:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${item.date}T12:00:00`))}</span></div><div className="history-summary"><b>{item.date === today ? 'Today' : displayDate(item.date, false)}</b><div>{moodAverage ? <span>Daily mood {moodAverage.toFixed(1)}/5</span> : <span>No mood</span>}<span>{item.schoolStatus || 'No school entry'}</span><span>{item.meltdowns.length} {item.meltdowns.length === 1 ? 'meltdown' : 'meltdowns'}</span></div>{tags.length > 0 && <p>{tags.join(' · ')}</p>}</div><ArrowRight /></button>;
          })}</div>}
        </TabsContent>
      </Tabs>

    </main>
  );
}
