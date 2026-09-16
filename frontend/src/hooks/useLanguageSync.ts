import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'

/** Bidirectional sync between uiStore.language and i18next. */
export function useLanguageSync() {
  const { i18n } = useTranslation()
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
    document.documentElement.lang = language
  }, [i18n, language])

  // Rehydrate store from i18n if localStorage key differs (first load via detector)
  useEffect(() => {
    const lng = (i18n.resolvedLanguage || i18n.language || 'en').startsWith('vi') ? 'vi' : 'en'
    if (lng !== language) {
      setLanguage(lng)
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
