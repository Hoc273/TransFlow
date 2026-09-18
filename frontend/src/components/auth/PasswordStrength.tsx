import { useTranslation } from 'react-i18next'
import { IconCircle, IconCircleCheck } from '@tabler/icons-react'
import { scorePassword } from '@/lib/validation'
import { cn } from '@/lib/cn'

interface PasswordStrengthProps {
  password: string
  showRequirements?: boolean
}

export function PasswordStrength({ password, showRequirements = true }: PasswordStrengthProps) {
  const { t } = useTranslation('auth')
  const { score, strength, hasLen, hasUpper, hasNum } = scorePassword(password)

  if (!password) return null

  const barClass =
    strength === 'weak'
      ? 'bg-[var(--color-error)]'
      : strength === 'medium'
        ? 'bg-amber-500'
        : 'bg-[var(--color-success)]'

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              'h-[3px] flex-1 rounded-sm transition-colors',
              i < score ? barClass : 'bg-[var(--color-border)]',
            )}
          />
        ))}
      </div>
      {strength && (
        <div className="mt-1.5 text-[11px] text-[var(--color-text-tertiary)]">
          {t(`password.${strength}`)}
        </div>
      )}
      {showRequirements && (
        <div className="mt-2.5 space-y-0.5 rounded-lg bg-[var(--color-bg-surface-2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-text-secondary)]">
          <Req ok={hasLen} label={t('password.reqLen')} />
          <Req ok={hasUpper} label={t('password.reqUpper')} />
          <Req ok={hasNum} label={t('password.reqNum')} />
        </div>
      )}
    </div>
  )
}

function Req({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5',
        ok ? 'text-[var(--color-success)]' : 'text-[var(--color-text-tertiary)]',
      )}
    >
      {ok ? <IconCircleCheck size={13} /> : <IconCircle size={13} />}
      <span>{label}</span>
    </div>
  )
}
