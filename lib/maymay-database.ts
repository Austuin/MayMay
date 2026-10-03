import { doc, getDocFromServer, type Firestore } from 'firebase/firestore';
import { DATA_SCHEMA_VERSION, collections, type DataConfiguration } from './maymay-schema';

export const familyRef = (db: Firestore, familyId: string) => doc(db, collections.families, familyId);
export const patientRef = (db: Firestore, familyId: string, patientId: string) => doc(familyRef(db, familyId), collections.patients, patientId);
export const relationshipRef = (db: Firestore, familyId: string, patientId: string, userId: string) => doc(patientRef(db, familyId, patientId), collections.relationships, userId);

export class ActivationPendingError extends Error {
  constructor() {
    super('MayMay data setup is pending or maintenance is active. Ask the host owner to finish activation.');
    this.name = 'ActivationPendingError';
  }
}

export async function readDataConfiguration(db: Firestore): Promise<DataConfiguration> {
  const snapshot = await getDocFromServer(doc(db, 'system', 'data')).catch(error => {
    if ((error as { code?: string }).code === 'permission-denied') throw new ActivationPendingError();
    throw error;
  });
  const value = snapshot.data();
  if (!snapshot.exists() || value?.schemaVersion !== DATA_SCHEMA_VERSION || typeof value?.generation !== 'string' || !value.generation) {
    throw new ActivationPendingError();
  }
  return { schemaVersion: DATA_SCHEMA_VERSION, generation: value.generation };
}

export async function assertDataGeneration(db: Firestore, expected: string) {
  const current = await readDataConfiguration(db);
  if (current.generation !== expected) throw new Error('MayMay data has been reset. Sign out and sign in again before continuing.');
}
