import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ObservationHistory, ObservationInsights } from '@/app/observation-history';
import { nextHistoryWindow, replaceObservationWindow } from '@/lib/maymay-observation-history';
import { summarizeObservations } from '@/lib/maymay-observation-insights';
import type { ObservationRecord, TrackerKind } from '@/lib/maymay-schema';

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); });

function record(id: string, date: string, value: ObservationRecord['value'], kind: ObservationRecord['kind'] = 'answer', trackerKind?: TrackerKind): ObservationRecord {
  return { observationId: id, familyId: 'family-a', patientId: 'patient-a', dataGeneration: 'test',
    createdBy: 'caregiver', updatedBy: 'caregiver', createdAt: '', updatedAt: '', revision: 1, deletedAt: null,
    localDate: date, occurredAt: `${date}T12:00:00Z`, kind,
    trackerId: kind === 'answer' ? id : null,
    trackerSnapshot: kind === 'answer' ? { title: id, description: 'Recorded answer', kind: trackerKind ?? (typeof value === 'number' ? 'count' : typeof value === 'string' ? 'mood' : 'checkin') } : null,
    value, title: id, note: '', details: {} };
}

describe('Observation history and insights', () => {
  it('loads contiguous bounded ranges and keeps a soft-deleted observation out of the timeline', () => {
    const first = nextHistoryWindow(undefined, '2026-10-03', '2023-10-03')!;
    const second = nextHistoryWindow(first, '2026-10-03', '2023-10-03')!;
    expect(first.end).toBe('2026-10-03');
    expect(new Date(first.end).getTime() - new Date(first.start).getTime()).toBe(89 * 86_400_000);
    expect(new Date(first.start).getTime() - new Date(second.end).getTime()).toBe(86_400_000);
    const deleted = { ...record('removed', '2026-10-01', true), deletedAt: '2026-10-02T12:00:00Z' };
    expect(replaceObservationWindow([record('old', '2026-01-01', false)], [record('new', '2026-10-02', false), deleted], first)
      .map(item => item.observationId)).toEqual(['new', 'old']);
  });

  it('counts each tracker separately, includes No and zero, and excludes unanswered entries', () => {
    const records = [record('Mood', '2026-10-01', 'Good'), record('Mood', '2026-10-02', 'Poor'),
      record('Bowel movements', '2026-10-01', 0), record('Bowel movements', '2026-10-02', 2),
      record('School', '2026-10-01', false), record('School', '2026-10-02', true),
      record('Meltdown', '2026-10-02', null, 'meltdown')];
    const summary = summarizeObservations(records);
    expect(summary.recordedDays).toBe(2);
    expect(summary.trackers.find(item => item.id === 'Mood')?.average).toBe(3.5);
    expect(summary.trackers.find(item => item.id === 'Mood')?.moods).toMatchObject({ Good: 1, Poor: 1, Bad: 0 });
    expect(summary.trackers.find(item => item.id === 'Bowel movements')).toMatchObject({ total: 2, average: 1, recorded: 2 });
    expect(summary.trackers.find(item => item.id === 'School')).toMatchObject({ yes: 1, no: 1, recorded: 2 });
    expect(summary.spontaneous.meltdown).toBe(1);
  });

  it('totals positive and difficult counters independently, including zero', () => {
    const records = [record('Hugs', '2026-10-01', 3, 'answer', 'good_count'),
      record('Hugs', '2026-10-02', 0, 'answer', 'good_count'),
      record('Crying', '2026-10-01', 1, 'answer', 'difficult_count'),
      record('Crying', '2026-10-02', 2, 'answer', 'difficult_count')];
    const summary = summarizeObservations(records);
    expect(summary.trackers.find(item => item.id === 'Hugs')).toMatchObject({ kind: 'good_count', total: 3, average: 1.5, recorded: 2 });
    expect(summary.trackers.find(item => item.id === 'Crying')).toMatchObject({ kind: 'difficult_count', total: 3, average: 1.5, recorded: 2 });
    render(<ObservationInsights observations={records} loading={false} error="" hasMore={false}
      rangeStart="2026-10-01" rangeEnd="2026-10-02" onOpenDay={() => undefined}
      onLoadMore={() => undefined} onRefresh={() => undefined} />);
    expect(screen.getAllByText('Total 3 · 1.5 per recorded day')).toHaveLength(2);
  });

  it('opens the recorded day and links a meltdown back to its day', () => {
    const records = [record('Mood', '2026-10-01', 'Good'), record('Meltdown', '2026-10-01', null, 'meltdown')];
    const opened: string[] = [];
    const shared = { observations: records, loading: false, error: '', hasMore: false,
      rangeStart: '2026-07-06', rangeEnd: '2026-10-03', onOpenDay: (date: string) => opened.push(date),
      onLoadMore: () => undefined, onRefresh: () => undefined };
    const view = render(<ObservationHistory {...shared} onAddPastDay={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /October 1, 2026/ }));
    expect(opened).toEqual(['2026-10-01']);
    view.rerender(<ObservationInsights {...shared} />);
    fireEvent.click(screen.getByRole('button', { name: 'October 1, 2026' }));
    expect(opened).toEqual(['2026-10-01', '2026-10-01']);
  });
});
