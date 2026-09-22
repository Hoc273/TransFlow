import { Link, useParams } from 'react-router-dom'
import { IconChevronLeft } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { CreditSection } from '@/pages/account/sections/CreditSection'

export function MobileCreditPage() {
  const { t } = useTranslation('account')
  const { workspaceId = '' } = useParams()

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      <Link
        to={`/w/${workspaceId}/account`}
        className="inline-flex items-center gap-1 text-sm font-medium text-neutral-500"
      >
        <IconChevronLeft size={17} />
        {t('title')}
      </Link>
      <h1 className="text-xl font-bold text-neutral-900 dark:text-white">{t('nav.credit')}</h1>
      <CreditSection />
    </div>
  )
}
