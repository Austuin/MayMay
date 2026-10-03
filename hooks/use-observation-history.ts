import { useCallback, useEffect, useState } from 'react';
import type { FirebaseConnection } from '@/lib/maymay-firebase';
import type { ObservationRecord } from '@/lib/maymay-schema';
import { historyCutoffDate } from '@/lib/maymay-types';
import { nextHistoryWindow, readObservationWindow, replaceObservationWindow, type HistoryWindow } from '@/lib/maymay-observation-history';

type HistoryState = { scope: string; windows: HistoryWindow[]; observations: ObservationRecord[]; loading: boolean; error: string };
const empty: HistoryState = { scope: '', windows: [], observations: [], loading: false, error: '' };

export function useObservationHistory(connection: FirebaseConnection | null, activeTab: string) {
  const scope = connection?.patientId ? [connection.app.options.projectId, connection.dataGeneration, connection.user.uid,
    connection.profile.familyId, connection.patientId].join('|') : '';
  const [state, setState] = useState<HistoryState>(empty);
  const [refreshNumber, setRefreshNumber] = useState(0);
  const visible = state.scope === scope ? state : empty;
  const active = activeTab === 'history' || activeTab === 'insights';

  useEffect(() => {
    if (!active || !scope || !connection) return;
    let alive = true;
    const windows = state.scope === scope && state.windows.length ? state.windows : [nextHistoryWindow()!];
    queueMicrotask(() => { if (alive) setState(previous => ({
      ...(previous.scope === scope ? previous : { ...empty, scope }), loading: true, error: '',
    })); });
    void Promise.all(windows.map(async window => ({ window, observations: await readObservationWindow(connection, window) })))
      .then(results => { if (!alive) return; setState(previous => {
        let observations = previous.scope === scope ? previous.observations : [];
        for (const result of results) observations = replaceObservationWindow(observations, result.observations, result.window);
        return { scope, windows, observations, loading: false, error: '' };
      }); })
      .catch(error => { if (alive) setState(previous => ({ ...previous, scope, loading: false,
        error: error instanceof Error ? error.message : 'Could not load recorded days.' })); });
    return () => { alive = false; };
  // Refresh when entering History or Insights, changing patient, or requesting a reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeTab, scope, refreshNumber]);

  const loadMore = useCallback(async () => {
    if (!connection || !scope || visible.loading) return;
    const window = nextHistoryWindow(visible.windows.at(-1));
    if (!window) return;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    try {
      const records = await readObservationWindow(connection, window);
      setState(previous => previous.scope !== scope ? previous : { ...previous, windows: [...previous.windows, window],
        observations: replaceObservationWindow(previous.observations, records, window), loading: false });
    } catch (error) {
      setState(previous => previous.scope !== scope ? previous : { ...previous, loading: false,
        error: error instanceof Error ? error.message : 'Could not load older days.' });
    }
  }, [connection, scope, visible.loading, visible.windows]);

  return { ...visible, hasMore: Boolean(visible.windows.length && visible.windows.at(-1)!.start > historyCutoffDate()),
    loadMore, refresh: () => setRefreshNumber(number => number + 1) };
}
