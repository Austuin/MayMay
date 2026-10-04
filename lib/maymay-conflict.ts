/** Show the caregiver's choices without internal IDs or database metadata. */
export function describeCareVersion(value: unknown): string {
  if (!value || typeof value !== 'object') return 'Removed';
  const record = value as Record<string, unknown>;
  if (record.deletedAt) return 'Removed';
  const lines = [String(record.title || 'Entry')];
  const kinds: Record<string, string> = { mood: 'Mood check', good: 'Good event', difficult: 'Difficult event', meltdown: 'Meltdown', other: 'Other event', checkin: 'Check-in', count: 'Counter', good_count: 'Good counter', difficult_count: 'Difficult counter' };
  if (typeof record.kind === 'string' && kinds[record.kind]) lines.push(kinds[record.kind]);
  if (typeof record.description === 'string') lines.push(record.description);
  if (Array.isArray(record.days)) lines.push(record.days.map(day => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(day)]).join(', '));
  if (record.value !== undefined && record.value !== null) lines.push(typeof record.value === 'boolean' ? record.value ? 'Yes' : 'No' : String(record.value));
  if (typeof record.localDate === 'string') lines.push(record.localDate);
  if (record.kind !== 'answer' && typeof record.occurredAt === 'string') {
    const occurred = new Date(record.occurredAt);
    if (Number.isFinite(occurred.getTime())) lines.push(occurred.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
  }
  if (typeof record.note === 'string' && record.note) lines.push(record.note);
  if (record.details && typeof record.details === 'object') {
    for (const [key, detail] of Object.entries(record.details)) if (detail !== '' && detail !== null) {
      lines.push(`${key.replace(/([A-Z])/g, ' $1')}: ${String(detail)}`);
    }
  }
  return lines.join('\n');
}
