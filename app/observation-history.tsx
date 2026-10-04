'use client';

import { ArrowRight, BarChart3, History, Info, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isCounterKind, type ObservationRecord } from '@/lib/maymay-schema';
import { observationDaySummary, summarizeObservations } from '@/lib/maymay-observation-insights';

type HistoryProps = {
  observations: ObservationRecord[]; loading: boolean; error: string; hasMore: boolean;
  rangeStart: string | null; rangeEnd: string;
  onOpenDay: (date: string) => void; onAddPastDay: () => void;
  onLoadMore: () => void; onRefresh: () => void;
};
function displayDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${date}T12:00:00`));
}

export function ObservationHistory(props: HistoryProps) {
  const days = new Map<string, ObservationRecord[]>();
  for (const record of props.observations) days.set(record.localDate, [...(days.get(record.localDate) ?? []), record]);
  return <>
    <div className="page-intro"><div><p className="eyebrow">Review and continue</p><h1>History</h1><p>Open a recorded day or add one you missed.</p></div>
      <Button variant="outline" className="h-11" onClick={props.onAddPastDay}><Plus /> Add past day</Button></div>
    <p className="mt-3 text-sm text-muted-foreground">Loaded range: {props.rangeStart ? displayDate(props.rangeStart) : 'loading'} – {displayDate(props.rangeEnd)}</p>
    <div className="backfill-note mt-5" role="note"><Info /><span>Past details may be less reliable. Add only what you clearly remember.</span></div>
    {props.error && <p className="mt-4 text-sm text-destructive" role="alert">{props.error} <button className="underline" onClick={props.onRefresh}>Retry</button></p>}
    {props.loading && <p className="mt-4 text-sm" role="status">Loading recorded days…</p>}
    {!props.loading && !days.size && !props.error && <div className="empty-state mt-5"><History /><h2>No recorded days in this range</h2><p>Record today or load an older range.</p></div>}
    {days.size > 0 && <div className="history-list mt-5">{[...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, records]) => {
      const summary = observationDaySummary(records);
      return <button key={date} type="button" className="history-item" onClick={() => props.onOpenDay(date)}>
        <div className="history-date"><small>{new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))}</small>
          <strong>{Number(date.slice(8, 10))}</strong><span>{new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${date}T12:00:00`))}</span></div>
        <div className="history-summary"><b>{displayDate(date)}</b><div><span>{summary.answers} {summary.answers === 1 ? 'answer' : 'answers'}</span>
          <span>{summary.spontaneous} spontaneous {summary.spontaneous === 1 ? 'event' : 'events'}</span></div>
          <p>{summary.labels.slice(0, 4).join(' · ')}{summary.labels.length > 4 ? ' · …' : ''}</p></div><ArrowRight />
      </button>;
    })}</div>}
    {props.hasMore && <Button variant="outline" className="mt-5 min-h-11" disabled={props.loading} onClick={props.onLoadMore}>Load older days</Button>}
  </>;
}

export function ObservationInsights({ observations, loading, error, rangeStart, rangeEnd, onRefresh, onOpenDay, onLoadMore, hasMore }: Omit<HistoryProps, 'onAddPastDay'>) {
  const summary = summarizeObservations(observations);
  const meltdowns = observations.filter(item => item.kind === 'meltdown').sort((a, b) => b.localDate.localeCompare(a.localDate));
  return <>
    <div className="page-intro"><div><p className="eyebrow">Patterns from recorded care</p><h1>Insights</h1><p>Simple counts from this patient&apos;s saved observations.</p></div></div>
    <p className="mt-4 text-sm text-muted-foreground">Loaded range: {rangeStart ? displayDate(rangeStart) : 'loading'} – {displayDate(rangeEnd)} · {summary.recordedDays} recorded {summary.recordedDays === 1 ? 'day' : 'days'}</p>
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error} <button className="underline" onClick={onRefresh}>Retry</button></p>}
    {loading && <p className="mt-3 text-sm" role="status">Loading observations…</p>}
    {!loading && !summary.recordedDays && !error && <div className="empty-state mt-5"><BarChart3 /><h2>Insights begin with the first check-in</h2><p>Save an answer or spontaneous event to see it here.</p></div>}
    {summary.recordedDays > 0 && <div className="mt-5 space-y-5">
      <div className="stats-grid">
        <Card><CardContent><small>Recorded days</small><strong>{summary.recordedDays}</strong><span>in the loaded range</span></CardContent></Card>
        <Card><CardContent><small>Spontaneous events</small><strong>{Object.values(summary.spontaneous).reduce((a, b) => a + b, 0)}</strong><span>good, difficult, meltdown, or other</span></CardContent></Card>
        <Card><CardContent><small>Meltdowns</small><strong>{summary.spontaneous.meltdown}</strong><span>recorded occurrences</span></CardContent></Card>
      </div>
      {summary.trackers.length > 0 && <Card><CardHeader><CardTitle className="text-xl font-bold">Recurring events</CardTitle><p className="text-muted-foreground">Each tracker is counted separately. Unanswered days are excluded.</p></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">{summary.trackers.map(item => <div key={item.id} className="rounded-xl border p-4">
          <b>{item.title}</b><p className="text-sm text-muted-foreground">{item.recorded} recorded {item.recorded === 1 ? 'day' : 'days'}</p>
          <p className="mt-2 text-sm">{item.kind === 'mood' ? `Average mood ${item.average?.toFixed(1)}/5` : isCounterKind(item.kind)
            ? `Total ${item.total} · ${item.average?.toFixed(1)} per recorded day`
            : `${item.yes} Yes · ${item.no} No`}</p>
          {item.kind === 'mood' && <p className="mt-1 text-xs text-muted-foreground">{Object.entries(item.moods).map(([mood, count]) => `${mood} ${count}`).join(' · ')}</p>}
        </div>)}</CardContent></Card>}
      <Card><CardHeader><CardTitle className="text-xl font-bold">Spontaneous events</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        {Object.entries(summary.spontaneous).map(([kind, count]) => <p key={kind} className="rounded-xl border p-3"><b className="capitalize">{kind}</b>: {count}</p>)}
      </CardContent></Card>
      {meltdowns.length > 0 && <Card><CardHeader><CardTitle className="text-xl font-bold">Explore meltdown days</CardTitle><p className="text-muted-foreground">Open the recorded day, then use the date controls to inspect preceding days.</p></CardHeader>
        <CardContent className="flex flex-wrap gap-2">{[...new Set(meltdowns.map(item => item.localDate))].slice(0, 10).map(date =>
          <Button key={date} variant="outline" className="min-h-11" onClick={() => onOpenDay(date)}>{displayDate(date)}</Button>)}</CardContent></Card>}
    </div>}
    {hasMore && <Button variant="outline" className="mt-5 min-h-11" disabled={loading} onClick={onLoadMore}>Include older days</Button>}
  </>;
}
