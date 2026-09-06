import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { homedir, networkInterfaces } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import multicastDns from 'multicast-dns';

const PROJECT_ID = 'maymaydata-a6fda';
const FAMILY_ID = 'maymay';
const CHILD_ID = 'maymay';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FILE = join(ROOT, 'public', 'maymay-runtime.json');
const INSTALLED_CREDENTIALS = join(ROOT, 'config', 'firebase-admin.json');
const STATIC_ROOT = join(ROOT, 'dist', 'client');
const VINEXT_CLI = join(ROOT, 'node_modules', 'vinext', 'dist', 'cli.js');
const TERMINAL_THEME = '\u001B[40m\u001B[96m';
const TERMINAL_RESET = '\u001B[0m';

function plainTerminalText(value) {
  return String(value)
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function writeTerminal(value) {
  process.stdout.write(`${TERMINAL_THEME}${plainTerminalText(value)}`);
}

function writeServerIssues(value) {
  const lines = plainTerminalText(value).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    if (/error|failed|warning/i.test(line)) writeTerminal(`[web] ${line}\n`);
  }
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function findCredentials() {
  const explicit = valueAfter('--credentials') || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit) {
    await access(resolve(explicit));
    return resolve(explicit);
  }

  try {
    await access(INSTALLED_CREDENTIALS);
    return INSTALLED_CREDENTIALS;
  } catch {
    // Portable/development installs can continue to use the Downloads folder.
  }

  const downloads = join(homedir(), 'Downloads');
  const matches = (await readdir(downloads))
    .filter((name) => name.startsWith(`${PROJECT_ID}-firebase-adminsdk-`) && name.endsWith('.json'))
    .sort();
  if (matches.length === 0) {
    throw new Error(
      `No ${PROJECT_ID} Admin key was found in Downloads. Start with --credentials "C:\\path\\to\\key.json".`,
    );
  }
  return join(downloads, matches.at(-1));
}

function localIPv4Addresses() {
  const addresses = Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => entry.family === 'IPv4' && !entry.internal)
        .map((entry) => ({ name, address: entry.address })),
    );
  const physical = addresses.filter(
    ({ name, address }) =>
      !/virtual|vethernet|wsl|docker|loopback|bluetooth|vmware|hyper-v/i.test(name) &&
      !address.startsWith('169.254.'),
  );
  return [...new Set((physical.length ? physical : addresses).map(({ address }) => address))];
}

function localAddresses() {
  return localIPv4Addresses().map((address) => `http://${address}:3000/`);
}

function startFriendlyName(addresses) {
  if (addresses.length === 0) return null;
  const responder = multicastDns();
  const answers = addresses.map((address) => ({
    name: 'maymay.local',
    type: 'A',
    class: 'IN',
    ttl: 120,
    data: address,
  }));
  responder.on('query', (packet) => {
    const requested = packet.questions?.some(
      (question) =>
        question.name?.toLowerCase() === 'maymay.local' &&
        (question.type === 'A' || question.type === 'ANY'),
    );
    if (requested) responder.respond({ answers });
  });
  responder.on('error', (error) => {
    writeTerminal(`[local address] ${error.message}\n`);
  });
  responder.respond({ answers });
  return responder;
}

function startFriendlyProxy() {
  const proxy = createServer((incoming, outgoing) => {
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: 3000,
        method: incoming.method,
        path: incoming.url,
        headers: { ...incoming.headers, host: '127.0.0.1:3000' },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'Content-Type': 'text/plain' });
      outgoing.end('MayMay is still starting. Refresh in a moment.');
    });
    incoming.pipe(upstream);
  });

  return new Promise((resolvePromise) => {
    const onStartupError = (error) => {
      writeTerminal(`[local address] Port 80 is unavailable (${error.code ?? error.message}).\n`);
      resolvePromise(null);
    };
    proxy.once('error', onStartupError);
    proxy.listen(80, '0.0.0.0', () => {
      proxy.off('error', onStartupError);
      proxy.on('error', (error) => writeTerminal(`[local address] ${error.message}\n`));
      resolvePromise(proxy);
    });
  });
}

function stopFriendlyProxy(proxy) {
  if (!proxy?.listening) return Promise.resolve();
  return new Promise((resolvePromise) => proxy.close(resolvePromise));
}

async function fetchRuntimeConfig(credential, projectId) {
  const token = await credential.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
  };
  const appsResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/webApps?pageSize=100`,
    { headers },
  );
  if (!appsResponse.ok) {
    throw new Error(`Firebase Web app lookup failed (${appsResponse.status}).`);
  }
  const appsPayload = await appsResponse.json();
  const apps = Array.isArray(appsPayload.apps) ? appsPayload.apps : [];
  let webApp =
    apps.find((app) => app.displayName?.toLowerCase() === 'maymay' && app.state !== 'DELETED') ||
    apps.find((app) => app.state !== 'DELETED');
  if (!webApp?.name) {
    console.log('No Firebase Web app found; creating MayMay…');
    const createResponse = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/webApps`,
      { method: 'POST', headers, body: JSON.stringify({ displayName: 'MayMay' }) },
    );
    if (!createResponse.ok) {
      throw new Error(`Firebase Web app creation failed (${createResponse.status}).`);
    }
    let operation = await createResponse.json();
    for (let attempt = 0; !operation.done && attempt < 30; attempt += 1) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
      const operationResponse = await fetch(
        `https://firebase.googleapis.com/v1beta1/${operation.name}`,
        { headers },
      );
      if (!operationResponse.ok) {
        throw new Error(`Firebase Web app status check failed (${operationResponse.status}).`);
      }
      operation = await operationResponse.json();
    }
    if (operation.error) {
      throw new Error(operation.error.message || 'Firebase Web app creation failed.');
    }
    if (!operation.done) {
      throw new Error('Firebase Web app creation is still pending. Run the host again in a minute.');
    }
    webApp = operation.response;
    if (!webApp?.name) {
      const refreshedResponse = await fetch(
        `https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/webApps?pageSize=100`,
        { headers },
      );
      const refreshedPayload = refreshedResponse.ok ? await refreshedResponse.json() : {};
      webApp = refreshedPayload.apps?.find((app) => app.state !== 'DELETED');
    }
    if (!webApp?.name) throw new Error('Firebase created the Web app, but it is not ready yet. Run the host again.');
  }

  const configResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/${webApp.name}/config`,
    { headers },
  );
  if (!configResponse.ok) {
    throw new Error(`Firebase Web configuration lookup failed (${configResponse.status}).`);
  }
  const firebase = await configResponse.json();
  if (!firebase.apiKey || !firebase.authDomain || !firebase.projectId || !firebase.appId) {
    throw new Error('Firebase returned an incomplete Web configuration.');
  }
  return {
    firebase: {
      apiKey: firebase.apiKey,
      authDomain: firebase.authDomain,
      projectId: firebase.projectId,
      appId: firebase.appId,
      ...(firebase.storageBucket ? { storageBucket: firebase.storageBucket } : {}),
      ...(firebase.messagingSenderId ? { messagingSenderId: firebase.messagingSenderId } : {}),
    },
    familyId: FAMILY_ID,
    childId: CHILD_ID,
  };
}

async function writeRuntimeConfig(runtimeConfig) {
  const temporary = `${RUNTIME_FILE}.tmp`;
  await writeFile(temporary, `${JSON.stringify(runtimeConfig, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, RUNTIME_FILE);
}

async function deployFirestoreRules(credential, projectId) {
  const token = await credential.getAccessToken();
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Content-Type': 'application/json',
  };
  const content = await readFile(join(ROOT, 'firebase.rules'), 'utf8');
  const rulesetResponse = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/rulesets`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content }] } }),
    },
  );
  if (!rulesetResponse.ok) {
    const payload = await rulesetResponse.json().catch(() => ({}));
    throw new Error(payload.error?.message || `Firestore rules validation failed (${rulesetResponse.status}).`);
  }
  const ruleset = await rulesetResponse.json();
  const releaseName = `projects/${projectId}/releases/cloud.firestore`;
  const releaseUrl = `https://firebaserules.googleapis.com/v1/${releaseName}`;
  const currentRelease = await fetch(releaseUrl, { headers });
  const releaseResponse = currentRelease.status === 404
    ? await fetch(`https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/releases`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: releaseName, rulesetName: ruleset.name }),
      })
    : await fetch(releaseUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          release: { name: releaseName, rulesetName: ruleset.name },
          updateMask: 'rulesetName',
        }),
      });
  if (!releaseResponse.ok) {
    const payload = await releaseResponse.json().catch(() => ({}));
    throw new Error(payload.error?.message || `Firestore rules release failed (${releaseResponse.status}).`);
  }
  return ruleset.name;
}

function runProvision(credentialsPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [join(ROOT, 'scripts', 'provision-firestore.mjs'), '--credentials', credentialsPath],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    child.stdout.on('data', writeTerminal);
    child.stderr.on('data', writeTerminal);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Database provisioning exited with code ${code}.`));
    });
  });
}

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function contentType(path) {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

async function staticFileFor(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl || '/', 'http://maymay.local').pathname);
  if (pathname === '/maymay-runtime.json') return RUNTIME_FILE;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(STATIC_ROOT, relative);
  if (candidate !== STATIC_ROOT && !candidate.startsWith(`${STATIC_ROOT}\\`)) return null;
  try {
    const details = await stat(candidate);
    if (details.isFile()) return candidate;
  } catch {
    // Client-side routes fall back to the exported app shell.
  }
  return join(STATIC_ROOT, 'index.html');
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const file = await staticFileFor(request.url);
      if (!file) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Invalid request.');
        return;
      }
      const details = await stat(file);
      response.writeHead(200, {
        'Content-Type': contentType(file),
        'Content-Length': details.size,
        'Cache-Control': file.endsWith('index.html') || file === RUNTIME_FILE
          ? 'no-store'
          : 'public, max-age=31536000, immutable',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found.');
    }
  });
  server.exitCode = null;
  server.on('close', () => { server.exitCode = 0; });
  server.on('error', (error) => writeTerminal(`[web] ${error.message}\n`));
  server.listen(3000, '0.0.0.0');
  return server;
}

function startDevelopmentServer() {
  const child = spawn(
    process.execPath,
    [VINEXT_CLI, 'dev', '--hostname', '0.0.0.0'],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    },
  );
  child.stdout.on('data', writeServerIssues);
  child.stderr.on('data', writeServerIssues);
  child.once('exit', (code) => {
    if (code && code !== 0) console.error(`\nWeb server stopped with code ${code}.`);
  });
  return child;
}

async function startServer() {
  try {
    await access(join(STATIC_ROOT, 'index.html'));
    return startStaticServer();
  } catch {
    return startDevelopmentServer();
  }
}

async function stopServer(server) {
  if (!server || server.exitCode !== null) return;
  if (typeof server.close === 'function') {
    await new Promise((resolvePromise) => server.close(resolvePromise));
    return;
  }
  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      server.kill('SIGKILL');
      resolvePromise();
    }, 4000);
    server.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
    server.kill('SIGINT');
  });
}

function showMenu() {
  console.log('\nHost commands');
  console.log('  status                  Check the database and web server');
  console.log('  users                   List Authentication users and MayMay roles');
  console.log('  master EMAIL_OR_UID     Assign the Master role');
  console.log('  caregiver EMAIL_OR_UID  Approve a caregiver account');
  console.log('  viewer EMAIL_OR_UID     Assign the read-only Viewer role');
  console.log('  disable EMAIL_OR_UID    Disable MayMay access for a profile');
  console.log('  provision               Re-run schema and security-rule provisioning');
  console.log('  restart                 Restart the web server');
  console.log('  help                    Show these commands');
  console.log('  quit                    Stop MayMay\n');
}

function authUserFor(identifier) {
  return identifier.includes('@') ? auth.getUserByEmail(identifier) : auth.getUser(identifier);
}

const credentialsPath = await findCredentials();
const serviceAccount = JSON.parse(await readFile(credentialsPath, 'utf8'));
if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`The selected Admin key belongs to ${serviceAccount.project_id}, not ${PROJECT_ID}.`);
}
const credential = cert(serviceAccount);
const adminApp =
  getApps().find((app) => app.name === 'maymay-host') ||
  initializeApp({ credential, projectId: PROJECT_ID }, 'maymay-host');
const auth = getAuth(adminApp);
const db = getFirestore(adminApp);

process.title = 'MayMay Host';
if (process.stdout.isTTY) writeTerminal('\u001B[2J\u001B[H');
console.log('MayMay Host');
console.log(`Project: ${PROJECT_ID}`);
console.log(`Admin key: ${basename(credentialsPath)} (host only)`);
console.log('Preparing Firestore…');
await runProvision(credentialsPath);
console.log('Validating and publishing Firestore security rules…');
await deployFirestoreRules(credential, PROJECT_ID);
console.log('Loading Firebase Web configuration…');
await writeRuntimeConfig(await fetchRuntimeConfig(credential, PROJECT_ID));
console.log('Runtime configuration ready. The Admin key was not copied or served.');

let server = await startServer();
const friendlyProxy = await startFriendlyProxy();
const friendlyPort = friendlyProxy ? 80 : 3000;
const friendlyName = startFriendlyName(localIPv4Addresses());
console.log('\nCaregiver addresses');
console.log(`  http://maymay.local${friendlyPort === 80 ? '' : ':3000'}/  (preferred)`);
console.log('  http://localhost:3000/');
for (const address of localAddresses()) console.log(`  ${address}`);
showMenu();

const terminal = createInterface({ input: process.stdin, output: process.stdout });
terminal.setPrompt('maymay> ');
terminal.prompt();

let handling = false;
terminal.on('line', async (line) => {
  if (handling) return terminal.prompt();
  handling = true;
  const [command = '', identifier = ''] = line.trim().split(/\s+/, 2);
  try {
    if (command === 'status') {
      const schema = await db.doc('system/schema').get();
      console.log(`Database: ${schema.exists ? 'ready' : 'schema missing'}`);
      console.log(`Web server: ${server.exitCode === null ? 'running' : 'stopped'}`);
      console.log(`Friendly address: http://maymay.local${friendlyPort === 80 ? '' : ':3000'}/`);
    } else if (command === 'users') {
      const result = await auth.listUsers(1000);
      const profiles = await db.getAll(...result.users.map((user) => db.doc(`users/${user.uid}`)));
      if (result.users.length === 0) console.log('No Authentication users found.');
      for (const [index, user] of result.users.entries()) {
        const profile = profiles[index].data();
        console.log(`${user.email ?? '(no email)'} | ${user.uid} | ${profile?.role ?? 'unassigned'} | ${profile?.active === true ? 'active' : 'inactive'}`);
      }
    } else if (['master', 'caregiver', 'viewer'].includes(command)) {
      if (!identifier) throw new Error(`Use: ${command} EMAIL_OR_UID`);
      const user = await authUserFor(identifier);
      const profileRef = db.doc(`users/${user.uid}`);
      const existing = await profileRef.get();
      await profileRef.set(
        {
          schemaVersion: 1,
          familyId: FAMILY_ID,
          role: command,
          displayName: existing.data()?.displayName || user.displayName || user.email?.split('@')[0] || command,
          active: true,
          updatedAt: FieldValue.serverTimestamp(),
          ...(!existing.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
        },
        { merge: true },
      );
      console.log(`${user.email ?? user.uid} is now an active ${command}.`);
    } else if (command === 'disable') {
      if (!identifier) throw new Error('Use: disable EMAIL_OR_UID');
      const user = await authUserFor(identifier);
      const profileRef = db.doc(`users/${user.uid}`);
      if (!(await profileRef.get()).exists) throw new Error('That user has no MayMay profile.');
      await profileRef.set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      console.log(`MayMay access disabled for ${user.email ?? user.uid}.`);
    } else if (command === 'provision') {
      await runProvision(credentialsPath);
      await deployFirestoreRules(credential, PROJECT_ID);
      console.log('Firestore schema and security rules are current.');
    } else if (command === 'restart') {
      await stopServer(server);
      server = await startServer();
      console.log('Web server restarted.');
    } else if (command === 'help' || command === '') {
      showMenu();
    } else if (command === 'quit' || command === 'exit') {
      terminal.close();
      return;
    } else {
      console.log('Unknown command. Type help.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    handling = false;
    if (!terminal.closed) terminal.prompt();
  }
});

terminal.on('close', async () => {
  console.log('\nStopping MayMay…');
  await stopServer(server);
  await stopFriendlyProxy(friendlyProxy);
  friendlyName?.destroy();
  process.stdout.write(TERMINAL_RESET);
  process.exit(0);
});
