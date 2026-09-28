import type { TFunction } from 'i18next'

/** Backend stage errorCode → user-facing reason (media:pipeline.providerErrors.*). */
export const STAGE_ERROR_KEYS: Record<string, string> = {
  PROVIDER_QUOTA_EXCEEDED: 'quotaExceeded',
  PROVIDER_AUTH_FAILED: 'authFailed',
  PROVIDER_PERMISSION_DENIED: 'permissionDenied',
  PROVIDER_RATE_LIMITED: 'rateLimited',
  PROVIDER_TIMEOUT: 'timeout',
  PROVIDER_UNAVAILABLE: 'unavailable',
  PROVIDER_MODEL_NOT_FOUND: 'modelNotFound',
  PROVIDER_UNSUPPORTED_MODEL: 'unsupportedModel',
  PROVIDER_BAD_REQUEST: 'badRequest',
  PROVIDER_RESPONSE_MALFORMED: 'responseMalformed',
  INSUFFICIENT_CREDIT: 'insufficientCredit',
  TTS_SEGMENTS_INCOMPLETE: 'ttsIncomplete',
  PLATFORM_PROVIDER_NOT_CONFIGURED: 'platformNotConfigured',
  PROVIDER_DEFAULT_NOT_CONFIGURED: 'defaultNotConfigured',
  PROVIDER_MODEL_NOT_CONFIGURED: 'modelNotConfigured',
  PROVIDER_KEY_DECRYPTION_FAILED: 'keyUnreadable',
  PROVIDER_CAPABILITY_NOT_SUPPORTED: 'capabilityNotSupported',
  STAGE_TIMEOUT: 'stageTimeout',
  MEDIA_FILE_EXPIRED: 'fileExpired',
}

function stageLabel(t: TFunction, stageName: string): string {
  return t(`stages.${stageName}`, { ns: 'media', defaultValue: stageName.replaceAll('_', ' ') })
}

/** Localized reason for a known stage errorCode, or null when the code has no translation. */
export function stageErrorText(t: TFunction, stageName: string, errorCode?: string | null): string | null {
  const key = errorCode ? STAGE_ERROR_KEYS[errorCode] : undefined
  return key ? t(`pipeline.providerErrors.${key}`, { ns: 'media', stage: stageLabel(t, stageName) }) : null
}

/**
 * JOB_FAILED notifications carry the backend text "Stage <STAGE> failed (<CODE>): <english detail>"
 * (MediaCallbackServiceImpl#safeFailureNotification). Returns the localized reason instead, or
 * null when the message is not in that shape.
 */
export function localizedJobFailure(t: TFunction, message: string | null | undefined): string | null {
  const match = message?.match(/^Stage ([A-Z_]+) failed(?: \(([A-Z_]+)\))?/)
  if (!match) return null
  const [, stage, code] = match
  return stageErrorText(t, stage, code) ?? t('pipeline.stageFailed', { ns: 'media', stage: stageLabel(t, stage) })
}
