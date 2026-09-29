// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MobileMembersPage } from './MobileMembersPage'
import { MobilePresetSettingsPage } from './MobilePresetSettingsPage'
import i18n from '@/i18n'

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

const mockAddMutation = vi.fn()
const mockRemoveMutation = vi.fn()
const mockUpdateRoleMutation = vi.fn()
let mockCanManage = true

const lead = { memberId: 'm1', userId: 'u1', fullName: 'John Doe', email: 'john@example.com', role: 'LEAD' }
const member = { memberId: 'm2', userId: 'u2', fullName: 'Sarah Connor', email: 'sarah@example.com', role: 'MEMBER' }
const client = { memberId: 'm3', userId: 'u3', fullName: 'Bob Client', email: 'bob@example.com', role: 'CLIENT' }

let mockMembersHookData: any = { data: [lead], isLoading: false, isError: false, refetch: vi.fn() }

vi.mock('@/hooks/useMembers', () => ({
  useMembers: () => mockMembersHookData,
  useAddMember: () => ({ mutate: mockAddMutation, isPending: false }),
  useRemoveMember: () => ({ mutate: mockRemoveMutation, isPending: false }),
  useUpdateMemberRole: () => ({ mutate: mockUpdateRoleMutation, isPending: false }),
}))

vi.mock('@/hooks/useWorkspaceBilling', () => ({
  useWorkspaceBillingConfig: () => ({ data: { costMode: 'PAY_PER_USER' }, isLoading: false, isError: false }),
  useUpdateWorkspaceBillingConfig: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => mockCanManage,
}))

let mockPresetsHookData: any = {
  data: [
    {
      id: 'p1',
      name: 'Standard Subtitles',
      description: 'Default subtitle styling with yellow background',
      scope: 'SYSTEM',
    },
    {
      id: 'p2',
      name: 'Custom Dubbing',
      description: 'Vietnamese female voice with soft background music',
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

beforeAll(async () => {
  await i18n.changeLanguage('vi')
})

describe('MobileMembersPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <MobileMembersPage />
      </MemoryRouter>
    )
  const setMembers = (data: any[], extra: any = {}) => {
    mockMembersHookData = { data, isLoading: false, isError: false, refetch: vi.fn(), ...extra }
  }

  beforeEach(() => {
    mockCanManage = true
  })

  it('renders member cards with translated 3-role labels', () => {
    setMembers([lead, member, client])
    renderPage()

    expect(screen.getByText('Thành viên Workspace')).toBeInTheDocument()
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('Trưởng nhóm').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Thành viên').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Khách hàng').length).toBeGreaterThanOrEqual(1)
  })

  it('shows loading state when isLoading is true', () => {
    setMembers([], { isLoading: true })
    renderPage()
    expect(screen.getByText('Đang tải danh sách thành viên...')).toBeInTheDocument()
  })

  it('shows empty state when members list is empty', () => {
    setMembers([])
    renderPage()
    expect(screen.getByText('Chưa có thành viên nào')).toBeInTheDocument()
  })

  it('invite sheet only offers MEMBER and CLIENT, and submits via useAddMember', () => {
    setMembers([lead])
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /mời/i }))
    expect(screen.getByText('Mời thành viên mới')).toBeInTheDocument()

    const options = Array.from(
      (screen.getByLabelText('Vai trò') as HTMLSelectElement).options,
    ).map((o) => o.value)
    expect(options).toEqual(['MEMBER', 'CLIENT'])

    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'alice@transflow.ai' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời' }))

    expect(mockAddMutation).toHaveBeenCalledWith(
      { email: 'alice@transflow.ai', role: 'MEMBER' },
      expect.any(Object),
    )
  })

  it('does not invite if email is empty', () => {
    setMembers([lead])
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /mời/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lời mời' }))

    expect(mockAddMutation).not.toHaveBeenCalled()
  })

  it('never offers removal of the Lead', () => {
    setMembers([lead])
    renderPage()
    expect(screen.queryByTestId('remove-member-m1')).toBeNull()
  })

  it('opens remove confirmation and calls useRemoveMember', () => {
    setMembers([lead, member])
    renderPage()

    fireEvent.click(screen.getByLabelText('Xóa Sarah Connor'))
    expect(screen.getByText('Xóa thành viên')).toBeInTheDocument()
    expect(screen.getByText(/Bạn có chắc chắn muốn xóa thành viên/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận xóa' }))
    expect(mockRemoveMutation).toHaveBeenCalledWith('m2', expect.any(Object))
  })

  it('hides invite and remove actions for non-Lead users', () => {
    mockCanManage = false
    setMembers([lead, member])
    renderPage()

    expect(screen.queryByRole('button', { name: /mời/i })).toBeNull()
    expect(screen.queryByTestId('remove-member-m2')).toBeNull()
    expect(
      screen.getByText('Chỉ Trưởng nhóm của workspace mới có thể mời hoặc xóa thành viên.'),
    ).toBeInTheDocument()
  })

  it('filters members by search query', () => {
    setMembers([lead, member])
    renderPage()

    fireEvent.change(screen.getByPlaceholderText('Tìm theo tên hoặc email...'), {
      target: { value: 'sarah' },
    })

    expect(screen.queryByText('John Doe')).toBeNull()
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument()
  })

  it('changes a member role via useUpdateMemberRole (never for the Lead)', () => {
    setMembers([lead, member])
    renderPage()

    expect(screen.queryByTestId('role-select-m1')).toBeNull()
    fireEvent.change(screen.getByTestId('role-select-m2'), { target: { value: 'CLIENT' } })
    expect(mockUpdateRoleMutation).toHaveBeenCalledWith(
      { memberId: 'm2', body: { role: 'CLIENT' } },
      expect.any(Object),
    )
  })

  it('shows a read-only role badge for non-Lead users', () => {
    mockCanManage = false
    setMembers([lead, member])
    renderPage()
    expect(screen.queryByTestId('role-select-m2')).toBeNull()
  })
})

describe('MobilePresetSettingsPage', () => {
  it('renders presets with system and workspace badges', () => {
    mockPresetsHookData = {
      data: [
        {
          id: 'p1',
          name: 'Standard Subtitles',
          description: 'Default subtitle styling with yellow background',
          scope: 'SYSTEM',
        },
        {
          id: 'p2',
          name: 'Custom Dubbing',
          description: 'Vietnamese female voice with soft background music',
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

  it('links to the full preset editor only for users who can manage presets', () => {
    mockCanManage = true
    mockPresetsHookData = { data: [], isLoading: false }
    render(
      <MemoryRouter initialEntries={['/w/ws-1/media/presets']}>
        <Routes>
          <Route path="/w/:workspaceId/media/presets" element={<MobilePresetSettingsPage />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByTestId('mobile-presets-manage').getAttribute('href')).toBe(
      '/w/ws-1/media/presets/manage',
    )
    cleanup()

    mockCanManage = false
    render(
      <MemoryRouter>
        <MobilePresetSettingsPage />
      </MemoryRouter>
    )
    expect(screen.queryByTestId('mobile-presets-manage')).toBeNull()
    mockCanManage = true
  })

  it('renders presets from real hook shape ({ data: [...] })', () => {
    mockPresetsHookData = {
      data: [
        {
          id: 'p-real',
          name: 'Real Hook Preset',
          description: 'Preset fetched via real useWorkflowPresets data property',
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
      data: [],
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
      data: [],
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
      data: [
        {
          id: 'p1',
          name: 'Subtitle Fast Track',
          description: 'Fast track subtitles without TTS',
          scope: 'SYSTEM',
        },
        {
          id: 'p2',
          name: 'Full Studio Dub',
          description: 'Full voice dubbing and sound mixing',
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

    expect(screen.getByText('Subtitle Fast Track')).toBeInTheDocument()
    expect(screen.getByText('Full Studio Dub')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Tìm preset theo tên, mô tả...')
    fireEvent.change(searchInput, { target: { value: 'Fast Track' } })

    expect(screen.getByText('Subtitle Fast Track')).toBeInTheDocument()
    expect(screen.queryByText('Full Studio Dub')).toBeNull()
  })

  it('opens details BottomSheet when tapping preset card', () => {
    mockPresetsHookData = {
      data: [
        {
          id: 'p1',
          name: 'Premium Audio Preset',
          description: 'High quality multi-channel export',
          scope: 'SYSTEM',
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
