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

const LANGUAGE_NAMES: Record<LangCode, { en: string; vi: string; ko: string }> = {
  en: { en: 'English', vi: 'Tiếng Anh' , ko: '영어' },
  vi: { en: 'Vietnamese', vi: 'Tiếng Việt' , ko: '베트남어' },
  ja: { en: 'Japanese', vi: 'Tiếng Nhật' , ko: '일본어' },
  ko: { en: 'Korean', vi: 'Tiếng Hàn' , ko: '한국어' },
  zh: { en: 'Chinese', vi: 'Tiếng Trung' , ko: '중국어' },
  fr: { en: 'French', vi: 'Tiếng Pháp' , ko: '프랑스어' },
  de: { en: 'German', vi: 'Tiếng Đức' , ko: '독일어' },
  es: { en: 'Spanish', vi: 'Tiếng Tây Ban Nha' , ko: '스페인어' },
  pt: { en: 'Portuguese', vi: 'Tiếng Bồ Đào Nha' , ko: '포르투갈어' },
  it: { en: 'Italian', vi: 'Tiếng Ý' , ko: '이탈리아어' },
  th: { en: 'Thai', vi: 'Tiếng Thái' , ko: '태국어' },
  id: { en: 'Indonesian', vi: 'Tiếng Indonesia' , ko: '인도네시아어' },
}

export function getLanguageName(code: string, locale: string): string {
  const names = LANGUAGE_NAMES[code.toLowerCase() as LangCode]
  if (!names) return code
  const lang = locale.toLowerCase()
  if (lang.startsWith('vi')) return names.vi
  if (lang.startsWith('ko')) return names.ko
  return names.en
}

export function formatLanguageOption(code: string, locale: string): string {
  return `${code.toLowerCase()} (${getLanguageName(code, locale)})`
}
