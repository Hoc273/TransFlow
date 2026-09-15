/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_DEFAULT_LANGUAGE?: string
  readonly VITE_ENABLE_GLOBAL_SEARCH?: string
  /** Google OAuth — shipped; default true in `.env.example` (docs/07 Q-AUTH-G7). */
  readonly VITE_ENABLE_GOOGLE_AUTH?: string
  /** QA Override modal — shipped; default true in `.env.example` (docs/06b §6.1). */
  readonly VITE_ENABLE_QA_OVERRIDE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
