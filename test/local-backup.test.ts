import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateBackupFile, writeLocalBackup } from '../scripts/local-backup.mjs';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });
function database() {
  const ref = (path: string, exists = true): any => ({ path, get: async () => ({ exists }),
    listCollections: async () => path === 'families/missing' ? [{ listDocuments: async () => [ref('families/missing/patients/p')] }] : [] });
  return { listCollections: async () => [{ listDocuments: async () => [ref('admins/a'), ref('families/missing', false)] }] };
}
describe('local Firestore backup', () => {
  it('preserves typed values and orphan descendants with a verified checksum; never overwrites a backup', async () => {
    directory = await mkdtemp(join(tmpdir(), 'maymay-backup-test-'));
    const path = join(directory, 'backup.json');
    const request = async (_url: string, { body }: any) => body.documents.map((name: string) => ({ found: { name,
      fields: { count: { integerValue: '9007199254740993' }, time: { timestampValue: '2026-10-01T00:00:00Z' } } } }));
    const result = await writeLocalBackup({ projectId: 'demo-test', db: database(), path, request });
    const text = await readFile(path, 'utf8'); const saved = JSON.parse(text);
    expect(result.documentCount).toBe(2);
    expect(saved.documents.map((doc: any) => doc.name.split('/documents/')[1])).toEqual(['admins/a', 'families/missing/patients/p']);
    expect(saved.documents[0].fields.count.integerValue).toBe('9007199254740993');
    expect((await readFile(path + '.sha256', 'utf8')).trim()).toBe(createHash('sha256').update(text).digest('hex'));
    await expect(writeLocalBackup({ projectId: 'demo-test', db: database(), path, request })).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(text);
  });
  it('refuses missing or duplicated responses and paths inside the public bundle', async () => {
    directory = await mkdtemp(join(tmpdir(), 'maymay-backup-test-'));
    for (const request of [async () => [], async (_url: string, { body }: any) => [0, 1].map(() => ({ found: { name: body.documents[0] } }))]) {
      await expect(writeLocalBackup({ projectId: 'demo-test', db: database(), path: join(directory, 'bad.json'), request })).rejects.toThrow(/every inventoried/);
    }
    expect(() => validateBackupFile(resolve('public/backup.json'), process.cwd())).toThrow(/outside served/);
  });
});
