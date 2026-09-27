export type HistoryEvent = {
  id: string
  actorType: 'HUMAN' | 'AI' | string
  actorUserId: string | null
  actorName: string | null
  action: 'CREATE' | 'EDIT' | 'QA' | 'APPROVE' | 'ROLLBACK' | string
  oldValue: string | null
  newValue: string | null
  createdAt: string
}
