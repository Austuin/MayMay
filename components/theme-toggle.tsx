'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

export const THEME_KEY = 'maymay.theme';
const ThemeContext = createContext({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const apply = (next: boolean) => {
      document.documentElement.classList.toggle('dark', next);
      setDark(next);
    };
    try { apply(localStorage.getItem(THEME_KEY) === 'dark'); } catch { apply(false); }
    const storage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      apply(event.newValue === 'dark');
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);
  function toggle() {
    const next = dark ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Keep this session's choice. */ }
    document.documentElement.classList.toggle('dark', next === 'dark');
    setDark(next === 'dark');
  }
  return <ThemeContext.Provider value={{ dark, toggle }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeContext);
  return <button type="button" className="theme-toggle" onClick={toggle}
    aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    title={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
    {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    <span>{dark ? 'Light' : 'Dark'}</span>
  </button>;
}
