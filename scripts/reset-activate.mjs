import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { runControlledReset, waitForRulesRelease } from './reset-plan.mjs';
import { validateBackupFile, writeLocalBackup } from './local-backup.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));

function argsFor(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index++) {
    const flag = values[index];
    if (!flag.startsWith('--') || flags.has(flag)) throw new Error(`Unexpected or repeated argument: ${flag}`);
    if (flag === '--execute' || flag === '--dry-run') flags.set(flag, true);
    else {
      const value = values[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      flags.set(flag, value);
    }
  }
  const allowed = ['--project', '--credentials', '--execute', '--dry-run', '--confirm-project', '--confirm-plan', '--backup-uri', '--backup-file'];
  for (const flag of flags.keys()) if (!allowed.includes(flag)) throw new Error(`Unknown option: ${flag}`);
  if (flags.has('--execute') && flags.has('--dry-run')) throw new Error('Choose --dry-run or --execute.');
  if (!flags.get('--project') || !flags.get('--credentials')) {
    throw new Error('Usage: node scripts/reset-activate.mjs --project PROJECT --credentials ADMIN_JSON [--dry-run]');
  }
  return flags;
}

async function firebaseRequest(credential, path, { method = 'GET', body } = {}) {
  const token = await credential.getAccessToken();
  const response = await fetch(`https://${path}`, { method, headers: {
    Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Firebase API request failed (${response.status}).`);
  return payload;
}

async function backupFirestore(credential, projectId, uri) {
  console.log(`Exporting Firestore backup to ${uri}…`);
  const operation = await firebaseRequest(credential,
    `firestore.googleapis.com/v1/projects/${projectId}/databases/(default):exportDocuments`,
    { method: 'POST', body: { outputUriPrefix: uri } });
  if (!operation.name?.startsWith(`projects/${projectId}/databases/(default)/operations/`)) {
    throw new Error('Firestore did not return a backup operation for the selected project.');
  }
  for (let attempt = 0; attempt < 360; attempt++) {
    const status = await firebaseRequest(credential, `firestore.googleapis.com/v1/${operation.name}`);
    if (status.done) {
      if (status.error) throw new Error(status.error.message || 'Firestore backup export failed.');
      console.log(`Backup export completed: ${status.response?.outputUriPrefix || uri}`);
      return;
    }
    await sleep(5000);
  }
  throw new Error('Firestore backup has not completed after 30 minutes. The reset has not started. Check the export operation.');
}

async function installRules(credential, projectId, fileName) {
  console.log(`Installing ${fileName} for ${projectId}…`);
  const content = await readFile(join(ROOT, fileName), 'utf8');
  const ruleset = await firebaseRequest(credential,
    `firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
    { method: 'POST', body: { source: { files: [{ name: 'firestore.rules', content }] } } });
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const token = await credential.getAccessToken();
  const releaseResponse = await fetch(`https://firebaserules.googleapis.com/v1/${releaseName}`, {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(60_000),
  });
  if (releaseResponse.status !== 404 && !releaseResponse.ok) {
    throw new Error(`Could not inspect the Firestore rules release (${releaseResponse.status}).`);
  }
  const path = releaseResponse.status === 404
    ? `firebaserules.googleapis.com/v1/projects/${projectId}/releases`
    : `firebaserules.googleapis.com/v1/${releaseName}`;
  await firebaseRequest(credential, path, releaseResponse.status === 404
    ? { method: 'POST', body: { name: releaseName, rulesetName: ruleset.name } }
    : { method: 'PATCH', body: { release: { name: releaseName, rulesetName: ruleset.name }, updateMask: 'rulesetName' } });
  console.log('Verifying the published release and waiting for rule propagation (60 seconds)…');
  await waitForRulesRelease({ rulesetName: ruleset.name, sleep,
    readRelease: () => firebaseRequest(credential, `firebaserules.googleapis.com/v1/${releaseName}`) });
}

async function main() {
  const flags = argsFor(process.argv.slice(2));
  const projectId = flags.get('--project');
  const credentialsPath = resolve(flags.get('--credentials'));
  const serviceAccount = JSON.parse(await readFile(credentialsPath, 'utf8'));
  if (serviceAccount.project_id !== projectId) throw new Error('The Admin key project does not match --project.');
  const credential = cert(serviceAccount);
  const app = initializeApp({ credential, projectId }, 'maymay-reset-tool');
  const db = getFirestore(app);
  const execute = Boolean(flags.get('--execute'));
  const backupFile = flags.has('--backup-file') ? validateBackupFile(flags.get('--backup-file'), ROOT) : undefined;
  if (execute) {
    // Compile both rule sets before entering maintenance or deleting anything.
    for (const fileName of ['firebase.maintenance.rules', 'firebase.rules']) {
      await firebaseRequest(credential, `firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`,
        { method: 'POST', body: { source: { files: [{ name: 'firestore.rules', content: await readFile(join(ROOT, fileName), 'utf8') }] } } });
    }
  }
  const result = await runControlledReset({ projectId, db, execute,
    confirmProject: flags.get('--confirm-project'), confirmPlan: flags.get('--confirm-plan'),
    backupUri: flags.get('--backup-uri'), backupFile,
    operations: {
      backup: async destination => {
        if (!backupFile) return backupFirestore(credential, projectId, destination);
        const result = await writeLocalBackup({ projectId, db, path: backupFile,
          request: (path, options) => firebaseRequest(credential, path, options) });
        console.log(`Verified local backup: ${result.documentCount} documents; SHA-256 ${result.checksum}`);
      },
      maintenanceRules: () => installRules(credential, projectId, 'firebase.maintenance.rules'),
      finalRules: () => installRules(credential, projectId, 'firebase.rules'),
    },
    report: plan => {
      console.log(`Project: ${plan.projectId}`);
      console.log(`Mode: ${plan.execute ? 'EXECUTE' : 'DRY RUN (read-only)'}`);
      console.log(`Delete collection roots, including all descendants: ${plan.collectionRoots.join(', ')}`);
      console.log(`Delete document roots, including all descendants: ${plan.documentRoots.join(', ')}`);
      console.log(`Preserve: ${plan.preserved.join(', ')}`);
      console.log(`Other root collections, excluded from deletion: ${plan.otherRootCollections.join(', ') || '(none)'}`);
      console.log(`Current affected documents (${plan.affectedDocuments.length}):`);
      for (const path of plan.affectedDocuments) console.log(`  ${path}`);
      console.log(`Plan SHA-256: ${plan.planHash}`);
    } });
  if (result.executed) {
    console.log(`MayMay 1.0 activated with generation ${result.generation}. Restart the prepared host and refresh caregiver devices.`);
  } else {
    console.log('No data or rules were changed. Review the inventory before any authorized production run.');
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
