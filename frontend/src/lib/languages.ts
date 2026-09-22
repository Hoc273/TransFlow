/** Shared language codes for project/document/TM forms. */
export const LANG_OPTIONS = [
  'en',
  'vi',
  'ja',
  'ko',
  'zh',
  'fr',
  'de',
  'es',
  'pt',
  'it',
  'th',
  'id',
] as const

export type LangCode = (typeof LANG_OPTIONS)[number]

const LANGUAGE_NAMES: Record<LangCode, { en: string; vi: string }> = {
  en: { en: 'English', vi: 'Tiếng Anh' },
  vi: { en: 'Vietnamese', vi: 'Tiếng Việt' },
  ja: { en: 'Japanese', vi: 'Tiếng Nhật' },
  ko: { en: 'Korean', vi: 'Tiếng Hàn' },
  zh: { en: 'Chinese', vi: 'Tiếng Trung' },
  fr: { en: 'French', vi: 'Tiếng Pháp' },
  de: { en: 'German', vi: 'Tiếng Đức' },
  es: { en: 'Spanish', vi: 'Tiếng Tây Ban Nha' },
  pt: { en: 'Portuguese', vi: 'Tiếng Bồ Đào Nha' },
  it: { en: 'Italian', vi: 'Tiếng Ý' },
  th: { en: 'Thai', vi: 'Tiếng Thái' },
  id: { en: 'Indonesian', vi: 'Tiếng Indonesia' },
}

export function getLanguageName(code: string, locale: string): string {
  const names = LANGUAGE_NAMES[code.toLowerCase() as LangCode]
  if (!names) return code
  return locale.toLowerCase().startsWith('vi') ? names.vi : names.en
}

export function formatLanguageOption(code: string, locale: string): string {
  return `${code.toLowerCase()} (${getLanguageName(code, locale)})`
}
