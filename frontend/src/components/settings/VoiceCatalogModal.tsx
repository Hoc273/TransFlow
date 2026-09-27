import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLoader2, IconPlayerPlay, IconRefresh, IconSearch } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { useVoicePreview } from '@/hooks/useProviders'
import {
  foldForSearch,
  formatVoiceLanguage,
  groupVoicesForPicker,
  listVoiceLanguages,
  sortVoicesByName,
  splitVoicesByLanguage,
  type VoiceGroup,
} from '@/lib/media/voiceSelection'
import { ApiError } from '@/types/api'
import type { TtsVoice } from '@/types/provider'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  voices: TtsVoice[] | undefined
  loading: boolean
  /** Re-sync the catalog from the provider (BYOK refresh / platform sync). */
  onRefresh?: () => Promise<unknown>
  refreshing?: boolean
}

/**
 * TTS voice catalog of one provider — shared by personal API keys and the
 * platform admin pool. Languages and voices are A→Z in the web language;
 * picking a language lists voices native to it, and multilingual voices of
 * other locales (Azure en-US-…Multilingual also reads Korean) are opt-in.
 */
export function VoiceCatalogModal({ open, onClose, title, description, voices, loading, onRefresh, refreshing }: Props) {
  const { t, i18n } = useTranslation(['settings', 'media', 'common'])
  const tv = (key: string, options?: Record<string, unknown>) => t(`settings:providers.voices.${key}`, options)
  const uiLang = i18n?.language
  const preview = useVoicePreview()

  const [language, setLanguage] = useState('')
  const [query, setQuery] = useState('')
  const [showMultilingual, setShowMultilingual] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const languages = useMemo(() => listVoiceLanguages(voices, uiLang), [voices, uiLang])

  // Open on the web language when the catalog speaks it; else every language.
  useEffect(() => {
    if (!open) return
    const ui = (uiLang ?? '').split('-')[0]
    setLanguage(languages.length === 1
      ? languages[0].code
      : languages.some((l) => l.code === ui && l.nativeCount > 0) ? ui : '')
    setQuery('')
    setShowMultilingual(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, languages.length])

  const split = useMemo(
    () => (language ? splitVoicesByLanguage(voices ?? [], language) : null),
    [voices, language],
  )
  // A language without native voices would otherwise show an empty table.
  const multilingualVisible = showMultilingual || (split !== null && split.native.length === 0)

  const groups: VoiceGroup[] = useMemo(() => {
    if (language) {
      return groupVoicesForPicker(voices, language, { query, includeMultilingual: multilingualVisible, uiLang })
    }
    // Every language: one group per locale, A→Z.
    const folded = foldForSearch(query.trim())
    const byLocale = new Map<string, TtsVoice[]>()
    for (const voice of voices ?? []) {
      if (folded && ![voice.displayName, voice.voiceId, voice.language, formatVoiceLanguage(voice.language, uiLang)]
        .some((f) => foldForSearch(f ?? '').includes(folded))) continue
      const locale = voice.language.trim().toLowerCase()
      byLocale.set(locale, [...(byLocale.get(locale) ?? []), voice])
    }
    return [...byLocale.entries()]
      .map(([locale, list]) => ({
        key: `native:${locale}`,
        kind: 'native' as const,
        locale,
        voices: sortVoicesByName(list, uiLang),
      }))
      .sort((a, b) => formatVoiceLanguage(a.locale, uiLang).localeCompare(formatVoiceLanguage(b.locale, uiLang), uiLang))
  }, [voices, language, query, multilingualVisible, uiLang])

  const shownCount = groups.reduce((sum, g) => sum + g.voices.length, 0)

  const playPreview = (voice: TtsVoice) => {
    setError(null)
    void preview
      .mutateAsync({ providerId: voice.providerId ?? '', voiceRowId: voice.id, language: voice.language })
      .catch((err: unknown) => {
        setError(`${tv('previewError')}: ${err instanceof ApiError ? err.message : t('common:error.generic')}`)
      })
  }

  return (
    <Modal
      open={open}
      onClose={() => !refreshing && onClose()}
      title={title}
      description={description}
      size="lg"
      className="voice-catalog-modal"
    >
      <div className="space-y-4" data-testid="voice-catalog">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-[var(--color-text-secondary)]">
            {tv('activeCount', { count: voices?.length ?? 0 })}
          </p>
          {onRefresh && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={refreshing}
              onClick={() => {
                setError(null)
                void onRefresh().catch((err: unknown) =>
                  setError(err instanceof ApiError ? err.message : t('common:error.generic')))
              }}
            >
              <IconRefresh size={14} />
              {refreshing ? tv('refreshing') : tv('refresh')}
            </button>
          )}
        </div>

        {(voices?.length ?? 0) > 0 && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <label className="field-label">
              <span>{tv('language')}</span>
              <select
                className="field-input"
                data-testid="voice-catalog-language"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value)
                  setShowMultilingual(false)
                }}
              >
                <option value="">{tv('allLanguages')}</option>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                    {' · '}
                    {l.nativeCount > 0
                      ? tv('languageCount', { count: l.nativeCount })
                      : tv('multilingualOnly', { count: l.multilingualCount })}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>{tv('search')}</span>
              <span className="relative block">
                <IconSearch
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
                />
                <input
                  type="search"
                  className="field-input pl-8"
                  data-testid="voice-catalog-search"
                  value={query}
                  placeholder={t('media:voice.searchPlaceholder')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </span>
            </label>
          </div>
        )}

        {split && split.native.length > 0 && split.multilingual.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              data-testid="voice-catalog-show-multilingual"
              checked={showMultilingual}
              onChange={(e) => setShowMultilingual(e.target.checked)}
            />
            {tv('showMultilingual', {
              count: split.multilingual.length,
              language: formatVoiceLanguage(language, uiLang),
            })}
          </label>
        )}

        <div className="voice-catalog-table-wrap">
          {loading ? (
            <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">{t('common:loading')}</p>
          ) : (voices?.length ?? 0) === 0 ? (
            <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">{tv('empty')}</p>
          ) : shownCount === 0 ? (
            <p className="m-0 p-4 text-sm text-[var(--color-text-tertiary)]">
              {query ? tv('noMatch') : tv('noneForLanguage', { language: formatVoiceLanguage(language, uiLang) })}
            </p>
          ) : (
            <table className="dd-table voice-catalog-table">
              <thead>
                <tr>
                  <th>{tv('displayName')}</th>
                  <th>{tv('gender')}</th>
                  <th className="voice-catalog-preview-col">{tv('preview')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <Fragment key={group.key}>
                    <tr className="voice-catalog-group-row">
                      <td colSpan={3}>
                        {group.kind === 'multilingual'
                          ? tv('multilingualGroup')
                          : formatVoiceLanguage(group.locale ?? '', uiLang)}
                        <span className="voice-catalog-group-count">{group.voices.length}</span>
                      </td>
                    </tr>
                    {group.voices.map((voice) => (
                      <tr key={voice.id} data-testid="voice-catalog-row" data-voice-id={voice.voiceId}>
                        <td>
                          <div className="font-medium text-[var(--color-text-primary)]">
                            {voice.displayName || voice.voiceId}
                            {voice.status === 'PREVIEW' && (
                              <span className="role-pill ml-1.5 text-[10px]">{t('media:voice.previewTag')}</span>
                            )}
                          </div>
                          <div className="voice-catalog-id" title={voice.voiceId}>
                            {group.kind === 'multilingual'
                              ? `${formatVoiceLanguage(voice.language, uiLang)} · ${voice.voiceId}`
                              : voice.voiceId}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">
                          {voice.gender && voice.gender !== 'UNKNOWN'
                            ? t(`media:voice.gender.${voice.gender}`, { defaultValue: voice.gender })
                            : '—'}
                        </td>
                        <td className="voice-catalog-preview-col">
                          <button
                            type="button"
                            className="btn-secondary btn-sm whitespace-nowrap"
                            disabled={preview.isPending}
                            onClick={() => playPreview(voice)}
                          >
                            {preview.isPending && preview.variables?.voiceRowId === voice.id ? (
                              <IconLoader2 size={14} className="animate-spin" />
                            ) : (
                              <IconPlayerPlay size={14} />
                            )}
                            {tv('preview')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
