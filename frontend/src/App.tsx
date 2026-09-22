import { useEffect, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { AppRouter } from '@/app/router'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useLanguageSync } from '@/hooks/useLanguageSync'
import { applyThemeToDocument, useUiStore } from '@/store/uiStore'
import { createAppQueryClient } from '@/lib/queryClient'
import { GlobalErrorBoundary } from '@/components/error/GlobalErrorBoundary'

function ThemeBootstrap() {
  useThemeSync()
  useLanguageSync()

  useEffect(() => {
    applyThemeToDocument(useUiStore.getState().theme)
  }, [])

  return null
}

export default function App() {
  const [queryClient] = useState(() => createAppQueryClient())

  return (
    <GlobalErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeBootstrap />
        <AppRouter />
      </QueryClientProvider>
    </GlobalErrorBoundary>
  )
}
