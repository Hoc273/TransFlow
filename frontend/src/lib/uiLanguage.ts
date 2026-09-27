/** UI languages the web app ships translations for. */
export type Language = 'en' | 'vi' | 'ko'

export const SUPPORTED_LANGUAGES: readonly Language[] = ['en', 'vi', 'ko']

/** Maps any BCP-47 tag ("ko-KR", "vi", …) to a supported UI language, else `fallback`. */
export function normalizeLanguage(raw: unknown, fallback: Language = 'en'): Language {
  const primary = typeof raw === 'string' ? raw.toLowerCase().split(/[-_]/)[0] : ''
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(primary) ? (primary as Language) : fallback
}
