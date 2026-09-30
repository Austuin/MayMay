import { createEventId, type DailyEntry } from './maymay-types';
import { entriesFromEvents, eventValues, logicalEventId, sameValue, type EventRecord, type EventValue } from './maymay-events';

export type EventMutation = {
  id: string;
  eventId: string;
  localDate: string;
  expected: { revision: number; updatedAt: string } | null;
  predecessor: string | null;
  after: EventValue | null;
  queuedAt: number;
};

export class SaveConflict extends Error {
  constructor(public eventId: string, public remote: EventRecord | null) {
    super('Another caregiver changed this record. Review both versions before saving.');
    this.name = 'SaveConflict';
  }
}

export function mutationsForEdit(before: DailyEntry, after: DailyEntry, records: EventRecord[], pending: EventMutation[]): EventMutation[] {
  const previous = new Map(eventValues(before).map(event => [event.id, event]));
  const next = new Map(eventValues(after).map(event => [event.id, event]));
  let queuedAt = pending.reduce((time, item) => Math.max(time, item.queuedAt + 1), Date.now());
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap(logicalId => {
    if (sameValue(previous.get(logicalId), next.get(logicalId))) return [];
    const matching = records.filter(event => logicalEventId(event) === logicalId);
    const remote = matching.filter(event => !event.deletedAt).at(-1) ?? matching.at(-1);
    const eventId = remote?.id ?? logicalId;
    const predecessor = pending.filter(item => item.eventId === eventId).at(-1);
    const value = next.get(logicalId);
    return [{
      id: createEventId(), eventId, localDate: after.date,
      expected: remote ? { revision: remote.revision, updatedAt: remote.updatedAt } : null,
      predecessor: predecessor?.id ?? null,
      after: value ? { ...value, id: eventId } : null, queuedAt: queuedAt++,
    }];
  });
}

export function projectEntries(records: EventRecord[], pending: EventMutation[]) {
  const projected = new Map(records.map(event => [event.id, event]));
  for (const mutation of pending) {
    if (mutation.after) {
      projected.set(mutation.eventId, {
        ...mutation.after, localDate: mutation.localDate, revision: 0,
        updatedAt: new Date(mutation.queuedAt).toISOString(), deletedAt: null,
      });
    } else projected.delete(mutation.eventId);
  }
  return entriesFromEvents([...projected.values()]);
}

/** A deleted record still has a revision: an old device must never resurrect it. */
export function matchesExpected(current: EventRecord | null, expected: EventMutation['expected']) {
  return current === null ? expected === null : expected !== null
    && current.revision === expected.revision
    && (current.revision > 0 || current.updatedAt === expected.updatedAt);
}
