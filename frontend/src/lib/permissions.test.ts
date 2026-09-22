import { describe, expect, it } from 'vitest'
import { can } from '@/lib/permissions'

describe('admin RBAC', () => {
  it('LEAD được manage_members, MEMBER/CLIENT không', () => {
    expect(can('LEAD', 'workspace.manage_members')).toBe(true)
    expect(can('MEMBER', 'workspace.manage_members')).toBe(false)
    expect(can('CLIENT', 'workspace.manage_members')).toBe(false)
  })

  it('ADMIN alias LEAD để tương thích UI cũ', () => {
    expect(can('ADMIN', 'workspace.manage_members')).toBe(true)
  })

  it('platform.view tồn tại để ẩn/hiện link platform', () => {
    expect(can('LEAD', 'platform.view')).toBe(true)
    expect(can('MEMBER', 'platform.view')).toBe(false)
  })
})
