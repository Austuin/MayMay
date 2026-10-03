export function existingWebApp(apps) {
  const app = apps.find(item => item.displayName?.toLowerCase() === 'maymay' && item.state !== 'DELETED')
    || apps.find(item => item.state !== 'DELETED');
  if (!app?.name) throw new Error('No Firebase Web app is configured for this project. Complete host setup before starting MayMay.');
  return app;
}

export function activationState(snapshot) {
  const value = snapshot.data();
  return snapshot.exists && value?.schemaVersion === 1 && typeof value.generation === 'string' && value.generation
    ? 'active' : 'setup/maintenance';
}

export function verifyWebConfigProject(config, projectId) {
  if (config.projectId !== projectId) {
    throw new Error('Firebase Web configuration belongs to a different project. Host startup stopped.');
  }
  return config;
}
