/**
 * Feature flags from env (09b A.5.6). Screens must import from here — never
 * read `import.meta.env` directly for product flags.
 */
export const featureFlags = {
  /** Global Search / Command Palette — backend not ready (B.7). */
  globalSearch: import.meta.env.VITE_ENABLE_GLOBAL_SEARCH === 'true',
  /**
   * Google OAuth (07 Q-AUTH-G*, 09b B.1b). Shipped + activated — default ON in `.env.example`.
   * When false: GoogleButton shows info only — never fake JWT.
   */
  googleAuth: import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true',
  /**
   * QA Override (06b §6.1). Shipped — FE modal + BE endpoint; default ON in `.env.example`.
   * When false: Override button hidden — never fake success.
   */
  qaOverride: import.meta.env.VITE_ENABLE_QA_OVERRIDE === 'true',
  /**
   * CT5.4b Narrative Review UI. Must be enabled only when the backend
   * NARRATIVE_REVIEW_AI_ENABLED gate is enabled for the same deployment.
   */
  narrativeReviewAi: import.meta.env.VITE_ENABLE_NARRATIVE_REVIEW_AI !== 'false',
} as const

export const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '')

export const defaultLanguage = (import.meta.env.VITE_DEFAULT_LANGUAGE === 'vi' ? 'vi' : 'en') as
  | 'en'
  | 'vi'
