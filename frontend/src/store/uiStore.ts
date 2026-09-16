import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Light / dark only — system mode removed per product request. */
export type ThemeMode = 'light' | 'dark'
export type Language = 'en' | 'vi'

interface UiState {
  theme: ThemeMode
  language: Language
  sidebarCollapsed: boolean
  setTheme: (theme: ThemeMode) => void
  cycleTheme: () => void
  setLanguage: (language: Language) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

export function getEffectiveTheme(theme: ThemeMode): 'light' | 'dark' {
  return theme
}

function normalizeTheme(raw: unknown): ThemeMode {
  if (raw === 'dark') return 'dark'
  // 'system' or anything else → light
  return 'light'
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      language: 'en',
      sidebarCollapsed: false,
      setTheme: (theme) => set({ theme: normalizeTheme(theme) }),
      cycleTheme: () => {
        const next: ThemeMode = get().theme === 'light' ? 'dark' : 'light'
        set({ theme: next })
      },
      setLanguage: (language) => set({ language }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
    }),
    {
      name: 'tf-ui',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>
        return {
          ...current,
          ...p,
          theme: normalizeTheme(p.theme),
        }
      },
    },
  ),
)

/** Apply theme class on <html>. Call after rehydrate and on theme change. */
export function applyThemeToDocument(theme: ThemeMode) {
  const effective = getEffectiveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', effective === 'dark')
  root.classList.toggle('light', effective === 'light')
  root.dataset.theme = effective
}
