import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export class InvitationError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new InvitationError(message, status); };
const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('Invalid request.');
  return value;
};
const metadata = snapshot => snapshot?.exists ? {
  inviteId: snapshot.id, expiresAt: snapshot.data().expiresAt.toDate().toISOString(),
  revoked: Boolean(snapshot.data().revokedAt), patientIds: snapshot.data().patientIds,
} : null;

/** Only call with an identity verified by Firebase Admin Auth, never a browser-supplied UID. */
export function createInvitationService(db, now = () => Date.now()) {
  async function context(tx, actor, input, familyId, primary = false) {
    const config = await tx.get(db.doc('system/data'));
    if (config.data()?.schemaVersion !== 1 || !input.dataGeneration || config.data()?.generation !== input.dataGeneration) {
      fail('MayMay setup changed or is not active yet. Sign in again.', 409);
    }
    const identity = await tx.get(db.doc(`users/${id(actor.uid)}`));
    if (identity.data()?.dataGeneration !== input.dataGeneration) fail('Sign in again to refresh your account.', 409);
    const familyRef = db.doc(`families/${id(familyId)}`);
    const family = await tx.get(familyRef);
    if (!family.exists || family.data().dataGeneration !== input.dataGeneration) fail('This family is unavailable.', 404);
    const memberRef = familyRef.collection('memberships').doc(actor.uid);
    const member = await tx.get(memberRef);
    if (primary && (member.data()?.role !== 'Primary' || member.data()?.status !== 'Active')) {
      fail('Only an active Primary caregiver can manage this family.', 403);
    }
    return { familyRef, family, memberRef, member };
  }

  async function patients(tx, familyRef, uid, values) {
    if (!Array.isArray(values) || values.length > 100) fail('Choose the patients for this invitation.');
    const ids = [...new Set(values.map(id))];
    for (const patientId of ids) {
      const patient = familyRef.collection('patients').doc(patientId);
      const record = await tx.get(patient);
      const access = await tx.get(patient.collection('relationships').doc(uid));
      if (!record.exists || access.data()?.canAccess !== true) fail('One of those patients is unavailable to you.', 403);
    }
    return ids;
  }

  async function throttle(uid) {
    const ref = db.doc(`system/invitationLimits/users/${id(uid)}`);
    await db.runTransaction(async tx => {
      const previous = (await tx.get(ref)).data();
      const start = previous && now() - previous.start < 15 * 60_000 ? previous.start : now();
      const count = previous?.start === start ? previous.count : 0;
      if (count >= 10) fail('Too many attempts. Please wait 15 minutes before trying again.', 429);
      tx.set(ref, { start, count: count + 1 });
    });
  }

  return async function execute(action, actor, input) {
    if (action === 'request') {
      if (actor.email_verified !== true || !actor.email) fail('Verify your email before requesting family access.', 403);
      await throttle(actor.uid);
      const match = typeof input.code === 'string' && /^MM1\.([A-Za-z0-9_-]{1,128})\.([a-f0-9]{24})\.([a-f0-9]{32})$/.exec(input.code.trim());
      if (!match) fail('That Family Code is invalid or expired. Ask a Primary caregiver for a new code.');
      const [, familyId, inviteId, secret] = match;
      const relationship = typeof input.relationship === 'string' ? input.relationship.trim() : '';
      if (!relationship || relationship.length > 100) fail('Enter your relationship to the patient (up to 100 characters).');
      return db.runTransaction(async tx => {
        const { familyRef, family, memberRef, member } = await context(tx, actor, input, familyId);
        const invite = (await tx.get(familyRef.collection('invitations').doc(inviteId))).data();
        if (!invite || invite.dataGeneration !== input.dataGeneration
          || !timingSafeEqual(Buffer.from(hash(secret)), Buffer.from(invite.codeHash))) {
          fail('That Family Code is invalid or expired. Ask a Primary caregiver for a new code.');
        }
        // A retry of an already submitted request must not reset its audit or scope.
        if (member.data()?.status === 'Pending') return { status: 'Pending', existing: true };
        if (invite.revokedAt || family.data().activeInviteId !== inviteId || invite.expiresAt.toMillis() <= now()) {
          fail('That Family Code is invalid or expired. Ask a Primary caregiver for a new code.');
        }
        if (member.exists && member.data().status !== 'Rejected') fail('This account already has a membership in that family.', 409);
        tx.set(memberRef, {
          familyId, userId: actor.uid, role: 'Caregiver', status: 'Pending', patientIds: [],
          invitationId: inviteId, proposedPatientIds: invite.patientIds,
          requesterName: String(actor.name || actor.email).slice(0, 100), requesterEmail: actor.email,
          requesterEmailVerified: true, relationship, requestedAt: FieldValue.serverTimestamp(),
        });
        tx.update(db.doc(`users/${actor.uid}`), { familyIds: FieldValue.arrayUnion(familyId), dateUpdated: FieldValue.serverTimestamp() });
        return { status: 'Pending', existing: false };
      });
    }

    if (!['status', 'rotate', 'approve', 'reject', 'cancel'].includes(action)) fail('Unknown invitation action.', 404);
    return db.runTransaction(async tx => {
      const { familyRef, family, memberRef, member } = await context(tx, actor, input, input.familyId, action !== 'cancel');
      if (action === 'cancel') {
        if (member.data()?.status !== 'Pending') fail('That request is no longer pending. Refresh your access.', 409);
        tx.delete(memberRef);
        tx.update(db.doc(`users/${actor.uid}`), { familyIds: FieldValue.arrayRemove(input.familyId), dateUpdated: FieldValue.serverTimestamp() });
        return { status: 'Cancelled' };
      }
      if (action === 'status' || action === 'rotate') {
        const previousId = family.data().activeInviteId;
        const previous = previousId ? await tx.get(familyRef.collection('invitations').doc(previousId)) : null;
        if (action === 'status') return metadata(previous);
        const patientIds = await patients(tx, familyRef, actor.uid, input.patientIds);
        const inviteId = randomBytes(12).toString('hex');
        const secret = randomBytes(16).toString('hex');
        const expiresAt = Timestamp.fromMillis(now() + 7 * 24 * 60 * 60_000);
        if (previous?.exists) tx.update(previous.ref, { revokedAt: FieldValue.serverTimestamp() });
        tx.create(familyRef.collection('invitations').doc(inviteId), {
          inviteId, familyId: input.familyId, codeHash: hash(secret), expiresAt, patientIds,
          revokedAt: null, createdBy: actor.uid, dateCreated: FieldValue.serverTimestamp(), dataGeneration: input.dataGeneration,
        });
        tx.update(familyRef, { activeInviteId: inviteId });
        return { code: `MM1.${input.familyId}.${inviteId}.${secret}`, inviteId, expiresAt: expiresAt.toDate().toISOString(), revoked: false, patientIds };
      }
      const target = familyRef.collection('memberships').doc(id(input.userId));
      const pending = (await tx.get(target)).data();
      if (pending?.status !== 'Pending') fail('That request has already been reviewed or cancelled. Refresh the list.', 409);
      if (action === 'reject') {
        tx.update(target, { status: 'Rejected', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: actor.uid });
        return { status: 'Rejected' };
      }
      if (!['Caregiver', 'Viewer'].includes(input.role)) fail('Approve as Caregiver or Viewer.');
      const patientIds = await patients(tx, familyRef, actor.uid, input.patientIds);
      if (!patientIds.length) fail('Choose at least one patient before approving access.');
      tx.update(target, {
        status: 'Active', role: input.role, patientIds,
        dateJoined: FieldValue.serverTimestamp(), approvedAt: FieldValue.serverTimestamp(), approvedBy: actor.uid,
      });
      for (const patientId of patientIds) tx.set(familyRef.collection('patients').doc(patientId).collection('relationships').doc(input.userId), {
        familyId: input.familyId, patientId, userId: input.userId, relationship: pending.relationship, canAccess: true,
      });
      return { status: 'Active' };
    });
  };
}

/** Same-origin host endpoint; credentials remain on the host, outside the static bundle. */
export function createInvitationHandler({ db, auth }) {
  const execute = createInvitationService(db);
  return async function handle(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/family-invitations/')) return false;
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method !== 'POST') fail('Use POST for invitation requests.', 405);
      if (!request.headers['content-type']?.startsWith('application/json')) fail('Send a JSON request.', 415);
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization || '')?.[1];
      if (!token) fail('Sign in to manage family access.', 401);
      let actor;
      try { actor = await auth.verifyIdToken(token, true); }
      catch { fail('Your sign-in expired. Sign in again.', 401); }
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 8192) fail('The request is too large.', 413);
      }
      let input;
      try { input = JSON.parse(body); } catch { fail('Invalid request.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid request.');
      reply(200, await execute(pathname.slice('/api/family-invitations/'.length), actor, input));
    } catch (error) {
      reply(error instanceof InvitationError ? error.status : 500, {
        error: error instanceof InvitationError ? error.message : 'Family access is unavailable. Please try again.',
      });
    }
    return true;
  };
}
