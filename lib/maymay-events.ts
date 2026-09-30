import { emptyEntry, type DailyEntry } from './maymay-types';

export type EventValue = { id: string; type: string; occurredAt: string; data: Record<string, unknown> };
export type EventRecord = EventValue & { localDate: string; revision: number; updatedAt: string; deletedAt: string | null };

function stringValue(value: unknown) { return typeof value === 'string' ? value : ''; }
function dateFor(date: string, time = '12:00') {
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : '12:00';
  return new Date(date + 'T' + safeTime + ':00');
}

export function entriesFromEvents(records: EventRecord[]) {
  const entries = new Map<string, DailyEntry>();

  for (const event of records) {
    if (event.deletedAt) continue;
    const date = stringValue(event.localDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const entry = entries.get(date) ?? emptyEntry(date);
    const data = (event.data ?? {}) as Record<string, unknown>;
    const updatedAt = event.updatedAt;
    if (updatedAt > entry.updatedAt) entry.updatedAt = updatedAt;

    if (event.type === 'mood') {
      const period = stringValue(data.period);
      if (period === 'morning' || period === 'afternoon' || period === 'evening') {
        entry.moods[period] = {
          score: typeof data.score === 'number' ? data.score : null,
          tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        };
      }
    } else if (event.type === 'sleep') {
      entry.sleepQuality = typeof data.quality === 'number' ? data.quality : null;
      entry.sleepStart = stringValue(data.sleepStart);
      entry.wakeTime = stringValue(data.wakeTime);
      entry.wakeUps = stringValue(data.wakeUps);
    } else if (event.type === 'routine' && data.routine === 'school') {
      entry.schoolStatus = stringValue(data.status);
      entry.schoolNote = stringValue(data.notes);
    } else if (event.type === 'health') {
      entry.healthStatus = stringValue(data.status) || 'Great';
      entry.healthNotes = stringValue(data.notes);
    } else if (event.type === 'meal') {
      const meal = stringValue(data.meal);
      if (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner' || meal === 'snacks') {
        entry.meals[meal] = stringValue(data.outcome) || stringValue(data.description);
      }
      if (typeof data.eatingOverall === 'string') {
        entry.eatingOverall = data.eatingOverall;
      }
    } else if (event.type === 'bathroom') {
      entry.bathroom = {
        bowelMovement: stringValue(data.bowelMovement),
        count: stringValue(data.count),
      };
    } else if (event.type === 'medication') {
      const medicationId = stringValue(data.medicationId);
      if (medicationId === 'melatonin' || medicationId === 'fluoxetine') {
        entry.medications[medicationId] = {
          status: stringValue(data.status),
          amount: stringValue(data.amount),
          time: stringValue(data.scheduledTime),
        };
      }
    } else if (event.type === 'trigger') {
      entry.possibleTriggers.push({
        id: stringValue(data.eventId) || event.id,
        time: stringValue(data.time),
        category: stringValue(data.category),
        categoryOther: stringValue(data.categoryOther),
        observedEffect: stringValue(data.observedEffect),
        notes: stringValue(data.notes),
      });
    } else if (event.type === 'meltdown') {
      entry.meltdowns.push({
        id: stringValue(data.eventId) || event.id,
        time: stringValue(data.time),
        duration: stringValue(data.duration),
        intensity: stringValue(data.intensity),
        trigger: stringValue(data.trigger),
        triggerOther: stringValue(data.triggerOther),
        earlySigns: stringValue(data.earlySigns),
        aggression: stringValue(data.aggression),
        whatHelped: stringValue(data.whatHelped),
        notes: stringValue(data.notes),
      });
    } else if (event.type === 'note') {
      entry.notes = stringValue(data.text);
    }
    entries.set(date, entry);
  }

  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type DesiredEvent = {
  id: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
};

export function desiredEvents(entry: DailyEntry): DesiredEvent[] {
  const desired: DesiredEvent[] = [];
  const moodTimes = { morning: '08:00', afternoon: '14:00', evening: '20:00' };
  for (const period of ['morning', 'afternoon', 'evening'] as const) {
    const mood = entry.moods[period];
    if (mood.score !== null || mood.tags.length > 0) {
      desired.push({
        id: `${entry.date}_mood_${period}`,
        type: 'mood',
        occurredAt: dateFor(entry.date, moodTimes[period]),
        data: { period, score: mood.score, tags: mood.tags },
      });
    }
  }

  if (entry.sleepQuality !== null || entry.sleepStart || entry.wakeTime || entry.wakeUps) {
    desired.push({
      id: `${entry.date}_sleep`,
      type: 'sleep',
      occurredAt: dateFor(entry.date, entry.wakeTime || '07:00'),
      data: {
        quality: entry.sleepQuality,
        sleepStart: entry.sleepStart,
        wakeTime: entry.wakeTime,
        wakeUps: entry.wakeUps,
      },
    });
  }

  if (entry.schoolStatus || entry.schoolNote) {
    desired.push({
      id: `${entry.date}_routine_school`,
      type: 'routine',
      occurredAt: dateFor(entry.date, '08:00'),
      data: { routine: 'school', status: entry.schoolStatus, notes: entry.schoolNote },
    });
  }

  if (entry.healthStatus || entry.healthNotes) {
    desired.push({
      id: `${entry.date}_health`,
      type: 'health',
      occurredAt: dateFor(entry.date, '09:00'),
      data: { status: entry.healthStatus || 'Great', notes: entry.healthNotes },
    });
  }

  const mealTimes = { breakfast: '08:00', lunch: '12:00', dinner: '18:00', snacks: '15:00' };
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snacks'] as const) {
    if (entry.meals[meal] || (meal === 'breakfast' && entry.eatingOverall)) {
      desired.push({
        id: `${entry.date}_meal_${meal}`,
        type: 'meal',
        occurredAt: dateFor(entry.date, mealTimes[meal]),
        data: {
          meal,
          outcome: entry.meals[meal],
          ...(meal === 'breakfast' ? { eatingOverall: entry.eatingOverall } : {}),
        },
      });
    }
  }

  if (entry.bathroom.bowelMovement || entry.bathroom.count) {
    desired.push({
      id: `${entry.date}_bathroom`,
      type: 'bathroom',
      occurredAt: dateFor(entry.date),
      data: entry.bathroom,
    });
  }

  for (const medicationId of ['melatonin', 'fluoxetine'] as const) {
    const medication = entry.medications[medicationId];
    if (medication.status || medication.amount || medication.time) {
      desired.push({
        id: `${entry.date}_medication_${medicationId}`,
        type: 'medication',
        occurredAt: dateFor(entry.date, medication.time),
        data: {
          medicationId,
          status: medication.status,
          amount: medication.amount,
          scheduledTime: medication.time,
        },
      });
    }
  }

  for (const possibleTrigger of entry.possibleTriggers) {
    desired.push({
      id: `${entry.date}_trigger_${possibleTrigger.id}`,
      type: 'trigger',
      occurredAt: dateFor(entry.date, possibleTrigger.time),
      data: { ...possibleTrigger, eventId: possibleTrigger.id },
    });
  }

  for (const meltdown of entry.meltdowns) {
    desired.push({
      id: `${entry.date}_meltdown_${meltdown.id}`,
      type: 'meltdown',
      occurredAt: dateFor(entry.date, meltdown.time),
      data: { ...meltdown, eventId: meltdown.id },
    });
  }

  if (entry.notes) {
    desired.push({
      id: `${entry.date}_note`,
      type: 'note',
      occurredAt: dateFor(entry.date, '21:00'),
      data: { text: entry.notes },
    });
  }

  return desired;
}


export function eventValues(entry: DailyEntry): EventValue[] {
  return desiredEvents(entry).map(event => ({ ...event, occurredAt: event.occurredAt.toISOString() }));
}

/** Keep existing document identities, including records created by earlier clients. */
export function logicalEventId(event: EventRecord): string {
  const prefix = `${event.localDate}_${event.type}`;
  if (event.type === 'mood') return `${prefix}_${stringValue(event.data.period)}`;
  if (event.type === 'meal') return `${prefix}_${stringValue(event.data.meal)}`;
  if (event.type === 'medication') return `${prefix}_${stringValue(event.data.medicationId)}`;
  if (event.type === 'routine') return `${prefix}_${stringValue(event.data.routine)}`;
  if (event.type === 'trigger' || event.type === 'meltdown') return `${prefix}_${stringValue(event.data.eventId) || event.id}`;
  return prefix;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a);
  const right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.hasOwn(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
