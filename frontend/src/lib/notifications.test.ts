import { describe, expect, it } from 'vitest'
import { notificationHref } from './notifications'
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
