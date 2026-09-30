import type { FirebaseConnection } from './maymay-firebase';
import type { EventRecord } from './maymay-events';
import type { EventMutation } from './maymay-sync-model';

export function careStorageScope(connection: FirebaseConnection) {
  return 'maymay.sync.v1.' + encodeURIComponent(JSON.stringify([
    connection.app.options.projectId, connection.user.uid, connection.profile.familyId, connection.childId,
  ]));
}

export function loadCareCache(scope: string): EventRecord[] {
  const value: unknown = JSON.parse(localStorage.getItem(scope + '.cache') ?? '[]');
  if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string'
    || typeof item.localDate !== 'string' || typeof item.type !== 'string'
    || typeof item.revision !== 'number' || typeof item.data !== 'object' || !item.data)) {
    throw new Error('The local care cache could not be read.');
  }
  return value;
}

export function saveCareCache(scope: string, records: EventRecord[]) {
  localStorage.setItem(scope + '.cache', JSON.stringify(records));
}

export function loadPendingMutations(scope: string): EventMutation[] {
  const prefix = scope + '.pending.';
  const result: EventMutation[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) {
      const item = JSON.parse(localStorage.getItem(key)!);
      if (!item || key !== prefix + item.id || typeof item.eventId !== 'string'
        || typeof item.localDate !== 'string' || !Number.isFinite(item.queuedAt)
        || (item.after !== null && (!item.after || item.after.id !== item.eventId || !item.after.data))) {
        throw new Error('An unsent local note could not be read.');
      }
      result.push(item);
    }
  }
  return result.sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

export function savePendingMutation(scope: string, mutation: EventMutation) {
  // Separate immutable keys keep two tabs from replacing one another's unsent work.
  localStorage.setItem(scope + '.pending.' + mutation.id, JSON.stringify(mutation));
}

export function removePendingMutation(scope: string, id: string) {
  localStorage.removeItem(scope + '.pending.' + id);
}

export function hasLegacyCareCache() {
  try {
    return ['maymay.entries.v3', 'maymay.entries.v2', 'trackerV11'].some(key => {
      const value = localStorage.getItem(key);
      return value !== null && value !== '[]';
    });
  } catch { return false; }
}
