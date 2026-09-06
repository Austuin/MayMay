import type { DailyEntry, FirebaseWebConfig, SavedFirebaseSetup } from './maymay-types';
import { createMeltdown, emptyEntry, historyCutoffDate } from './maymay-types';

const ENTRY_KEY = 'maymay.entries.v3';
const PREVIOUS_KEY = 'maymay.entries.v2';
const LEGACY_KEY = 'trackerV11';
const FIREBASE_KEY = 'maymay.firebase.setup.v1';

function isDailyEntry(value: unknown): value is DailyEntry {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'version' in value &&
      value.version === 3 &&
      'date' in value &&
      typeof value.date === 'string',
  );
}

function normalizeDailyEntry(entry: DailyEntry): DailyEntry {
  const possibleTriggers = (entry as DailyEntry & { possibleTriggers?: unknown }).possibleTriggers;
  return {
    ...entry,
    healthStatus: typeof (entry as DailyEntry & { healthStatus?: unknown }).healthStatus === 'string'
      ? (entry as DailyEntry & { healthStatus: string }).healthStatus || 'Great'
      : 'Great',
    healthNotes: typeof (entry as DailyEntry & { healthNotes?: unknown }).healthNotes === 'string'
      ? (entry as DailyEntry & { healthNotes: string }).healthNotes
      : '',
    possibleTriggers: Array.isArray(possibleTriggers) ? possibleTriggers : [],
  };
}

function withinHistoryWindow(entry: DailyEntry) {
  return entry.date >= historyCutoffDate();
}

function migrateLegacy(value: unknown): DailyEntry[] {
  if (!Array.isArray(value)) return [];
  const moodScores: Record<string, number> = {
    'Very happy': 5,
    Happy: 4,
    Calm: 4,
    Neutral: 3,
    Anxious: 2,
    Irritable: 2,
    Sad: 2,
    Frustrated: 1,
    Tired: 2,
    Excited: 4,
  };

  return value.flatMap((legacy) => {
    if (!legacy || typeof legacy !== 'object' || typeof legacy.date !== 'string') return [];
    const entry = emptyEntry(legacy.date);
    const moods: string[] = Array.isArray(legacy.mood) ? legacy.mood.filter((m: unknown): m is string => typeof m === 'string') : [];
    const scores: number[] = moods.map((m: string) => moodScores[m]).filter(Boolean);
    const legacyScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    entry.moods = {
      morning: { score: legacyScore, tags: moods },
      afternoon: { score: null, tags: [] },
      evening: { score: null, tags: [] },
    };
    entry.schoolStatus = typeof legacy.school === 'string' ? legacy.school : '';
    entry.schoolNote = typeof legacy.schoolReason === 'string' ? legacy.schoolReason : '';
    entry.sleepQuality = legacy.sleep ? Number(legacy.sleep) || null : null;
    entry.sleepStart = typeof legacy.fell === 'string' ? legacy.fell : '';
    entry.wakeTime = typeof legacy.wake === 'string' ? legacy.wake : '';
    entry.wakeUps = typeof legacy.wakeups === 'string' ? legacy.wakeups : '';
    entry.eatingOverall = typeof legacy.eat === 'string' ? legacy.eat : '';
    entry.meals = {
      breakfast: typeof legacy.breakfast === 'string' ? legacy.breakfast : '',
      lunch: typeof legacy.lunch === 'string' ? legacy.lunch : '',
      dinner: typeof legacy.dinner === 'string' ? legacy.dinner : '',
      snacks: typeof legacy.snacks === 'string' ? legacy.snacks : '',
    };
    entry.bathroom = {
      bowelMovement: typeof legacy.poop === 'string' ? legacy.poop : '',
      count: typeof legacy.poopCount === 'string' ? legacy.poopCount : '',
    };
    entry.medications = {
      melatonin: {
        status: typeof legacy.mel === 'string' ? legacy.mel : '',
        amount: typeof legacy.melAmt === 'string' ? legacy.melAmt : '',
        time: typeof legacy.melTime === 'string' ? legacy.melTime : '',
      },
      fluoxetine: {
        status: typeof legacy.flu === 'string' ? legacy.flu : '',
        amount: typeof legacy.fluAmt === 'string' ? legacy.fluAmt : '',
        time: '',
      },
    };
    const details = Array.isArray(legacy.md) ? legacy.md : [];
    const desiredCount = Math.max(details.length, Number.parseInt(legacy.mc, 10) || 0);
    entry.meltdowns = Array.from({ length: desiredCount }, (_, index) => {
      const item = details[index] ?? {};
      return {
        ...createMeltdown(),
        duration: typeof item.dur === 'string' ? item.dur : '',
        trigger: typeof item.tr === 'string' ? item.tr : '',
        aggression: typeof item.violent === 'string' ? item.violent : '',
        whatHelped: typeof item.hp === 'string' ? item.hp : '',
        notes: [item.agg, item.mn].filter((part) => typeof part === 'string' && part).join(' — '),
      };
    });
    entry.notes = typeof legacy.notes === 'string' ? legacy.notes : '';
    entry.updatedAt = new Date().toISOString();
    return [entry];
  });
}

function migratePrevious(value: unknown): DailyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((previous) => {
    if (!previous || typeof previous !== 'object' || typeof previous.date !== 'string') return [];
    const entry = emptyEntry(previous.date);
    const score = typeof previous.moodScore === 'number' ? previous.moodScore : null;
    const tags: string[] = Array.isArray(previous.moodTags) ? previous.moodTags.filter((tag: unknown): tag is string => typeof tag === 'string') : [];
    return [{
      ...entry,
      ...previous,
      version: 3 as const,
      moods: {
        morning: { score, tags },
        afternoon: { score: null, tags: [] },
        evening: { score: null, tags: [] },
      },
    }];
  });
}

export function loadLocalEntries(): DailyEntry[] {
  try {
    const current = JSON.parse(localStorage.getItem(ENTRY_KEY) ?? '[]');
    if (Array.isArray(current) && current.some(isDailyEntry)) {
      const valid = current.filter(isDailyEntry).map(normalizeDailyEntry);
      const retained = valid.filter(withinHistoryWindow);
      if (retained.length !== valid.length) saveLocalEntries(retained);
      return retained;
    }

    const previous = migratePrevious(JSON.parse(localStorage.getItem(PREVIOUS_KEY) ?? '[]'));
    const migrated = previous.length
      ? previous
      : migrateLegacy(JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]'));
    const retained = migrated.filter(withinHistoryWindow);
    if (migrated.length) saveLocalEntries(retained);
    return retained;
  } catch {
    return [];
  }
}

export function saveLocalEntries(entries: DailyEntry[]) {
  localStorage.setItem(
    ENTRY_KEY,
    JSON.stringify(
      entries
        .filter(withinHistoryWindow)
        .sort((a, b) => a.date.localeCompare(b.date)),
    ),
  );
}

export function loadFirebaseSetup(): SavedFirebaseSetup | null {
  try {
    const value = JSON.parse(localStorage.getItem(FIREBASE_KEY) ?? 'null');
    if (!value?.config?.apiKey || !value?.config?.projectId || !value?.caregiverEmail) return null;
    return value as SavedFirebaseSetup;
  } catch {
    return null;
  }
}

export function saveFirebaseSetup(setup: SavedFirebaseSetup) {
  localStorage.setItem(FIREBASE_KEY, JSON.stringify(setup));
}

export function clearFirebaseSetup() {
  localStorage.removeItem(FIREBASE_KEY);
}

export function parseFirebaseConfig(input: string): FirebaseWebConfig {
  const withoutWrapper = input
    .trim()
    .replace(/^const\s+firebaseConfig\s*=\s*/, '')
    .replace(/;\s*$/, '')
    .replace(/([{,]\s*)([A-Za-z][A-Za-z0-9]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'/g, '"');
  const value = JSON.parse(withoutWrapper) as Partial<FirebaseWebConfig>;
  if (!value.apiKey || !value.authDomain || !value.projectId || !value.appId) {
    throw new Error('Firebase config must include apiKey, authDomain, projectId, and appId.');
  }
  return value as FirebaseWebConfig;
}

export function mergeEntries(local: DailyEntry[], remote: DailyEntry[]) {
  const byDate = new Map<string, DailyEntry>();
  for (const entry of [...local, ...remote]) {
    if (!isDailyEntry(entry) || !withinHistoryWindow(entry)) continue;
    const normalized = normalizeDailyEntry(entry);
    const existing = byDate.get(normalized.date);
    if (!existing || normalized.updatedAt > existing.updatedAt) byDate.set(normalized.date, normalized);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
