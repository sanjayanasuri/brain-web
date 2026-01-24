'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start with 'light' to match server-side rendering
  // This prevents hydration mismatches
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
  const hasInitialized = useRef(false);

  // After hydration, read from localStorage and apply
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('brain-web-theme') as Theme | null;
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme);
      // Apply immediately
      if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      hasInitialized.current = true;
    } else {
      // No saved theme, use default 'light'
      document.documentElement.classList.remove('dark');
      hasInitialized.current = true;
    }
  }, []);

  // Apply theme to document when theme changes (after initial mount)
  useEffect(() => {
    if (hasInitialized.current && mounted) {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('brain-web-theme', theme);
    }
  }, [theme, mounted]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Always wrap children in Provider, even before mounting
  // This prevents the "must be used within ThemeProvider" error
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

