import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrackerPreview from './fixtures/tracker-preview';

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 7, 12)); });
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

function openManage() {
  fireEvent.click(screen.getByLabelText('Tracker options'));
  fireEvent.click(screen.getByRole('button', { name: 'Manage trackers' }));
}

describe('tracker UI preview with isolated mock data', () => {
  it('starts with three unanswered examples and keeps No distinct from Unanswered', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    expect(screen.getByText('0 of 3 answered')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Morning Mood mood'), {
      target: { value: 'Good' },
    });
    fireEvent.click(screen.getByLabelText('Increase Bowel Movements'));
    fireEvent.change(screen.getByLabelText('Bowel Movements count'), { target: { value: '0' } });
    expect((screen.getByLabelText('Bowel Movements count') as HTMLInputElement).value).toBe('0');
    const schoolCard = screen
      .getByText('Went to School on Time')
      .closest('article')!;
    fireEvent.click(within(schoolCard).getByRole('button', { name: 'No' }));
    expect(screen.getByText('3 of 3 answered')).toBeTruthy();
    expect(
      within(schoolCard)
        .getByRole('button', { name: 'No' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(
      within(schoolCard).getByRole('button', { name: 'Clear answer' }),
    );
    expect(screen.getByText('2 of 3 answered')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Entry date'), {
      target: { value: '2026-10-03' },
    });
    expect(screen.getByText('0 of 2 answered')).toBeTruthy();
    expect(screen.queryByText('Went to School on Time')).toBeNull();
    fireEvent.change(screen.getByLabelText('Entry date'), {
      target: { value: '2026-10-01' },
    });
    expect(screen.getByText('2 of 3 answered')).toBeTruthy();
  });

  it('creates, edits, and deletes a tracker through management, with confirmation', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'Add tracker' }));
    fireEvent.click(screen.getByRole('radio', { name: /Good event/ }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Ate Breakfast' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Did they eat breakfast this morning?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracker' }));
    expect(screen.getByText('Ate Breakfast')).toBeTruthy();
    let createdCard = screen.getByText('Ate Breakfast').closest('article')!;
    fireEvent.click(within(createdCard).getByRole('button', { name: 'Edit' }));
    expect(
      screen
        .getByRole('radio', { name: 'Good event' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Breakfast eaten' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracker' }));
    expect(screen.queryByText('Ate Breakfast')).toBeNull();
    createdCard = screen.getByText('Breakfast eaten').closest('article')!;
    fireEvent.click(
      within(createdCard).getByRole('button', {
        name: 'Delete Breakfast eaten',
      }),
    );
    expect(screen.getByText(/Existing answers remain in history/)).toBeTruthy();
    fireEvent.click(
      within(createdCard).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.getByText('Breakfast eaten')).toBeTruthy();
    fireEvent.click(
      within(createdCard).getByRole('button', {
        name: 'Delete Breakfast eaten',
      }),
    );
    fireEvent.click(
      within(createdCard).getByRole('button', { name: 'Delete tracker' }),
    );
    expect(screen.queryByText('Breakfast eaten')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to check-in' }));
    expect(screen.getByText('0 of 3 answered')).toBeTruthy();
  });

  it('lets a caregiver delete any of the three starting examples', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    openManage();
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Morning Mood' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete tracker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to check-in' }));
    expect(screen.queryByText('Morning Mood')).toBeNull();
    expect(screen.getByText('0 of 2 answered')).toBeTruthy();
  });

  it('shows a new tracker only on its chosen days', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    openManage();
    fireEvent.click(screen.getByRole('button', { name: 'Add tracker' }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Therapy Day' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Was there a therapy session today?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose days' }));
    for (const day of ['Mon', 'Tue', 'Wed', 'Fri'])
      fireEvent.click(screen.getByLabelText(day));
    fireEvent.click(screen.getByRole('button', { name: 'Save tracker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to check-in' }));
    expect(screen.getByText('Therapy Day')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Entry date'), {
      target: { value: '2026-10-02' },
    });
    expect(screen.queryByText('Therapy Day')).toBeNull();
  });

  it('quickly logs an unexpected event, removes it, and offers Undo', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add spontaneous event' }));
    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'Loud assembly' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(screen.getByText('Loud assembly')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Loud assembly' }),
    );
    expect(screen.queryByText('Loud assembly')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Loud assembly')).toBeTruthy();
  });

  it('suggests making a repeated unexpected event a regular tracker', () => {
    render(<TrackerPreview />);
    fireEvent.change(screen.getByLabelText('Entry date'), { target: { value: '2026-10-01' } });
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Add spontaneous event' }));
      fireEvent.change(screen.getByLabelText('What happened?'), {
        target: { value: 'Calm bedtime' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    }
    expect(screen.getByText(/has been logged four times/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make a tracker' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Calm bedtime',
    );
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Did bedtime feel calm?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tracker' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to check-in' }));
    expect(screen.getByText('Calm bedtime', { selector: 'h3' })).toBeTruthy();
    expect(screen.queryByText(/has been logged four times/)).toBeNull();
  });
});
