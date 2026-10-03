import type { MoodAnswer, ObservationRecord, TrackerKind } from './maymay-schema';

const moodScores: Record<string, number> = { Bad: 1, Poor: 2, Neutral: 3, OK: 4, Good: 5 };
const emptyMoods = (): Record<MoodAnswer, number> => ({ Bad: 0, Poor: 0, Neutral: 0, OK: 0, Good: 0 });
type TrackerInsight = { id: string; title: string; kind: TrackerKind; recorded: number; total: number;
  yes: number; no: number; average: number | null; moods: Record<MoodAnswer, number> };

export function summarizeObservations(records: ObservationRecord[]) {
  const active = records.filter(item => !item.deletedAt);
  const days = [...new Set(active.map(item => item.localDate))].sort().reverse();
  const trackers = new Map<string, TrackerInsight>();
  const spontaneous = { good: 0, difficult: 0, meltdown: 0, other: 0 };
  for (const item of active) {
    if (item.kind !== 'answer') {
      spontaneous[item.kind]++;
      continue;
    }
    if (!item.trackerId || !item.trackerSnapshot || item.value === null) continue;
    const snapshot = item.trackerSnapshot;
    const insight = trackers.get(item.trackerId) ?? { id: item.trackerId, title: snapshot.title,
      kind: snapshot.kind, recorded: 0, total: 0, yes: 0, no: 0, average: null, moods: emptyMoods() };
    insight.recorded++;
    if (snapshot.kind === 'mood' && typeof item.value === 'string') {
      insight.total += moodScores[item.value] ?? 0;
      if (item.value in insight.moods) insight.moods[item.value as MoodAnswer]++;
    }
    if (snapshot.kind === 'count' && typeof item.value === 'number') insight.total += item.value;
    if (item.value === true) insight.yes++;
    if (item.value === false) insight.no++;
    insight.average = ['mood', 'count'].includes(snapshot.kind) ? insight.total / insight.recorded : null;
    trackers.set(item.trackerId, insight);
  }
  return { recordedDays: days.length, firstDate: days.at(-1) ?? null, lastDate: days[0] ?? null,
    trackers: [...trackers.values()].sort((a, b) => a.title.localeCompare(b.title)), spontaneous };
}

export function observationDaySummary(records: ObservationRecord[]) {
  const answers = records.filter(item => item.kind === 'answer');
  const spontaneous = records.filter(item => item.kind !== 'answer');
  return { answers: answers.length, spontaneous: spontaneous.length,
    labels: [...answers.map(item => item.trackerSnapshot?.title ?? item.title), ...spontaneous.map(item => item.title)] };
}
