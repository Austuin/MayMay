import { useCallback, useEffect, useRef, useState } from 'react';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import type { DailyEntry } from '@/lib/maymay-types';
import { CareSyncSession, type CareSyncState } from '@/lib/maymay-sync-session';

const initial: CareSyncState = { entries: [], status: 'loading', message: 'Loading shared records…', conflicts: [] };

export function useCareSync(connection: FirebaseConnection | null) {
  const [snapshot, setSnapshot] = useState<{ owner: FirebaseConnection | null; state: CareSyncState }>({ owner: null, state: initial });
  const entriesRef = useRef<DailyEntry[]>([]);
  const session = useRef<CareSyncSession | null>(null);
  useEffect(() => {
    entriesRef.current = [];
    if (!connection || !connection.childId || connection.profile.role === 'pending') return;
    const current = new CareSyncSession(connection, next => {
      entriesRef.current = next.entries;
      setSnapshot({ owner: connection, state: next });
    });
    session.current = current;
    current.start();
    const retry = () => current.retry();
    window.addEventListener('online', retry);
    return () => {
      current.dispose();
      session.current = null;
      entriesRef.current = [];
      window.removeEventListener('online', retry);
    };
  }, [connection]);
  const getEntries = useCallback(() => entriesRef.current, []);
  const replaceEntry = useCallback((entry: DailyEntry) => session.current?.edit(entry), []);
  const retry = useCallback(() => session.current?.retry(), []);
  const acceptSaved = useCallback((eventId: string) => session.current?.useSaved(eventId), []);
  const saveDraft = useCallback((eventId: string) => session.current?.useMyEdit(eventId), []);
  const stop = useCallback(() => { session.current?.dispose(); session.current = null; entriesRef.current = []; }, []);
  return { ...(snapshot.owner === connection ? snapshot.state : initial), getEntries, replaceEntry, retry, acceptSaved, saveDraft, stop };
}
