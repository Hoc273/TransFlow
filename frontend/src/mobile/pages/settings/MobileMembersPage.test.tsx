// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MobileMembersPage } from './MobileMembersPage'
import { MobilePresetSettingsPage } from './MobilePresetSettingsPage'

interface CustomMatchers<R = unknown> {
  toBeInTheDocument(): R
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBeInTheDocument(received) {
    const pass = received !== null && received !== undefined
    return {
      pass,
      message: () => `expected element to ${pass ? 'not ' : ''}be in the document`,
    }
  },
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const mockInviteMember = vi.fn()
const mockRemoveMember = vi.fn()
const mockAddMutation = vi.fn()
const mockRemoveMutation = vi.fn()

let mockMembersHookData: any = {
  members: [
    { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
  ],
  isLoading: false,
  inviteMember: mockInviteMember,
  removeMember: mockRemoveMember,
}

vi.mock('@/hooks/useMembers', () => ({
  useMembers: () => mockMembersHookData,
  useAddMember: () => ({ mutate: mockAddMutation, isPending: false }),
  useRemoveMember: () => ({ mutate: mockRemoveMutation, isPending: false }),
  useUpdateMemberRole: () => ({ mutate: vi.fn(), isPending: false }),
}))

let mockPresetsHookData: any = {
  presets: [
    {
      id: 'p1',
      name: 'Standard Subtitles',
      description: 'Default subtitle styling with yellow background',
      isSystem: true,
      scope: 'SYSTEM',
    },
    {
      id: 'p2',
      name: 'Custom Dubbing',
      description: 'Vietnamese female voice with soft background music',
      isSystem: false,
      scope: 'WORKSPACE',
    },
  ],
  isLoading: false,
}

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => mockPresetsHookData,
  useCreateWorkflowPreset: () => ({ mutate: vi.fn() }),
  useUpdateWorkflowPreset: () => ({ mutate: vi.fn() }),
  useDeleteWorkflowPreset: () => ({ mutate: vi.fn() }),
}))

describe('MobileMembersPage', () => {
  it('renders member cards with roles (mock shape)', () => {
    mockMembersHookData = {
      members: [
        { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
      ],
      isLoading: false,
      inviteMember: mockInviteMember,
      removeMember: mockRemoveMember,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Thành viên Workspace')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getByText('OWNER')).toBeInTheDocument()
  })

  it('renders member cards with real hook shape ({ data: [...] })', () => {
    mockMembersHookData = {
      data: [
        {
          memberId: 'm2',
          fullName: 'Jane Smith',
          email: 'jane@example.com',
          role: 'ADMIN',
        },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('ADMIN')).toBeInTheDocument()
  })

  it('shows loading state when isLoading is true', () => {
    mockMembersHookData = {
      isLoading: true,
      members: [],
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Đang tải danh sách thành viên...')).toBeInTheDocument()
  })

  it('shows empty state when members list is empty', () => {
    mockMembersHookData = {
      isLoading: false,
      members: [],
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Chưa có thành viên nào')).toBeInTheDocument()
  })

  it('opens invite BottomSheet and invites member on submit', () => {
    mockMembersHookData = {
      members: [
        { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
      ],
      isLoading: false,
      inviteMember: mockInviteMember,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    // Click invite button
    const inviteBtn = screen.getByRole('button', { name: /mời/i })
    fireEvent.click(inviteBtn)

    // BottomSheet should be visible
    expect(screen.getByText('Mời thành viên mới')).toBeInTheDocument()

    // Fill form
    const emailInput = screen.getByPlaceholderText('user@example.com')
    fireEvent.change(emailInput, { target: { value: 'alice@transflow.ai' } })

    // Click submit
    const submitBtn = screen.getByRole('button', { name: 'Gửi lời mời' })
    fireEvent.click(submitBtn)

    expect(mockInviteMember).toHaveBeenCalledWith({
      email: 'alice@transflow.ai',
      role: 'MEMBER',
    })
  })

  it('does not invite if email is empty', () => {
    mockMembersHookData = {
      members: [
        { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
      ],
      isLoading: false,
      inviteMember: mockInviteMember,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /mời/i }))
    const submitBtn = screen.getByRole('button', { name: 'Gửi lời mời' })
    fireEvent.click(submitBtn)

    expect(mockInviteMember).not.toHaveBeenCalled()
  })

  it('invokes useAddMember mutation when inviteMember is not in useMembers', () => {
    mockMembersHookData = {
      data: [
        { memberId: 'm1', fullName: 'John Doe', email: 'john@example.com', role: 'OWNER' },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: /mời/i }))
    const emailInput = screen.getByPlaceholderText('user@example.com')
    fireEvent.change(emailInput, { target: { value: 'newmember@transflow.ai' } })

    const submitBtn = screen.getByRole('button', { name: 'Gửi lời mời' })
    fireEvent.click(submitBtn)

    expect(mockAddMutation).toHaveBeenCalledWith({
      email: 'newmember@transflow.ai',
      role: 'MEMBER',
    })
  })

  it('opens remove confirmation and calls removeMember', () => {
    mockMembersHookData = {
      members: [
        { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
      ],
      isLoading: false,
      removeMember: mockRemoveMember,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    // Find and click remove button on John Doe
    const removeBtn = screen.getByLabelText('Xóa John Doe')
    fireEvent.click(removeBtn)

    // Confirmation sheet should be visible
    expect(screen.getByText('Xóa thành viên')).toBeInTheDocument()
    expect(screen.getByText(/Bạn có chắc chắn muốn xóa thành viên/)).toBeInTheDocument()

    // Confirm deletion
    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận xóa' })
    fireEvent.click(confirmBtn)

    expect(mockRemoveMember).toHaveBeenCalledWith('m1')
  })

  it('invokes useRemoveMember mutation when removeMember is not on useMembers', () => {
    mockMembersHookData = {
      data: [
        { memberId: 'm-target', fullName: 'Bob Target', email: 'bob@example.com', role: 'TRANSLATOR' },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    const removeBtn = screen.getByLabelText('Xóa Bob Target')
    fireEvent.click(removeBtn)

    const confirmBtn = screen.getByRole('button', { name: 'Xác nhận xóa' })
    fireEvent.click(confirmBtn)

    expect(mockRemoveMutation).toHaveBeenCalledWith('m-target')
  })

  it('filters members by search query', () => {
    mockMembersHookData = {
      members: [
        { id: 'm1', name: 'John Doe', email: 'john@example.com', role: 'OWNER' },
        { id: 'm2', name: 'Sarah Connor', email: 'sarah@example.com', role: 'ADMIN' },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )

    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Tìm theo tên hoặc email...')
    fireEvent.change(searchInput, { target: { value: 'sarah' } })

    expect(screen.queryByText('John Doe')).toBeNull()
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument()
  })
})

describe('MobilePresetSettingsPage', () => {
  it('renders presets with system and workspace badges', () => {
    mockPresetsHookData = {
      presets: [
        {
          id: 'p1',
          name: 'Standard Subtitles',
          description: 'Default subtitle styling with yellow background',
          isSystem: true,
          scope: 'SYSTEM',
        },
        {
          id: 'p2',
          name: 'Custom Dubbing',
          description: 'Vietnamese female voice with soft background music',
          isSystem: false,
          scope: 'WORKSPACE',
        },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Workflow Presets')).toBeInTheDocument()
    expect(screen.getByText('Standard Subtitles')).toBeInTheDocument()
    expect(screen.getByText('Default subtitle styling with yellow background')).toBeInTheDocument()
    expect(screen.getByText('Hệ thống')).toBeInTheDocument()

    expect(screen.getByText('Custom Dubbing')).toBeInTheDocument()
    expect(screen.getByText('Vietnamese female voice with soft background music')).toBeInTheDocument()
    expect(screen.getByText('Tùy chỉnh')).toBeInTheDocument()
  })

  it('renders presets from real hook shape ({ data: [...] })', () => {
    mockPresetsHookData = {
      data: [
        {
          id: 'p-real',
          name: 'Real Hook Preset',
          description: 'Preset fetched via real useWorkflowPresets data property',
          isSystem: false,
          scope: 'WORKSPACE',
        },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Real Hook Preset')).toBeInTheDocument()
    expect(screen.getByText('Preset fetched via real useWorkflowPresets data property')).toBeInTheDocument()
  })

  it('shows loading state for presets', () => {
    mockPresetsHookData = {
      presets: [],
      isLoading: true,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Đang tải presets...')).toBeInTheDocument()
  })

  it('shows empty state when presets list is empty', () => {
    mockPresetsHookData = {
      presets: [],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Chưa có preset nào')).toBeInTheDocument()
  })

  it('filters presets by search query', () => {
    mockPresetsHookData = {
      presets: [
        {
          id: 'p1',
          name: 'Subtitle Fast Track',
          description: 'Fast track subtitles without TTS',
          isSystem: true,
        },
        {
          id: 'p2',
          name: 'Full Studio Dub',
          description: 'Full voice dubbing and sound mixing',
          isSystem: false,
        },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Subtitle Fast Track')).toBeInTheDocument()
    expect(screen.getByText('Full Studio Dub')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Tìm preset theo tên, mô tả...')
    fireEvent.change(searchInput, { target: { value: 'Fast Track' } })

    expect(screen.getByText('Subtitle Fast Track')).toBeInTheDocument()
    expect(screen.queryByText('Full Studio Dub')).toBeNull()
  })

  it('opens details BottomSheet when tapping preset card', () => {
    mockPresetsHookData = {
      presets: [
        {
          id: 'p1',
          name: 'Premium Audio Preset',
          description: 'High quality multi-channel export',
          isSystem: true,
          config: {
            workflowMode: 'AUTO',
            subtitleMode: 'BURN_IN',
          },
        },
      ],
      isLoading: false,
    }

    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )

    // Tap the preset card
    fireEvent.click(screen.getByText('Premium Audio Preset'))

    // BottomSheet should show details
    expect(screen.getByText('Chi tiết Preset')).toBeInTheDocument()
    expect(screen.getByText('Cấu hình chi tiết')).toBeInTheDocument()
    expect(screen.getAllByText('AUTO').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('BURN_IN').length).toBeGreaterThanOrEqual(1)
  })
})
