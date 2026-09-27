import { useTranslation } from 'react-i18next'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconInfoCircle,
  IconShieldX,
} from '@tabler/icons-react'
import { cn } from '@/lib/cn'
import { asSeverity } from '@/lib/qa'
import type { QaSeverity } from '@/types/qa'

const CLASS: Record<string, string> = {
  LOW: 'severity-badge severity-low',
  MEDIUM: 'severity-badge severity-medium',
  HIGH: 'severity-badge severity-high',
  CRITICAL: 'severity-badge severity-critical',
}

type Props = {
  severity: QaSeverity | string
  className?: string
  showMediaNote?: boolean
}

export function SeverityBadge({ severity, className, showMediaNote }: Props) {
  const { t } = useTranslation('job')
  const s = asSeverity(severity)
  const Icon =
    s === 'CRITICAL'
      ? IconShieldX
      : s === 'HIGH'
        ? IconAlertTriangle
        : s === 'MEDIUM'
          ? IconAlertCircle
          : IconInfoCircle

  return (
    <span className={cn(CLASS[s] || CLASS.LOW, className)} title={s === 'CRITICAL' && showMediaNote ? t('qa.criticalMediaOnly') : undefined}>
      <Icon size={12} stroke={2} />
      {t(`qa.severity.${s.toLowerCase()}`)}
      {s === 'CRITICAL' && showMediaNote && (
        <span className="ml-1 opacity-70">· media</span>
      )}
    </span>
  )
}
