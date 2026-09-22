import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import enCommon from '@/locales/en/common.json'
import enAuth from '@/locales/en/auth.json'
import enLanding from '@/locales/en/landing.json'
import enDashboard from '@/locales/en/dashboard.json'
import enSettings from '@/locales/en/settings.json'
import enBatch from '@/locales/en/batch.json'
import enProject from '@/locales/en/project.json'
import enNotification from '@/locales/en/notification.json'
import enGlossary from '@/locales/en/glossary.json'
import enJob from '@/locales/en/job.json'
import enAccount from '@/locales/en/account.json'
import enMedia from '@/locales/en/media.json'
import enPlatform from '@/locales/en/platform.json'
import viCommon from '@/locales/vi/common.json'
import viAuth from '@/locales/vi/auth.json'
import viLanding from '@/locales/vi/landing.json'
import viDashboard from '@/locales/vi/dashboard.json'
import viSettings from '@/locales/vi/settings.json'
import viBatch from '@/locales/vi/batch.json'
import viProject from '@/locales/vi/project.json'
import viNotification from '@/locales/vi/notification.json'
import viGlossary from '@/locales/vi/glossary.json'
import viJob from '@/locales/vi/job.json'
import viAccount from '@/locales/vi/account.json'
import viMedia from '@/locales/vi/media.json'
import viPlatform from '@/locales/vi/platform.json'

const defaultLanguage = import.meta.env.VITE_DEFAULT_LANGUAGE === 'vi' ? 'vi' : 'en'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        landing: enLanding,
        dashboard: enDashboard,
        settings: enSettings,
        batch: enBatch,
        project: enProject,
        notification: enNotification,
        glossary: enGlossary,
        job: enJob,
        account: enAccount,
        media: enMedia,
        platform: enPlatform,
      },
      vi: {
        common: viCommon,
        auth: viAuth,
        landing: viLanding,
        dashboard: viDashboard,
        settings: viSettings,
        batch: viBatch,
        project: viProject,
        notification: viNotification,
        glossary: viGlossary,
        job: viJob,
        account: viAccount,
        media: viMedia,
        platform: viPlatform,
      },
    },
    fallbackLng: defaultLanguage,
    defaultNS: 'common',
    ns: [
      'common',
      'auth',
      'landing',
      'dashboard',
      'settings',
      'batch',
      'project',
      'notification',
      'glossary',
      'job',
      'account',
      'media',
      'platform',
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'app_language',
    },
  })

export default i18n
