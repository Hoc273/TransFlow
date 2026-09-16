export type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  relatedEntityType: string | null
  relatedEntityId: string | null
  payload: unknown
  createdAt: string
}
