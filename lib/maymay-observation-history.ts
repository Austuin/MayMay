import { getDocsFromServer, orderBy, query, where } from 'firebase/firestore';
import type { FirebaseConnection } from './maymay-firebase';
import { careCollection, observationFromDocument } from './maymay-care-records';
import type { ObservationRecord } from './maymay-schema';
import { historyCutoffDate, localDateValue } from './maymay-types';

export type HistoryWindow = { start: string; end: string };

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDateValue(date);
}

export function nextHistoryWindow(previous?: HistoryWindow, today = localDateValue(), cutoff = historyCutoffDate()): HistoryWindow | null {
  const end = previous ? shiftDay(previous.start, -1) : today;
  if (end < cutoff) return null;
  return { start: shiftDay(end, -89) < cutoff ? cutoff : shiftDay(end, -89), end };
}

export async function readObservationWindow(connection: FirebaseConnection, window: HistoryWindow): Promise<ObservationRecord[]> {
  if (!connection.patientId) return [];
  const source = careCollection(connection.db, connection.profile.familyId, connection.patientId, 'observation');
  const snapshot = await getDocsFromServer(query(source,
    where('localDate', '>=', window.start), where('localDate', '<=', window.end), orderBy('localDate', 'desc')));
  return snapshot.docs.map(item => observationFromDocument(item.data()));
}

export function replaceObservationWindow(previous: ObservationRecord[], incoming: ObservationRecord[], window: HistoryWindow) {
  return [...previous.filter(item => item.localDate < window.start || item.localDate > window.end), ...incoming]
    .filter(item => !item.deletedAt)
    .sort((a, b) => b.localDate.localeCompare(a.localDate) || String(b.occurredAt).localeCompare(String(a.occurredAt)));
}
