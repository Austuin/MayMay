export type MeltdownEvent = {
  id: string;
  time: string;
  duration: string;
  intensity: string;
  trigger: string;
  triggerOther: string;
  earlySigns: string;
  aggression: string;
  whatHelped: string;
  notes: string;
};

export type PossibleTriggerEvent = {
  id: string;
  time: string;
  category: string;
  categoryOther: string;
  observedEffect: string;
  notes: string;
};

export type MoodPeriod = {
  score: number | null;
  tags: string[];
};

export type DailyEntry = {
  version: 3;
  date: string;
  updatedAt: string;
  moods: {
    morning: MoodPeriod;
    afternoon: MoodPeriod;
    evening: MoodPeriod;
  };
  schoolStatus: string;
  schoolNote: string;
  healthStatus: string;
  healthNotes: string;
  sleepQuality: number | null;
  sleepStart: string;
  wakeTime: string;
  wakeUps: string;
  eatingOverall: string;
  meals: {
    breakfast: string;
    lunch: string;
    dinner: string;
    snacks: string;
  };
  bathroom: {
    bowelMovement: string;
    count: string;
  };
  medications: {
    melatonin: { status: string; amount: string; time: string };
    fluoxetine: { status: string; amount: string; time: string };
  };
  possibleTriggers: PossibleTriggerEvent[];
  meltdowns: MeltdownEvent[];
  notes: string;
};

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

export type SavedFirebaseSetup = {
  config: FirebaseWebConfig;
  caregiverEmail: string;
};

export const HISTORY_YEARS = 3;

export function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function historyCutoffDate(referenceDate = new Date()) {
  const cutoff = new Date(referenceDate);
  const targetYear = cutoff.getFullYear() - HISTORY_YEARS;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    cutoff.getMonth() + 1,
    0,
  ).getDate();
  cutoff.setFullYear(
    targetYear,
    cutoff.getMonth(),
    Math.min(cutoff.getDate(), lastDayOfTargetMonth),
  );
  return localDateValue(cutoff);
}

export function emptyEntry(date: string): DailyEntry {
  return {
    version: 3,
    date,
    updatedAt: new Date(0).toISOString(),
    moods: {
      morning: { score: null, tags: [] },
      afternoon: { score: null, tags: [] },
      evening: { score: null, tags: [] },
    },
    schoolStatus: '',
    schoolNote: '',
    healthStatus: 'Great',
    healthNotes: '',
    sleepQuality: null,
    sleepStart: '',
    wakeTime: '',
    wakeUps: '',
    eatingOverall: '',
    meals: { breakfast: '', lunch: '', dinner: '', snacks: '' },
    bathroom: { bowelMovement: '', count: '' },
    medications: {
      melatonin: { status: '', amount: '', time: '' },
      fluoxetine: { status: '', amount: '', time: '' },
    },
    possibleTriggers: [],
    meltdowns: [],
    notes: '',
  };
}

export function createEventId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // randomUUID is unavailable on some plain-HTTP LAN origins.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createPossibleTrigger(): PossibleTriggerEvent {
  return {
    id: createEventId(),
    time: '',
    category: '',
    categoryOther: '',
    observedEffect: '',
    notes: '',
  };
}

export function createMeltdown(): MeltdownEvent {
  return {
    id: createEventId(),
    time: '',
    duration: '',
    intensity: '',
    trigger: '',
    triggerOther: '',
    earlySigns: '',
    aggression: '',
    whatHelped: '',
    notes: '',
  };
}
