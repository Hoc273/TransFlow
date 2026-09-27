import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle } from '@tabler/icons-react'
import { Modal } from '@/components/shared/Modal'
import { formatLanguageOption, LANG_OPTIONS } from '@/lib/languages'

type Props = {
  open: boolean
  /** Current job source language (null = auto-detect). */
  currentLang: string | null | undefined
  /** UI language used to render language option labels. */
  uiLanguage: string
  /** True when any stage already ran — the change rewinds TRANSLATE → TTS → RENDER. */
  willRerun: boolean
  loading?: boolean
  error?: string | null
  onClose: () => void
  onApply: (lang: string) => void
}

/**
 * Change-source-language dialog for Job Studio. The dialog itself is the
 * confirmation step: when the pipeline already ran, the rerun warning is shown
 * inline and the primary action reads "Confirm & re-run".
 */
export function SourceLangModal({
  open,
  currentLang,
  uiLanguage,
  willRerun,
  loading,
  error,
  onClose,
  onApply,
}: Props) {
  const { t } = useTranslation(['media', 'common'])
  const [draft, setDraft] = useState(currentLang ?? '')

  useEffect(() => {
    if (open) setDraft(currentLang ?? '')
  }, [open, currentLang])

  const unchanged = draft === (currentLang ?? '')

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={t('media:pipeline.overrideLang')}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {t('common:actions.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary"
            data-testid="source-lang-apply"
            disabled={!draft.trim() || unchanged || loading}
            onClick={() => onApply(draft.trim())}
          >
            {willRerun ? t('media:pipeline.overrideConfirmApply') : t('media:pipeline.applyLang')}
          </button>
        </>
      }
    >
      <div className="space-y-3" data-testid="source-lang-editor">
        <label className="field-label">
          <span>{t('media:pipeline.sourceLang')}</span>
          <select
            className="field-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
          >
            <option value="">{t('media:pipeline.selectSourceLang')}</option>
            {LANG_OPTIONS.map((lang) => (
              <option key={lang} value={lang}>
                {formatLanguageOption(lang, uiLanguage)}
              </option>
            ))}
          </select>
        </label>
        {willRerun ? (
          <div className="media-banner warn" data-testid="lang-override-confirm">
            <IconAlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p className="m-0 text-sm">{t('media:pipeline.overrideConfirm')}</p>
          </div>
        ) : (
          <p className="field-help m-0">{t('media:pipeline.staleWarn')}</p>
        )}
        {error && (
          <p className="field-error m-0" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
