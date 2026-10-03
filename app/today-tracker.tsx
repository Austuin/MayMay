'use client';

import { useState, type SetStateAction, type SyntheticEvent } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { createEventId, localDateValue } from '@/lib/maymay-types';
import type { TrackerAnswer, TrackerDefinition, TrackerKind } from '@/lib/maymay-schema';

type Answer = TrackerAnswer;
type Tracker = TrackerDefinition & {
  id: string;
  deleted?: boolean;
};
type Spontaneous = {
  id: string;
  date: string;
  kind: 'good' | 'difficult' | 'meltdown' | 'other';
  title: string;
  note: string;
  time: string;
};
type TrackerDraft = TrackerDefinition;

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const kinds: { value: TrackerKind; label: string; hint: string }[] = [
  { value: 'mood', label: 'Mood check', hint: 'Bad → Good' },
  { value: 'good', label: 'Good event', hint: 'Yes or No' },
  { value: 'difficult', label: 'Difficult event', hint: 'Yes or No' },
  { value: 'checkin', label: 'Check-in', hint: 'Yes or No' },
  { value: 'count', label: 'Counter', hint: 'A number' },
];
const blankDraft = (): TrackerDraft => ({
  kind: 'checkin',
  title: '',
  description: '',
  days: everyDay,
});

function kindLabel(kind: TrackerKind) {
  return kinds.find((item) => item.value === kind)?.label ?? 'Check-in';
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export type TrackerData = {
  trackers: Tracker[];
  answers: Record<string, Record<string, Answer>>;
  spontaneous: Spontaneous[];
};
export function TodayTracker({ patientName, date, onDateChange, data, onChange, readOnly = false, saveStatus, saveMessage }: {
  patientName: string;
  date: string;
  onDateChange: (date: string) => void;
  data: TrackerData;
  onChange: (change: (current: TrackerData) => TrackerData) => void;
  readOnly?: boolean;
  saveStatus?: 'loading' | 'saving' | 'saved' | 'pending' | 'error';
  saveMessage?: string;
}) {
  const { trackers, answers, spontaneous } = data;
  const today = localDateValue();
  function update<Key extends keyof TrackerData>(key: Key, value: SetStateAction<TrackerData[Key]>) {
    if (readOnly) return;
    onChange(current => ({ ...current, [key]: typeof value === 'function'
      ? (value as (previous: TrackerData[Key]) => TrackerData[Key])(current[key]) : value }));
  }
  const setTrackers = (value: SetStateAction<Tracker[]>) => update('trackers', value);
  const setAnswers = (value: SetStateAction<TrackerData['answers']>) => update('answers', value);
  const setSpontaneous = (value: SetStateAction<Spontaneous[]>) => update('spontaneous', value);
  function changeDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today) return;
    const parsed = new Date(value + 'T12:00:00');
    if (!Number.isFinite(parsed.getTime()) || localDateValue(parsed) !== value) return;
    onDateChange(value);
    setShowUnexpectedForm(false);
    setLastRemoved(null);
  }
  function stepDate(offset: number) {
    const next = new Date(date + 'T12:00:00');
    next.setDate(next.getDate() + offset);
    changeDate(localDateValue(next));
  }
  const [screen, setScreen] = useState<'day' | 'manage' | 'form'>('day');
  const [draft, setDraft] = useState<TrackerDraft>(blankDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showUnexpectedForm, setShowUnexpectedForm] = useState(false);
  const [unexpectedKind, setUnexpectedKind] =
    useState<Spontaneous['kind']>('good');
  const [unexpectedTitle, setUnexpectedTitle] = useState('');
  const [unexpectedNote, setUnexpectedNote] = useState('');
  const [unexpectedTime, setUnexpectedTime] = useState('');
  const [lastRemoved, setLastRemoved] = useState<Spontaneous | null>(null);

  const active = trackers.filter((item) => !item.deleted);
  const scheduled = active.filter((item) =>
    item.days.includes(new Date(`${date}T12:00:00`).getDay()),
  );
  const todayAnswers = answers[date] ?? {};
  const answeredCount = scheduled.filter((item) =>
    Object.prototype.hasOwnProperty.call(todayAnswers, item.id),
  ).length;
  const dayEvents = spontaneous.filter((item) => item.date === date);
  const repeated = [
    ...new Map(
      spontaneous.map((item) => [
        `${item.kind}:${item.title.trim().toLowerCase()}`,
        item,
      ]),
    ).entries(),
  ]
    .filter(
      ([key]) =>
        spontaneous.filter(
          (item) => `${item.kind}:${item.title.trim().toLowerCase()}` === key,
        ).length >= 4,
    )
    .map(([, item]) => item)
    .filter(
      (item) =>
        !active.some(
          (tracker) =>
            tracker.title.trim().toLowerCase() ===
            item.title.trim().toLowerCase(),
        ),
    );

  function setAnswer(id: string, value: Answer | null) {
    setAnswers((current) => {
      const nextDay = { ...current[date] };
      if (value === null) delete nextDay[id];
      else nextDay[id] = value;
      return { ...current, [date]: nextDay };
    });
  }

  function setCount(id: string, raw: string) {
    if (raw === '') { setAnswer(id, null); return; }
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= 0) setAnswer(id, value);
  }

  function openAdd(prefill?: Spontaneous) {
    setEditingId(null);
    setDraft(
      prefill
        ? {
            kind:
              prefill.kind === 'good'
                ? 'good'
                : prefill.kind === 'difficult' || prefill.kind === 'meltdown'
                  ? 'difficult'
                  : 'checkin',
            title: prefill.title,
            description: prefill.note,
            days: everyDay,
          }
        : blankDraft(),
    );
    setScreen('form');
  }

  function openEdit(item: Tracker) {
    setEditingId(item.id);
    setDraft({
      kind: item.kind,
      title: item.title,
      description: item.description,
      days: [...item.days],
    });
    setScreen('form');
  }

  function saveTracker(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.description.trim() || !draft.days.length)
      return;
    const next = {
      ...draft,
      title: draft.title.trim(),
      description: draft.description.trim(),
      days: [...draft.days].sort((left, right) => left - right),
    };
    if (editingId)
      setTrackers((current) =>
        current.map((item) =>
          item.id === editingId ? { ...item, ...next } : item,
        ),
      );
    else
      setTrackers((current) => [...current, { ...next, id: createEventId() }]);
    setScreen('manage');
  }

  function addUnexpected(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unexpectedTitle.trim()) return;
    setSpontaneous((current) => [
      ...current,
      {
        id: createEventId(),
        date,
        kind: unexpectedKind,
        title: unexpectedTitle.trim(),
        note: unexpectedNote.trim(),
        time: unexpectedTime,
      },
    ]);
    setUnexpectedTitle('');
    setUnexpectedNote('');
    setUnexpectedTime('');
    setShowUnexpectedForm(false);
    setLastRemoved(null);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {saveStatus && <output role="status" aria-live="polite" className="block text-sm text-muted-foreground">{saveMessage ?? saveStatus}</output>}
      {readOnly && <p className="text-sm text-muted-foreground">View-only access. A caregiver can record answers.</p>}
        {screen === 'day' && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary">
                  {patientName} · <span>{date === today ? "Today's check-in" : 'Past-day entry'}</span>
                </p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">
                  {dateLabel(date)}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  A few useful details, at your pace.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button aria-label="Previous day" className="size-11 rounded-xl border bg-card" onClick={() => stepDate(-1)}><ChevronLeft className="mx-auto size-5" /></button>
                <input
                  aria-label="Entry date"
                  max={today}
                  type="date"
                  className="h-11 rounded-xl border bg-card px-3 text-sm"
                  value={date}
                  onChange={(event) => changeDate(event.target.value)}
                />
                <button aria-label="Next day" disabled={date >= today} className="size-11 rounded-xl border bg-card disabled:opacity-40" onClick={() => stepDate(1)}><ChevronRight className="mx-auto size-5" /></button>
                {date !== today && <button className="min-h-11 rounded-xl border bg-card px-3 text-sm" onClick={() => changeDate(today)}>Today</button>}
                {!readOnly && <div className="relative">
                  <button
                    aria-label="Tracker options"
                    aria-expanded={menuOpen}
                    className="flex h-11 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted"
                    onClick={() => setMenuOpen((value) => !value)}
                  >
                    Trackers <MoreHorizontal className="size-5" />
                  </button>
                  {menuOpen && (
                    <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border bg-card p-1 shadow-lg">
                      <button
                        className="w-full rounded-lg px-3 py-3 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setMenuOpen(false);
                          setScreen('manage');
                        }}
                      >
                        Manage trackers
                      </button>
                    </div>
                  )}
                </div>}
              </div>
            </div>

            <section aria-label="Daily trackers" className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Daily check-in</h2>
                <span className="text-sm text-muted-foreground">
                  {answeredCount} of {scheduled.length} answered
                </span>
              </div>
              {scheduled.map((item) => {
                const value = todayAnswers[item.id];
                const hasAnswer = Object.prototype.hasOwnProperty.call(
                  todayAnswers,
                  item.id,
                );
                return (
                  <article
                    key={item.id}
                    className="rounded-2xl border bg-card p-5 shadow-sm"
                  >
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-primary">
                          {kindLabel(item.kind)}
                        </p>
                        <h3 className="mt-1 text-lg font-bold">{item.title}</h3>
                        {item.description && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.description}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        {hasAnswer ? 'Answered' : 'Unanswered'}
                      </span>
                    </div>
                    <fieldset disabled={readOnly} aria-label={`${item.title} answer`} className="disabled:opacity-70">
                    {item.kind === 'mood' ? (
                      <select
                        aria-label={`${item.title} mood`}
                        className="h-12 w-full rounded-xl border bg-background px-3"
                        value={typeof value === 'string' ? value : ''}
                        onChange={(event) =>
                          setAnswer(item.id, (event.target.value || null) as TrackerAnswer | null)
                        }
                      >
                        <option value="">Choose a mood</option>
                        {['Bad', 'Poor', 'Neutral', 'OK', 'Good'].map(
                          (mood) => (
                            <option key={mood}>{mood}</option>
                          ),
                        )}
                      </select>
                    ) : item.kind === 'count' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          aria-label={`Decrease ${item.title}`}
                          className="size-12 rounded-xl border text-xl hover:bg-muted"
                          onClick={() =>
                            setAnswer(
                              item.id,
                              Math.max(
                                0,
                                (typeof value === 'number' ? value : 1) - 1,
                              ),
                            )
                          }
                        >
                          −
                        </button>
                        <input
                          aria-label={`${item.title} count`}
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          placeholder="—"
                          className="h-12 w-20 rounded-xl border bg-background text-center text-lg font-semibold"
                          value={typeof value === 'number' ? value : ''}
                          onChange={(event) => setCount(item.id, event.target.value)}
                        />
                        <button
                          aria-label={`Increase ${item.title}`}
                          className="size-12 rounded-xl border text-xl hover:bg-muted"
                          onClick={() =>
                            setAnswer(
                              item.id,
                              (typeof value === 'number' ? value : 0) + 1,
                            )
                          }
                        >
                          +
                        </button>
                        {hasAnswer && (
                          <button
                            className="ml-2 min-h-11 text-sm text-muted-foreground underline"
                            onClick={() => setAnswer(item.id, null)}
                          >
                            Clear answer
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          aria-pressed={value === true}
                          className={`min-h-12 min-w-24 rounded-xl border px-5 font-semibold ${value === true ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          onClick={() => setAnswer(item.id, true)}
                        >
                          Yes
                        </button>
                        <button
                          aria-pressed={value === false}
                          className={`min-h-12 min-w-24 rounded-xl border px-5 font-semibold ${value === false ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                          onClick={() => setAnswer(item.id, false)}
                        >
                          No
                        </button>
                        {hasAnswer && (
                          <button
                            className="ml-2 min-h-11 text-sm text-muted-foreground underline"
                            onClick={() => setAnswer(item.id, null)}
                          >
                            Clear answer
                          </button>
                        )}
                      </div>
                    )}
                    </fieldset>
                  </article>
                );
              })}
              {!scheduled.length && (
                <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
                  No trackers are scheduled for this day. Use the tracker menu
                  to add one.
                </p>
              )}
            </section>

            <section
              aria-label="Spontaneous events"
              className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Spontaneous events</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Good, difficult, or simply worth noting.
                  </p>
                </div>
                {!readOnly && <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"
                  onClick={() => setShowUnexpectedForm((value) => !value)}
                >
                  <Plus className="size-4" /> Add spontaneous event
                </button>}
              </div>
              {showUnexpectedForm && !readOnly && (
                <form
                  onSubmit={addUnexpected}
                  className="grid gap-3 rounded-xl bg-muted/50 p-4"
                >
                  <label className="grid gap-1 text-sm font-medium">
                    Kind
                    <select
                      className="h-11 rounded-lg border bg-background px-3"
                      value={unexpectedKind}
                      onChange={(event) =>
                        setUnexpectedKind(
                          event.target.value as Spontaneous['kind'],
                        )
                      }
                    >
                      <option value="good">Good</option>
                      <option value="difficult">Difficult</option>
                      <option value="meltdown">Meltdown</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    What happened?
                    <input
                      className="h-11 rounded-lg border bg-background px-3"
                      value={unexpectedTitle}
                      onChange={(event) =>
                        setUnexpectedTitle(event.target.value)
                      }
                      placeholder="e.g. Loud assembly"
                      required
                      maxLength={100}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <label className="grid gap-1 text-sm font-medium">
                      Time (optional)
                      <input
                        type="time"
                        className="h-11 rounded-lg border bg-background px-3"
                        value={unexpectedTime}
                        onChange={(event) =>
                          setUnexpectedTime(event.target.value)
                        }
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Note (optional)
                      <input
                        className="h-11 rounded-lg border bg-background px-3"
                        value={unexpectedNote}
                        onChange={(event) =>
                          setUnexpectedNote(event.target.value)
                        }
                        placeholder="A little context"
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
                      Save event
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border px-4"
                      onClick={() => setShowUnexpectedForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {dayEvents.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 border-t pt-3"
                >
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-primary">
                      {item.kind}
                      {item.time ? ` · ${item.time}` : ''}
                    </p>
                    <b>{item.title}</b>
                    {item.note && (
                      <p className="text-sm text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </div>
                  {!readOnly && <button
                    aria-label={`Remove ${item.title}`}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-muted-foreground underline hover:text-destructive"
                    onClick={() => {
                      setSpontaneous((current) =>
                        current.filter((event) => event.id !== item.id),
                      );
                      setLastRemoved(item);
                    }}
                  >
                    Remove
                  </button>}
                </div>
              ))}
              {lastRemoved && !readOnly && (
                <output className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm">
                  Event removed.
                  <button
                    className="inline-flex items-center gap-1 font-semibold text-primary underline"
                    onClick={() => {
                      setSpontaneous((current) => [...current, lastRemoved]);
                      setLastRemoved(null);
                    }}
                  >
                    <RotateCcw className="size-4" /> Undo
                  </button>
                </output>
              )}
              {!readOnly && repeated.map((item) => (
                <div
                  key={item.kind + item.title}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 p-4 text-sm text-sky-950 dark:bg-sky-950 dark:text-sky-100"
                >
                      <span>
                    <b>{item.title}</b> has been logged four times. Add it to
                    the daily check-in?
                  </span>
                  <button
                    className="font-semibold underline"
                    onClick={() => openAdd(item)}
                  >
                    Make a tracker
                  </button>
                </div>
              ))}
            </section>
          </>
        )}

        {screen === 'manage' && !readOnly && (
          <>
            <button
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline"
              onClick={() => setScreen('day')}
            >
              <ArrowLeft className="size-4" /> Back to check-in
            </button>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-primary">
                  {patientName}
                </p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight">
                  Manage trackers
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Choose what appears on each day.
                </p>
              </div>
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"
                onClick={() => openAdd()}
              >
                <Plus className="size-4" /> Add tracker
              </button>
            </div>
            <div className="space-y-3">
              {active.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-primary">
                        {kindLabel(item.kind)} ·{' '}
                        {item.days.length === 7
                          ? 'Daily'
                          : item.days.map((day) => days[day]).join(', ')}
                      </p>
                      <h2 className="mt-1 font-bold">{item.title}</h2>
                      {item.description && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="min-h-11 rounded-lg border px-3 text-sm"
                        onClick={() => openEdit(item)}
                      >
                        Edit
                      </button>
                      <button
                        aria-label={`Delete ${item.title}`}
                        className="flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm text-destructive"
                        onClick={() => setDeleteId(item.id)}
                      >
                        <Trash2 className="size-4" /> Delete
                      </button>
                    </div>
                  </div>
                  {deleteId === item.id && (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950 dark:bg-rose-950 dark:text-rose-100">
                      <p>
                        Delete <b>{item.title}</b> from future check-ins?
                        Existing answers remain in history.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <button
                          className="min-h-11 rounded-lg bg-destructive px-4 font-semibold text-white"
                          onClick={() => {
                            setTrackers((current) =>
                              current.map((tracker) =>
                                tracker.id === item.id
                                  ? { ...tracker, deleted: true }
                                  : tracker,
                              ),
                            );
                            setDeleteId(null);
                          }}
                        >
                          Delete tracker
                        </button>
                        <button
                          className="min-h-11 rounded-lg border px-4"
                          onClick={() => setDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {!active.length && (
                <p className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
                  No trackers yet. Add one when you are ready.
                </p>
              )}
            </div>
          </>
        )}

        {screen === 'form' && !readOnly && (
          <>
            <button
              className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline"
              onClick={() => setScreen('manage')}
            >
              <ArrowLeft className="size-4" /> Back to trackers
            </button>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                {patientName}
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight">
                {editingId ? 'Edit tracker' : 'Add a tracker'}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Keep it short. You can change it later.
              </p>
            </div>
            <form
              onSubmit={saveTracker}
              className="space-y-5 rounded-2xl border bg-card p-5 shadow-sm"
            >
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">
                  What will you record?
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kinds.map((kind) => (
                    <label
                      key={kind.value}
                      htmlFor={`tracker-kind-${kind.value}`}
                      aria-label={kind.label}
                      className={`flex min-h-14 items-center gap-3 rounded-xl border p-3 ${editingId ? 'cursor-default opacity-70' : 'cursor-pointer'} ${draft.kind === kind.value ? 'border-primary bg-secondary' : ''}`}
                    >
                      <input
                        id={`tracker-kind-${kind.value}`}
                        aria-label={kind.label}
                        type="radio"
                        name="tracker-kind"
                        value={kind.value}
                        disabled={Boolean(editingId)}
                        checked={draft.kind === kind.value}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            kind: kind.value,
                          }))
                        }
                      />
                      <span>
                        <b className="block text-sm">{kind.label}</b>
                        <small className="text-muted-foreground">
                          {kind.hint}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                {editingId && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    The answer type stays the same so past entries keep their
                    meaning.
                  </p>
                )}
              </fieldset>
              <label className="grid gap-2 text-sm font-semibold">
                Title
                <input
                  className="h-12 rounded-xl border bg-background px-3 font-normal"
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="e.g. Ate Breakfast"
                  required
                  maxLength={100}
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold">
                Description
                <input
                  className="h-12 rounded-xl border bg-background px-3 font-normal"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  placeholder="e.g. Did they eat breakfast this morning?"
                  required
                  maxLength={240}
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">
                  When should it appear?
                </legend>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`min-h-11 rounded-xl border px-4 text-sm ${draft.days.length === 7 ? 'border-primary bg-secondary font-semibold' : ''}`}
                    onClick={() =>
                      setDraft((current) => ({ ...current, days: everyDay }))
                    }
                  >
                    Every day
                  </button>
                  <button
                    type="button"
                    className={`min-h-11 rounded-xl border px-4 text-sm ${draft.days.length !== 7 ? 'border-primary bg-secondary font-semibold' : ''}`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        days: [1, 2, 3, 4, 5],
                      }))
                    }
                  >
                    Choose days
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {days.map((day, index) => (
                    <label
                      key={day}
                      className={`flex min-h-11 min-w-12 cursor-pointer items-center justify-center rounded-xl border px-2 text-sm ${draft.days.includes(index) ? 'border-primary bg-secondary font-semibold' : ''}`}
                    >
                      <input
                        className="sr-only"
                        type="checkbox"
                        checked={draft.days.includes(index)}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            days: event.target.checked
                              ? [...current.days, index]
                              : current.days.filter((value) => value !== index),
                          }))
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
                {!draft.days.length && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    Choose at least one day.
                  </p>
                )}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled={!draft.days.length}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Check className="size-4" /> Save tracker
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-xl border px-4"
                  onClick={() => setScreen('manage')}
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
    </div>
  );
}
