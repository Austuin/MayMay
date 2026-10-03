import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchFirebaseAccess, type FirebaseConnection } from '@/lib/maymay-firebase';

const fake = vi.hoisted(() => ({ auth: (_user: unknown) => {}, listeners: new Map<string, { next: (value: unknown) => void; error: (value: unknown) => void }>(), stops: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('firebase/auth', async importOriginal => ({ ...await importOriginal<object>(), getAuth: () => ({}),
  onAuthStateChanged: (_auth: unknown, next: typeof fake.auth) => { fake.auth = next; const stop = vi.fn(); fake.stops.push(stop); return stop; },
}));
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<object>(), doc: (_db: unknown, path: string) => path,
  onSnapshot: (path: string, _options: unknown, next: (value: unknown) => void, error: (value: unknown) => void) => {
    fake.listeners.set(path, { next, error }); const stop = vi.fn(); fake.stops.push(stop); return stop;
  },
}));
const connection = { app: {}, db: {}, user: { uid: 'alice' }, dataGeneration: 'generation',
  profile: { familyId: 'family' }, patientId: 'patient', families: [{ familyId: 'family', role: 'Caregiver' }] } as unknown as FirebaseConnection;
const member = 'families/family/memberships/alice';
const relation = 'families/family/patients/patient/relationships/alice';
function snapshot(path: string, data: unknown, fromCache = false) {
  fake.listeners.get(path)!.next({ metadata: { fromCache, hasPendingWrites: false }, data: () => data });
}
beforeEach(() => { fake.listeners.clear(); fake.stops.length = 0; });
describe('live access revocation', () => {
  it.each(['sign-out', 'account', 'generation', 'membership', 'role', 'patient', 'denied'])('invalidates once for %s and releases listeners', cause => {
    const invalidated = vi.fn(); const stop = watchFirebaseAccess(connection, invalidated);
    snapshot(member, { status: 'Disabled' }, true);
    snapshot('system/data', { schemaVersion: 1, generation: 'generation' });
    snapshot(member, { status: 'Active', role: 'Caregiver' });
    snapshot(relation, { canAccess: true });
    expect(invalidated).not.toHaveBeenCalled();
    if (cause === 'sign-out') fake.auth(null);
    if (cause === 'account') fake.auth({ uid: 'bob' });
    if (cause === 'generation') snapshot('system/data', { schemaVersion: 1, generation: 'new' });
    if (cause === 'membership') snapshot(member, { status: 'Disabled', role: 'Caregiver' });
    if (cause === 'role') snapshot(member, { status: 'Active', role: 'Viewer' });
    if (cause === 'patient') snapshot(relation, undefined);
    if (cause === 'denied') fake.listeners.get(relation)!.error({ code: 'permission-denied' });
    fake.auth(null);
    expect(invalidated).toHaveBeenCalledTimes(1);
    stop();
    expect(fake.stops.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
  });
});
