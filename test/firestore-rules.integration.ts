import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { commitEventMutations, recordFromDocument } from '../lib/maymay-sync-firebase';
import { mutationsForEdit, SaveConflict, type EventMutation } from '../lib/maymay-sync-model';
import { emptyEntry } from '../lib/maymay-types';
import type { EventRecord } from '../lib/maymay-events';

let env: RulesTestEnvironment;
const day = '2026-09-30';
const eventPath = (id: string) => `families/maymay/children/maymay/events/${id}`;
function connection(uid = 'alice', familyId = 'maymay', role = 'caregiver') {
  return { db: env.authenticatedContext(uid).firestore(), user: { uid }, profile: { familyId, role, active: true }, childId: 'maymay' } as unknown as FirebaseConnection;
}
async function read(id: string, uid = 'alice'): Promise<EventRecord | null> {
  const snapshot = await getDoc(doc(connection(uid).db, eventPath(id)));
  return snapshot.exists() ? recordFromDocument(id, snapshot.data()) : null;
}
function editNote(text: string, baseline: EventRecord | null = null): EventMutation {
  return { id: crypto.randomUUID(), eventId: `${day}_note`, localDate: day,
    expected: baseline ? { revision: baseline.revision, updatedAt: baseline.updatedAt } : null,
    predecessor: null, queuedAt: Date.now(),
    after: { id: `${day}_note`, type: 'note', occurredAt: `${day}T12:00:00Z`, data: { text } } };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Tests require the isolated local emulator.');
  env = await initializeTestEnvironment({ projectId: 'demo-maymay-test', firestore: { rules: await readFile('firebase.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, familyId, role, active] of [
      ['alice', 'maymay', 'caregiver', true], ['bob', 'maymay', 'caregiver', true],
      ['viewer', 'maymay', 'viewer', true], ['outsider', 'other-family', 'caregiver', true],
      ['pending', 'maymay', 'pending', false],
    ] as const) await setDoc(doc(context.firestore(), 'users', uid), { familyId, role, active });
  });
});
afterAll(async () => { if (env) { await env.clearFirestore(); await env.cleanup(); } });

describe('concurrent caregiver saves with real Firestore rules', () => {
  it('preserves independent mood and meal changes made from the same empty day', async () => {
    const before = emptyEntry(day);
    const breakfast = structuredClone(before); breakfast.meals.breakfast = 'Ate well';
    const mood = structuredClone(before); mood.moods.morning.score = 4;
    const a = mutationsForEdit(before, breakfast, [], []);
    const b = mutationsForEdit(before, mood, [], []);
    expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    await Promise.all([commitEventMutations(connection('alice'), a), commitEventMutations(connection('bob'), b)]);
    expect((await read(a[0].eventId))?.data.outcome).toBe('Ate well');
    expect((await read(b[0].eventId))?.data.score).toBe(4);
    expect(await read(`${day}_health`)).toBeNull();
  });

  it('allows only one of two conflicting creates and retains the winner', async () => {
    const results = await Promise.allSettled([
      commitEventMutations(connection('alice'), [editNote('Alice')]),
      commitEventMutations(connection('bob'), [editNote('Bob')]),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(SaveConflict);
    expect(['Alice', 'Bob']).toContain((await read(`${day}_note`))?.data.text);
  });

  it('removes only the explicitly selected event while preserving an event absent from a stale device', async () => {
    const note = editNote('Remove this note');
    await commitEventMutations(connection(), [note]);
    const stale = await read(note.eventId);
    const before = emptyEntry(day);
    const after = structuredClone(before); after.meals.lunch = 'Ate well';
    const lunch = mutationsForEdit(before, after, [], []);
    await commitEventMutations(connection('bob'), lunch);
    await commitEventMutations(connection(), [{ ...editNote('', stale), after: null }]);
    expect((await read(note.eventId))?.deletedAt).toBeTruthy();
    expect((await read(lunch[0].eventId))?.data.outcome).toBe('Ate well');
  });

  it('rejects a stale edit and a stale deletion of an existing record', async () => {
    await commitEventMutations(connection(), [editNote('Initial')]);
    const old = await read(`${day}_note`);
    await commitEventMutations(connection('bob'), [editNote('Newer shared note', old)]);
    await expect(commitEventMutations(connection(), [editNote('Stale', old)])).rejects.toBeInstanceOf(SaveConflict);
    await expect(commitEventMutations(connection(), [{ ...editNote('', old), after: null }])).rejects.toBeInstanceOf(SaveConflict);
    expect((await read(`${day}_note`))?.data.text).toBe('Newer shared note');
  });

  it('does not resurrect tombstones and retries successful writes without duplicating or reverting them', async () => {
    const original = editNote('First');
    await commitEventMutations(connection(), [original]);
    const before = await read(original.eventId);
    const deletion = { ...editNote('', before), after: null };
    await commitEventMutations(connection('bob'), [deletion]);
    await commitEventMutations(connection(), [original]); // lost acknowledgement, retried after deletion
    expect((await read(original.eventId))?.deletedAt).toBeTruthy();
    expect((await read(original.eventId))?.revision).toBe(2);
    await expect(commitEventMutations(connection(), [editNote('Resurrect', before)])).rejects.toBeInstanceOf(SaveConflict);
  });

  it('coalesces typing, receipts each intent, and protects later queued edits from intervening caregivers', async () => {
    const a = editNote('H');
    const b = { ...editNote('Hello'), predecessor: a.id };
    await commitEventMutations(connection(), [a, b]);
    expect((await read(a.eventId))?.revision).toBe(1);
    await commitEventMutations(connection(), [a]);
    expect((await read(a.eventId))?.data.text).toBe('Hello');
    const c = { ...editNote('Hello world'), predecessor: b.id };
    await commitEventMutations(connection(), [c]);
    await commitEventMutations(connection('bob'), [editNote('Bob changed it', await read(a.eventId))]);
    const d = { ...editNote('Outdated continuation'), predecessor: c.id };
    await expect(commitEventMutations(connection(), [d])).rejects.toBeInstanceOf(SaveConflict);
  });

  it('upgrades a legacy event on its first edit without rewriting its author or unknown fields', async () => {
    const id = `${day}_note`;
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), eventPath(id)), {
      schemaVersion: 1, childId: 'maymay', type: 'note', localDate: day,
      occurredAt: Timestamp.fromDate(new Date(`${day}T12:00:00Z`)),
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdBy: 'original-author',
      data: { text: 'Legacy', extraContext: 'Preserve me' },
    }));
    await commitEventMutations(connection(), [editNote('Updated', await read(id))]);
    const snapshot = await getDoc(doc(connection().db, eventPath(id)));
    expect(snapshot.data()).toMatchObject({ createdBy: 'original-author', revision: 1, syncVersion: 2, data: { text: 'Updated', extraContext: 'Preserve me' } });
  });

  it('supports a full typing batch and a subsequent batch without exceeding rule access limits', async () => {
    const mutations: EventMutation[] = [];
    for (let i = 0; i < 100; i++) mutations.push({ ...editNote(`Draft ${i}`), predecessor: mutations.at(-1)?.id ?? null });
    await commitEventMutations(connection(), mutations);
    await commitEventMutations(connection(), [{ ...editNote('Final draft'), predecessor: mutations.at(-1)!.id }]);
    expect((await read(`${day}_note`))?.data.text).toBe('Final draft');
    expect((await read(`${day}_note`))?.revision).toBe(2);
  });

  it('blocks old-client writes, legacy daily writes, altered receipts, viewers, and other families', async () => {
    const mutation = editNote('Protected');
    await commitEventMutations(connection(), [mutation]);
    const ref = doc(connection().db, eventPath(mutation.eventId));
    await assertFails(setDoc(ref, { data: { text: 'Old overwrite' }, updatedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(ref, { deletedAt: Timestamp.now() }, { merge: true }));
    await assertFails(setDoc(doc(connection().db, 'users/alice/days/' + day), { notes: 'Legacy' }));
    await assertFails(setDoc(doc(ref, 'mutations', mutation.id), { revision: 9 }, { merge: true }));
    await assertFails(commitEventMutations(connection('viewer', 'maymay', 'caregiver'), [editNote('Not allowed', await read(mutation.eventId))]));
    await assertFails(getDoc(doc(connection('outsider').db, eventPath(mutation.eventId))));
    await assertFails(commitEventMutations(connection('outsider'), [editNote('Cross-family')]));
    await assertFails(commitEventMutations(connection('pending'), [editNote('Unapproved')]));
    expect((await read(mutation.eventId))?.data.text).toBe('Protected');
  });
});
