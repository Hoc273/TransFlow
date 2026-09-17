import { IconChevronRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/shared/EmptyState'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

interface PlaceholderPageProps {
  titleKey: string
  /** Optional description i18n key under common */
  descriptionKey?: string
}

/** Generic shell page for routes not yet implemented (API phase later). */
export function PlaceholderPage({ titleKey, descriptionKey = 'apiLater' }: PlaceholderPageProps) {
  const { t } = useTranslation('common')
  const title = t(titleKey)
  useDocumentTitle(title)

  return (
    <div>
      <div className="breadcrumb">
        <span>{t('workspace.demoName')}</span>
        <IconChevronRight size={10} />
        <span>{title}</span>
      </div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="page-subtitle">{t(descriptionKey)}</div>
        </div>
      </div>
      <div className="app-card">
        <EmptyState title={title} description={t(descriptionKey)} className="py-16" />
      </div>
    </div>
  )
}
