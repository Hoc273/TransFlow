import { describe, expect, it } from 'vitest'
import { notificationHref, notificationMessage } from './notifications'
import type { NotificationItem } from '@/types/notification'

function item(type: string, relatedEntityId: string | null = 'ref-1'): NotificationItem {
  return {
    id: 'n',
    type,
    title: type,
    message: '',
    relatedEntityType: null,
    relatedEntityId,
    payload: null,
    readAt: null,
    isRead: false,
    createdAt: '2026-09-26T00:00:00Z',
  }
}

describe('notificationHref', () => {
  it('opens the media job for job notifications', () => {
    expect(notificationHref('ws', item('JOB_COMPLETED', 'job-7'))).toBe('/w/ws/media/jobs/job-7')
    expect(notificationHref('ws', item('JOB_QA_BLOCKED', 'job-8'))).toBe('/w/ws/media/jobs/job-8')
  })

  it('opens the media list for batch notifications (batch routes are disabled)', () => {
    expect(notificationHref('ws', item('BATCH_PARTIALLY_FAILED'))).toBe('/w/ws/media')
  })

  it('opens API keys settings for a rejected provider key', () => {
    expect(notificationHref('ws', item('PROVIDER_KEY_INVALID'))).toBe('/w/ws/account/api-keys')
  })

  it('returns null without a target', () => {
    expect(notificationHref('ws', item('JOB_FAILED', null))).toBeNull()
    expect(notificationHref('ws', item('SOMETHING_ELSE'))).toBeNull()
    expect(notificationHref('', item('JOB_FAILED'))).toBeNull()
  })
})

describe('notificationMessage', () => {
  const t = ((key: string, opts?: Record<string, unknown>) =>
    `${key}${opts?.stage ? `|${opts.stage}` : ''}`) as unknown as import('i18next').TFunction

  it('localizes a failed stage with a known error code', () => {
    const n = { ...item('JOB_FAILED'), message: 'Stage STT failed (PLATFORM_PROVIDER_NOT_CONFIGURED): No platform AI provider configured for this capability' }
    expect(notificationMessage(t, n)).toBe('pipeline.providerErrors.platformNotConfigured|stages.STT')
  })

  it('falls back to a generic localized failure for an unknown code', () => {
    const n = { ...item('JOB_FAILED'), message: 'Stage RENDER failed (FFMPEG_CRASHED): exit 1' }
    expect(notificationMessage(t, n)).toBe('pipeline.stageFailed|stages.RENDER')
  })

  it('keeps messages it does not recognise', () => {
    expect(notificationMessage(t, { ...item('JOB_FAILED'), message: 'Something else' })).toBe('Something else')
    expect(notificationMessage(t, { ...item('JOB_COMPLETED'), message: 'Media job completed' })).toBe('Media job completed')
  })
})
