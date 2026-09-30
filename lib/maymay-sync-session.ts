import type { FirebaseConnection } from './maymay-firebase';
import { createEventId, emptyEntry, type DailyEntry } from './maymay-types';
import type { EventRecord } from './maymay-events';
import { commitEventMutations, watchCareEvents } from './maymay-sync-firebase';
import { mutationsForEdit, projectEntries, SaveConflict, type EventMutation } from './maymay-sync-model';
import { careStorageScope, loadCareCache, loadPendingMutations, removePendingMutation, saveCareCache, savePendingMutation } from './maymay-sync-storage';

export type CareSyncState = {
  entries: DailyEntry[];
  status: 'loading' | 'saved' | 'pending' | 'error';
  message: string;
  conflicts: { eventId: string; date: string; local: Record<string, unknown> | null; remote: Record<string, unknown> | null }[];
};

export class CareSyncSession {
  private records: EventRecord[] = [];
  private pending: EventMutation[] = [];
  private conflicts = new Map<string, SaveConflict>();
  private scope: string;
  private disposed = false;
  private running = false;
  private locked = false;
  private timer?: ReturnType<typeof setTimeout>;
  private unwatch?: () => void;
  private status: CareSyncState['status'] = 'loading';
  private message = 'Loading shared records…';

  constructor(private connection: FirebaseConnection, private changed: (state: CareSyncState) => void) {
    this.scope = careStorageScope(connection);
  }

  start() {
    try {
      this.records = loadCareCache(this.scope);
      this.pending = loadPendingMutations(this.scope);
    } catch {
      this.locked = true;
      this.status = 'error';
      this.message = 'Local notes could not be read. They have been preserved; please do not clear browser storage.';
      this.emit();
      return;
    }
    this.emit();
    this.unwatch = watchCareEvents(this.connection, records => {
      if (this.disposed) return;
      this.records = records;
      try { saveCareCache(this.scope, records); } catch { /* Pending changes are persisted separately before display. */ }
      if (!this.pending.length && !this.locked) {
        this.status = 'saved';
        this.message = 'Connected and up to date';
      }
      this.emit();
      this.schedule();
    }, error => {
      if (this.disposed) return;
      if ((error as { code?: string }).code === 'permission-denied') {
        this.locked = true;
        this.records = [];
      }
      this.status = 'error';
      this.message = this.locked ? 'Access changed. Sign in again to check access. Unsent notes are preserved.' : 'Connection interrupted. Your unsent notes are kept on this device.';
      this.emit();
    });
    this.schedule();
  }

  private emit() {
    if (this.disposed) return;
    this.changed({
      entries: this.locked ? [] : projectEntries(this.records, this.pending),
      status: this.status, message: this.message,
      conflicts: [...this.conflicts].map(([eventId, conflict]) => {
        const local = this.pending.filter(item => item.eventId === eventId).at(-1)!;
        return { eventId, date: local.localDate, local: local.after?.data ?? null,
          remote: conflict.remote?.deletedAt ? null : conflict.remote?.data ?? null };
      }),
    });
  }

  edit(next: DailyEntry) {
    if (this.disposed || this.locked || !['master', 'caregiver'].includes(this.connection.profile.role)) return;
    const before = projectEntries(this.records, this.pending).find(entry => entry.date === next.date) ?? emptyEntry(next.date);
    const mutations = mutationsForEdit(before, next, this.records, this.pending);
    try {
      for (const mutation of mutations) {
        savePendingMutation(this.scope, mutation);
        this.pending.push(mutation);
      }
    } catch {
      this.status = 'error';
      this.message = 'This device could not save the latest change. Free browser storage and enter it again.';
      this.emit();
      return;
    }
    if (mutations.length) {
      this.status = 'pending';
      this.message = 'Saved on this device · waiting to sync';
      this.emit();
      this.schedule();
    }
  }

  retry() {
    if (this.disposed || this.locked) return;
    this.schedule(0);
  }

  private schedule(delay = 450) {
    if (this.disposed || this.locked || !this.pending.length || this.connection.profile.role === 'viewer') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }

  private async flush() {
    if (this.running || this.disposed || this.locked) return;
    this.running = true;
    try {
      while (!this.disposed && !this.locked) {
        const first = this.pending.find(item => !this.conflicts.has(item.eventId));
        if (!first) break;
        const candidates = this.pending.filter(item => item.eventId === first.eventId);
        // A separate tab may have a divergent edit. Only combine a single intent chain.
        const group = [first];
        for (const candidate of candidates.slice(1, 100)) {
          if (candidate.predecessor !== group.at(-1)!.id) break;
          group.push(candidate);
        }
        try {
          const record = await commitEventMutations(this.connection, group);
          for (const item of group) removePendingMutation(this.scope, item.id);
          const done = new Set(group.map(item => item.id));
          this.pending = this.pending.filter(item => !done.has(item.id));
          if (this.disposed) return;
          if (record) {
            const existing = this.records.find(item => item.id === record.id);
            if (!existing || record.revision > existing.revision) {
              this.records = [...this.records.filter(item => item.id !== record.id), record];
            }
          }
          try { saveCareCache(this.scope, this.records); } catch { /* Cloud save succeeded. */ }
        } catch (error) {
          if (this.disposed) return;
          if (error instanceof SaveConflict) {
            this.conflicts.set(first.eventId, error);
            if (error.remote) this.records = [...this.records.filter(item => item.id !== first.eventId), error.remote];
          } else {
            this.status = 'error';
            this.message = (error as { code?: string }).code === 'permission-denied'
              ? 'Saving is blocked. Check access or update MayMay, then retry. Your edits are kept on this device.'
              : 'Saved on this device · could not sync. We will retry when connected.';
            this.emit();
            this.schedule(15_000);
            return;
          }
        }
        this.status = this.conflicts.size ? 'error' : this.pending.length ? 'pending' : 'saved';
        this.message = this.conflicts.size ? 'Another caregiver changed a record. Review the saved version and your edit below.'
          : this.pending.length ? 'Saving changes…' : 'Saved locally and synced';
        this.emit();
      }
    } finally {
      this.running = false;
    }
  }

  useSaved(eventId: string) {
    if (!this.conflicts.has(eventId)) return;
    try {
      for (const item of this.pending.filter(item => item.eventId === eventId)) removePendingMutation(this.scope, item.id);
    } catch {
      this.message = 'Could not update the local draft. Please retry.';
      this.emit();
      return;
    }
    this.pending = this.pending.filter(item => item.eventId !== eventId);
    this.conflicts.delete(eventId);
    this.status = this.conflicts.size ? 'error' : this.pending.length ? 'pending' : 'saved';
    this.message = 'Using the saved version. You can edit it again if needed.';
    this.emit();
    this.schedule();
  }

  useMyEdit(eventId: string) {
    const conflict = this.conflicts.get(eventId);
    const edits = this.pending.filter(item => item.eventId === eventId);
    if (!conflict || !edits.length || this.disposed || this.locked) return;
    const last = edits.at(-1)!;
    const replacement: EventMutation = {
      ...last, id: createEventId(), predecessor: null,
      // Use the version shown in the comparison, not a newer, unseen live update.
      expected: conflict.remote ? { revision: conflict.remote.revision, updatedAt: conflict.remote.updatedAt } : null,
      queuedAt: Math.max(Date.now(), last.queuedAt + 1),
    };
    try {
      savePendingMutation(this.scope, replacement);
      for (const item of edits) removePendingMutation(this.scope, item.id);
    } catch {
      this.message = 'Could not update the local draft. Please retry.';
      this.emit();
      return;
    }
    this.pending = [...this.pending.filter(item => item.eventId !== eventId), replacement];
    this.conflicts.delete(eventId);
    this.status = 'pending';
    this.message = 'Saving your chosen version…';
    this.emit();
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.unwatch?.();
  }
}
