import { NavLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IconClipboardCheck, IconVideo } from '@tabler/icons-react'
import { cn } from '@/lib/cn'

export function MediaStudioNav({ className }: { className?: string }) {
  const { t } = useTranslation('media')
  const { workspaceId = '' } = useParams()

  return (
    <nav
      className={cn(
        'flex items-center gap-2 border-b border-[var(--color-border)] mb-4',
        className,
      )}
      aria-label={t('tabs.navLabel', { defaultValue: 'Media Studio Navigation' })}
    >
      <NavLink
        to={`/w/${workspaceId}/media`}
        end
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-150',
            isActive
              ? 'border-[var(--color-media)] text-[var(--color-media)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border)]',
          )
        }
      >
        <IconVideo size={16} />
        <span>{t('tabs.jobs', { defaultValue: 'Dự án video' })}</span>
      </NavLink>

      <NavLink
        to={`/w/${workspaceId}/media/presets`}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-150',
            isActive
              ? 'border-[var(--color-media)] text-[var(--color-media)]'
              : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border)]',
          )
        }
      >
        <IconClipboardCheck size={16} />
        <span>{t('tabs.presets', { defaultValue: 'Preset quy trình' })}</span>
      </NavLink>
    </nav>
  )
}
