import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RenderPreparationPanel } from '@/components/media-studio/RenderPreparationPanel'
import {
  DEFAULT_AUDIO_PRESENTATION,
  type AudioPresentationValues,
} from '@/components/media-studio/RenderPreparationPanel'
import { SubtitleStylePanel } from '@/components/media-studio/SubtitleStylePanel'
import { VoiceSelector } from '@/components/media-studio/VoiceSelector'
import { useRenderConfig } from '@/hooks/useMedia'
import { isGenerativeRecipe } from '@/lib/media'
import type { MediaJob } from '@/types/media'
import type { ProviderConfig, TtsVoice } from '@/types/provider'

type Props = {
  workspaceId: string
  job: MediaJob
  providers: ProviderConfig[]
  provider?: ProviderConfig
  voices: TtsVoice[]
  selectedProviderId: string | null
  canEdit: boolean
  selectVoicePending: boolean
  onVoiceChange: (selection: { providerId: string | null; voiceId: string | null }) => void
}

/**
 * UI aggregation of voice + subtitle style + audio + render prep (§1.8.2
 * redesign). Does not create backend stages — only groups existing surfaces.
 *
 * Layout: one workbench — RenderPreparationPanel hosts the sticky preview +
 * decision actions on the left and the numbered config groups on the right;
 * the VoiceSelector and SubtitleStylePanel are passed as slots for groups
 * ①/②. Audio values stay owned here (hydrated from the shared render-config
 * query) and flow into the panel for the confirm payload.
 */
export function RenderAndVoiceSection({
  workspaceId,
  job,
  providers,
  provider,
  voices,
  selectedProviderId,
  canEdit,
  selectVoicePending,
  onVoiceChange,
}: Props) {
  const { t } = useTranslation('media')

  const translateReady = job.stages.some(
    (stage) => stage.stageName === 'TRANSLATE' && stage.status === 'COMPLETED',
  )
  const configQuery = useRenderConfig(workspaceId, job.id, translateReady)

  // Audio presentation values live here and flow into the panel's group ④ and
  // its confirm payload via the `audio` / `onAudioChange` props.
  const [audio, setAudio] = useState<AudioPresentationValues>(DEFAULT_AUDIO_PRESENTATION)
  useEffect(() => {
    const aud = configQuery.data?.presentation?.audio
    if (!aud) return
    setAudio({
      originalGainDb: aud.originalGainDb ?? DEFAULT_AUDIO_PRESENTATION.originalGainDb,
      ttsGainDb: aud.ttsGainDb ?? DEFAULT_AUDIO_PRESENTATION.ttsGainDb,
      duckingEnabled: aud.ducking?.enabled ?? DEFAULT_AUDIO_PRESENTATION.duckingEnabled,
      duckingGainDb: aud.ducking?.gainDb ?? DEFAULT_AUDIO_PRESENTATION.duckingGainDb,
      ttsTempo: aud.ttsTempo ?? DEFAULT_AUDIO_PRESENTATION.ttsTempo,
    })
  }, [configQuery.data])

  return (
    <section className="space-y-2" data-testid="render-and-voice-section">
      <section className="space-y-2" data-testid="finish-render-prep-block">
      <RenderPreparationPanel
        workspaceId={workspaceId}
        job={job}
        provider={provider}
        voices={voices}
        canEdit={canEdit}
        hideVoiceGrid
        audio={audio}
        onAudioChange={setAudio}
        voiceSlot={
          <div data-testid="finish-voice-block" className="space-y-2">
            <VoiceSelector
              workspaceId={workspaceId}
              providers={providers}
              targetLang={job.targetLang}
              selectedProviderId={selectedProviderId}
              selectedVoiceId={job.ttsVoiceId ?? null}
              disabled={!canEdit || selectVoicePending}
              allowOriginal={!isGenerativeRecipe(job)}
              onChange={onVoiceChange}
            />
            <p className="mb-0 text-xs leading-relaxed text-[var(--color-text-tertiary)]">
              {t('voice.regenHint')}
            </p>
          </div>
        }
        styleSlot={
          <div data-testid="finish-style-block">
            <SubtitleStylePanel jobId={job.id} canEdit={canEdit} compact />
          </div>
        }
      />
      </section>
    </section>
  )
}
