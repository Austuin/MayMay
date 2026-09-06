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

export function createPossibleTrigger(): PossibleTriggerEvent {
  return {
    id: crypto.randomUUID(),
    time: '',
    category: '',
    categoryOther: '',
    observedEffect: '',
    notes: '',
  };
}

export function createMeltdown(): MeltdownEvent {
  return {
    id: crypto.randomUUID(),
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
