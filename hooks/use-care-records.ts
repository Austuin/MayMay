import { useCallback, useEffect, useRef, useState } from 'react';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import { CareRecordSession, type CareView } from '@/lib/maymay-care-session';
import type { TrackerData } from '@/app/today-tracker';

const initial: CareView = {
  data: { trackers: [], answers: {}, spontaneous: [] }, status: 'loading',
  message: 'Loading shared records…', conflicts: [],
};

export function useCareRecords(connection: FirebaseConnection | null, date: string) {
  const [snapshot, setSnapshot] = useState<{ key: string; view: CareView }>({ key: '', view: initial });
  const session = useRef<CareRecordSession | null>(null);
  const key = connection?.childId ? [connection.app.options.projectId, connection.dataGeneration,
    connection.user.uid, connection.profile.familyId, connection.childId, date].join('|') : '';
  useEffect(() => {
    if (!connection?.childId) return;
    const current = new CareRecordSession(connection, date, view => setSnapshot({ key, view }));
    session.current = current;
    current.start();
    const retry = () => current.retry();
    window.addEventListener('online', retry);
    return () => {
      current.dispose();
      if (session.current === current) session.current = null;
      window.removeEventListener('online', retry);
    };
  }, [connection, date, key]);
  const change = useCallback((update: (current: TrackerData) => TrackerData) => session.current?.edit(update), []);
  const retry = useCallback(() => session.current?.retry(), []);
  const choose = useCallback((recordId: string, target: 'tracker' | 'observation', useMine: boolean) =>
    session.current?.choose(recordId, target, useMine), []);
  return { ...(snapshot.key === key ? snapshot.view : initial), change, retry, choose };
}
