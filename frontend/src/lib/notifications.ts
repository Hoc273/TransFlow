import type { TFunction } from 'i18next'
import type { NotificationItem } from '@/types/notification'

/**
 * Where a notification leads when clicked, or null when it has no target.
 * Batch detail routes are disabled in the SPA, so batch notifications open the
 * media list where the batch's child jobs are listed.
 */
export function notificationHref(workspaceId: string, n: NotificationItem): string | null {
  if (!workspaceId) return null
  const type = (n.type || '').toUpperCase()
  if (type.startsWith('JOB_') && n.relatedEntityId) {
    return `/w/${workspaceId}/media/jobs/${n.relatedEntityId}`
  }
  if (type.startsWith('BATCH_')) {
    return `/w/${workspaceId}/media`
  }
  if (type === 'PROVIDER_KEY_INVALID') {
    return `/w/${workspaceId}/account/api-keys`
  }
  return null
}

/** Localized title per notification type; falls back to the raw API title. */
export function notificationTitle(t: TFunction, n: NotificationItem): string {
  return t(`notification:types.${(n.type || '').toUpperCase()}`, { defaultValue: n.title })
}
