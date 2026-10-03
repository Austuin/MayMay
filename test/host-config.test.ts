import { describe, expect, it } from 'vitest';
import { activationState, existingWebApp, verifyWebConfigProject } from '../scripts/host-config.mjs';

describe('nondestructive host setup', () => {
  it('uses an existing Firebase Web app and stops when none is configured', () => {
    expect(existingWebApp([{ name: 'projects/demo/apps/other', displayName: 'Other' },
      { name: 'projects/demo/apps/maymay', displayName: 'MayMay' }]).name).toBe('projects/demo/apps/maymay');
    expect(() => existingWebApp([{ name: 'deleted', state: 'DELETED' }])).toThrow(/No Firebase Web app/);
  });

  it('reports missing or invalid activation as setup or maintenance', () => {
    expect(activationState({ exists: false, data: () => undefined })).toBe('setup/maintenance');
    expect(activationState({ exists: true, data: () => ({ schemaVersion: 1, generation: 'release-a' }) })).toBe('active');
    expect(activationState({ exists: true, data: () => ({ schemaVersion: 0, generation: 'old' }) })).toBe('setup/maintenance');
  });

  it('stops when the selected Web app points at another Firebase project', () => {
    expect(verifyWebConfigProject({ projectId: 'demo' }, 'demo')).toEqual({ projectId: 'demo' });
    expect(() => verifyWebConfigProject({ projectId: 'other' }, 'demo')).toThrow(/different project/);
  });
});
