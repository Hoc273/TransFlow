import { beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => t(k) }),
}))

const presetsQuery = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
}
vi.mock('@/hooks/useWorkflowPresets', () => ({
  useWorkflowPresets: () => presetsQuery,
}))

const { renderToStaticMarkup } = await import('react-dom/server')
const {
  WorkflowPresetPicker,
  activePresets,
  presetById,
  optionToPresetId,
  presetWorkflowModeLabelKey,
  presetSubtitleModeLabelKey,
  presetDisplayModeLabelKey,
  presetAspectSuffix,
} = await import('./WorkflowPresetPicker')

import type { WorkflowPreset } from '@/types/media'

function preset(partial: Partial<WorkflowPreset>): WorkflowPreset {
  return {
    id: 'p1',
    scope: 'WORKSPACE',
    workspaceId: 'ws',
    projectId: null,
    name: 'Studio standard',
    description: null,
    config: { schemaVersion: 1, workflowMode: 'MANUAL', subtitleMode: 'HARD_SUB' },
    schemaVersion: 1,
    active: true,
    isDefault: false,
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    ...partial,
  }
}

const renderPicker = (value: string | null) =>
  renderToStaticMarkup(
    <WorkflowPresetPicker
      workspaceId="ws"
      projectId="prj"
      value={value}
      onChange={() => {}}
    />,
  )

describe('WorkflowPresetPicker — M-C create-form picker (docs/16 §7.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    presetsQuery.data = undefined
    presetsQuery.isPending = false
    presetsQuery.isError = false
  })

  it('renders active presets grouped by scope with scope labels', () => {
    presetsQuery.data = [
      preset({ id: 'sys-1', scope: 'SYSTEM', name: 'System Auto' }),
      preset({ id: 'ws-1', scope: 'WORKSPACE', name: 'Studio standard' }),
      preset({ id: 'prj-1', scope: 'PROJECT', name: 'Project Manual', isDefault: true }),
    ]

    const html = renderPicker(null)

    expect(html).toContain('media:workflowPreset.label')
    expect(html).toContain('media:workflowPreset.none')
    expect(html).toContain('media:workflowPreset.scopeSystem')
    expect(html).toContain('media:workflowPreset.scopeWorkspace')
    expect(html).toContain('media:workflowPreset.scopeProject')
    expect(html).toContain('value="sys-1"')
    expect(html).toContain('value="ws-1"')
    expect(html).toContain('value="prj-1"')
    expect(html).toContain('media:workflowPreset.default')
  })

  it('never renders inactive presets', () => {
    presetsQuery.data = [
      preset({ id: 'ws-1', scope: 'WORKSPACE', name: 'Active' }),
      preset({ id: 'ws-2', scope: 'WORKSPACE', name: 'Deactivated', active: false }),
    ]

    const html = renderPicker(null)

    expect(html).toContain('value="ws-1"')
    expect(html).not.toContain('value="ws-2"')
  })

  it('renders the resolved summary from the preset config (mode + subtitle)', () => {
    presetsQuery.data = [preset({ id: 'ws-1', scope: 'WORKSPACE', name: 'Studio standard' })]

    const html = renderPicker('ws-1')

    expect(html).toContain('workflow-preset-summary')
    expect(html).toContain('Studio standard')
    expect(html).toContain('media:workflowPreset.mode')
    expect(html).toContain('media:workflowPreset.subtitle')
    expect(html).toContain('media:workflowPreset.hint')
  })

  it('renders presentation fields in the summary when the response carries them (P1 M-C)', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        scope: 'WORKSPACE',
        name: 'Studio standard',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          presentation: {
            subtitle: { schemaVersion: 1, displayMode: 'CHARACTERS', maxCharactersPerCue: 40 },
          },
        },
      }),
    ]

    const html = renderPicker('ws-1')

    expect(html).toContain('media:workflowPreset.display')
    expect(html).toContain('media:workflowPreset.maxCharacters')
  })

  it('omits presentation lines when the config has none', () => {
    presetsQuery.data = [preset({ id: 'ws-1', config: { schemaVersion: 1 } })]

    const html = renderPicker('ws-1')

    expect(html).toContain('workflow-preset-summary')
    expect(html).not.toContain('media:workflowPreset.display')
    expect(html).not.toContain('media:workflowPreset.maxCharacters')
  })

  it('shows a semantic voice label when the preset configures a TTS pair (never raw UUIDs)', () => {
    presetsQuery.data = [
      preset({
        id: 'ws-1',
        scope: 'WORKSPACE',
        name: 'Dubbed studio',
        config: {
          schemaVersion: 1,
          workflowMode: 'AUTO',
          subtitleMode: 'HARD_SUB',
          ttsProviderId: '8d7c2a91-1111-1111-1111-111111111111',
          ttsVoiceId: '8d7c2a91-2222-2222-2222-222222222222',
        },
      }),
    ]

    const html = renderPicker('ws-1')

    expect(html).toContain('media:workflowPreset.voiceConfigured')
    expect(html).not.toContain('8d7c2a91-1111')
    expect(html).not.toContain('8d7c2a91-2222')
  })

  it('C2 gap 2: notes that the explicit create-form mode wins over the preset mode', () => {
    // Preset says MANUAL, the create form selected AUTO → explicit AUTO wins.
    presetsQuery.data = [preset({ id: 'ws-1', config: { schemaVersion: 1, workflowMode: 'MANUAL' } })]

    const html = renderToStaticMarkup(
      <WorkflowPresetPicker
        workspaceId="ws"
        projectId="prj"
        value="ws-1"
        onChange={() => {}}
        explicitMode="AUTO"
      />,
    )

    expect(html).toContain('preset-mode-override-note')
    expect(html).toContain('media:workflowPreset.modeOverrideNote')

    // Same mode → no note.
    const same = renderToStaticMarkup(
      <WorkflowPresetPicker
        workspaceId="ws"
        projectId="prj"
        value="ws-1"
        onChange={() => {}}
        explicitMode="MANUAL"
      />,
    )
    expect(same).not.toContain('preset-mode-override-note')

    // No explicit mode (or preset mode absent) → no note.
    const none = renderToStaticMarkup(
      <WorkflowPresetPicker workspaceId="ws" projectId="prj" value="ws-1" onChange={() => {}} />,
    )
    expect(none).not.toContain('preset-mode-override-note')
  })

  it('omits the voice line when the preset has no TTS pair', () => {
    presetsQuery.data = [preset({ id: 'ws-1', config: { schemaVersion: 1, workflowMode: 'AUTO' } })]

    const html = renderPicker('ws-1')

    expect(html).not.toContain('media:workflowPreset.voiceConfigured')
  })

  it('label helpers map the resolved config to i18n keys (never invented semantics)', () => {
    expect(presetWorkflowModeLabelKey('MANUAL')).toBe('media:workflow.manual')
    expect(presetWorkflowModeLabelKey('AUTO')).toBe('media:workflow.auto')
    expect(presetWorkflowModeLabelKey(null)).toBeNull()
    expect(presetSubtitleModeLabelKey('HARD_SUB')).toBe('media:subtitleHard')
    expect(presetSubtitleModeLabelKey('SOFT_SUB')).toBe('media:subtitleSoft')
    expect(presetSubtitleModeLabelKey(undefined)).toBeNull()
    expect(presetDisplayModeLabelKey('SENTENCE')).toBe('media:renderPrep.displayModeSentence')
    expect(presetDisplayModeLabelKey('PHRASE')).toBe('media:renderPrep.displayModePhrase')
    expect(presetDisplayModeLabelKey('WORD')).toBe('media:renderPrep.displayModeWord')
    expect(presetDisplayModeLabelKey('CHARACTERS')).toBe('media:renderPrep.displayModeCharacters')
    expect(presetDisplayModeLabelKey(null)).toBeNull()
  })

  it('renders no summary when nothing is selected', () => {
    presetsQuery.data = [preset({ id: 'ws-1' })]

    const html = renderPicker(null)

    expect(html).not.toContain('workflow-preset-summary')
  })

  it('shows a loading state while the list is pending', () => {
    presetsQuery.isPending = true

    const html = renderPicker(null)

    expect(html).toContain('media:workflowPreset.loading')
  })

  it('is fail-safe on list errors — inline error, no crash', () => {
    presetsQuery.isError = true

    const html = renderPicker(null)

    expect(html).toContain('media:workflowPreset.error')
  })

  it('shows the empty state when no presets exist', () => {
    presetsQuery.data = []

    const html = renderPicker(null)

    expect(html).toContain('media:workflowPreset.empty')
  })

  it('flags a stale selected preset as invalid and never renders a fabricated summary', () => {
    presetsQuery.data = [preset({ id: 'ws-2', scope: 'WORKSPACE', name: 'New preset' })]

    const html = renderPicker('ws-1')

    expect(html).toContain('media:workflowPreset.invalid')
    expect(html).not.toContain('workflow-preset-summary')
  })

  it('preset helpers: active-only filter, stale resolution and option mapping', () => {
    const list = [
      preset({ id: 'a', active: true }),
      preset({ id: 'b', active: false }),
    ]

    expect(activePresets(list).map((p) => p.id)).toEqual(['a'])
    expect(activePresets(undefined)).toEqual([])
    expect(presetById(list, 'a')?.id).toBe('a')
    // Inactive rows never resolve — no stale/fabricated config.
    expect(presetById(list, 'b')).toBeNull()
    expect(presetById(list, 'gone')).toBeNull()
    expect(presetById(list, null)).toBeNull()
    expect(optionToPresetId('preset-1')).toBe('preset-1')
    expect(optionToPresetId('')).toBeNull()
  })

  it('option labels carry the output frame so 16:9 and 9:16 presets read apart', () => {
    expect(presetAspectSuffix(preset({ config: { outputAspectRatio: '9:16' } }))).toBe(' (9:16)')
    expect(presetAspectSuffix(preset({ config: { outputAspectRatio: '16:9' } }))).toBe(' (16:9)')
    expect(presetAspectSuffix(preset({ config: { outputAspectRatio: 'ORIGINAL' } }))).toBe('')
    expect(presetAspectSuffix(preset({ config: null }))).toBe('')

    presetsQuery.data = [preset({ id: 'reels', name: 'Social Media Shorts / Reels', config: { outputAspectRatio: '9:16' } })]
    const html = renderToStaticMarkup(
      <WorkflowPresetPicker workspaceId="ws" projectId="p" value={null} onChange={() => {}} />,
    )
    expect(html).toContain('Social Media Shorts / Reels (9:16)')
  })
})
