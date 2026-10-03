import { onSnapshot, query, where } from 'firebase/firestore';
import type { FirebaseConnection } from './maymay-firebase';
import { createEventId } from './maymay-types';
import { dailyObservationId, type ObservationRecord, type TrackerAnswer, type TrackerDefinition, type TrackerRecord } from './maymay-schema';
import { careCollection, commitCareMutation, observationFromDocument, trackerFromDocument,
  CareConflict, type CareMutation, type ObservationDraft } from './maymay-care-records';
import type { TrackerData } from '@/app/today-tracker';

export type CareView = {
  data: TrackerData; status: 'loading' | 'saving' | 'saved' | 'pending' | 'error'; message: string;
  conflicts: { recordId: string; target: CareMutation['target']; local: unknown; remote: unknown }[];
};

const emptyData = (): TrackerData => ({ trackers: [], answers: {}, spontaneous: [] });

export function careScope(connection: FirebaseConnection) {
  return 'maymay.care.v2.' + encodeURIComponent(JSON.stringify([
    connection.app.options.projectId, connection.dataGeneration, connection.user.uid,
    connection.profile.familyId, connection.childId,
  ]));
}

function loadJson<T>(key: string, fallback: T): T {
  const stored = localStorage.getItem(key);
  return stored === null ? fallback : JSON.parse(stored) as T;
}

function occurredAt(localDate: string, time: string) {
  return new Date(`${localDate}T${time || '12:00'}:00`).toISOString();
}
function localTime(value: unknown) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
function observationDraft(item: TrackerData['spontaneous'][number]): ObservationDraft {
  return { localDate: item.date, occurredAt: occurredAt(item.date, item.time), kind: item.kind,
    trackerId: null, trackerSnapshot: null, value: null, title: item.title,
    note: item.note, details: {} };
}

function preserveNewer<T extends { revision: number }>(previous: T[], incoming: T[], id: (item: T) => string): T[] {
  const old = new Map(previous.map(item => [id(item), item]));
  const result = incoming.map(item => {
    const cached = old.get(id(item));
    old.delete(id(item));
    return cached && cached.revision > item.revision ? cached : item;
  });
  return [...result, ...[...old.values()].filter(item => item.revision > 0)];
}

export class CareRecordSession {
  private scope: string;
  private trackers: TrackerRecord[] = [];
  private observations: ObservationRecord[] = [];
  private pending: CareMutation[] = [];
  private conflicts = new Map<string, CareConflict>();
  private stopped = false;
  private flushing = false;
  private loadedTrackers = false;
  private loadedObservations = false;
  private locked = false;
  private error = '';
  private timer?: ReturnType<typeof setTimeout>;
  private listeners: (() => void)[] = [];

  constructor(private connection: FirebaseConnection, private date: string, private changed: (view: CareView) => void) {
    this.scope = careScope(connection);
  }

  start() {
    try {
      const cache = loadJson<{ trackers: TrackerRecord[]; observations: ObservationRecord[] }>(this.scope + '.cache', { trackers: [], observations: [] });
      if (!Array.isArray(cache.trackers) || !Array.isArray(cache.observations)) throw new Error('Invalid cache');
      this.trackers = cache.trackers;
      this.observations = cache.observations;
      const prefix = this.scope + '.pending.';
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const mutation = loadJson<CareMutation | null>(key, null);
          if (!mutation || key !== prefix + mutation.id || !['tracker', 'observation'].includes(mutation.target)
            || typeof mutation.recordId !== 'string' || typeof mutation.queuedAt !== 'number') throw new Error('Invalid draft');
          this.pending.push(mutation);
        }
      }
      this.pending.sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
    } catch {
      this.error = 'This device could not read its saved drafts. They have been preserved; please do not clear browser storage.';
      this.emit();
      return;
    }
    this.emit();
    this.listeners.push(onSnapshot(careCollection(this.connection.db, this.connection.profile.familyId, this.connection.childId, 'tracker'),
      { includeMetadataChanges: true }, snapshot => {
        if (this.stopped || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        this.trackers = preserveNewer(this.trackers, snapshot.docs.map(item => trackerFromDocument(item.data())), item => item.trackerId);
        this.loadedTrackers = true;
        this.cache(); this.emit(); this.schedule();
      }, error => this.fail(error)));
    this.listeners.push(onSnapshot(query(careCollection(this.connection.db, this.connection.profile.familyId, this.connection.childId, 'observation'),
      where('localDate', '==', this.date)), { includeMetadataChanges: true }, snapshot => {
        if (this.stopped || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        this.observations = [...this.observations.filter(item => item.localDate !== this.date),
          ...preserveNewer(this.observations.filter(item => item.localDate === this.date),
            snapshot.docs.map(item => observationFromDocument(item.data())), item => item.observationId)];
        this.loadedObservations = true;
        this.cache(); this.emit(); this.schedule();
      }, error => this.fail(error)));
    this.schedule();
  }

  private fail(error: Error) {
    if (this.stopped) return;
    if ((error as { code?: string }).code === 'permission-denied') {
      this.locked = true;
      this.trackers = [];
      this.observations = [];
      this.error = 'Access changed. Sign in again to check access. Unsent edits are preserved.';
    } else this.error = 'Connection interrupted. Unsent edits are kept on this device.';
    this.emit();
  }
  private cache() {
    try { localStorage.setItem(this.scope + '.cache', JSON.stringify({ trackers: this.trackers, observations: this.observations })); }
    catch { /* Pending drafts are stored separately. */ }
  }

  private projected(): TrackerData {
    const data = emptyData();
    if (this.locked) return data;
    const trackers = new Map(this.trackers.map(item => [item.trackerId, item]));
    const observations = new Map(this.observations.map(item => [item.observationId, item]));
    for (const mutation of this.pending) {
      if (mutation.target === 'tracker') {
        const current = trackers.get(mutation.recordId);
        if (mutation.after) trackers.set(mutation.recordId, {
          ...current, ...mutation.after as TrackerDefinition, trackerId: mutation.recordId,
          deletedAt: null,
        } as TrackerRecord);
        else if (current) trackers.set(mutation.recordId, { ...current, deletedAt: 'pending' });
      } else {
        const current = observations.get(mutation.recordId);
        if (mutation.after) observations.set(mutation.recordId, {
          ...current, ...mutation.after as ObservationDraft, observationId: mutation.recordId,
          deletedAt: null,
        } as ObservationRecord);
        else if (current) observations.set(mutation.recordId, { ...current, deletedAt: 'pending' });
      }
    }
    data.trackers = [...trackers.values()].map(item => ({ id: item.trackerId, title: item.title,
      description: item.description, kind: item.kind, days: item.days, deleted: Boolean(item.deletedAt) }));
    for (const item of observations.values()) {
      if (item.deletedAt) continue;
      if (item.kind === 'answer' && item.trackerId && item.value !== null) {
        data.answers[item.localDate] ??= {};
        data.answers[item.localDate][item.trackerId] = item.value;
      } else if (item.kind !== 'answer') {
        data.spontaneous.push({ id: item.observationId, date: item.localDate,
          kind: item.kind, title: item.title, note: item.note, time: localTime(item.occurredAt) });
      }
    }
    return data;
  }

  private emit() {
    if (this.stopped) return;
    const status = this.error ? 'error' : this.conflicts.size ? 'error'
      : !this.loadedTrackers || !this.loadedObservations ? this.pending.length ? 'pending' : 'loading'
        : this.pending.length ? this.flushing ? 'saving' : 'pending' : 'saved';
    const message = this.error || (this.conflicts.size ? 'Another caregiver changed a record. Choose a version below.'
      : status === 'loading' ? 'Loading shared records…' : status === 'saving' ? 'Saving…'
        : status === 'pending' ? 'Pending connection' : 'Saved');
    this.changed({ data: this.projected(), status, message,
      conflicts: [...this.conflicts.values()].map(conflict => ({ recordId: conflict.mutation.recordId,
        target: conflict.mutation.target, local: conflict.mutation.after, remote: conflict.remote })) });
  }

  edit(change: (current: TrackerData) => TrackerData) {
    if (this.stopped || this.locked || this.error || !['master', 'caregiver'].includes(this.connection.profile.role)) return;
    const before = this.projected();
    const after = change(before);
    const edits: { target: CareMutation['target']; id: string; value: CareMutation['after'] }[] = [];
    const oldTrackers = new Map(before.trackers.map(item => [item.id, item]));
    for (const item of after.trackers) {
      const old = oldTrackers.get(item.id);
      if (JSON.stringify(old) === JSON.stringify(item)) continue;
      edits.push({ target: 'tracker', id: item.id, value: item.deleted ? null
        : { title: item.title, description: item.description, kind: item.kind, days: item.days } });
    }
    const oldAnswers = before.answers[this.date] ?? {};
    const newAnswers = after.answers[this.date] ?? {};
    for (const trackerId of new Set([...Object.keys(oldAnswers), ...Object.keys(newAnswers)])) {
      if (Object.is(oldAnswers[trackerId], newAnswers[trackerId])) continue;
      const tracker = after.trackers.find(item => item.id === trackerId);
      if (!tracker) continue;
      const value = newAnswers[trackerId] as TrackerAnswer | undefined;
      const id = dailyObservationId(trackerId, this.date);
      edits.push({ target: 'observation', id, value: value === undefined ? null : {
        localDate: this.date, occurredAt: occurredAt(this.date, ''), kind: 'answer', trackerId,
        trackerSnapshot: { title: tracker.title, description: tracker.description, kind: tracker.kind },
        value, title: tracker.title, note: '', details: {},
      } });
    }
    const oldEvents = new Map(before.spontaneous.map(item => [item.id, item]));
    const newEvents = new Map(after.spontaneous.map(item => [item.id, item]));
    for (const id of new Set([...oldEvents.keys(), ...newEvents.keys()])) {
      const old = oldEvents.get(id); const next = newEvents.get(id);
      if (JSON.stringify(old) === JSON.stringify(next)) continue;
      edits.push({ target: 'observation', id, value: next ? observationDraft(next) : null });
    }
    const saved: CareMutation[] = [];
    try {
      for (const edit of edits) {
        const existing = edit.target === 'tracker' ? this.trackers.find(item => item.trackerId === edit.id)
          : this.observations.find(item => item.observationId === edit.id);
        const prior = [...this.pending].reverse().find(item => item.target === edit.target && item.recordId === edit.id);
        const mutation: CareMutation = { id: createEventId(), target: edit.target, recordId: edit.id,
          expectedRevision: existing?.revision ?? null, predecessor: prior?.id ?? null,
          queuedAt: Math.max(Date.now(), (this.pending.at(-1)?.queuedAt ?? 0) + 1), after: edit.value };
        localStorage.setItem(this.scope + '.pending.' + mutation.id, JSON.stringify(mutation));
        this.pending.push(mutation); saved.push(mutation);
      }
    } catch {
      // Keep already persisted mutations; never show an unpersisted edit as saved.
      this.error = 'This device could not keep the latest edit. Free browser storage and enter it again.';
    }
    if (saved.length) { this.emit(); this.schedule(); }
  }

  private schedule(delay = 350) {
    if (this.stopped || this.locked || (this.error && this.error !== 'Pending connection. Your edits remain on this device.')
      || !this.pending.length || this.connection.profile.role === 'viewer') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }
  retry() { if (this.locked) return; this.error = ''; this.schedule(0); this.emit(); }

  private async flush() {
    if (this.flushing || this.stopped || (this.error && this.error !== 'Pending connection. Your edits remain on this device.')) return;
    if (this.error) this.error = '';
    this.flushing = true; this.emit();
    try {
      while (!this.stopped) {
        const mutation = this.pending.find(item => !this.conflicts.has(`${item.target}:${item.recordId}`));
        if (!mutation) break;
        try {
          const result = await commitCareMutation(this.connection, mutation);
          localStorage.removeItem(this.scope + '.pending.' + mutation.id);
          this.pending = this.pending.filter(item => item.id !== mutation.id);
          if (this.stopped) return;
          if (mutation.target === 'tracker') this.trackers = [...this.trackers.filter(item => item.trackerId !== mutation.recordId), result as TrackerRecord];
          else this.observations = [...this.observations.filter(item => item.observationId !== mutation.recordId), result as ObservationRecord];
          this.cache();
        } catch (error) {
          if (this.stopped) return;
          if (error instanceof CareConflict) {
            this.conflicts.set(`${mutation.target}:${mutation.recordId}`, error);
            if (error.remote) {
              if (mutation.target === 'tracker') this.trackers = [...this.trackers.filter(item => item.trackerId !== mutation.recordId), error.remote as TrackerRecord];
              else this.observations = [...this.observations.filter(item => item.observationId !== mutation.recordId), error.remote as ObservationRecord];
            }
          } else {
            this.error = (error as { code?: string }).code === 'permission-denied'
              ? 'Saving is blocked. Check your access; your edits remain on this device.'
              : 'Pending connection. Your edits remain on this device.';
            this.schedule(15_000);
            break;
          }
        }
        this.emit();
      }
    } finally { this.flushing = false; this.emit(); }
  }

  choose(recordId: string, target: CareMutation['target'], useMine: boolean) {
    const key = `${target}:${recordId}`;
    const conflict = this.conflicts.get(key);
    if (!conflict) return;
    const edits = this.pending.filter(item => item.target === target && item.recordId === recordId);
    try {
      if (useMine && edits.length) {
        const last = edits.at(-1)!;
        const replacement: CareMutation = { ...last, id: createEventId(), predecessor: null,
          expectedRevision: conflict.remote?.revision ?? null, queuedAt: Date.now() };
        localStorage.setItem(this.scope + '.pending.' + replacement.id, JSON.stringify(replacement));
        this.pending.push(replacement);
      }
      for (const item of edits) localStorage.removeItem(this.scope + '.pending.' + item.id);
      this.pending = this.pending.filter(item => !edits.includes(item));
      this.conflicts.delete(key);
      this.emit(); this.schedule(0);
    } catch { this.error = 'Could not update the local draft. Please retry.'; this.emit(); }
  }

  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const stop of this.listeners) stop();
  }
}
