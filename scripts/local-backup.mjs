import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export function validateBackupFile(path, root) {
  if (typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.json')) throw new Error('Use an absolute .json backup path.');
  const resolved = resolve(path);
  for (const folder of ['public', 'dist', '.git', 'node_modules']) {
    const forbidden = resolve(root, folder).toLowerCase();
    if (resolved.toLowerCase().startsWith(forbidden + sep)) throw new Error('Backups must remain outside served or dependency directories.');
  }
  return resolved;
}

/** Preserve Firestore's REST Value encoding: timestamps, references, bytes and integers survive recovery. */
export async function writeLocalBackup({ projectId, db, path, request }) {
  const paths = [];
  async function scan(collection) {
    for (const ref of await collection.listDocuments()) {
      if ((await ref.get()).exists) paths.push(ref.path);
      for (const child of await ref.listCollections()) await scan(child);
    }
  }
  for (const collection of await db.listCollections()) await scan(collection);
  paths.sort();
  const prefix = `projects/${projectId}/databases/(default)/documents/`;
  const documents = [];
  for (let offset = 0; offset < paths.length; offset += 100) {
    const names = paths.slice(offset, offset + 100).map(path => prefix + path);
    const result = await request(`firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchGet`,
      { method: 'POST', body: { documents: names } });
    if (!Array.isArray(result) || result.length !== names.length || result.some(item => !item.found || !names.includes(item.found.name))
      || new Set(result.map(item => item.found.name)).size !== names.length) {
      throw new Error('Backup could not read every inventoried document. No data was deleted.');
    }
    documents.push(...result.map(item => item.found));
  }
  documents.sort((a, b) => a.name.localeCompare(b.name));
  const data = JSON.stringify({ format: 'maymay-firestore-rest-v1', projectId, createdAt: new Date().toISOString(), documents }, null, 2);
  await writeFile(path, data, { flag: 'wx', mode: 0o600 });
  const saved = await readFile(path, 'utf8');
  if (saved !== data || JSON.parse(saved).documents.length !== paths.length) throw new Error('Backup verification failed. No data was deleted.');
  const checksum = createHash('sha256').update(saved).digest('hex');
  await writeFile(path + '.sha256', checksum + '\n', { flag: 'wx', mode: 0o600 });
  return { documentCount: paths.length, checksum };
}
