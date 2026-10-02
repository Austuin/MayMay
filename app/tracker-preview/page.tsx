'use client';
import { useState } from 'react';
import { TodayTracker, useTrackerDrafts } from '../today-tracker';
import { localDateValue } from '@/lib/maymay-types';

export default function TrackerPreview() {
  const [date, setDate] = useState(localDateValue);
  const drafts = useTrackerDrafts('sample');
  return <main className="min-h-screen bg-background px-4 py-7 text-foreground sm:px-6">
    <TodayTracker patientName="Sample patient" date={date} onDateChange={setDate} data={drafts.data} onChange={drafts.update} />
  </main>;
}
