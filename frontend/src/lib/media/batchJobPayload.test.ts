import { describe, expect, it } from 'vitest'
import {
  BATCH_CONCURRENCY,
  buildLocalizationCreateJobInput,
  mapWithConcurrency,
  type LocalizationJobPayloadInput,
} from '@/lib/media/batchJobPayload'

function input(partial: Partial<LocalizationJobPayloadInput>): LocalizationJobPayloadInput {
  return {
    documentId: 'doc-1',
    recipeId: 'localization.full',
    targetLang: 'vi',
    requestedDurationSeconds: null,
    requestedMode: 'FAST',
    voiceSelection: { providerId: 'p1', voiceId: 'v1' },
    ...partial,
  }
}

describe('buildLocalizationCreateJobInput', () => {
  it('sends the explicit provider+voice pair through', () => {
    const body = buildLocalizationCreateJobInput(input({}))
    expect(body.ttsProviderId).toBe('p1')
    expect(body.ttsVoiceId).toBe('v1')
    expect(body.keepOriginalAudio).toBe(false)
    expect(body.skipPresetResolution).toBe(true)
    expect(body.workflowPresetId).toBeNull()
  })

  it('forces null/null TTS when keepOriginalAudio is set, even with a pair present', () => {
    const body = buildLocalizationCreateJobInput(input({ keepOriginalAudio: true }))
    expect(body.ttsProviderId).toBeNull()
    expect(body.ttsVoiceId).toBeNull()
    expect(body.keepOriginalAudio).toBe(true)
  })

  it('sends null/null (no throw) when the preset provides the voice pair', () => {
    const body = buildLocalizationCreateJobInput(
      input({ presetProvidesVoice: true }),
    )
    expect(body.ttsProviderId).toBeNull()
    expect(body.ttsVoiceId).toBeNull()
  })

  it('does not throw on a transient provider-only selection when the preset binds the voice', () => {
    const body = buildLocalizationCreateJobInput(
      input({
        presetProvidesVoice: true,
        voiceSelection: { providerId: 'p1', voiceId: null },
      }),
    )
    expect(body.ttsProviderId).toBeNull()
    expect(body.ttsVoiceId).toBeNull()
  })

  it('throws on a partial pair without preset voice (backend would 422)', () => {
    expect(() => buildLocalizationCreateJobInput(
      input({ voiceSelection: { providerId: 'p1', voiceId: null } }),
    )).toThrow('partial TTS binding')
  })

  it('sends skipPresetResolution=false when a preset id is pinned', () => {
    const body = buildLocalizationCreateJobInput(input({ workflowPresetId: 'preset-1' }))
    expect(body.workflowPresetId).toBe('preset-1')
    expect(body.skipPresetResolution).toBe(false)
  })

  it('forwards shared preset/workflow fields verbatim for every row', () => {
    const body = buildLocalizationCreateJobInput(
      input({
        sourceLang: 'en',
        workflowMode: 'AUTO',
        workflowPresetId: 'preset-9',
        voiceSelection: { providerId: 'p-en', voiceId: 'v-en' },
        targetLang: 'ja',
      }),
    )
    expect(body).toMatchObject({
      sourceLang: 'en',
      targetLang: 'ja',
      workflowMode: 'AUTO',
      workflowPresetId: 'preset-9',
      skipPresetResolution: false,
      ttsProviderId: 'p-en',
      ttsVoiceId: 'v-en',
    })
  })
})

describe('mapWithConcurrency', () => {
  it('preserves input order and caps in-flight work at the limit', async () => {
    expect(BATCH_CONCURRENCY).toBe(3)
    let inFlight = 0
    let maxInFlight = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (n) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return n * 10
    })
    expect(results).toEqual([10, 20, 30, 40, 50, 60])
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('returns an empty array for empty input without calling fn', async () => {
    let calls = 0
    const results = await mapWithConcurrency([], 3, async () => {
      calls += 1
      return 1
    })
    expect(results).toEqual([])
    expect(calls).toBe(0)
  })
})
