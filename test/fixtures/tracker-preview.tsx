'use client';
import { useState } from 'react';
import { TodayTracker, type TrackerData } from '@/app/today-tracker';
import { localDateValue } from '@/lib/maymay-types';

const everyDay = [0, 1, 2, 3, 4, 5, 6];
const examples: TrackerData['trackers'] = [
  {
    id: 'morning-mood',
    kind: 'mood',
    title: 'Morning Mood',
    description: 'How was the morning?',
    days: everyDay,
  },
  {
    id: 'bowel-movements',
    kind: 'count',
    title: 'Bowel Movements',
    description: 'How many times did they go today?',
    days: everyDay,
  },
  {
    id: 'school-on-time',
    kind: 'good',
    title: 'Went to School on Time',
    description: 'Did they arrive on time?',
    days: [1, 2, 3, 4, 5],
  },
];
const emptyData: TrackerData = { trackers: examples, answers: {}, spontaneous: [] };

// Test-only state for exercising the reusable tracker component.
function useTrackerDrafts(scope: string) {
  const [drafts, setDrafts] = useState<Record<string, TrackerData>>({});
  return {
    data: drafts[scope] ?? emptyData,
    update: (change: (current: TrackerData) => TrackerData) => setDrafts(current => ({
      ...current, [scope]: change(current[scope] ?? emptyData),
    })),
    clear: () => setDrafts({}),
  };
}


export default function TrackerPreview() {
  const [date, setDate] = useState(localDateValue);
  const drafts = useTrackerDrafts('sample');
  return <main className="min-h-screen bg-background px-4 py-7 text-foreground sm:px-6">
    <TodayTracker patientName="Sample patient" date={date} onDateChange={setDate} data={drafts.data} onChange={drafts.update} />
  </main>;
}
