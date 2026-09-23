// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import enMedia from '@/locales/en/media.json'

/**
 * Auto-detect integration (no Single/Batch toggle):
 * - 1 dropped file → legacy single flow untouched;
 * - N dropped files → N→1 batch view with the files pre-staged;
 * - "Add target languages" on one uploaded video → 1→N batch view reusing
 *   the parent upload (never re-uploaded).
 */
function lookup(key: string): string | undefined {
  const path = key.replace(/^media:/, '').replace(/^common:/, '').split('.')
  let node: unknown = key.startsWith('common:') ? {} : enMedia
  for (const part of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const hit = lookup(key) ?? (options?.defaultValue != null ? String(options.defaultValue) : key)
      return hit.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        options?.[name] != null ? String(options[name]) : `{{${name}}}`,
      )
    },
  }),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}))

const uploadHookMock = { mutateAsync: vi.fn(), isPending: false }
const consentHookMock = { mutateAsync: vi.fn(), isPending: false }
const refetchMock = vi.fn()
const PROJECTION = {
  protocolVersion: '1',
  supportedExecutionModes: ['FAST'],
  defaultExecutionMode: 'FAST',
  availability: { FAST: { available: true, unavailableReason: null } },
  workerCapability: { state: 'AVAILABLE', workerCount: 1, compatibleFastWorkers: 1, compatibleStudioWorkers: 0 },
  readiness: { status: 'READY', readyExecutionModes: ['FAST'], reasons: [], evaluatedAt: null },
}

vi.mock('@/hooks/useMedia', () => ({
  useUploadMedia: () => uploadHookMock,
  useConsentMedia: () => consentHookMock,
  useMediaTermsVersion: () => ({ data: { termsVersion: '2026-01-01' } }),
  useTransformationCapabilities: () => ({
    data: PROJECTION,
    isPending: false,
    isError: false,
    refetch: refetchMock,
  }),
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => true,
}))

const providersQuery = { data: undefined as unknown, isPending: false, isError: false }
const voicesMap = new Map<string, unknown[]>()

vi.mock('@/hooks/useProviders', () => ({
  useProviders: () => providersQuery,
  useTtsVoices: (_ws: string | undefined, providerId: string | undefined) => ({
    data: providerId ? voicesMap.get(providerId) : undefined,
    isPending: false,
  }),
  useVoicePreview: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => ({ data: [] as unknown[], isPending: false, isError: false }),
}))

vi.mock('@/components/media-studio/WorkflowPresetPicker', () => ({
  WorkflowPresetPicker: () => null,
  presetById: () => null,
}))

const apiUploadMock = vi.fn()
const apiConsentMock = vi.fn()
const apiCreateMock = vi.fn()

vi.mock('@/api/transformation', () => ({
  uploadTransformationMediaApi: (...args: unknown[]) => apiUploadMock(...args),
  consentTransformationAssetApi: (...args: unknown[]) => apiConsentMock(...args),
  createTransformationJobApi: (...args: unknown[]) => apiCreateMock(...args),
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

vi.mock('@/config/featureFlags', () => ({
  featureFlags: { narrativeReviewAi: false },
}))

const { UploadConsentPanel } = await import('./UploadConsentPanel')

function videoFile(name: string): File {
  return new File(['0123456789'], name, { type: 'video/mp4' })
}

describe('UploadConsentPanel — staged multi-file upload card', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    voicesMap.clear()
    providersQuery.data = []
    refetchMock.mockReset().mockResolvedValue({ data: PROJECTION })
    uploadHookMock.mutateAsync.mockReset().mockImplementation(async ({ file }: { file: File }) => ({
      assetId: `asset-${file.name}`,
      documentId: `doc-${file.name}`,
      fileName: file.name,
      fileSizeBytes: file.size,
      durationMs: 60000,
      consented: false,
    }))
    consentHookMock.mutateAsync.mockReset().mockResolvedValue({ id: 'c1' })
    apiUploadMock.mockReset()
    apiConsentMock.mockReset().mockResolvedValue({ id: 'c1' })
    apiCreateMock.mockReset().mockImplementation(async (_ws: string, body: Record<string, unknown>) => ({
      id: `job-${body.documentId}-${body.targetLang}`,
      projectId: 'prj',
    }))
  })

  afterEach(() => cleanup())

  // vi.waitFor on mock calls can resolve before the async continuations
  // (patchStaged/finally) flush. Settle on UI state instead: the consent
  // button unmounts exactly when every row is consented.
  async function waitForConsentSettled() {
    await vi.waitFor(() => {
      expect(screen.queryByTestId('consent-confirm')).toBeNull()
    })
  }

  it('stages several videos as stacked rows in the unchanged upload card', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    // Same look as single upload — rows simply stack, no separate batch view.
    const rows = await screen.findAllByTestId('staged-row')
    expect(rows).toHaveLength(2)
    expect(screen.queryByTestId('localization-batch-panel')).toBeNull()
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    // Footer flips from "change file" to "add more files".
    expect(screen.getByTestId('batch-add-more')).toBeTruthy()
  })

  it('removes a staged row on hover delete without touching siblings', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    // Two queued rows → two delete buttons (Remove).
    expect(screen.getAllByLabelText('Remove')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('Remove')[0])
    const rows = await screen.findAllByTestId('staged-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('b.mp4')
  })

  it('keeps one dropped file in the legacy single flow', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('solo.mp4')] },
    })
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(1)
    expect(screen.queryByTestId('localization-batch-panel')).toBeNull()
    // Inline target checkboxes: exactly one checked (vi default).
    expect(screen.getByTestId('target-checkboxes')).toBeTruthy()
    expect((screen.getByTestId('target-check-vi') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByTestId('target-check-en') as HTMLInputElement).checked).toBe(false)
  })

  it('creates one job per staged video with the shared config', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    // Consent checkbox + confirm every staged video at once.
    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    })
    await waitForConsentSettled()
    // Shared config: keep-original skips per-row voice setup.
    fireEvent.click(screen.getByTestId('voice-keep-original'))
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('2/2 jobs created')
    expect(apiCreateMock).toHaveBeenCalledTimes(2)
    const bodies = apiCreateMock.mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(new Set(bodies.map((b) => b.documentId))).toEqual(new Set(['doc-a.mp4', 'doc-b.mp4']))
    expect(new Set(bodies.map((b) => b.targetLang))).toEqual(new Set(['vi']))
    // Guard ran once for the whole fan-out.
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('isolates a create failure and retries only failed rows without re-uploading', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    })
    await waitForConsentSettled()
    fireEvent.click(screen.getByTestId('voice-keep-original'))
    apiCreateMock.mockRejectedValueOnce(new Error('boom-create'))
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('1/2 jobs created')
    expect(apiCreateMock).toHaveBeenCalledTimes(2)

    // Retry: no re-upload, only the failed row re-creates.
    fireEvent.click(screen.getByTestId('create-submit'))
    const retrySummary = await screen.findByTestId('staged-summary')
    expect(retrySummary.textContent).toContain('2/2 jobs created')
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    expect(apiCreateMock).toHaveBeenCalledTimes(3)
  })

  it('re-runs consent for rows that failed consent, then creates them', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('consent-check'))
    consentHookMock.mutateAsync.mockRejectedValueOnce(new Error('boom-consent'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    })
    // a.mp4 consent failed (row error), b.mp4 consented — create is blocked
    // until every row is consented.
    fireEvent.click(screen.getByTestId('voice-keep-original'))
    expect((screen.getByTestId('create-submit') as HTMLButtonElement).disabled).toBe(true)

    // Consent again: only the failed row re-runs consent. Wait for the first
    // run to fully settle (button enabled) — a real user cannot click sooner.
    await vi.waitFor(() => {
      expect((screen.getByTestId('consent-confirm') as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(3)
    })
    expect(consentHookMock.mutateAsync.mock.calls[2]).toEqual([
      { assetId: 'asset-a.mp4', termsVersion: '2026-01-01' },
    ])
    await vi.waitFor(() => {
      expect((screen.getByTestId('create-submit') as HTMLButtonElement).disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('2/2 jobs created')
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(2)
    expect(apiCreateMock).toHaveBeenCalledTimes(2)
  })

  it('creates one job per checked target inline without any view jump', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('solo.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(1)
    // Tick a second target checkbox — per-target voice rows appear inline.
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect(await screen.findAllByTestId('multi-target-row')).toHaveLength(2)
    expect(screen.queryByTestId('localization-batch-panel')).toBeNull()

    fireEvent.click(screen.getByTestId('multi-keep-original'))
    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    })
    await waitForConsentSettled()
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('2/2 jobs created')
    // One upload, one consent, two creates on the SAME document.
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    expect(apiCreateMock).toHaveBeenCalledTimes(2)
    const bodies = apiCreateMock.mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(new Set(bodies.map((b) => b.documentId))).toEqual(new Set(['doc-solo.mp4']))
    expect(new Set(bodies.map((b) => b.targetLang))).toEqual(new Set(['vi', 'en']))
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends an explicit voice pair per target when dubbing inline', async () => {
    providersQuery.data = [
      {
        id: 'p1',
        displayName: 'Cloud TTS',
        protocol: 'azure_speech',
        capabilities: ['TTS'],
        defaultFor: ['TTS'],
        baseUrl: 'https://example.test',
        apiKeyHint: null,
        defaultModel: 'm',
        enabled: true,
      },
    ]
    voicesMap.set('p1', [
      { id: 'v-vi', voiceId: 'voice-vi', language: 'vi', gender: 'FEMALE', displayName: 'V', isActive: true, cachedAt: null },
      { id: 'v-en', voiceId: 'voice-en', language: 'en', gender: 'FEMALE', displayName: 'E', isActive: true, cachedAt: null },
    ])
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('solo.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect(await screen.findAllByTestId('multi-target-row')).toHaveLength(2)

    // Drive each row's provider select — autoSelect commits the first
    // compatible voice per target language.
    const providerSelects = await screen.findAllByTestId('voice-provider-select')
    expect(providerSelects).toHaveLength(2)
    fireEvent.change(providerSelects[0], { target: { value: 'p1' } })
    fireEvent.change(providerSelects[1], { target: { value: 'p1' } })
    const voiceSelects = await screen.findAllByTestId('voice-voice-select')
    expect((voiceSelects[0] as HTMLSelectElement).value).toBe('v-vi')
    expect((voiceSelects[1] as HTMLSelectElement).value).toBe('v-en')

    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    })
    await waitForConsentSettled()
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('2/2 jobs created')
    const bodies = apiCreateMock.mock.calls.map((c) => c[1] as Record<string, unknown>)
    const byLang = new Map(bodies.map((b) => [b.targetLang as string, b]))
    expect(byLang.get('vi')).toMatchObject({ ttsProviderId: 'p1', ttsVoiceId: 'v-vi' })
    expect(byLang.get('en')).toMatchObject({ ttsProviderId: 'p1', ttsVoiceId: 'v-en' })
  })

  it('reuses the staged upload on multi-target retry (no re-upload)', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('solo.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect(await screen.findAllByTestId('multi-target-row')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('multi-keep-original'))
    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await vi.waitFor(() => {
      expect(consentHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    })
    await waitForConsentSettled()
    apiCreateMock.mockRejectedValueOnce(new Error('boom-create'))
    fireEvent.click(screen.getByTestId('create-submit'))
    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('1/2 jobs created')
    expect(apiCreateMock).toHaveBeenCalledTimes(2)

    // Retry: the failed target re-runs create on the SAME document.
    fireEvent.click(screen.getByTestId('create-submit'))
    const retrySummary = await screen.findByTestId('staged-summary')
    expect(retrySummary.textContent).toContain('2/2 jobs created')
    expect(uploadHookMock.mutateAsync).toHaveBeenCalledTimes(1)
    expect(apiCreateMock).toHaveBeenCalledTimes(3)
  })

  it('bans N×N: staged videos lock targets and block submit with a hint', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    // Pick two targets first, then stage a second video → N×N dead-end.
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect(await screen.findAllByTestId('multi-target-row')).toHaveLength(2)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    expect(screen.getByTestId('nxn-hint')).toBeTruthy()
    expect((screen.getByTestId('create-submit') as HTMLButtonElement).disabled).toBe(true)
    // Escape hatch: unchecking a target re-enables submit.
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect(screen.queryByTestId('nxn-hint')).toBeNull()
  })

  it('locks target checkboxes to one language once several videos are staged', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('a.mp4'), videoFile('b.mp4')] },
    })
    expect(await screen.findAllByTestId('staged-row')).toHaveLength(2)
    // Checking a second target is refused while several videos are staged.
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect((screen.getByTestId('target-check-en') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByTestId('multi-target-row')).toBeNull()
  })

  it('toggles target dropdown, removes targets via chip remove button, and closes on Escape', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    const trigger = screen.getByTestId('target-dropdown-trigger')
    const menu = screen.getByTestId('target-checkboxes')

    // Initial state: 1 target ('vi'), menu hidden, no chips
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(menu.className).toContain('hidden')
    expect(screen.queryByTestId('selected-target-chips')).toBeNull()

    // Click trigger -> opens dropdown
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(menu.className).not.toContain('hidden')

    // Select second target 'en' -> chips appear
    fireEvent.click(screen.getByTestId('target-check-en'))
    expect((screen.getByTestId('target-check-en') as HTMLInputElement).checked).toBe(true)
    const chipsContainer = screen.getByTestId('selected-target-chips')
    expect(chipsContainer).toBeTruthy()

    // Press Escape -> closes dropdown
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(menu.className).toContain('hidden')

    // Remove 'en' via its chip remove button -> reverts to 1 target
    const removeEnBtn = screen.getByRole('button', { name: /remove en/i })
    fireEvent.click(removeEnBtn)
    expect((screen.getByTestId('target-check-en') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByTestId('selected-target-chips')).toBeNull()
    expect(screen.queryByTestId('multi-target-row')).toBeNull()
  })

  it('renders staged rows with soft blue cards and shows redirecting countdown in summary', async () => {
    render(<UploadConsentPanel workspaceId="ws" projectId="prj" />)
    fireEvent.change(screen.getByTestId('single-file-input'), {
      target: { files: [videoFile('v1.mp4'), videoFile('v2.mp4')] },
    })
    const rows = await screen.findAllByTestId('staged-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].className).toContain('bg-[var(--color-media-soft)]')
    expect(rows[0].className).toContain('batch-file-row')

    fireEvent.click(screen.getByTestId('consent-check'))
    fireEvent.click(screen.getByTestId('consent-confirm'))
    await waitForConsentSettled()
    fireEvent.click(screen.getByTestId('voice-keep-original'))
    fireEvent.click(screen.getByTestId('create-submit'))

    const summary = await screen.findByTestId('staged-summary')
    expect(summary.textContent).toContain('2/2 jobs created')
    expect(summary.textContent).toMatch(/redirecting/i)
  })
})

