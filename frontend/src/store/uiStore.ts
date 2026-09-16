import { create } from 'zustand'

export type Language = 'vi' | 'en'
export type Theme = 'light' | 'dark'

interface UiState {
  theme: Theme
  language: Language
  setTheme: (theme: Theme) => void
  cycleTheme: () => void
  setLanguage: (lang: Language) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme: (typeof window !== 'undefined' ? (localStorage.getItem('transflow_theme') as Theme) : null) || 'dark',
  language: (typeof window !== 'undefined' ? (localStorage.getItem('transflow_language') as Language) : null) || 'vi',
  setTheme: (theme: Theme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('transflow_theme', theme)
      document.documentElement.setAttribute('data-theme', theme)
    }
    set({ theme })
  },
  cycleTheme: () =>
    set((state) => {
      const nextTheme: Theme = state.theme === 'dark' ? 'light' : 'dark'
      if (typeof window !== 'undefined') {
        localStorage.setItem('transflow_theme', nextTheme)
        document.documentElement.setAttribute('data-theme', nextTheme)
      }
      return { theme: nextTheme }
    }),
  setLanguage: (language: Language) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('transflow_language', language)
    }
    set({ language })
  },
}))
