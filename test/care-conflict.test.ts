import { describe, expect, it } from 'vitest';
import { describeCareVersion } from '@/lib/maymay-conflict';
describe('readable conflict choices', () => {
  it('keeps No and zero distinct from removal without exposing database metadata', () => {
    expect(describeCareVersion({ title: 'Breakfast', value: false, patientId: 'private-id' })).toBe('Breakfast\nNo');
    expect(describeCareVersion({ title: 'Bowel movements', value: 0 })).toBe('Bowel movements\n0');
    expect(describeCareVersion(null)).toBe('Removed');
    expect(describeCareVersion({ title: 'Old', deletedAt: 'yesterday' })).toBe('Removed');
  });
  it('includes schedules and spontaneous context when choosing between edits', () => {
    expect(describeCareVersion({ title: 'Morning mood', description: 'How did they wake up?', days: [1, 3] })).toContain('Mon, Wed');
    expect(describeCareVersion({ title: 'Overwhelmed', note: 'Assembly', details: { whatHelped: 'Quiet room' } })).toContain('what Helped: Quiet room');
  });
});
