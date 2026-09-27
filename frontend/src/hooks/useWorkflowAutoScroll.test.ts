import { describe, expect, it } from 'vitest'
import { isFirstCompletionTransition } from './useWorkflowAutoScroll'

describe('useWorkflowAutoScroll helpers', () => {
  it('detects first COMPLETED transition only once', () => {
    expect(isFirstCompletionTransition(null, 'COMPLETED')).toBe(true)
    expect(isFirstCompletionTransition('PROCESSING', 'COMPLETED')).toBe(true)
    expect(isFirstCompletionTransition('PENDING', 'COMPLETED')).toBe(true)
    expect(isFirstCompletionTransition('COMPLETED', 'COMPLETED')).toBe(false)
    expect(isFirstCompletionTransition('PROCESSING', 'PROCESSING')).toBe(false)
    expect(isFirstCompletionTransition('COMPLETED', 'STALE')).toBe(false)
  })

  it('is case-insensitive on status strings', () => {
    expect(isFirstCompletionTransition('processing', 'completed')).toBe(true)
    expect(isFirstCompletionTransition('completed', 'completed')).toBe(false)
  })
})
