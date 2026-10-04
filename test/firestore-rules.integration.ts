import { createServer, type Server } from 'node:http';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createInvitationHandler, createInvitationService } from '../scripts/family-invitations.mjs';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, type Firestore } from 'firebase/firestore';
import type { FirebaseConnection } from '../lib/maymay-firebase';
import { createFamilyFoundation } from '../lib/maymay-access';
import { createFamily, createPatient, selectFamilyPatient, updateAccountName, updateFamilyName, updatePatient } from '../lib/maymay-firebase';
import {
  approveFamilyRequest, cancelFamilyRequest, changeFamilyMemberPatients, disableFamilyMember, getFamilyInvitation,
  listFamilyMembers, listPendingRequests, rejectFamilyRequest, requestFamilyAccess,
  restoreFamilyMember, rotateFamilyCode, setFamilyMemberRole, transferProtectedPrimary,
} from '../lib/maymay-invitations';
import { CareConflict, commitCareMutation, type CareMutation, type ObservationDraft } from '../lib/maymay-care-records';
import { readObservationWindow } from '../lib/maymay-observation-history';

let env: RulesTestEnvironment;
let invitationServer: Server;
let adminApp: ReturnType<typeof initializeAdmin>;
let adminDb: ReturnType<typeof getAdminFirestore>;
const nativeFetch = globalThis.fetch;
const day = '2026-09-30';
const eventPath = (id: string) => `families/maymay/patients/maymay/events/${id}`;
function connection(uid = 'alice', familyId = 'maymay', role = 'caregiver', patientId = 'maymay') {
  return { dataGeneration: 'test-generation', accountName: uid, db: env.authenticatedContext(uid).firestore(), user: { uid }, profile: { familyId, role, active: true }, patientId } as unknown as FirebaseConnection;
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
      dataGeneration: 'test-generation', accountName: 'Test user', profile: { familyId: '', role: 'pending', active: false }, patientId: '', families: [],
    } as unknown as FirebaseConnection;
    const first = await createFamily(session, 'First family');
    expect(first.profile.role).toBe('master');
    expect(first.families.map(item => item.name)).toContain('First family');
    const accountRenamed = await updateAccountName(first, 'Renamed caregiver');
    expect(accountRenamed.accountName).toBe('Renamed caregiver');
    await expect(updateAccountName(first, 'Stale name')).rejects.toThrow(/changed elsewhere/);
    await assertFails(updateDoc(doc(creatorDb, 'users/setup-user'), { name: '' }));
    const patient = await createPatient(accountRenamed, first.profile.familyId, {
      name: 'Sam', sex: 'Female', ethnicity: 'Optional example',
      autismLevel: 'Level 2', birthdate: '2018-01-02', supportNeeds: 'Allow extra response time',
    });
    expect(patient.patient?.name).toBe('Sam');
    expect(patient.patient?.ethnicity).toBe('Optional example');
    expect(patient.patient?.supportNeeds).toBe('Allow extra response time');
    const patientRef = doc(creatorDb, 'families', first.profile.familyId, 'patients', patient.patientId);
    expect((await getDoc(patientRef)).data()?.birthdate).toBe('2018-01-02');
    const starters = (await getDocs(collection(patientRef, 'trackers'))).docs.map(item => item.data());
    expect(starters.map(item => item.title).sort()).toEqual(['Bowel Movements', 'Morning Mood', 'Went to School on Time']);
    expect(starters.every(item => item.revision === 1 && item.deletedAt === null)).toBe(true);
    const edited = await updatePatient(patient, { name: 'Sam Updated', sex: 'Female' });
    expect(edited.patient?.name).toBe('Sam Updated');
    expect((await getDoc(patientRef)).data()?.ethnicity).toBeUndefined();
    expect((await getDoc(patientRef)).data()?.birthdate).toBeUndefined();
    expect((await getDoc(patientRef)).data()?.supportNeeds).toBeUndefined();
    await expect(updatePatient(patient, { name: 'Conflicting name' })).rejects.toThrow(/changed elsewhere/);
    await updateDoc(patientRef, { ethnicity: 'Concurrent detail' });
    const preserved = await updatePatient(edited, { name: 'Sam Updated', sex: 'Female', supportNeeds: 'New support' });
    expect(preserved.patient?.name).toBe('Sam Updated');
    expect(preserved.patient?.ethnicity).toBe('Concurrent detail');
    expect(preserved.patient?.supportNeeds).toBe('New support');
    const renamed = await updateFamilyName(preserved, first.profile.familyId, 'Renamed family');
    expect(renamed.families.find(item => item.familyId === first.profile.familyId)?.name).toBe('Renamed family');
    await expect(updateFamilyName(first, first.profile.familyId, 'Stale family edit')).rejects.toThrow(/changed elsewhere/);
    await assertFails(updateDoc(doc(creatorDb, 'families', first.profile.familyId), { name: '' }));
    await assertFails(updateDoc(patientRef, { supportNeeds: 123 }));
    const second = await createFamily(renamed, 'Second family');
    expect(second.families).toHaveLength(2);
    expect(second.patientId).toBe('');
    const switched = selectFamilyPatient(second, first.profile.familyId, patient.patientId);
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
      await setDoc(doc(context.firestore(), 'families/maymay/patients/second/relationships/owner'), patientGrant('maymay', 'second', 'owner'));
      await setDoc(doc(context.firestore(), 'families/maymay/patients/second/events/private'), { type: 'note', data: { text: 'Second private' } });
    });
    for (const uid of ['pending', 'outsider']) {
      await assertFails(getDoc(doc(db(uid), eventPath('private'))));
      await assertFails(setDoc(doc(db(uid), eventPath('private')), { data: { text: 'Overwrite' } }, { merge: true }));
    }
    await assertFails(getDoc(doc(db('alice'), 'families/maymay/patients/second/events/private')));
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
    }
  });

  it('allows one account in two families without granting access outside either patient scope', async () => {
    await assertFails(setDoc(doc(db('other-owner'), 'families/other-family/memberships/alice'), membership('other-family', 'alice')));
    await env.withSecurityRulesDisabled(context =>
      setDoc(doc(context.firestore(), 'families/other-family/memberships/alice'), membership('other-family', 'alice')));
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient'), { familyId: 'other-family', patientId: 'other-patient', name: 'Other patient' });
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient/events/private'), { type: 'note' });
      await setDoc(doc(context.firestore(), 'families/other-family/patients/other-patient/relationships/other-owner'), patientGrant('other-family', 'other-patient', 'other-owner'));
    });
    await assertFails(getDoc(doc(db('alice'), 'families/other-family/patients/other-patient/events/private')));
    await assertSucceeds(setDoc(doc(db('other-owner'), 'families/other-family/patients/other-patient/relationships/alice'), patientGrant('other-family', 'other-patient', 'alice')));
    await assertSucceeds(getDoc(doc(db('alice'), 'families/other-family/patients/other-patient/events/private')));
  });

  it('prevents a Primary without patient access from editing or granting themselves access', async () => {
    await adminDb.doc('families/maymay/patients/restricted').set({ familyId: 'maymay', patientId: 'restricted', name: 'Restricted' });
    const primary = db('owner');
    const ref = doc(primary, 'families/maymay/patients/restricted');
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { name: 'Changed' }));
    await assertFails(setDoc(doc(ref, 'relationships/owner'), patientGrant('maymay', 'restricted', 'owner')));
    await assertFails(setDoc(doc(ref, 'relationships/alice'), patientGrant('maymay', 'restricted', 'alice')));
    await assertFails(deleteDoc(doc(primary, 'families/maymay/memberships/alice')));
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
  it('rejects stale role changes and protected Primary transfers', async () => {
    const owner = ownerConnection();
    const bob = (await listFamilyMembers(owner, 'maymay')).find(item => item.userId === 'bob')!;
    await setFamilyMemberRole(owner, 'maymay', bob, 'Primary');
    await expect(setFamilyMemberRole(owner, 'maymay', bob, 'Viewer')).rejects.toThrow(/changed elsewhere/);
    await transferProtectedPrimary(owner, 'maymay', 'bob');
    await expect(transferProtectedPrimary(owner, 'maymay', 'owner')).rejects.toThrow(/changed elsewhere/);
    expect((await adminDb.doc('families/maymay').get()).data()?.primaryId).toBe('bob');
  });
  it('preserves Unicode relationship text split across incoming network chunks', async () => {
    const joining = await applicant('unicode');
    const { code } = await rotateFamilyCode(ownerConnection(), 'maymay', ['maymay']);
    const bytes = Buffer.from(JSON.stringify({ dataGeneration: 'test-generation', code, relationship: 'Tía 💙' }));
    const handle = createInvitationHandler({ db: adminDb, auth: { verifyIdToken: async () => ({ uid: joining.user.uid, email: 'unicode@example.test', email_verified: true }) } });
    let status = 0;
    await handle({ url: '/api/family-invitations/request', method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      async *[Symbol.asyncIterator]() { for (const byte of bytes) yield Buffer.from([byte]); },
    }, { writeHead: (value: number) => { status = value; }, end: () => undefined });
    expect(status).toBe(200);
    expect((await adminDb.doc('families/maymay/memberships/unicode').get()).data()?.relationship).toBe('Tía 💙');
  });
  function ownerConnection() {
    return {
      app: { options: { projectId: 'demo-maymay-test' } },
      db: env.authenticatedContext('owner', { email: 'owner@example.test' }).firestore(),
      user: { uid: 'owner', email: 'owner@example.test', displayName: 'Owner', getIdToken: async () => 'owner' },
      dataGeneration: 'test-generation', accountName: 'Test user', profile: { familyId: 'maymay', role: 'master', active: true },
      patientId: 'maymay',
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
      patientId: '', families: [], requests: [],
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
    await expect(changeFamilyMemberPatients(owner, 'maymay', member, ['maymay'])).rejects.toThrow(/changed elsewhere/);
    await expect(disableFamilyMember(owner, 'maymay', member)).rejects.toThrow(/changed elsewhere/);
    await expect(setFamilyMemberRole(owner, 'maymay', member, 'Caregiver')).rejects.toThrow(/changed elsewhere/);
    await assertFails(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
    expect((await getDoc(doc(owner.db, 'families/maymay/patients/maymay/relationships/viewing'))).exists()).toBe(false);
    await restoreFamilyMember(owner, 'maymay', { ...member, status: 'Disabled', patientIds: [] }, ['maymay']);
    await assertSucceeds(getDoc(doc(joining.db, 'families/maymay/patients/maymay')));
  });
});

describe('retired care paths', () => {
  it('rejects writes to legacy events, medications, and daily summaries', async () => {
    const patientDb = connection('alice').db;
    await assertFails(setDoc(doc(patientDb, eventPath('old')), { type: 'note', data: { text: 'Old' } }));
    await assertFails(setDoc(doc(patientDb, 'families/maymay/patients/maymay/medications/old'), { name: 'Old' }));
    await assertFails(setDoc(doc(patientDb, 'families/maymay/patients/maymay/daySummaries/2026-09-30'), { localDate: '2026-09-30' }));
    await assertFails(setDoc(doc(patientDb, eventPath('old') + '/mutations/old'), { revision: 1 }));
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

  it.each(['good_count', 'difficult_count'] as const)('saves nonnegative %s answers and rejects negative counts', async (kind) => {
    const recordId = `${kind}-tracker`;
    const title = kind === 'good_count' ? 'Hugs' : 'Crying';
    await commitCareMutation(connection('alice'), {
      id: `create-${kind}`, target: 'tracker', recordId, expectedRevision: null,
      predecessor: null, queuedAt: 1,
      after: { title, description: `How many times?`, kind, days: [0, 1, 2, 3, 4, 5, 6] },
    });
    const observationId = `${recordId}_${day}`;
    const draft: ObservationDraft = { localDate: day, occurredAt: `${day}T12:00:00Z`, kind: 'answer',
      trackerId: recordId, trackerSnapshot: { title, description: 'How many times?', kind },
      value: 0, title, note: '', details: {} };
    await commitCareMutation(connection('alice'), {
      id: `answer-${kind}`, target: 'observation', recordId: observationId,
      expectedRevision: null, predecessor: null, queuedAt: 2, after: draft,
    });
    expect((await getDoc(doc(connection('alice').db,
      `families/maymay/patients/maymay/observations/${observationId}`))).data()?.value).toBe(0);
    await assertFails(commitCareMutation(connection('alice'), {
      id: `negative-${kind}`, target: 'observation', recordId: observationId,
      expectedRevision: 1, predecessor: null, queuedAt: 3, after: { ...draft, value: -1 },
    }));
  });

  it('shares No and Yes across caregivers while protecting revisions, snapshots, and Viewer access', async () => {
    await commitCareMutation(connection('alice'), tracker);
    const trackerPath = 'families/maymay/patients/maymay/trackers/school';
    const originalTracker = (await getDoc(doc(connection('alice').db, trackerPath))).data()!;
    await assertFails(setDoc(doc(connection('alice').db, trackerPath), {
      ...originalTracker, kind: 'count', revision: 2, updatedBy: 'alice', updatedAt: serverTimestamp(),
    }));
    await commitCareMutation(connection('alice'), answer('alice', false, null));
    const path = `families/maymay/patients/maymay/observations/school_${day}`;
    expect((await getDoc(doc(connection('bob').db, path))).data()?.value).toBe(false);
    await commitCareMutation(connection('bob'), answer('bob', true, 1));
    expect((await readObservationWindow(connection('alice'), { start: day, end: day })).map(item => item.value)).toEqual([true]);
    await expect(readObservationWindow(connection('outsider'), { start: day, end: day })).rejects.toThrow();
    await expect(commitCareMutation(connection('alice'), answer('alice', false, 1))).rejects.toBeInstanceOf(CareConflict);
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({
      value: true, revision: 2, trackerSnapshot: { title: 'School on time', kind: 'good' },
    });
    await expect(commitCareMutation(connection('viewer', 'maymay', 'viewer'), answer('viewer', false, 2))).rejects.toThrow(/cannot change/);
    await assertFails(updateDoc(doc(connection('viewer').db, path), { value: false }));
    await assertFails(commitCareMutation(connection('pending'), answer('pending', false, 2)));
    await assertFails(getDoc(doc(connection('outsider').db, path)));
    await commitCareMutation(connection('bob'), answer('bob', null, 2));
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({ revision: 3, value: true });
    expect((await getDoc(doc(connection('alice').db, path))).data()?.deletedAt).toBeTruthy();
    await commitCareMutation(connection('alice'), { ...tracker, id: 'remove-school', expectedRevision: 1, after: null });
    expect((await getDoc(doc(connection('bob').db, trackerPath))).data()?.deletedAt).toBeTruthy();
    expect((await getDoc(doc(connection('bob').db, path))).data()?.trackerSnapshot).toMatchObject({ title: 'School on time' });
  });

  it('edits, soft deletes, and undoes one spontaneous occurrence without reusing its ID', async () => {
    const id = 'occurrence-one';
    const first: CareMutation = { id: 'save-occurrence-one', target: 'observation', recordId: id,
      expectedRevision: null, predecessor: null, queuedAt: 1,
      after: { localDate: day, occurredAt: `${day}T09:30:00Z`, kind: 'meltdown',
        trackerId: null, trackerSnapshot: null, value: null, title: 'Loud assembly',
        repeatKey: 'meltdown:loud assembly', note: 'Private context', details: { whatHelped: 'Quiet room' } } };
    await commitCareMutation(connection('alice'), first);
    const changed: CareMutation = { ...first, id: 'edit-occurrence-one', expectedRevision: 1,
      after: { ...first.after as ObservationDraft, kind: 'difficult',
        repeatKey: 'difficult:loud assembly', note: '' } };
    await commitCareMutation(connection('bob'), changed);
    const path = `families/maymay/patients/maymay/observations/${id}`;
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({ kind: 'difficult', revision: 2, note: '' });
    await commitCareMutation(connection('alice'), { ...first, id: 'remove-occurrence-one', expectedRevision: 2, after: null });
    expect((await getDoc(doc(connection('bob').db, path))).data()?.deletedAt).toBeTruthy();
    await commitCareMutation(connection('bob'), { ...changed, id: 'undo-occurrence-one', expectedRevision: 3 });
    expect((await getDoc(doc(connection('alice').db, path))).data()).toMatchObject({ revision: 4, deletedAt: null });
    const { repeatKey: _repeatKey, ...withoutRepeatKey } = first.after as ObservationDraft;
    await assertFails(setDoc(doc(connection('alice').db, `families/maymay/patients/maymay/observations/invalid-repeat`), {
      ...withoutRepeatKey, occurredAt: Timestamp.fromDate(new Date(`${day}T09:30:00Z`)),
      observationId: 'invalid-repeat', familyId: 'maymay', patientId: 'maymay',
      dataGeneration: 'test-generation', createdBy: 'alice', updatedBy: 'alice',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1, deletedAt: null,
    }));
  });
});

describe('maintenance rules', () => {
  it('allows signed-in activation status reads and blocks all client writes', async () => {
    const maintenance = await initializeTestEnvironment({ projectId: 'demo-maymay-maintenance',
      firestore: { rules: await readFile('firebase.maintenance.rules', 'utf8') } });
    try {
      await maintenance.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'system/data'), { schemaVersion: 1, generation: 'old' });
        await setDoc(doc(context.firestore(), 'users/owner'), { name: 'Owner' });
      });
      const client = maintenance.authenticatedContext('owner').firestore();
      await assertSucceeds(getDoc(doc(client, 'system/data')));
      await assertFails(getDoc(doc(client, 'users/owner')));
      await assertFails(setDoc(doc(client, 'users/new'), { name: 'Blocked' }));
      await assertFails(updateDoc(doc(client, 'system/data'), { generation: 'forged' }));
    } finally { await maintenance.clearFirestore(); await maintenance.cleanup(); }
  });
});
