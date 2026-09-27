import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IconArrowLeft, IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

/**
 * Mobile-only wrapper for a desktop page (Media Studio Job detail, preset editor).
 * Keeps the desktop page untouched, only adds safe viewport containment,
 * back navigation and a notice banner on small screens.
 */
export function MobileMediaJobWrapper({
  children,
  backTo = 'media',
  backLabelKey = 'mobile:jobWrapper.back',
  noticeKey = 'mobile:jobWrapper.notice',
}: {
  children: ReactNode
  /** Path relative to /w/:workspaceId. */
  backTo?: string
  backLabelKey?: string
  noticeKey?: string
}) {
  const { t } = useTranslation('mobile')
  const { workspaceId } = useParams()

  return (
    <div className="w-full min-w-0 overflow-x-clip">
      <div className="flex min-w-0 items-center gap-2 px-1 py-2">
        <Link
          to={`/w/${workspaceId}/${backTo}`}
          aria-label={t(backLabelKey)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 active:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:active:bg-neutral-800"
        >
          <IconArrowLeft size={18} />
        </Link>
        <div className="flex min-w-0 flex-1 items-start gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
          <IconInfoCircle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {t(noticeKey)}
          </span>
        </div>
      </div>
      <div className="min-w-0 overflow-x-clip">{children}</div>
    </div>
  )
}
