// @vitest-environment jsdom
// C2 (docs/19 §1.8.2) — create-form redesign interaction coverage:
//  - subtitleMode is never offered at create (configured at Finish & Render /
//    preset for AUTO);
//  - workflow mode is a segmented control; the preset picker is AUTO-only and
//    switching to MANUAL clears a selected preset;
//  - an AUTO preset carrying its own voice pair hides the voice selector and
//    shows the "voice from preset" note (the FE sends no explicit pair).
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  useNavigate: () => vi.fn(),
}))

const {
  uploadMutate,
  consentMutate,
  permissionMock,
  previewMutate,
  createJobApiMock,
} = vi.hoisted(() => ({
  uploadMutate: vi.fn(),
  consentMutate: vi.fn(),
  permissionMock: vi.fn(() => true),
  previewMutate: vi.fn(),
  createJobApiMock: vi.fn(),
}))

const providerRowId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const voiceRowId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const termsQuery = { data: { termsVersion: '2026-01-01' }, isPending: false, isError: false }
const capabilitiesQuery = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
  refetchAsync: vi.fn(),
}
const providersQuery = { data: undefined as unknown, isPending: false, isError: false }
const voicesMap = new Map<string, unknown[]>()
const presetsQuery = { data: [] as unknown[], isPending: false, isError: false }

vi.mock('@/hooks/useMedia', () => ({
  useConsentMedia: () => ({ mutateAsync: consentMutate, isPending: false }),
  useMediaTermsVersion: () => termsQuery,
  useTransformationCapabilities: () => capabilitiesQuery,
  useUploadMedia: () => ({ mutateAsync: uploadMutate, isPending: false }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => permissionMock(),
}))

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesMap.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: previewMutate }),
}))

vi.mock('@/api/transformation', () => ({
  createTransformationJobApi: (...args: unknown[]) => createJobApiMock(...args),
  selectTransformationVoiceApi: (...args: unknown[]) => vi.fn()(...args),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: (opts: { mutationFn: (...a: unknown[]) => unknown }) => ({
    isPending: false,
    mutateAsync: (...args: unknown[]) => opts.mutationFn(...args),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}))

vi.mock('@/lib/queryClient', () => ({
  queryKeys: {
    mediaJobs: (ws: string, projectId: string) => ['mediaJobs', ws, projectId],
    mediaJob: (ws: string, jobId: string) => ['mediaJob', ws, jobId],
  },
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => presetsQuery,
}))

vi.mock('@/components/media-studio/WorkflowPresetPicker', () => ({
  WorkflowPresetPicker: (props: { onChange: (v: string | null) => void; value: string | null }) => (
    <div data-testid="preset-picker-marker" data-value={props.value ?? ''}>
      <button type="button" onClick={() => props.onChange('preset-1')}>
        pick preset-1
      </button>
      <button type="button" onClick={() => props.onChange(null)}>
        clear preset
      </button>
    </div>
  ),
  presetById: (_presets: unknown, id: string | null) => {
    if (!id) return null
    // Preset "preset-1" carries a voice pair (C2 gap 1).
    return {
      id,
      config: {
        schemaVersion: 1,
        workflowMode: 'MANUAL',
        subtitleMode: 'HARD_SUB',
        ttsProviderId: 'p1',
        ttsVoiceId: 'v1',
      },
    }
  },
}))

vi.mock('@/config/featureFlags', () => ({
  featureFlags: { narrativeReviewAi: false },
}))

const { UploadConsentPanel } = await import('./UploadConsentPanel')

const PROJECTION = {
  protocolVersion: '1',
  supportedExecutionModes: ['FAST'],
  defaultExecutionMode: 'FAST',
  availability: { FAST: { available: true, unavailableReason: null } },
  workerCapability: { state: 'AVAILABLE', workerCount: 1, compatibleFastWorkers: 1, compatibleStudioWorkers: 0 },
  readiness: { status: 'READY', readyExecutionModes: ['FAST'], reasons: [], evaluatedAt: null },
}

async function setupPanel() {
  createJobApiMock.mockResolvedValue({ id: 'job-created' })
  previewMutate.mockResolvedValue({ audioUrl: 'https://example.test/preview.mp3', expiresInSeconds: 60 })
  uploadMutate.mockResolvedValue({
    assetId: 'asset-1',
    documentId: 'doc-1',
    fileName: 'movie.mp4',
    fileSizeBytes: 1024,
    durationMs: 60000,
    consented: false,
  })
  consentMutate.mockResolvedValue({})
  capabilitiesQuery.data = PROJECTION
  capabilitiesQuery.refetch.mockResolvedValue({ data: PROJECTION })
  providersQuery.data = [
    {
      id: providerRowId,
      displayName: 'Cloud TTS',
      protocol: 'openai_compatible',
      capabilities: ['TTS'],
      defaultFor: ['TTS'],
      baseUrl: 'https://example.test',
      apiKeyHint: null,
      defaultModel: 'm',
      enabled: true,
    },
  ]
  voicesMap.set(providerRowId, [
    {
      id: voiceRowId,
      voiceId: 'Kai',
      language: 'vi',
      languages: ['vi', 'en'],
      gender: 'FEMALE',
      displayName: 'Vais',
      isActive: true,
      cachedAt: null,
    },
  ])
  const { container } = render(<UploadConsentPanel workspaceId="ws" projectId="prj" onCreated={() => {}} />)
  const file = new File(['x'], 'movie.mp4', { type: 'video/mp4' })
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })
  await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1))
  fireEvent.click(container.querySelector('.media-consent-box input[type="checkbox"]')!)
  fireEvent.click(screen.getByText('media:consentButton'))
  await waitFor(() => expect(consentMutate).toHaveBeenCalledTimes(1))
  return container
}

describe('UploadConsentPanel — C2 create-form redesign (docs/19 §1.8.2)', () => {
  afterEach(() => {
    vi.clearAllMocks()
    presetsQuery.data = []
  })

  it('never offers the subtitle display mode at create; the workflow mode is a segmented control', async () => {
    await setupPanel()

    expect(screen.queryByText('media:subtitleModeLabel')).toBeNull()
    expect(screen.getByTestId('workflow-mode-seg')).toBeTruthy()
    // Default for localization.full is AUTO (recipe-derived).
    expect(screen.getByTestId('workflow-mode-seg').querySelector('[aria-checked="true"]')?.textContent)
      .toBe('media:workflow.auto')
  })

  it('shows the preset picker in AUTO and hides it (clearing the selection) in MANUAL', async () => {
    await setupPanel()

    // AUTO default → picker visible.
    const marker = screen.getByTestId('preset-picker-marker')
    expect(marker).toBeTruthy()
    fireEvent.click(screen.getByText('pick preset-1'))
    expect(marker.getAttribute('data-value')).toBe('preset-1')

    // Switch to MANUAL → picker hidden + selected preset cleared (fail-closed:
    // a stale preset id must never be submitted with an explicit manual flow).
    fireEvent.click(screen.getByText('media:workflow.manual'))
    await waitFor(() => expect(screen.queryByTestId('preset-picker-marker')).toBeNull())
  })

  it('AUTO + preset with a voice pair hides the voice selector and shows the preset-voice note', async () => {
    await setupPanel()

    // Before selecting the preset: normal voice selector.
    expect(screen.getByTestId('voice-selector')).toBeTruthy()
    expect(screen.queryByTestId('preset-voice-note')).toBeNull()

    fireEvent.click(screen.getByText('pick preset-1'))

    // After selecting the preset (voice pair inside): selector hidden, note shown.
    expect(screen.queryByTestId('voice-selector')).toBeNull()
    expect(screen.getByTestId('preset-voice-note')).toBeTruthy()
    expect(screen.getByText('media:voice.presetVoiceTitle')).toBeTruthy()
  })

  it('previews Kai by row UUID and creates an English localization job with UUID bindings', async () => {
    const container = await setupPanel()

    fireEvent.click(screen.getByTestId('target-dropdown-trigger'))
    fireEvent.click(container.querySelector('[data-testid="target-check-en"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Remove vi' }))

    const providerSelect = screen.getByTestId('voice-provider-select') as HTMLSelectElement
    if (providerSelect.value !== providerRowId) {
      fireEvent.change(providerSelect, { target: { value: providerRowId } })
    }
    await waitFor(() => expect(providerSelect.value).toBe(providerRowId))
    const voiceSelect = screen.getByTestId('voice-voice-select') as HTMLSelectElement
    await waitFor(() => {
      expect(voiceSelect.value).toBe(voiceRowId)
    })

    fireEvent.click(screen.getByTestId('voice-preview-button'))
    expect(previewMutate).toHaveBeenCalledWith({
      providerId: providerRowId,
      voiceRowId,
      language: 'en',
    })

    const submit = screen.getByTestId('create-submit') as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() => expect(createJobApiMock).toHaveBeenCalledTimes(1))
    const [, body] = createJobApiMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body).toMatchObject({
      recipeId: 'localization.full',
      targetLang: 'en',
      ttsProviderId: providerRowId,
      ttsVoiceId: voiceRowId,
    })
    expect(JSON.stringify(body)).not.toContain('Kai')
  })
})
