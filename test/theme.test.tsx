import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, ThemeProvider, ThemeToggle } from '@/components/theme-toggle';

const show = () => render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); document.documentElement.classList.remove('dark'); });

describe('Light and Dark themes', () => {
  it('keeps Light as the default, saves Dark, restores it on reload, and saves a switch back to Light', () => {
    const first = show();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    first.unmount();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('syncs another tab’s preference and resets to Light when the saved choice is removed', () => {
    show();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' })));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'other.setting', newValue: 'light' })));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: null })));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('still switches themes when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
