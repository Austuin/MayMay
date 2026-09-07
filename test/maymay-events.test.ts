import { describe, expect, it } from 'vitest';

import { desiredEvents } from '@/lib/maymay-firebase';
import { createMeltdown, createPossibleTrigger, emptyEntry } from '@/lib/maymay-types';

describe('Firestore event mapping', () => {
  it('maps every daily input category without writing to Firebase', () => {
    const entry = emptyEntry('2026-09-06');
    entry.moods.morning = { score: 4, tags: ['Calm'] };
    entry.moods.afternoon = { score: 3, tags: ['Tired'] };
    entry.moods.evening = { score: 5, tags: ['Excited'] };
    entry.schoolStatus = 'Stayed home';
    entry.schoolNote = 'Test appointment';
    entry.healthStatus = 'A little unwell';
    entry.healthNotes = 'Test sniffles';
    entry.sleepQuality = 4;
    entry.sleepStart = '21:15';
    entry.wakeTime = '06:45';
    entry.wakeUps = '2';
    entry.meals = { breakfast: 'Ate well', lunch: 'Ate some', dinner: 'Very little', snacks: 'Refused' };
    entry.bathroom = { bowelMovement: 'Yes', count: '1' };
    entry.medications.melatonin = { status: 'Given', amount: '5 mg', time: '20:30' };
    entry.medications.fluoxetine = { status: 'Given', amount: '10 mg', time: '07:30' };
    entry.possibleTriggers.push({
      ...createPossibleTrigger(),
      time: '11:20',
      category: 'Other',
      categoryOther: 'Test transition',
      observedEffect: 'Moderate stress',
      notes: 'Test context',
    });
    entry.meltdowns.push({
      ...createMeltdown(),
      time: '14:10',
      duration: '5–15 min',
      intensity: 'Moderate',
      trigger: 'Other',
      triggerOther: 'Test noise',
      earlySigns: 'Test pacing',
      aggression: 'No',
      whatHelped: 'Quiet / space',
      notes: 'Test event notes',
    });
    entry.notes = 'Test daily note';

    const events = desiredEvents(entry);
    expect(events.map((event) => event.type)).toEqual([
      'mood', 'mood', 'mood',
      'sleep',
      'routine',
      'health',
      'meal', 'meal', 'meal', 'meal',
      'bathroom',
      'medication', 'medication',
      'trigger',
      'meltdown',
      'note',
    ]);
    expect(events.find((event) => event.type === 'trigger')?.data).toMatchObject({
      category: 'Other',
      categoryOther: 'Test transition',
      observedEffect: 'Moderate stress',
    });
    expect(events.find((event) => event.type === 'meltdown')?.data).toMatchObject({
      duration: '5–15 min',
      intensity: 'Moderate',
      triggerOther: 'Test noise',
      whatHelped: 'Quiet / space',
    });

    entry.possibleTriggers = [];
    entry.meltdowns = [];
    const cleanedEvents = desiredEvents(entry);
    expect(cleanedEvents.some((event) => event.type === 'trigger')).toBe(false);
    expect(cleanedEvents.some((event) => event.type === 'meltdown')).toBe(false);
  });
});
