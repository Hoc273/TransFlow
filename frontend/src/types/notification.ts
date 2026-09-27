export type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  payload: unknown
  /** ISO timestamp the user read it; null = unread. */
  readAt: string | null
  isRead: boolean
  createdAt: string
}
