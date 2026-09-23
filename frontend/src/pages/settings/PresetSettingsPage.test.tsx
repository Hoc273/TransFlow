// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ workspaceId: 'ws' }),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>{children}</a>
  ),
  NavLink: ({
    children,
    to,
    className,
    end: _end,
    ...rest
  }: {
    children?: React.ReactNode
    to: string
    className?: string | ((props: { isActive: boolean }) => string)
    end?: boolean
  }) => (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive: false }) : className}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const { presetsQuery, createMutate, updateMutate, deleteMutate, permissionMock } = vi.hoisted(() => ({
  presetsQuery: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  },
  createMutate: vi.fn().mockResolvedValue(undefined),
  updateMutate: vi.fn().mockResolvedValue(undefined),
  deleteMutate: vi.fn().mockResolvedValue(undefined),
  permissionMock: vi.fn(() => true),
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => presetsQuery,
  useCreateWorkflowPreset: () => ({ isPending: false, mutateAsync: createMutate }),
  useUpdateWorkflowPreset: () => ({ isPending: false, mutateAsync: updateMutate }),
  useDeleteWorkflowPreset: () => ({ isPending: false, mutateAsync: deleteMutate }),
}))

vi.mock('@/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'prj-1', name: 'Project A' }] }),
}))

const { ttsVoicesData, ttsVoiceLanguagesData } = vi.hoisted(() => ({
  ttsVoicesData: [] as unknown[],
  ttsVoiceLanguagesData: [] as unknown[],
}))

function makeVoice(partial: Record<string, unknown>) {
  return {
    id: 'voice-1',
    voiceId: 'voice-1',
    language: 'vi',
    gender: 'FEMALE',
    displayName: 'Vais',
    isActive: true,
    ...partial,
  }
}

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => ({
    data: [
      {
        id: 'prov-1',
        displayName: 'Cloud TTS',
        protocol: 'openai_compatible',
        capabilities: ['TTS'],
        defaultFor: [],
        baseUrl: 'https://example.test',
        apiKeyHint: null,
        defaultModel: 'm',
        enabled: true,
      },
    ],
  }),
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? ttsVoicesData : undefined,
    isPending: false,
  }),
  // V39 follow-up — language aggregation for the Provider→Language→Voice picker.
  useTtsVoiceLanguages: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? ttsVoiceLanguagesData : [],
  }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => permissionMock(),
}))

vi.mock('@/hooks/useDocumentTitle', () => ({
  useDocumentTitle: () => {},
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { currentWorkspace: { name: string } | null }) => unknown) =>
    selector
      ? selector({ currentWorkspace: { name: 'WS' } })
      : { currentWorkspace: { name: 'WS' } },
}))

const { PresetSettingsPage } = await import('./PresetSettingsPage')
import type { WorkflowPreset } from '@/types/media'

function preset(partial: Partial<WorkflowPreset>): WorkflowPreset {
  return {
    id: 'p1',
    scope: 'WORKSPACE',
    workspaceId: 'ws',
    projectId: null,
    name: 'Studio standard',
    description: null,
    config: { schemaVersion: 1, workflowMode: 'AUTO', subtitleMode: 'HARD_SUB' },
    schemaVersion: 1,
    active: true,
    isDefault: false,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    ...partial,
  }
}

const renderPage = () => render(<PresetSettingsPage />)

describe('PresetSettingsPage — preset admin UI (docs/16 §7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presetsQuery.data = []
    presetsQuery.isLoading = false
    presetsQuery.isError = false
    // Legacy default catalog: one Vietnamese voice, matching the historical
    // fixture so pre-V39 assertions keep their semantics.
    ttsVoicesData.length = 0
    ttsVoicesData.push(makeVoice({}))
    ttsVoiceLanguagesData.length = 0
    ttsVoiceLanguagesData.push({ code: 'vi', voiceCount: 1 })
  })

  it('lists workspace and system presets', () => {
    presetsQuery.data = [
      preset({ id: 'ws-1', name: 'Studio standard' }),
      preset({ id: 'sys-1', scope: 'SYSTEM', name: 'System Auto' }),
    ]

    renderPage()

    expect(screen.getByTestId('preset-card-ws-1')).toBeTruthy()
    expect(screen.getByTestId('preset-card-sys-1')).toBeTruthy()
    expect(screen.getAllByText('Studio standard').length).toBeGreaterThan(0)
  })

  it('renders voice status chips — configured vs default', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          ttsProviderId: 'prov-1',
          ttsVoiceId: 'voice-1',
        },
      }),
      preset({ id: 'ws-2', name: 'Default voice' }),
    ]

    renderPage()

    expect(screen.getByTestId('preset-voice-status-ws-1').textContent)
      .toContain('workflowPresetAdmin.voiceConfigured')
    expect(screen.getByTestId('preset-voice-status-ws-1').getAttribute('title'))
      .toBe('workflowPresetAdmin.voiceConfiguredTooltip')
    expect(screen.getByTestId('preset-voice-status-ws-2').textContent)
      .toContain('workflowPresetAdmin.voiceDefault')
    expect(screen.getByTestId('preset-voice-status-ws-2').getAttribute('title'))
      .toBe('workflowPresetAdmin.voiceDefaultTooltip')
  })

  it('renders aspect ratio badge when preset specifies non-original aspect', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-aspect',
        config: {
          schemaVersion: 1,
          outputAspectRatio: '16:9',
        },
      }),
    ]

    renderPage()

    expect(screen.getByTestId('preset-aspect-ws-aspect').textContent)
      .toContain('workflowPresetAdmin.aspectBadge')
  })

  it('does not render the old breadcrumb hub link (breadcrumb removed)', () => {
    presetsQuery.data = [preset({ id: 'ws-1' })]

    renderPage()

    expect(screen.queryByRole('link', { name: 'media:title' })).toBeNull()
  })

  it('system presets never show edit/delete even for managers', () => {
    presetsQuery.data = [preset({ id: 'sys-1', scope: 'SYSTEM', name: 'System Auto' })]

    renderPage()

    expect(screen.queryByLabelText('workflowPresetAdmin.edit')).toBeNull()
    expect(screen.queryByLabelText('workflowPresetAdmin.delete')).toBeNull()
  })

  it('non-manager roles see the page read-only (no create/edit/delete)', () => {
    // BA review v1 P2: RBAC coverage — TRANSLATOR/CLIENT members must not
    // get any mutation affordance; the backend 403 stays the authority.
    permissionMock.mockReturnValue(false)
    presetsQuery.data = [
      preset({ id: 'ws-1', name: 'Read only' }),
      preset({ id: 'sys-1', scope: 'SYSTEM', name: 'System Auto' }),
    ]

    renderPage()

    expect(screen.queryByTestId('preset-create-btn')).toBeNull()
    expect(screen.queryByLabelText('workflowPresetAdmin.edit')).toBeNull()
    expect(screen.queryByLabelText('workflowPresetAdmin.delete')).toBeNull()
    expect(screen.getByTestId('preset-card-ws-1')).toBeTruthy()
    expect(screen.getByTestId('preset-card-sys-1')).toBeTruthy()
    permissionMock.mockReturnValue(true)
  })

  it('create form saves a full extended config', async () => {
    presetsQuery.data = []
    renderPage()

    fireEvent.click(screen.getByTestId('preset-create-btn'))
    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'New preset' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledTimes(1)
    })
    const body = createMutate.mock.calls[0][0]
    expect(body.name).toBe('New preset')
    expect(body.scope).toBe('WORKSPACE')
    expect(body.config.schemaVersion).toBe(1)
    expect(body.config.workflowMode).toBe('AUTO')
    expect(body.config.subtitleMode).toBe('HARD_SUB')
    expect(body.config.subtitlePosition).toBe('BOTTOM')
    expect(body.config.verticalOffsetPercent).toBe(0)
    expect(body.config.backgroundBox).toBe(true)
    expect(body.config.ttsProviderId).toBeUndefined()
    expect(body.config.ttsVoiceId).toBeUndefined()
    expect(body.config.presentation.audio.schemaVersion).toBe(1)
  })

  it('hydrates legacy config with documented defaults on edit', () => {
    presetsQuery.data = [
      preset({ id: 'ws-1', name: 'Legacy' }),
    ]

    renderPage()
    fireEvent.click(screen.getByLabelText('workflowPresetAdmin.edit'))

    expect(screen.getByDisplayValue('Legacy')).toBeTruthy()
    // Extension defaults are hydrated (not stale/absent).
    expect(
      (screen.getByLabelText('media:renderPrep.position') as HTMLSelectElement).value,
    ).toBe('BOTTOM')
    expect(
      (screen.getByLabelText('media:renderPrep.offset') as HTMLInputElement).value,
    ).toBe('0')
  })

  it('hydrates extended config values on edit', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        name: 'Extended',
        config: {
          schemaVersion: 1,
          workflowMode: 'MANUAL',
          subtitleMode: 'HARD_SUB',
          subtitlePosition: 'TOP',
          verticalOffsetPercent: 12,
          backgroundBox: false,
          ttsProviderId: 'prov-1',
          ttsVoiceId: 'voice-1',
        },
      }),
    ]

    renderPage()
    fireEvent.click(screen.getByLabelText('workflowPresetAdmin.edit'))

    expect(screen.getByDisplayValue('Extended')).toBeTruthy()
    expect(
      (screen.getByLabelText('media:workflow.modeLabel') as HTMLSelectElement).value,
    ).toBe('MANUAL')
    expect(
      (screen.getByLabelText('media:renderPrep.position') as HTMLSelectElement).value,
    ).toBe('TOP')
    expect(
      (screen.getByLabelText('media:renderPrep.offset') as HTMLInputElement).value,
    ).toBe('12')
    expect(
      (screen.getByLabelText('media:voice.providerLabel') as HTMLSelectElement).value,
    ).toBe('prov-1')
    expect(
      (screen.getByLabelText('media:voice.label') as HTMLSelectElement).value,
    ).toBe('voice-1')
  })

  it('blocks a half voice pair on create', () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    // provider select: pick the TTS provider, leave voice empty → half pair.
    fireEvent.change(screen.getByLabelText('media:voice.providerLabel'), {
      target: { value: 'prov-1' },
    })

    expect(screen.getByTestId('preset-form-half-pair')).toBeTruthy()
    expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).not.toBeNull()
  })

  it('deletes a preset through the confirm modal', async () => {
    presetsQuery.data = [preset({ id: 'ws-1', name: 'Delete me' })]
    renderPage()

    fireEvent.click(screen.getByLabelText('workflowPresetAdmin.delete'))
    fireEvent.click(screen.getByTestId('preset-delete-confirm'))

    await waitFor(() => {
      expect(deleteMutate).toHaveBeenCalledWith('ws-1')
    })
  })

  it('maps default-conflict 409 to a friendly message', async () => {
    presetsQuery.data = []
    const { ApiError } = await import('@/types/api')
    createMutate.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'WORKFLOW_PRESET_DEFAULT_CONFLICT', message: 'raw' }),
    )
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))
    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'Conflicting' },
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))

    await waitFor(() => {
      expect(screen.getByText('media:workflowPresetAdmin.defaultConflict')).toBeTruthy()
    })
  })

  it('filters project presets after selecting a project', () => {
    presetsQuery.data = [preset({ id: 'prj-1', scope: 'PROJECT', name: 'Project preset' })]

    renderPage()
    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.projectFilter'), {
      target: { value: 'prj-1' },
    })

    expect(screen.getByTestId('preset-card-prj-1')).toBeTruthy()
  })

  // ─── V2 cover layers (docs/97 §19.17 §B — user decision 2026-09-06) ─────

  it('create form saves cover layers and hex8 background color (never the legacy mask)', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'Blur preset' },
    })
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))
    // Default first layer: BLUR anchored to the subtitle line (mirrors v1).
    fireEvent.change(screen.getByTestId('preset-form-mask-layer-0-blur-radius'), {
      target: { value: '14' },
    })
    fireEvent.change(screen.getByTestId('preset-form-mask-layer-0-width'), {
      target: { value: '80' },
    })
    fireEvent.change(screen.getByTestId('preset-form-background-color'), {
      target: { value: '#ff8800' },
    })
    fireEvent.change(screen.getByTestId('preset-form-background-alpha'), {
      target: { value: '30' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledTimes(1)
    })
    const body = createMutate.mock.calls[0][0]
    const subtitle = body.config.presentation.subtitle
    expect(subtitle.mask).toBeNull()
    expect(subtitle.layers).toEqual([
      {
        id: 'cover-1',
        type: 'BLUR',
        enabled: true,
        zIndex: 0,
        anchor: 'SUBTITLE',
        geometry: { widthPercent: 80, heightPercent: 8 },
        style: { blurRadius: 14 },
      },
    ])
    // alpha 30% → 0x4D hex8
    expect(body.config.backgroundColor).toBe('#FF88004D')
  })

  it('supports a second independent layer with its own anchor', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'Two covers' },
    })
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))
    fireEvent.click(screen.getByTestId('preset-form-mask-layer-add'))
    // Second layer defaults to the first free fixed line: CENTER.
    fireEvent.change(screen.getByTestId('preset-form-mask-layer-1-anchor'), {
      target: { value: 'TOP' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledTimes(1)
    })
    const body = createMutate.mock.calls[0][0]
    const layers = body.config.presentation.subtitle.layers
    expect(layers).toHaveLength(2)
    expect(layers[0].anchor).toBe('SUBTITLE')
    expect(layers[1].anchor).toBe('TOP')
    expect(layers[1].zIndex).toBe(1)
  })

  it('disabling the background box never sends a background color', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'No box' },
    })
    fireEvent.click(screen.getByLabelText('media:renderPrep.backgroundBox'))

    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledTimes(1)
    })
    const body = createMutate.mock.calls[0][0]
    expect(body.config.backgroundBox).toBe(false)
    expect(body.config.backgroundColor).toBeUndefined()
  })

  it('hydrates a legacy v1 mask into the equivalent layer + hex8 background on edit', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        name: 'Blur preset',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          backgroundColor: '#FF88004D',
          presentation: {
            subtitle: {
              schemaVersion: 1,
              displayMode: 'SENTENCE',
              mask: {
                enabled: true,
                anchor: 'SUBTITLE',
                widthPercent: 80,
                heightPercent: 10,
                opacityPercent: 70,
                paddingPercent: 3,
                style: 'BLUR',
                blurRadius: 9,
                color: '#336699',
              },
            },
          },
        },
      }),
    ]

    renderPage()
    fireEvent.click(screen.getByLabelText('workflowPresetAdmin.edit'))

    // The stored mask becomes an enabled BLUR layer on the subtitle line —
    // saving writes layers, never the legacy mask.
    expect(
      (screen.getByTestId('preset-form-mask-enable') as HTMLInputElement).checked,
    ).toBe(true)
    expect(
      (screen.getByTestId('preset-form-mask-layer-0-style') as HTMLSelectElement).value,
    ).toBe('BLUR')
    expect(
      (screen.getByTestId('preset-form-mask-layer-0-blur-radius') as HTMLInputElement).value,
    ).toBe('9')
    expect(
      (screen.getByTestId('preset-form-mask-layer-0-width') as HTMLInputElement).value,
    ).toBe('80')
    expect((screen.getByTestId('preset-form-background-color') as HTMLInputElement).value)
      .toBe('#ff8800')
    expect((screen.getByTestId('preset-form-background-alpha') as HTMLInputElement).value)
      .toBe('30')
  })

  it('renders the live preview frame and switches preview aspects', () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    expect(screen.getByTestId('preset-preview-frame')).toBeTruthy()
    expect(screen.getByTestId('preset-preview-aspect-16x9')).toBeTruthy()
    expect(screen.getByTestId('preset-preview-aspect-9x16')).toBeTruthy()
    expect(screen.getByTestId('preset-preview-aspect-4x3')).toBeTruthy()
    expect(screen.getByTestId('preset-preview-aspect-1x1')).toBeTruthy()

    fireEvent.click(screen.getByTestId('preset-preview-aspect-9x16'))
    expect(screen.getByTestId('preset-preview-aspect-9x16').getAttribute('aria-pressed'))
      .toBe('true')
    expect(screen.getByTestId('preset-preview-aspect-16x9').getAttribute('aria-pressed'))
      .toBe('false')

    // The cover layer appears once enabled and mirrors the chosen style.
    expect(screen.queryByTestId('preset-preview-layer-cover-1')).toBeNull()
    expect(screen.queryByTestId('preset-preview-mask')).toBeNull()
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))
    expect(screen.getByTestId('preset-preview-layer-cover-1').getAttribute('data-style')).toBe('BLUR')
    fireEvent.change(screen.getByTestId('preset-form-mask-layer-0-style'), {
      target: { value: 'SOLID' },
    })
    expect(screen.getByTestId('preset-preview-layer-cover-1').getAttribute('data-style')).toBe('SOLID')
  })

  it('shows the mask style badge on preset cards', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        name: 'Blur preset',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          presentation: {
            subtitle: {
              schemaVersion: 1,
              displayMode: 'SENTENCE',
              mask: {
                enabled: true,
                anchor: 'SUBTITLE',
                widthPercent: 85,
                heightPercent: 12,
                opacityPercent: 60,
                paddingPercent: 2,
                style: 'BLUR',
                blurRadius: 12,
                color: '#000000',
              },
            },
          },
        },
      }),
    ]

    renderPage()

    expect(screen.getByTestId('preset-mask-style-ws-1').textContent)
      .toContain('renderPrep.maskStyleBlur')
  })

  // ─── OUTPUT-ASPECT (docs/97 §19.19) — real output frame + calibration ───

  it('persists the output frame selected in the preview selector', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'Reel preset' },
    })
    // Controlled selector — the buttons write the real preset field.
    fireEvent.click(screen.getByTestId('preset-preview-aspect-9x16'))
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    const body = createMutate.mock.calls[0][0]
    expect(body.config.outputAspectRatio).toBe('9:16')
  })

  it('omits outputAspectRatio entirely when the frame stays ORIGINAL', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    fireEvent.change(screen.getByLabelText('media:workflowPresetAdmin.name'), {
      target: { value: 'Plain preset' },
    })
    await waitFor(() => {
      expect(screen.getByTestId('preset-form-save').getAttribute('disabled')).toBeNull()
    })
    fireEvent.click(screen.getByTestId('preset-form-save'))
    await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1))
    const body = createMutate.mock.calls[0][0]
    expect(body.config.outputAspectRatio).toBeUndefined()
  })

  it('accepts a local calibration video/image and never persists it', async () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    // No calibration by default — gradient background only.
    expect(screen.queryByTestId('preset-preview-blur-bg')).toBeNull()
    expect(screen.queryByTestId('preset-calibration-remove')).toBeNull()

    const file = new File(['tiny'], 'clip.mp4', { type: 'video/mp4' })
    fireEvent.change(screen.getByTestId('preset-calibration-input'), {
      target: { files: [file] },
    })

    // Blur-pad visualization: blurred cover bg + fitted foreground.
    expect(screen.getByTestId('preset-preview-blur-bg')).toBeTruthy()
    expect(screen.getByTestId('preset-preview-fit-fg')).toBeTruthy()
    fireEvent.click(screen.getByTestId('preset-calibration-remove'))
    expect(screen.queryByTestId('preset-preview-blur-bg')).toBeNull()
  })

  it('shows the cover-layer count badge on preset cards using v2 layers', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-2',
        name: 'Layers preset',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          presentation: {
            subtitle: {
              schemaVersion: 1,
              displayMode: 'SENTENCE',
              layers: [
                {
                  id: 'cover-1',
                  type: 'BLUR',
                  enabled: true,
                  zIndex: 0,
                  anchor: 'SUBTITLE',
                  geometry: { widthPercent: 84, heightPercent: 8 },
                  style: { blurRadius: 10 },
                },
                {
                  id: 'cover-2',
                  type: 'SOLID',
                  enabled: true,
                  zIndex: 1,
                  anchor: 'CENTER',
                  geometry: { widthPercent: 60, heightPercent: 10 },
                  style: { color: '#000000', opacityPercent: 80 },
                },
              ],
            },
          },
        },
      }),
    ]

    renderPage()

    const badge = screen.getByTestId('preset-mask-style-ws-2').textContent
    expect(badge).toContain('renderPrep.coverCount')
    expect(badge).toContain('renderPrep.maskStyleBlur')
  })

  // ─── PRESET-VIZ FE follow-up (docs/97 §19.16): sticky preview · audio
  //     always-expanded · mask follows subtitle help ─────────────────────

  it('keeps the preview column sticky on desktop while the form scrolls', () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    const col = screen.getByTestId('preset-preview-col')
    expect(col.className).toContain('lg:sticky')
    expect(col.className).toContain('lg:self-start')
  })

  it('renders the audio section always expanded (no accordion toggle)', () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))

    // The controls are queryable directly — no summary click needed.
    expect(screen.getByTestId('audio-config-expanded')).toBeTruthy()
    expect(screen.getByLabelText('media:renderPrep.originalGain')).toBeTruthy()
    expect(screen.getByLabelText('media:renderPrep.ttsGain')).toBeTruthy()
    expect(screen.getByLabelText('media:renderPrep.ttsTempo')).toBeTruthy()
  })

  it('explains that each cover layer anchors independently (subtitle can sit elsewhere)', () => {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))
    fireEvent.click(screen.getByLabelText('media:renderPrep.coverEnable'))

    expect(screen.getByText('media:renderPrep.coverHint')).toBeTruthy()
    // The per-layer anchor select offers the four semantic anchors.
    const anchor = screen.getByTestId('preset-form-mask-layer-0-anchor') as HTMLSelectElement
    expect(anchor.options).toHaveLength(4)
    expect(anchor.options[0].value).toBe('SUBTITLE')
  })

  // ── V39 follow-up — Provider → Language → Voice picker ──────────────────

  function openVoicePicker() {
    presetsQuery.data = []
    renderPage()
    fireEvent.click(screen.getByTestId('preset-create-btn'))
    fireEvent.change(screen.getByLabelText('media:voice.providerLabel'), {
      target: { value: 'prov-1' },
    })
  }

  it('narrows voice options to the selected language and shows codes in labels', () => {
    ttsVoicesData.length = 0
    ttsVoicesData.push(
      makeVoice({ id: 'vi-1', voiceId: 'vi-1', displayName: 'Mai', language: 'vi', languages: ['vi'] }),
      makeVoice({
        id: 'multi-1',
        voiceId: 'multi-1',
        displayName: 'Polyglot',
        language: 'ja',
        languages: ['ja', 'vi'],
        gender: 'MALE',
      }),
      makeVoice({ id: 'en-1', voiceId: 'en-1', displayName: 'Rachel', language: 'en', languages: ['en'] }),
    )
    ttsVoiceLanguagesData.length = 0
    ttsVoiceLanguagesData.push(
      { code: 'vi', voiceCount: 2 },
      { code: 'ja', voiceCount: 1 },
      { code: 'en', voiceCount: 1 },
    )

    openVoicePicker()

    const languageSelect = screen.getByTestId('preset-form-language-select') as HTMLSelectElement
    // No hardcoded English default — All languages first.
    expect(languageSelect.value).toBe('')
    const voiceSelect = screen.getByTestId('preset-form-voice-select') as HTMLSelectElement
    expect(voiceSelect.textContent).toContain('Rachel')

    fireEvent.change(languageSelect, { target: { value: 'vi' } })

    // Only VI-compatible voices remain (the ja-primary multilingual counts too);
    // labels expose every compatibility code, not just the primary one.
    expect((screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).textContent)
      .toContain('Mai')
    expect((screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).textContent)
      .toContain('ja/vi')
    expect((screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).textContent)
      .not.toContain('Rachel')
  })

  it('clears an incompatible selected voice when the language filter changes', () => {
    ttsVoicesData.length = 0
    ttsVoicesData.push(makeVoice({ id: 'vi-1', displayName: 'Mai' }))
    ttsVoiceLanguagesData.length = 0
    ttsVoiceLanguagesData.push({ code: 'vi', voiceCount: 1 }, { code: 'en', voiceCount: 3 })

    openVoicePicker()
    fireEvent.change(screen.getByTestId('preset-form-voice-select'), {
      target: { value: 'vi-1' },
    })
    expect(
      (screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).value,
    ).toBe('vi-1')

    fireEvent.change(screen.getByTestId('preset-form-language-select'), {
      target: { value: 'en' },
    })

    // vi-1 is incompatible with en → cleared; halfPair guard blocks saving.
    expect(
      (screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).value,
    ).toBe('')
    expect(screen.getByTestId('preset-form-half-pair')).toBeTruthy()
  })

  it('resets the voice selection when the provider changes', () => {
    openVoicePicker()
    fireEvent.change(screen.getByTestId('preset-form-voice-select'), {
      target: { value: 'voice-1' },
    })
    expect(
      (screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).value,
    ).toBe('voice-1')

    fireEvent.change(screen.getByLabelText('media:voice.providerLabel'), {
      target: { value: '' },
    })

    // Never carry a cross-provider pair into the payload.
    expect(
      (screen.getByTestId('preset-form-voice-select') as HTMLSelectElement).value,
    ).toBe('')
  })
})
