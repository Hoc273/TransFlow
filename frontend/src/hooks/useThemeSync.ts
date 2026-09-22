import { useEffect } from 'react'
import { applyThemeToDocument, useUiStore } from '@/store/uiStore'

/** Keeps <html> class + dataset.theme in sync with uiStore.theme (light | dark). */
export function useThemeSync() {
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    applyThemeToDocument(theme)
  }, [theme])
}
