import { IconCheck, IconX, IconInfoCircle } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type {
  OptionalFeatureResult,
  OptionalFeatures,
  PhaseResult,
  PhaseStatus,
  ProviderTestResult,
} from '@/types/provider'

type Props = {
  result: ProviderTestResult
}

function phaseIcon(status: PhaseStatus) {
  if (status === 'PASS') return <IconCheck size={16} className="phase-pass" />
  if (status === 'FAIL') return <IconX size={16} className="phase-fail" />
  return <IconInfoCircle size={16} className="phase-skip" />
}

function phaseClass(status: PhaseStatus) {
  if (status === 'PASS') return 'phase-pass'
  if (status === 'FAIL') return 'phase-fail'
  return 'phase-skip'
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function PhaseRow({ label, phase }: { label: string; phase: PhaseResult }) {
  return (
    <div className={`provider-test-phase ${phaseClass(phase.status)}`}>
      <div className="phase-left">
        <span className="phase-icon">{phaseIcon(phase.status)}</span>
        <span className="phase-label">{label}</span>
      </div>
      <div className="phase-right">
        <span className="phase-duration">{formatDuration(phase.durationMs)}</span>
        {phase.message && (
          <span className="phase-message">{phase.message}</span>
        )}
      </div>
    </div>
  )
}

function FeatureRow({
  label,
  icon,
  feature,
}: {
  label: string
  icon: string
  feature: OptionalFeatureResult
}) {
  return (
    <div className={`provider-test-feature ${feature.available ? 'feature-available' : 'feature-unavailable'}`}>
      <div className="feature-left">
        <span className="feature-icon">{icon}</span>
        <span className="feature-label">{label}</span>
      </div>
      <div className="feature-right">
        <span className="feature-status">
          {feature.available ? (
            <IconCheck size={14} className="feature-available" />
          ) : (
            <IconX size={14} className="feature-unavailable" />
          )}
        </span>
        {feature.detail && (
          <span className="feature-detail">{feature.detail}</span>
        )}
      </div>
    </div>
  )
}

export function ProviderTestPanel({ result }: Props) {
  const { t } = useTranslation('settings')

  const featureLabels: { key: keyof OptionalFeatures; labelKey: string; icon: string }[] = [
    { key: 'voiceDiscovery', labelKey: 'providers.validation.featureVoiceDiscovery', icon: '🎤' },
    { key: 'modelDiscovery', labelKey: 'providers.validation.featureModelDiscovery', icon: '📋' },
    { key: 'streaming', labelKey: 'providers.validation.featureStreaming', icon: '🔄' },
    { key: 'toolCalling', labelKey: 'providers.validation.featureToolCalling', icon: '🛠' },
    { key: 'realtime', labelKey: 'providers.validation.featureRealtime', icon: '⚡' },
  ]

  return (
    <div className="provider-test-panel">
      <div className="provider-test-phases">
        <PhaseRow label={t('providers.validation.phaseConnection')} phase={result.connection} />
        <PhaseRow label={t('providers.validation.phaseAuth')} phase={result.authentication} />
        <PhaseRow
          label={t('providers.validation.phaseCapability', { capability: result.capability })}
          phase={result.capabilityPhase}
        />
      </div>

      <div className="provider-test-features">
        <p className="features-heading">{t('providers.validation.optionalFeatures')}</p>
        {featureLabels.map(({ key, labelKey, icon }) => (
          <FeatureRow
            key={key}
            label={t(labelKey)}
            icon={icon}
            feature={result.optionalFeatures[key]}
          />
        ))}
      </div>

      <div className={`provider-test-overall ${result.overall === 'PASS' ? 'overall-pass' : 'overall-fail'}`}>
        {result.overall === 'PASS'
          ? t('providers.validation.overallPass')
          : t('providers.validation.overallFail')}
      </div>
    </div>
  )
}
