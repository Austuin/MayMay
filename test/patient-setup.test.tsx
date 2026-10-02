import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PatientForm } from '@/app/patient-form';

afterEach(() => { cleanup(); localStorage.clear(); });

it('creates a patient with only a name and clears the completed form', async () => {
  const save = vi.fn(async () => undefined);
  render(<PatientForm action="Add patient" onSave={save} resetOnSave />);
  expect(screen.getByText('Add optional details').closest('details')?.open).toBe(false);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Sam ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Sam' }));
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
});

it('saves every optional field, calculates age, and clears all inputs after saving', async () => {
  const save = vi.fn(async () => undefined);
  render(<PatientForm action="Add patient" onSave={save} resetOnSave />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } });
  fireEvent.click(screen.getByText('Add optional details'));
  for (const [label, value] of [
    ['Birthdate', '2018-01-02'], ['Sex', 'Prefer not to say'], ['Ethnicity', 'Example'],
    ['Autism support level', 'Level 2'], ['Communication and support needs', 'Allow extra response time'],
  ]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  expect(screen.getByText(/^Age: \d+/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ name: 'Sam', birthdate: '2018-01-02', sex: 'Prefer not to say', ethnicity: 'Example', autismLevel: 'Level 2', supportNeeds: 'Allow extra response time' }));
  for (const label of ['Name', 'Birthdate', 'Sex', 'Ethnicity', 'Autism support level', 'Communication and support needs']) {
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  }
  expect(screen.queryByText(/^Age:/)).toBeNull();
});

it('keeps patient details available for retry when saving fails', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Connection unavailable')).mockResolvedValueOnce(undefined);
  render(<PatientForm action="Add patient" onSave={save} resetOnSave />);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sam' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Sam');
  fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
  await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(''));
});
