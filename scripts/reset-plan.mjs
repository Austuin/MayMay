import { createHash, randomUUID } from 'node:crypto';

// These are the only roots the activation tool can delete. Firestore descendants
// are included because collections may exist beneath missing parent documents.
export const RESET_COLLECTIONS = Object.freeze(['users', 'families', 'joinSettings']);
export const RESET_DOCUMENTS = Object.freeze(['system/data', 'system/schema', 'system/invitationLimits']);
export const PRESERVED = Object.freeze([
  'Firebase Authentication accounts', 'admins/{uid}', 'host configuration and Admin credentials', 'update configuration',
]);

async function collectDocument(ref, found) {
  if ((await ref.get()).exists) found.add(ref.path);
  for (const collection of await ref.listCollections()) await collectCollection(collection, found);
}

async function collectCollection(ref, found) {
  for (const document of await ref.listDocuments()) await collectDocument(document, found);
}

export async function inventoryResetScope(db) {
  const affected = new Set();
  for (const path of RESET_COLLECTIONS) await collectCollection(db.collection(path), affected);
  for (const path of RESET_DOCUMENTS) await collectDocument(db.doc(path), affected);
  const rootCollections = (await db.listCollections()).map(item => item.id).sort();
  return { affectedDocuments: [...affected].sort(),
    otherRootCollections: rootCollections.filter(path => !RESET_COLLECTIONS.includes(path) && path !== 'system'),
    collectionRoots: [...RESET_COLLECTIONS], documentRoots: [...RESET_DOCUMENTS] };
}

export function resetPlanHash(projectId, inventory) {
  return createHash('sha256').update(JSON.stringify({ projectId,
    collections: RESET_COLLECTIONS, documents: RESET_DOCUMENTS, affected: inventory.affectedDocuments })).digest('hex');
}

export function validateBackupUri(value) {
  if (!/^gs:\/\/[a-z0-9][a-z0-9._-]+\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value ?? '') || value.includes('..')) {
    throw new Error('Pass an agreed backup destination such as gs://bucket/MayMay/export-2026-10-03.');
  }
  return value;
}

/** Deployment principals can inspect the release without reading executable bytecode. */
export async function waitForRulesRelease({ readRelease, rulesetName, sleep }) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await readRelease()).rulesetName === rulesetName) {
      await sleep(60_000);
      return;
    }
    await sleep(2000);
  }
  throw new Error('The rules release has not become active. The reset stopped before the next phase.');
}

/**
 * @param {{ projectId: string, db: any, execute?: boolean, confirmPlan?: string,
 *   confirmProject?: string, backupUri?: string, backupFile?: string,
 *   operations?: { backup?: (uri: string) => Promise<void>, maintenanceRules?: () => Promise<void>, finalRules?: () => Promise<void> },
 *   report?: (plan: any) => void }} options
 */
export async function runControlledReset({ projectId, db, execute = false, confirmPlan, confirmProject, backupUri, backupFile,
  operations = {}, report = (_plan) => undefined }) {
  if (!/^[a-z][a-z0-9-]{5,29}$/.test(projectId)) throw new Error('Pass an explicit Firebase project ID.');
  const inventory = await inventoryResetScope(db);
  const planHash = resetPlanHash(projectId, inventory);
  report({ projectId, planHash, ...inventory, preserved: [...PRESERVED], execute });
  if (!execute) return { planHash, inventory, executed: false };
  if (confirmProject !== projectId || confirmPlan !== planHash) {
    throw new Error('The project or inventory differs from the reviewed dry run. Stop and review a fresh plan.');
  }
  if (Boolean(backupUri) === Boolean(backupFile)) throw new Error('Choose exactly one backup destination.');
  if (backupUri) validateBackupUri(backupUri);
  if (!operations.backup || !operations.maintenanceRules || !operations.finalRules) throw new Error('Reset operations are incomplete.');

  // Freeze client writes before the backup so edits to existing documents cannot
  // fall into a gap between backup and deletion. Admin writers must be stopped.
  await operations.maintenanceRules();
  await operations.backup(backupFile || backupUri);
  const afterBackup = await inventoryResetScope(db);
  if (resetPlanHash(projectId, afterBackup) !== planHash) {
    throw new Error('The approved document inventory changed during backup. Review a fresh dry run before resetting.');
  }
  await db.recursiveDelete(db.doc('system/data'));
  for (const path of RESET_COLLECTIONS) await db.recursiveDelete(db.collection(path));
  for (const path of RESET_DOCUMENTS.filter(path => path !== 'system/data')) await db.recursiveDelete(db.doc(path));
  await operations.finalRules();
  const generation = randomUUID();
  await db.doc('system/data').set({ schemaVersion: 1, generation });
  return { planHash, inventory, executed: true, generation };
}
