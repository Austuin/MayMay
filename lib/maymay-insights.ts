import type { DailyEntry } from './maymay-types';

export type CountedItem = { label: string; count: number };

function ranked(values: string[]): CountedItem[] {
  const counts = new Map<string, number>();
  for (const value of values.filter((item) => item && item !== 'Unknown')) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function dailyMoodAverage(entry: DailyEntry) {
  const scores = Object.values(entry.moods).map((period) => period.score).filter((score): score is number => Boolean(score));
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0;
}

export function riskFactors(entry: DailyEntry) {
  const factors: string[] = [];
  if (entry.sleepQuality && entry.sleepQuality <= 2) factors.push('Low-quality sleep');
  if (Number(entry.wakeUps) >= 2) factors.push('Multiple wake-ups');
  if (entry.healthStatus && entry.healthStatus !== 'Great') {
    factors.push(`Health: ${entry.healthStatus.toLowerCase()}`);
  }
  const mealLabels = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks' };
  for (const meal of ['breakfast', 'lunch', 'dinner', 'snacks'] as const) {
    const outcome = entry.meals[meal];
    if (outcome === 'Refused') factors.push(`${mealLabels[meal]} refused`);
    if (outcome === 'Very little') factors.push(`${mealLabels[meal]}: very little`);
  }
  if (
    ['Very little', 'Refused'].includes(entry.eatingOverall) &&
    !factors.some((factor) => factor.includes('refused') || factor.includes('very little'))
  ) {
    factors.push('Limited eating');
  }
  if (entry.schoolStatus && entry.schoolStatus !== 'Not scheduled') {
    factors.push(`School: ${entry.schoolStatus.toLowerCase()}`);
  }
  if (entry.bathroom.bowelMovement === 'No') factors.push('No bowel movement recorded');
  for (const medication of ['melatonin', 'fluoxetine'] as const) {
    if (entry.medications[medication].status === 'Not given') {
      factors.push(`${medication[0].toUpperCase() + medication.slice(1)} not given`);
    }
  }
  for (const event of entry.possibleTriggers) {
    const category = event.category === 'Other' ? event.categoryOther || 'Other' : event.category;
    if (category) factors.push(`Possible trigger: ${category}`);
  }
  const allTags = Object.values(entry.moods).flatMap((period) => period.tags);
  for (const tag of ['Tired', 'Anxious', 'Irritable']) {
    if (allTags.includes(tag)) factors.push(tag);
  }
  return [...new Set(factors)];
}

export function meltdownEstimate(entries: DailyEntry[], current: DailyEntry) {
  const history = entries.filter((entry) => entry.date !== current.date);
  const total = history.length;
  const meltdownDays = history.filter((entry) => entry.meltdowns.length > 0).length;
  const baseline = (meltdownDays + 1.2) / (total + 8);
  const factors = riskFactors(current);
  let logOdds = Math.log(baseline / (1 - baseline));
  const learned: { label: string; days: number; rate: number }[] = [];

  for (const factor of factors) {
    const withFactor = history.filter((entry) => riskFactors(entry).includes(factor));
    if (withFactor.length < 3) continue;
    const withMeltdown = withFactor.filter((entry) => entry.meltdowns.length > 0).length;
    const rate = (withMeltdown + 1) / (withFactor.length + 2);
    const ratio = Math.min(3, Math.max(0.34, rate / Math.max(0.05, baseline)));
    const weight = Math.min(0.65, withFactor.length / 12);
    logOdds += Math.log(ratio) * weight;
    learned.push({ label: factor, days: withFactor.length, rate });
  }

  const raw = 1 / (1 + Math.exp(-logOdds));
  return {
    percent: Math.round(Math.min(0.9, Math.max(0.03, raw)) * 100),
    baselinePercent: Math.round(baseline * 100),
    confidence: total < 7 ? 'Starting' : total < 21 ? 'Developing' : 'Established',
    historyDays: total,
    ready: total >= 5,
    daysUntilEstimate: Math.max(0, 5 - total),
    factors,
    learned,
  };
}

export function summarizeEntries(entries: DailyEntry[]) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const withMood = sorted.filter((entry) => dailyMoodAverage(entry));
  const averageMood = withMood.length
    ? withMood.reduce((sum, entry) => sum + dailyMoodAverage(entry), 0) / withMood.length
    : 0;
  const meltdownDays = sorted.filter((entry) => entry.meltdowns.length > 0).length;
  const allMeltdowns = sorted.flatMap((entry) => entry.meltdowns);
  const triggers = ranked(
    allMeltdowns.map((event) =>
      event.trigger === 'Other' ? event.triggerOther || 'Other' : event.trigger,
    ),
  );
  const helpful = ranked(allMeltdowns.map((event) => event.whatHelped));
  const trend = sorted.slice(-14).map((entry) => ({
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
      new Date(`${entry.date}T12:00:00`),
    ),
    mood: dailyMoodAverage(entry) || null,
    meltdowns: entry.meltdowns.length,
  }));
  const periodAverages = (['morning', 'afternoon', 'evening'] as const).map((period) => {
    const scores = sorted.map((entry) => entry.moods[period].score).filter((score): score is number => Boolean(score));
    const difficult = scores.filter((score) => score <= 2).length;
    return {
      period,
      label: period[0].toUpperCase() + period.slice(1),
      average: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0,
      difficultPercent: scores.length ? Math.round((difficult / scores.length) * 100) : 0,
      days: scores.length,
    };
  });

  return {
    totalDays: sorted.length,
    averageMood,
    meltdownDays,
    meltdownDayPercent: sorted.length ? Math.round((meltdownDays / sorted.length) * 100) : 0,
    totalMeltdowns: allMeltdowns.length,
    triggers,
    helpful,
    trend,
    periodAverages,
  };
}
