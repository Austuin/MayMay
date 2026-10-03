import { describe, expect, it, vi } from 'vitest';
import { inventoryResetScope, resetPlanHash, runControlledReset, validateBackupUri } from '../scripts/reset-plan.mjs';

function fakeFirestore() {
  const documents = new Set([
    'users/alice', 'users/alice/days/old', 'families/family-a', 'families/family-a/patients/sam',
    'families/family-a/patients/sam/observations/one', 'joinSettings/current',
    'system/data', 'system/schema', 'system/invitationLimits/users/alice',
    'admins/admin-a', 'unrelated/keep',
  ]);
  const actions: string[] = [];
  const collection = (path: string) => ({ path, id: path.split('/').at(-1),
    listDocuments: async () => [...new Set([...documents].filter(item => item.startsWith(`${path}/`))
      .map(item => `${path}/${item.slice(path.length + 1).split('/')[0]}`))].map(doc),
  });
  const doc = (path: string) => ({ path, get: async () => ({ exists: documents.has(path) }),
    listCollections: async () => [...new Set([...documents].filter(item => item.startsWith(`${path}/`))
      .map(item => `${path}/${item.slice(path.length + 1).split('/')[0]}`))].map(collection),
    set: async (value: unknown) => { actions.push(`set:${path}`); documents.add(path); return value; },
  });
  const db = { collection, doc, listCollections: async () => [...new Set([...documents].map(item => item.split('/')[0]))].map(collection),
    recursiveDelete: async (ref: { path: string }) => { actions.push(`delete:${ref.path}`);
      for (const path of [...documents]) if (path === ref.path || path.startsWith(`${ref.path}/`)) documents.delete(path); },
  };
  return { db, documents, actions };
}

describe('controlled reset plan', () => {
  const projectId = 'demo-maymay-test';

  it('inventories exact approved paths, including descendants under a missing parent, without mutating data', async () => {
    const { db, actions } = fakeFirestore();
    const backup = vi.fn();
    const reports: unknown[] = [];
    const result = await runControlledReset({ projectId, db, operations: { backup }, report: (value: unknown) => { reports.push(value); } });
    expect(result.executed).toBe(false);
    expect(result.inventory.affectedDocuments).toContain('system/invitationLimits/users/alice');
    expect(result.inventory.affectedDocuments).toContain('families/family-a/patients/sam/observations/one');
    expect(result.inventory.affectedDocuments).not.toContain('admins/admin-a');
    expect(result.inventory.otherRootCollections).toContain('admins');
    expect(reports).toHaveLength(1);
    expect(actions).toEqual([]);
    expect(backup).not.toHaveBeenCalled();
  });

  it('requires the reviewed inventory hash, exact project, and a scoped backup destination', async () => {
    const { db, documents } = fakeFirestore();
    const inventory = await inventoryResetScope(db);
    const planHash = resetPlanHash(projectId, inventory);
    expect(() => validateBackupUri('gs://bucket')).toThrow(/agreed backup/);
    await expect(runControlledReset({ projectId, db, execute: true, confirmProject: projectId,
      confirmPlan: 'stale', backupUri: 'gs://bucket/MayMay/export', operations: {} })).rejects.toThrow(/reviewed dry run/);
    documents.add('users/new-after-review');
    await expect(runControlledReset({ projectId, db, execute: true, confirmProject: projectId,
      confirmPlan: planHash, backupUri: 'gs://bucket/MayMay/export', operations: {} })).rejects.toThrow(/reviewed dry run/);
  });

  it('completes backup before maintenance and activation, preserving Admin records', async () => {
    const { db, documents, actions } = fakeFirestore();
    const inventory = await inventoryResetScope(db);
    const planHash = resetPlanHash(projectId, inventory);
    const result = await runControlledReset({ projectId, db, execute: true, confirmProject: projectId,
      confirmPlan: planHash, backupUri: 'gs://backup-bucket/MayMay/export-2026-10-03',
      operations: {
        backup: async () => { actions.push('backup'); },
        maintenanceRules: async () => { actions.push('maintenance'); },
        finalRules: async () => { actions.push('final-rules'); },
      } });
    expect(actions.slice(0, 3)).toEqual(['backup', 'maintenance', 'delete:system/data']);
    expect(actions.at(-2)).toBe('final-rules');
    expect(actions.at(-1)).toBe('set:system/data');
    expect(documents.has('admins/admin-a')).toBe(true);
    expect(documents.has('unrelated/keep')).toBe(true);
    expect(documents.has('users/alice')).toBe(false);
    expect(documents.has('system/invitationLimits/users/alice')).toBe(false);
    expect(result.generation).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not invalidate activation when backup or maintenance rules fail', async () => {
    for (const failure of ['backup', 'maintenance'] as const) {
      const { db, documents, actions } = fakeFirestore();
      const planHash = resetPlanHash(projectId, await inventoryResetScope(db));
      await expect(runControlledReset({ projectId, db, execute: true, confirmProject: projectId,
        confirmPlan: planHash, backupUri: 'gs://backup-bucket/MayMay/export', operations: {
          backup: async () => { actions.push('backup'); if (failure === 'backup') throw new Error('Backup failed'); },
          maintenanceRules: async () => { actions.push('maintenance'); if (failure === 'maintenance') throw new Error('Rules failed'); },
          finalRules: async () => { actions.push('final-rules'); },
        } })).rejects.toThrow();
      expect(documents.has('system/data')).toBe(true);
      expect(documents.has('users/alice')).toBe(true);
      expect(actions.some(item => item.startsWith('delete:'))).toBe(false);
    }
  });

  it('stops before maintenance if the approved paths change during backup', async () => {
    const { db, documents, actions } = fakeFirestore();
    const planHash = resetPlanHash(projectId, await inventoryResetScope(db));
    await expect(runControlledReset({ projectId, db, execute: true, confirmProject: projectId,
      confirmPlan: planHash, backupUri: 'gs://backup-bucket/MayMay/export', operations: {
        backup: async () => { documents.add('users/new-during-backup'); actions.push('backup'); },
        maintenanceRules: async () => { actions.push('maintenance'); },
        finalRules: async () => { actions.push('final-rules'); },
      } })).rejects.toThrow(/changed during backup/);
    expect(actions).toEqual(['backup']);
    expect(documents.has('system/data')).toBe(true);
  });
});
