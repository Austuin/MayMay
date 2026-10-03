import { describe, expect, it } from 'vitest';
import { spontaneousRepeatKey, trackerValues, type TrackerDefinition } from '../lib/maymay-schema';

const draft: TrackerDefinition = { title: ' Morning Mood ', description: ' How was the morning? ', kind: 'mood', days: [5, 1, 5] };

describe('event crafter values', () => {
  it('trims text and stores unique weekdays in Sunday-first order', () => {
    expect(trackerValues(draft)).toEqual({ title: 'Morning Mood', description: 'How was the morning?', kind: 'mood', days: [1, 5] });
  });
  it('requires meaningful title, description, type and schedule within limits', () => {
    expect(() => trackerValues({ ...draft, title: '  ' })).toThrow(/title/);
    expect(() => trackerValues({ ...draft, title: 'x'.repeat(101) })).toThrow(/title/);
    expect(() => trackerValues({ ...draft, description: 'x'.repeat(241) })).toThrow(/description/);
    expect(() => trackerValues({ ...draft, days: [] })).toThrow(/weekday/);
    expect(() => trackerValues({ ...draft, days: [7] })).toThrow(/weekday/);
    expect(() => trackerValues({ ...draft, kind: 'other' as TrackerDefinition['kind'] })).toThrow(/type/);
  });
  it('matches repeated event titles within the same category after normalization', () => {
    expect(spontaneousRepeatKey('good', ' Calm   Bedtime ')).toBe(spontaneousRepeatKey('good', 'calm bedtime'));
    expect(spontaneousRepeatKey('good', 'calm bedtime')).not.toBe(spontaneousRepeatKey('difficult', 'calm bedtime'));
  });
});
