import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomePage from '@/app/page';
import { createMeltdown, createPossibleTrigger, localDateValue, type DailyEntry } from '@/lib/maymay-types';

const firebaseMocks = vi.hoisted(() => {
  const connection = {
    app: {},
    db: {},
    childId: 'maymay',
    user: {
      uid: 'caregiver-test',
      email: 'caregiver@example.test',
      displayName: 'Test Caregiver',
    },
    profile: {
      familyId: 'maymay',
      role: 'caregiver',
      active: true,
      displayName: 'Test Caregiver',
      email: 'caregiver@example.test',
    },
  };

  return {
    connection,
    pushEntry: vi.fn(async () => undefined),
    registerFirebaseAccount: vi.fn(async () => ({ uid: 'new-test-user', email: 'new@example.test' })),
    restoreFirebase: vi.fn(async () => connection),
  };
});

vi.mock('@/lib/maymay-firebase', () => ({
  assignFamilyRole: vi.fn(async () => undefined),
  connectFirebase: vi.fn(async () => firebaseMocks.connection),
  connectFirebaseWithGoogle: vi.fn(async () => firebaseMocks.connection),
  disconnectFirebase: vi.fn(async () => undefined),
  listFamilyUsers: vi.fn(async () => []),
  loadRuntimeConfig: vi.fn(async () => ({
    firebase: {
      apiKey: 'test-api-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      appId: 'test-app-id',
    },
    familyId: 'maymay',
    childId: 'maymay',
  })),
  pullRemoteEntries: vi.fn(async () => []),
  pushEntry: firebaseMocks.pushEntry,
  registerFirebaseAccount: firebaseMocks.registerFirebaseAccount,
  restoreFirebase: firebaseMocks.restoreFirebase,
}));

const ENTRY_KEY = 'maymay.entries.v3';
const secureContextCrypto = globalThis.crypto;

function savedEntry(date: string) {
  const entries = JSON.parse(localStorage.getItem(ENTRY_KEY) ?? '[]') as DailyEntry[];
  return entries.find((entry) => entry.date === date);
}

async function chooseSelect(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

function cardForHeading(name: string) {
  const heading = screen.getByText(name, { exact: true });
  const card = heading.closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error(`Card not found for ${name}`);
  return card;
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      randomUUID: () => {
        throw new DOMException('Not available in an insecure context', 'SecurityError');
      },
      getRandomValues: secureContextCrypto.getRandomValues.bind(secureContextCrypto),
    },
  });
  firebaseMocks.pushEntry.mockClear();
  firebaseMocks.registerFirebaseAccount.mockClear();
  firebaseMocks.restoreFirebase.mockResolvedValue(firebaseMocks.connection);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: secureContextCrypto });
});

describe('MayMay daily input coverage', () => {
  it('creates event IDs when Web Crypto is completely unavailable', () => {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });

    expect(createPossibleTrigger().id).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
    expect(createMeltdown().id).toMatch(/^local-[a-z0-9]+-[a-z0-9]+$/);
  });

  it('creates event IDs when randomUUID is unavailable on an HTTP LAN address', () => {
    const trigger = createPossibleTrigger();
    const meltdown = createMeltdown();

    expect(trigger.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(meltdown.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(meltdown.id).not.toBe(trigger.id);
  });

  it('enters, saves, verifies, removes, and cleans up every daily tracking input', async () => {
    const user = userEvent.setup();
    const yesterday = new Date(`${localDateValue()}T12:00:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    const date = localDateValue(yesterday);
    render(<HomePage />);

    await screen.findByText("Today's check-in");
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: date } });
    await screen.findByText('Past-day entry');

    for (const period of ['morning', 'afternoon', 'evening'] as const) {
      await user.click(within(screen.getByRole('group', { name: `${period} mood` })).getByRole('button', { name: 'Good' }));
      await user.click(within(screen.getByRole('group', { name: `${period} mood details` })).getByRole('button', { name: 'Calm' }));
    }

    await user.click(within(screen.getByRole('group', { name: 'School attendance' })).getByRole('button', { name: 'Stayed home' }));
    await user.type(screen.getByLabelText(/Reason or context/), 'Test appointment');
    fireEvent.change(screen.getByLabelText(/Fell asleep/), { target: { value: '21:15' } });
    fireEvent.change(screen.getByLabelText(/Woke up/), { target: { value: '06:45' } });
    await user.type(screen.getByLabelText(/Wake-ups/), '2');
    await user.click(within(screen.getByRole('group', { name: 'Sleep quality from 1 to 5' })).getByRole('button', { name: /^4/ }));

    await chooseSelect(user, 'How is his health today?', 'A little unwell');
    await user.type(screen.getByLabelText(/Health context/), 'Test sniffles');
    await chooseSelect(user, 'Breakfast', 'Ate well');
    await chooseSelect(user, 'Lunch', 'Ate some');
    await chooseSelect(user, 'Dinner', 'Very little');
    await chooseSelect(user, 'Snacks', 'Refused');

    await user.click(within(screen.getByRole('group', { name: 'Bowel movement' })).getByRole('button', { name: 'Yes' }));
    await user.type(screen.getByLabelText(/How many?/), '1');

    const melatonin = screen.getByText('Melatonin').closest('.medication-panel');
    const fluoxetine = screen.getByText('Fluoxetine').closest('.medication-panel');
    if (!(melatonin instanceof HTMLElement) || !(fluoxetine instanceof HTMLElement)) throw new Error('Medication panels not found');
    await user.click(within(melatonin).getByRole('button', { name: 'Given' }));
    await user.type(within(melatonin).getByLabelText('Amount'), '5 mg');
    fireEvent.change(within(melatonin).getByLabelText('Time'), { target: { value: '20:30' } });
    await user.click(within(fluoxetine).getByRole('button', { name: 'Given' }));
    await user.type(within(fluoxetine).getByLabelText('Amount'), '10 mg');
    fireEvent.change(within(fluoxetine).getByLabelText('Time'), { target: { value: '07:30' } });

    const triggerCard = cardForHeading('Possible triggers & changes');
    await user.click(within(triggerCard).getByRole('button', { name: 'Add' }));
    const triggerEvent = await screen.findByText('Possible trigger or change 1');
    const triggerPanel = triggerEvent.closest('.trigger-card');
    if (!(triggerPanel instanceof HTMLElement)) throw new Error('Possible trigger panel not found');
    fireEvent.change(within(triggerPanel).getByLabelText(/Time/), { target: { value: '11:20' } });
    await chooseSelect(user, 'Category', 'Other');
    await user.type(within(triggerPanel).getByLabelText('Other category'), 'Test transition');
    await chooseSelect(user, 'Observed effect', 'Moderate stress');
    await user.type(within(triggerPanel).getByLabelText(/Brief context/), 'Test context');

    const meltdownCard = cardForHeading('Meltdowns');
    await user.click(within(meltdownCard).getByRole('button', { name: 'Add' }));
    const meltdownEvent = await screen.findByText('Meltdown 1');
    const meltdownPanel = meltdownEvent.closest('.meltdown-card');
    if (!(meltdownPanel instanceof HTMLElement)) throw new Error('Meltdown panel not found');
    fireEvent.change(within(meltdownPanel).getByLabelText(/Time/), { target: { value: '14:10' } });
    await chooseSelect(user, 'Duration', '5–15 min');
    await chooseSelect(user, 'Intensity', 'Moderate');
    await chooseSelect(user, 'Likely trigger', 'Other');
    await user.type(within(meltdownPanel).getByLabelText('Other trigger'), 'Test noise');
    await chooseSelect(user, 'What helped most?', 'Quiet / space');
    await user.type(within(meltdownPanel).getByLabelText(/Early signs/), 'Test pacing');
    await user.click(within(screen.getByRole('group', { name: 'Aggression or risk of harm' })).getByRole('button', { name: 'No' }));
    await user.type(within(meltdownPanel).getByLabelText(/Event notes/), 'Test event notes');
    await user.type(screen.getByPlaceholderText('Add a brief note…'), 'Test daily note');

    await waitFor(() => expect(savedEntry(date)?.possibleTriggers).toHaveLength(1), { timeout: 3_000 });
    const saved = savedEntry(date);
    expect(saved).toMatchObject({
      moods: {
        morning: { score: 4, tags: ['Calm'] },
        afternoon: { score: 4, tags: ['Calm'] },
        evening: { score: 4, tags: ['Calm'] },
      },
      schoolStatus: 'Stayed home',
      schoolNote: 'Test appointment',
      sleepStart: '21:15',
      wakeTime: '06:45',
      wakeUps: '2',
      sleepQuality: 4,
      healthStatus: 'A little unwell',
      healthNotes: 'Test sniffles',
      meals: { breakfast: 'Ate well', lunch: 'Ate some', dinner: 'Very little', snacks: 'Refused' },
      bathroom: { bowelMovement: 'Yes', count: '1' },
      medications: {
        melatonin: { status: 'Given', amount: '5 mg', time: '20:30' },
        fluoxetine: { status: 'Given', amount: '10 mg', time: '07:30' },
      },
      notes: 'Test daily note',
    });
    expect(saved?.possibleTriggers[0]).toMatchObject({
      time: '11:20',
      category: 'Other',
      categoryOther: 'Test transition',
      observedEffect: 'Moderate stress',
      notes: 'Test context',
    });
    expect(saved?.meltdowns[0]).toMatchObject({
      time: '14:10',
      duration: '5–15 min',
      intensity: 'Moderate',
      trigger: 'Other',
      triggerOther: 'Test noise',
      earlySigns: 'Test pacing',
      aggression: 'No',
      whatHelped: 'Quiet / space',
      notes: 'Test event notes',
    });
    expect(firebaseMocks.pushEntry).toHaveBeenCalled();

    await user.click(within(triggerPanel).getByRole('button', { name: 'Remove possible trigger 1' }));
    await user.click(within(meltdownPanel).getByRole('button', { name: 'Remove meltdown 1' }));
    await waitFor(() => {
      expect(savedEntry(date)?.possibleTriggers).toHaveLength(0);
      expect(savedEntry(date)?.meltdowns).toHaveLength(0);
    }, { timeout: 3_000 });

    localStorage.clear();
    expect(localStorage.getItem(ENTRY_KEY)).toBeNull();
  });
});
