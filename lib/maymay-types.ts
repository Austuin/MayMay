export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

export const HISTORY_YEARS = 3;

export function localDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function historyCutoffDate(referenceDate = new Date()) {
  const cutoff = new Date(referenceDate);
  const targetYear = cutoff.getFullYear() - HISTORY_YEARS;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    cutoff.getMonth() + 1,
    0,
  ).getDate();
  cutoff.setFullYear(
    targetYear,
    cutoff.getMonth(),
    Math.min(cutoff.getDate(), lastDayOfTargetMonth),
  );
  return localDateValue(cutoff);
}

export function createEventId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID();
    } catch {
      // randomUUID is unavailable on some plain-HTTP LAN origins.
    }
  }

  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  }

  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
