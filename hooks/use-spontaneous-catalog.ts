import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocsFromServer, limit, orderBy, query, startAfter, where, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import { careCollection, observationFromDocument } from '@/lib/maymay-care-records';
import { spontaneousRepeatKey } from '@/lib/maymay-schema';
import type { Spontaneous } from '@/app/today-tracker';

type Catalog = { owner: string; previous: Spontaneous[]; counts: Record<string, number>; hasMore: boolean };
const empty: Catalog = { owner: '', previous: [], counts: {}, hasMore: false };

function toEvent(item: ReturnType<typeof observationFromDocument>): Spontaneous {
  const occurredAt = new Date(String(item.occurredAt));
  return { id: item.observationId, date: item.localDate,
    kind: item.kind as Spontaneous['kind'], title: item.title, note: item.note,
    time: Number.isFinite(occurredAt.getTime())
      ? `${String(occurredAt.getHours()).padStart(2, '0')}:${String(occurredAt.getMinutes()).padStart(2, '0')}` : '',
    details: item.details };
}

export function useSpontaneousCatalog(connection: FirebaseConnection | null, dayEvents: Spontaneous[], saveStatus: string) {
  const owner = connection?.patientId ? [connection.app.options.projectId, connection.dataGeneration,
    connection.user.uid, connection.profile.familyId, connection.patientId].join('|') : '';
  const [state, setState] = useState<Catalog>(empty);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const cursor = useRef<QueryDocumentSnapshot | null>(null);
  const loading = useRef(false);
  const alive = useRef(false);
  const version = useRef(0);
  const previousStatus = useRef(saveStatus);

  const loadMore = useCallback(async () => {
    if (!connection?.patientId || loading.current || !alive.current || currentOwner.current !== owner) return;
    loading.current = true;
    const requestVersion = version.current;
    try {
      const collectionRef = careCollection(connection.db, connection.profile.familyId, connection.patientId, 'observation');
      const parts: QueryConstraint[] = [orderBy('occurredAt', 'desc'), limit(100)];
      if (cursor.current) parts.push(startAfter(cursor.current));
      const snapshot = await getDocsFromServer(query(collectionRef, ...parts));
      if (!alive.current || currentOwner.current !== owner || version.current !== requestVersion) return;
      cursor.current = snapshot.docs.at(-1) ?? null;
      const found = snapshot.docs.map(item => observationFromDocument(item.data()))
        .filter(item => item.kind !== 'answer' && !item.deletedAt).map(toEvent);
      setState(current => {
        const unique = new Map(current.owner === owner
          ? current.previous.map(item => [spontaneousRepeatKey(item.kind, item.title), item]) : []);
        for (const item of found) {
          const key = spontaneousRepeatKey(item.kind, item.title);
          if (!unique.has(key)) unique.set(key, item);
        }
        return { ...current, owner, previous: [...unique.values()], hasMore: snapshot.docs.length === 100 };
      });
    } catch { /* Today's connected records remain usable when the catalog is offline. */ }
    finally { if (currentOwner.current === owner && version.current === requestVersion) loading.current = false; }
  }, [connection, owner]);

  useEffect(() => {
    alive.current = true; cursor.current = null; loading.current = false; version.current++;
    queueMicrotask(() => { if (alive.current && currentOwner.current === owner) setState({ ...empty, owner }); });
    void loadMore();
    return () => { alive.current = false; };
  }, [owner, loadMore]);

  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = saveStatus;
    if (was !== 'saved' && saveStatus === 'saved' && owner && alive.current) {
      version.current++; cursor.current = null; loading.current = false;
      queueMicrotask(() => {
        if (alive.current && currentOwner.current === owner) {
          setState(current => ({ ...current, owner, previous: [], hasMore: false }));
          void loadMore();
        }
      });
    }
  }, [saveStatus, owner, loadMore]);

  const keys = JSON.stringify([...new Set(dayEvents.map(item => spontaneousRepeatKey(item.kind, item.title)))].sort());
  useEffect(() => {
    if (!connection?.patientId || saveStatus !== 'saved' || keys === '[]') return;
    let active = true;
    const ref = careCollection(connection.db, connection.profile.familyId, connection.patientId, 'observation');
    void Promise.all((JSON.parse(keys) as string[]).map(async key => {
      const snapshot = await getDocsFromServer(query(ref, where('repeatKey', '==', key)));
      return [key, snapshot.docs.filter(item => item.data().deletedAt == null).length] as const;
    })).then(values => {
      if (active) setState(current => current.owner === owner
        ? { ...current, counts: { ...current.counts, ...Object.fromEntries(values) } } : current);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [connection, keys, owner, saveStatus]);

  return state.owner === owner ? { previous: state.previous, counts: state.counts,
    hasMore: state.hasMore, loadMore } : { previous: [], counts: {}, hasMore: false, loadMore };
}
