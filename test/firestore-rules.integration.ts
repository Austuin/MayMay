import { createServer, type Server } from 'node:http';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createInvitationHandler, createInvitationService } from '../scripts/family-invitations.mjs';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { createFamilyFoundation } from '../lib/maymay-access';
import { createFamily, createPatient, selectFamilyPatient, updatePatient } from '../lib/maymay-firebase';
import {
  approveFamilyRequest, cancelFamilyRequest, disableFamilyMember, getFamilyInvitation,
  listFamilyMembers, listPendingRequests, rejectFamilyRequest, requestFamilyAccess,
  restoreFamilyMember, rotateFamilyCode,
} from '../lib/maymay-invitations';
import { commitEventMutations, recordFromDocument } from '../lib/maymay-sync-firebase';
import { CareConflict, commitCareMutation, type CareMutation } from '../lib/maymay-care-records';
import { mutationsForEdit, SaveConflict, type EventMutation } from '../lib/maymay-sync-model';
import { emptyEntry } from '../lib/maymay-types';
import type { EventRecord } from '../lib/maymay-events';

let env: RulesTestEnvironment;
let invitationServer: Server;
let adminApp: ReturnType<typeof initializeAdmin>;
let adminDb: ReturnType<typeof getAdminFirestore>;
const nativeFetch = globalThis.fetch;
const day = '2026-09-30';
const eventPath = (id: string) => `families/maymay/patients/maymay/events/${id}`;
function connection(uid = 'alice', familyId = 'maymay', role = 'caregiver', childId = 'maymay') {
  return { dataGeneration: 'test-generation', accountName: uid, db: env.authenticatedContext(uid).firestore(), user: { uid }, profile: { familyId, role, active: true }, childId } as unknown as FirebaseConnection;
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
  adminApp = initializeAdmin({ projectId: 'demo-maymay-test' }, 'invitation-tests');
  adminDb = getAdminFirestore(adminApp);
  const handle = createInvitationHandler({ db: adminDb, auth: {
    verifyIdToken: async (token: string) => {
      if (token === 'invalid') throw new Error('Invalid token');
      return { uid: token, email: token + '@example.test', name: token, email_verified: token !== 'unverified' };
    },
  } });
  invitationServer = createServer((request, response) => { void handle(request, response); });
  await new Promise<void>(resolve => invitationServer.listen(0, '127.0.0.1', resolve));
  const address = invitationServer.address() as { port: number };
  vi.stubGlobal('fetch', (url: string | URL | Request, init?: RequestInit) => nativeFetch(typeof url === 'string' && url.startsWith('/api/') ? 'http://127.0.0.1:' + address.port + url : url, init));
  env = await initializeTestEnvironment({ projectId: 'demo-maymay-test', firestore: { rules: await readFile('firebase.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users/owner'), { userId: 'owner', name: 'Owner', email: 'owner@example.test', familyIds: ['maymay'], dataGeneration: 'test-generation' });
    await setDoc(doc(context.firestore(), 'system/data'), { schemaVersion: 1, generation: 'test-generation' });
    for (const [uid, familyId, role, status] of [
      ['alice', 'maymay', 'Caregiver', 'Active'], ['bob', 'maymay', 'Caregiver', 'Active'],
      ['viewer', 'maymay', 'Viewer', 'Active'], ['outsider', 'other-family', 'Caregiver', 'Active'],
      ['pending', 'maymay', 'Caregiver', 'Pending'],
      ['owner', 'maymay', 'Primary', 'Active'], ['other-owner', 'other-family', 'Primary', 'Active'],
    ] as const) {
      await setDoc(doc(context.firestore(), 'families', familyId, 'memberships', uid), { familyId, userId: uid, role, status });
    }
    await setDoc(doc(context.firestore(), 'families/maymay'), { familyId: 'maymay', name: 'MayMay', creatorId: 'owner', primaryId: 'owner', dataGeneration: 'test-generation' });
    await setDoc(doc(context.firestore(), 'families/other-family'), { familyId: 'other-family', name: 'Other', creatorId: 'other-owner', primaryId: 'other-owner', dataGeneration: 'test-generation' });
    await setDoc(doc(context.firestore(), 'families/maymay/patients/maymay'), { familyId: 'maymay', patientId: 'maymay', name: 'Patient' });
    for (const uid of ['alice', 'bob', 'viewer', 'owner']) {
      await setDoc(doc(context.firestore(), 'families/maymay/patients/maymay/relationships', uid), { familyId: 'maymay', patientId: 'maymay', userId: uid, relationship: '', canAccess: true });
    }
  });
});
afterAll(async () => {
  if (invitationServer) await new Promise<void>(resolve => invitationServer.close(() => resolve()));
  vi.unstubAllGlobals();
  if (adminApp) await deleteAdmin(adminApp);
  if (env) { await env.clearFirestore(); await env.cleanup(); }
});

describe('multi-family access foundation', () => {
  const db = (uid: string) => env.authenticatedContext(uid).firestore();
  const membership = (family: string, uid: string, role = 'Caregiver', status = 'Active') =>
    ({ familyId: family, userId: uid, role, status });
  const patientGrant = (family: string, patient: string, uid: string, canAccess = true) =>
    ({ familyId: family, patientId: patient, userId: uid, relationship: 'support worker', canAccess });

  it('creates an account family and patient, edits optional details, and switches between families', async () => {
    const creatorDb = env.authenticatedContext('setup-user', { email: 'setup@example.test' }).firestore();
    await assertSucceeds(setDoc(doc(creatorDb, 'users/setup-user'), {
      userId: 'setup-user', name: 'Setup user', email: 'setup@example.test', familyIds: [], dataGeneration: 'test-generation',
    }));
    const session = {
      app: { options: { projectId: 'demo-maymay-test' } }, db: creatorDb,
      user: { uid: 'setup-user', email: 'setup@example.test', displayName: 'Setup user' },
      dataGeneration: 'test-generation', accountName: 'Test user', profile: { familyId: '', role: 'pending', active: false }, childId: '', families: [],
    } as unknown as FirebaseConnection;
    const first = await createFamily(session, 'First family');
    expect(first.profile.role).toBe('master');
    expect(first.families.map(item => item.name)).toContain('First family');
    const patient = await createPatient(first, first.profile.familyId, {
      name: 'Sam', sex: 'Female', ethnicity: 'Optional example',
      autismLevel: 'Level 2', birthdate: '2018-01-02', supportNeeds: 'Allow extra response time',
    });
    expect(patient.patient?.name).toBe('Sam');
    expect(patient.patient?.ethnicity).toBe('Optional example');
    expect(patient.patient?.supportNeeds).toBe('Allow extra response time');
    const patientRef = doc(creatorDb, 'families', first.profile.familyId, 'patients', patient.childId);
    expect((await getDoc(patientRef)).data()?.birthdate).toBe('2018-01-02');
    const starters = (await getDocs(collection(patientRef, 'trackers'))).docs.map(item => item.data());
    expect(starters.map(item => item.title).sort()).toEqual(['Bowel Movements', 'Morning Mood', 'Went to School on Time']);
    expect(starters.every(item => item.revision === 1 && item.deletedAt === null)).toBe(true);
    const edited = await updatePatient(patient, { name: 'Sam Updated', sex: 'Female' });
    expect(edited.patient?.name).toBe('Sam Updated');
    expect((await getDoc(patientRef)).data()?.ethnicity).toBeUndefined();
    expect((await getDoc(patientRef)).data()?.birthdate).toBeUndefined();
    expect((await getDoc(patientRef)).data()?.supportNeeds).toBeUndefined();
    await assertFails(updateDoc(patientRef, { supportNeeds: 123 }));
    const second = await createFamily(edited, 'Second family');
    expect(second.families).toHaveLength(2);
    expect(second.childId).toBe('');
    const switched = selectFamilyPatient(second, first.profile.familyId, patient.childId);
    expect(switched.patient?.name).toBe('Sam Updated');
    await assertFails(getDoc(doc(db('outsider'), patientRef.path)));
  });

  it('bootstraps only the creator as the first active Primary in one atomic write', async () => {
    const creatorDb = db('new-creator');
    const familyRef = doc(creatorDb, 'families/new-family');
    const memberRef = doc(creatorDb, 'families/new-family/memberships/new-creator');
    await assertFails(setDoc(memberRef, membership('new-family', 'new-creator', 'Primary')));
    await assertFails(setDoc(familyRef, { familyId: 'new-family', name: 'New', creatorId: 'new-creator', primaryId: 'new-creator' }));
    await assertSucceeds(createFamilyFoundation(creatorDb as unknown as Firestore, 'new-family', 'New', 'new-creator'));
    expect((await getDoc(memberRef)).data()?.status).toBe('Active');
    await assertFails(setDoc(doc(db('attacker'), 'families/forged'), { familyId: 'forged', name: 'Forged', creatorId: 'new-creator', primaryId: 'new-creator' }));
  });

  it('requires active membership and explicit patient access for reads and writes across families', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), eventPath('private')), { type: 'note', data: { text: 'Private' } });
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient'), { familyId: 'other-family', patientId: 'other-patient', name: 'Other patient' });
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient/events/private'), { type: 'note', data: { text: 'Other private' } });
      await setDoc(doc(context.firestore(), 'families/maymay/patients/second'), { familyId: 'maymay', patientId: 'second', name: 'Second' });
      await setDoc(doc(context.firestore(), 'families/maymay/patients/second/events/private'), { type: 'note', data: { text: 'Second private' } });
    });
    for (const uid of ['pending', 'outsider']) {
      await assertFails(getDoc(doc(db(uid), eventPath('private'))));
      await assertFails(setDoc(doc(db(uid), eventPath('private')), { data: { text: 'Overwrite' } }, { merge: true }));
    }
    await assertFails(getDoc(doc(db('alice'), 'families/maymay/patients/second/events/private')));
    await assertFails(commitEventMutations(connection('alice', 'maymay', 'caregiver', 'second'), [editNote('Denied')]));
    await assertFails(getDoc(doc(db('alice'), 'families/other-family/patients/other-patient/events/private')));
    await assertSucceeds(getDoc(doc(db('alice'), eventPath('private'))));
    await assertFails(setDoc(doc(db('viewer'), eventPath('private')), { data: { text: 'Overwrite' } }, { merge: true }));
    await assertSucceeds(setDoc(doc(db('owner'), 'families/maymay/patients/second/relationships/alice'), patientGrant('maymay', 'second', 'alice')));
    await assertSucceeds(getDoc(doc(db('alice'), 'families/maymay/patients/second/events/private')));
    await assertSucceeds(deleteDoc(doc(db('owner'), 'families/maymay/patients/second/relationships/alice')));
    await assertFails(getDoc(doc(db('alice'), 'families/maymay/patients/second/events/private')));
  });

  it('blocks Pending, Rejected, and Disabled memberships even when an access grant remains', async () => {
    for (const status of ['Pending', 'Rejected', 'Disabled']) {
      await env.withSecurityRulesDisabled(context =>
        setDoc(doc(context.firestore(), 'families/maymay/memberships/alice'), membership('maymay', 'alice', 'Caregiver', status)));
      await assertFails(getDoc(doc(db('alice'), 'families/maymay/patients/maymay')));
      await assertFails(getDoc(doc(db('alice'), eventPath('private'))));
      await assertFails(commitEventMutations(connection('alice'), [editNote('Denied')]));
    }
  });

  it('allows one account in two families without granting access outside either patient scope', async () => {
    await assertFails(setDoc(doc(db('other-owner'), 'families/other-family/memberships/alice'), membership('other-family', 'alice')));
    await env.withSecurityRulesDisabled(context =>
      setDoc(doc(context.firestore(), 'families/other-family/memberships/alice'), membership('other-family', 'alice')));
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient'), { familyId: 'other-family', patientId: 'other-patient', name: 'Other patient' });
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient/events/private'), { type: 'note' });
    });
    await assertFails(getDoc(doc(db('alice'), 'families/other-family/patients/other-patient/events/private')));
    await assertSucceeds(setDoc(doc(db('other-owner'), 'families/other-family/patients/other-patient/relationships/alice'), patientGrant('other-family', 'other-patient', 'alice')));
    await assertSucceeds(getDoc(doc(db('alice'), 'families/other-family/patients/other-patient/events/private')));
  });

  it('enforces approved promotions and preserves the last active Primary on the server', async () => {
    const owner = db('owner');
    const familyRef = doc(owner, 'families/maymay');
    const ownerRef = doc(owner, 'families/maymay/memberships/owner');
    const bobRef = doc(owner, 'families/maymay/memberships/bob');
    await assertFails(updateDoc(ownerRef, { role: 'Caregiver' }));
    await assertFails(updateDoc(ownerRef, { status: 'Disabled' }));
    await assertFails(deleteDoc(ownerRef));
    await assertFails(updateDoc(familyRef, { primaryId: 'bob' }));
    await assertFails(setDoc(doc(db('alice'), 'families/maymay/memberships/bob'), membership('maymay', 'bob', 'Primary')));
    await assertFails(setDoc(doc(owner, 'families/maymay/memberships/new-primary'), membership('maymay', 'new-primary', 'Primary')));
    await assertFails(setDoc(doc(owner, 'families/maymay/memberships/new-primary'), membership('maymay', 'new-primary', 'Caregiver', 'Pending')));
    await env.withSecurityRulesDisabled(context =>
      setDoc(doc(context.firestore(), 'families/maymay/memberships/new-primary'), membership('maymay', 'new-primary', 'Caregiver', 'Pending')));
    await assertFails(updateDoc(doc(owner, 'families/maymay/memberships/new-primary'), { role: 'Primary', status: 'Active' }));
    await assertSucceeds(updateDoc(bobRef, { role: 'Primary' }));
    await assertFails(updateDoc(ownerRef, { role: 'Viewer' }));
    await assertSucceeds(updateDoc(familyRef, { primaryId: 'bob' }));
    await assertSucceeds(updateDoc(ownerRef, { role: 'Viewer' }));
    await assertFails(updateDoc(bobRef, { status: 'Disabled' }));
    await assertFails(updateDoc(bobRef, { role: 'Caregiver' }));
    await assertFails(updateDoc(familyRef, { primaryId: 'owner', dataGeneration: 'test-generation' }));
    await assertFails(updateDoc(doc(db('alice'), 'families/maymay/memberships/bob'), { role: 'Viewer' }));
  });
});

describe('Family Code requests and Primary approval', () => {
  function ownerConnection() {
    return {
      app: { options: { projectId: 'demo-maymay-test' } },
      db: env.authenticatedContext('owner', { email: 'owner@example.test' }).firestore(),
      user: { uid: 'owner', email: 'owner@example.test', displayName: 'Owner', getIdToken: async () => 'owner' },
      dataGeneration: 'test-generation', accountName: 'Test user', profile: { familyId: 'maymay', role: 'master', active: true },
      childId: 'maymay',
      families: [{ familyId: 'maymay', name: 'MayMay', role: 'Primary', primaryId: 'owner', dataGeneration: 'test-generation', patients: [{ familyId: 'maymay', patientId: 'maymay', name: 'Patient' }] }],
      requests: [],
    } as unknown as FirebaseConnection;
  }

  async function applicant(uid: string) {
    const email = `${uid}@example.test`;
    const firestore = env.authenticatedContext(uid, { email }).firestore();
    await assertSucceeds(setDoc(doc(firestore, 'users', uid), {
      userId: uid, name: uid, email, familyIds: [], dataGeneration: 'test-generation',
    }));
    return {
      app: { options: { projectId: 'demo-maymay-test' } }, db: firestore,
      user: { uid, email, displayName: uid, getIdToken: async () => uid },
      dataGeneration: 'test-generation', accountName: 'Test user', profile: { familyId: '', role: 'pending', active: false },
      childId: '', families: [], requests: [],
    } as unknown as FirebaseConnection;
  }

  it('requires a current code, keeps requests pending, and grants selected patient access only after approval', async () => {
    const owner = ownerConnection();
    const joining = await applicant('joining');
    const { code, inviteId } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    expect(await getFamilyInvitation(owner, 'maymay')).toMatchObject({ inviteId, patientIds: ['maymay'] });
    const invitation = (await adminDb.doc('families/maymay/invitations/' + inviteId).get()).data();
    expect(JSON.stringify(invitation)).not.toContain(code.split('.').at(-1));
    await assertFails(getDoc(doc(owner.db, 'families/maymay/invitations/' + inviteId)));
    await assertFails(getDoc(doc(joining.db, 'families/maymay/joinSettings/current')));
    await expect(requestFamilyAccess(joining, code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'), 'Sibling')).rejects.toThrow(/invalid or expired/);
    const pending = await requestFamilyAccess(joining, code, 'Sibling');
    expect(pending.requests).toEqual([{ familyId: 'maymay', status: 'Pending' }]);
    expect((await listPendingRequests(owner)).map(item => item.userId)).toContain('joining');
    expect((await listPendingRequests(owner))[0].relationship).toBe('Sibling');
    await assertFails(getDoc(doc(joining.db, 'families/maymay')));
    await assertFails(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    await assertFails(updateDoc(doc(joining.db, 'families/maymay/memberships/joining'), { status: 'Active' }));
    await assertFails(setDoc(doc(joining.db, 'families/maymay/patients/maymay/relationships/joining'), {
      familyId: 'maymay', patientId: 'maymay', userId: 'joining', relationship: '', canAccess: true,
    }));
    await rotateFamilyCode(owner, 'maymay', ['maymay']);
    const later = await applicant('later');
    await expect(requestFamilyAccess(later, code, 'Sibling')).rejects.toThrow(/invalid or expired/);
    await approveFamilyRequest(owner, 'maymay', 'joining', 'Caregiver', ['maymay']);
    const approved = (await getDoc(doc(joining.db, 'families/maymay/memberships/joining'))).data();
    expect(approved?.status).toBe('Active');
    expect(approved?.requesterEmailVerified).toBe(true);
    expect(approved?.approvedBy).toBe('owner');
    expect(approved?.patientIds).toEqual(['maymay']);
    expect((await getDoc(doc(joining.db, 'families/maymay/patients/maymay/relationships/joining'))).data()?.relationship).toBe('Sibling');
    await assertSucceeds(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    expect((await listPendingRequests(owner)).some(item => item.userId === 'joining')).toBe(false);
  });

  it('supports rejection, a fresh request, and cancellation without granting access', async () => {
    const owner = ownerConnection();
    const joining = await applicant('reapplicant');
    const { code, inviteId } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    await requestFamilyAccess(joining, code, 'Sibling');
    await rejectFamilyRequest(owner, 'maymay', 'reapplicant');
    await assertFails(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    expect((await getDoc(doc(joining.db, 'families/maymay/memberships/reapplicant'))).data()?.reviewedBy).toBe('owner');
    await requestFamilyAccess(joining, code, 'Sibling');
    const pending = await cancelFamilyRequest(joining, 'maymay');
    expect(pending.requests).toHaveLength(0);
    expect((await getDoc(doc(joining.db, 'families/maymay/memberships/reapplicant'))).exists()).toBe(false);
    expect((await getDoc(doc(joining.db, 'users/reapplicant'))).data()?.familyIds).toEqual([]);
  });

  it('blocks direct pending creation, approval bypasses, and invitation writes', async () => {
    const owner = ownerConnection();
    const joining = await applicant('direct');
    await assertFails(setDoc(doc(joining.db, 'families/maymay/memberships/direct'), {
      familyId: 'maymay', userId: 'direct', status: 'Pending', role: 'Caregiver', patientIds: [],
    }));
    const { code } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    await requestFamilyAccess(joining, code, 'Sibling');
    await assertFails(updateDoc(doc(owner.db, 'families/maymay/memberships/direct'), { status: 'Active' }));
    await assertFails(updateDoc(doc(owner.db, 'families/maymay/memberships/direct'), { status: 'Rejected' }));
    await assertFails(setDoc(doc(owner.db, 'families/maymay/joinSettings/current'), { secret: 'legacy' }));
    await assertFails(setDoc(doc(owner.db, 'families/maymay/invitations/fake'), { codeHash: 'fake' }));
    await assertFails(deleteDoc(doc(joining.db, 'families/maymay/memberships/direct')));
  });

  it('requires verified identity, enforces expiry and limits bad guesses', async () => {
    const owner = ownerConnection();
    const { code, inviteId } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    await expect(requestFamilyAccess(await applicant('unverified'), code, 'Sibling')).rejects.toThrow(/Verify your email/);
    await expect(requestFamilyAccess(await applicant('invalid'), code, 'Sibling')).rejects.toThrow(/sign-in expired/);
    const joining = await applicant('limited');
    for (let i = 0; i < 10; i++) await expect(requestFamilyAccess(joining, 'bad code', 'Sibling')).rejects.toThrow(/invalid or expired/);
    await expect(requestFamilyAccess(joining, code, 'Sibling')).rejects.toThrow(/Too many attempts/);
    await adminDb.doc('families/maymay/invitations/' + inviteId).update({ expiresAt: new Date(0) });
    await expect(requestFamilyAccess(await applicant('late'), code, 'Sibling')).rejects.toThrow(/invalid or expired/);
  });

  it('deduplicates requests and resolves concurrent approval/rejection only once', async () => {
    const owner = ownerConnection();
    const joining = await applicant('racing');
    const { code } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    await requestFamilyAccess(joining, code, 'Sibling');
    await requestFamilyAccess(joining, code, 'Changed by retry');
    expect((await listFamilyMembers(owner, 'maymay')).find(member => member.userId === 'racing')?.relationship).toBe('Sibling');
    const outcomes = await Promise.allSettled([
      approveFamilyRequest(owner, 'maymay', 'racing', 'Caregiver', ['maymay']),
      rejectFamilyRequest(owner, 'maymay', 'racing'),
    ]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const member = (await adminDb.doc('families/maymay/memberships/racing').get()).data();
    const grant = await adminDb.doc('families/maymay/patients/maymay/relationships/racing').get();
    expect(grant.exists).toBe(member?.status === 'Active');
  });

  it('enforces current generation, Primary role and patient scope in trusted operations', async () => {
    const execute = createInvitationService(adminDb);
    const input = { dataGeneration: 'test-generation', familyId: 'maymay', patientIds: ['maymay'] };
    await expect(execute('rotate', { uid: 'owner' }, { ...input, dataGeneration: 'old' })).rejects.toThrow(/setup changed/);
    const stranger = await applicant('admin-stranger');
    await adminDb.doc('admins/admin-stranger').set({ status: 'Active' });
    await expect(execute('rotate', { uid: stranger.user.uid }, input)).rejects.toThrow(/Primary/);
    await expect(execute('rotate', { uid: 'owner' }, { ...input, patientIds: ['other-patient'] })).rejects.toThrow(/unavailable/);
    const { code } = await rotateFamilyCode(ownerConnection(), 'maymay', ['maymay']);
    await requestFamilyAccess(stranger, code, 'Sibling');
    await expect(execute('approve', { uid: 'owner' }, { ...input, userId: stranger.user.uid, role: 'Primary' })).rejects.toThrow(/Caregiver or Viewer/);
    await expect(execute('approve', { uid: 'owner' }, { ...input, patientIds: ['other-patient'], userId: stranger.user.uid, role: 'Caregiver' })).rejects.toThrow(/unavailable/);
  });

  it('keeps viewers read-only and removes patient access when a member is disabled', async () => {
    const owner = ownerConnection();
    const joining = await applicant('viewing');
    const { code, inviteId } = await rotateFamilyCode(owner, 'maymay', ['maymay']);
    await requestFamilyAccess(joining, code, 'Sibling');
    await approveFamilyRequest(owner, 'maymay', 'viewing', 'Viewer', ['maymay']);
    await assertSucceeds(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    await assertFails(setDoc(doc(joining.db, 'families/maymay/patients/maymay/daySummaries/2026-10-01'), {
      schemaVersion: 1, childId: 'maymay', localDate: '2026-10-01',
    }));
    const member = (await listFamilyMembers(owner, 'maymay')).find(item => item.userId === 'viewing')!;
    await disableFamilyMember(owner, 'maymay', member);
    await assertFails(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    expect((await getDoc(doc(owner.db, 'families/maymay/patients/maymay/relationships/viewing'))).exists()).toBe(false);
    await restoreFamilyMember(owner, 'maymay', { ...member, status: 'Disabled', patientIds: [] }, ['maymay']);
    await assertSucceeds(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
  });
});

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

describe('tracker and observation saves with real Firestore rules', () => {
  const tracker: CareMutation = {
    id: 'create-tracker', target: 'tracker', recordId: 'school', expectedRevision: null,
    predecessor: null, queuedAt: 1,
    after: { title: 'School on time', description: 'Did they arrive on time?', kind: 'good', days: [1, 2, 3, 4, 5] },
  };
  const answer = (uid: string, value: boolean | null, expectedRevision: number | null): CareMutation => ({
    id: `${uid}-${value}-${expectedRevision}`, target: 'observation', recordId: `school_${day}`,
    expectedRevision, predecessor: null, queuedAt: 2,
    after: value === null ? null : { localDate: day, occurredAt: `${day}T12:00:00Z`, kind: 'answer',
      trackerId: 'school', trackerSnapshot: { title: 'School on time', description: 'Did they arrive on time?', kind: 'good' },
      value, title: 'School on time', note: '', details: {} },
  });

  it('shares No and Yes across caregivers while protecting revisions, snapshots, and Viewer access', async () => {
    await commitCareMutation(connection('alice'), tracker);
    await commitCareMutation(connection('alice'), answer('alice', false, null));
    const path = `families/maymay/patients/maymay/observations/school_${day}`;
    expect((await getDoc(doc(connection('bob').db, path))).data()?.value).toBe(false);
    await commitCareMutation(connection('bob'), answer('bob', true, 1));
    await expect(commitCareMutation(connection('alice'), answer('alice', false, 1))).rejects.toBeInstanceOf(CareConflict);
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({
      value: true, revision: 2, trackerSnapshot: { title: 'School on time', kind: 'good' },
    });
    await assertFails(commitCareMutation(connection('viewer', 'maymay', 'viewer'), answer('viewer', false, 2)));
    await assertFails(commitCareMutation(connection('pending'), answer('pending', false, 2)));
    await assertFails(getDoc(doc(connection('outsider').db, path)));
    await commitCareMutation(connection('bob'), answer('bob', null, 2));
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({ revision: 3, value: true });
    expect((await getDoc(doc(connection('alice').db, path))).data()?.deletedAt).toBeTruthy();
  });
});
