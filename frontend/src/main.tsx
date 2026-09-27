import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/i18n'
import { applyThemeToDocument, useUiStore } from '@/store/uiStore'
import './index.css'
import '@/styles/app-shell.css'
import '@/styles/forms.css'
import '@/pages/settings/settings.css'
import '@/pages/media/media-studio.css'
import '@/styles/platform.css'
import App from './App.tsx'

// Apply theme as early as possible to avoid flash
applyThemeToDocument(useUiStore.getState().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
