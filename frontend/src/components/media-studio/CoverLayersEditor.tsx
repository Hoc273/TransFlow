// @ts-nocheck
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import {
  COVER_ANCHORS,
  COVER_BLUR_MAX,
  COVER_BLUR_MIN,
  COVER_HEIGHT_MAX,
  COVER_HEIGHT_MIN,
  COVER_OPACITY_MAX,
  COVER_OPACITY_MIN,
  COVER_WIDTH_MAX,
  COVER_WIDTH_MIN,
  MAX_COVER_LAYERS,
  defaultCoverLayer,
} from '@/lib/media/coverLayers'
import type { PresentationLayer, PresentationLayerAnchor } from '@/types/media'

/**
 * Shared V2 cover-layers editor (docs/97 §19.17 §B exposure — user decision
 * 2026-09-06): every cover the user configures is stored as an authoritative
 * v2 layer; the legacy v1 mask field is never written again. Each layer picks
 * an independent semantic anchor, so covers can hide several burned-in regions
 * while the subtitle itself sits somewhere else.
 *
 * Presentational + controlled — the host (job Finish & Render panel / preset
 * editor) owns the enabled + layers state and the payload building.
 */
export function CoverLayersEditor({
  enabled,
  layers,
  locked,
  onChange,
  testidPrefix = 'cover',
}: {
  enabled: boolean
  layers: PresentationLayer[]
  locked: boolean
  onChange: (next: { enabled: boolean; layers: PresentationLayer[] }) => void
  testidPrefix?: string
}) {
  const { t } = useTranslation(['media'])
  const atCap = layers.length >= MAX_COVER_LAYERS

  const updateLayer = (index: number, patch: Partial<PresentationLayer>) => {
    onChange({
      enabled,
      layers: layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    })
  }

  const updateGeometry = (index: number, key: 'widthPercent' | 'heightPercent', raw: number) => {
    const min = key === 'widthPercent' ? COVER_WIDTH_MIN : COVER_HEIGHT_MIN
    const max = key === 'widthPercent' ? COVER_WIDTH_MAX : COVER_HEIGHT_MAX
    const layer = layers[index]
    updateLayer(index, { geometry: { ...layer.geometry, [key]: Math.max(min, Math.min(max, raw)) } })
  }

  const addLayer = () => {
    if (atCap) return
    onChange({ enabled, layers: [...layers, defaultCoverLayer(layers)] })
  }

  const removeLayer = (index: number) => {
    onChange({ enabled, layers: layers.filter((_, i) => i !== index) })
  }

  const moveLayer = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= layers.length) return
    const next = [...layers]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ enabled, layers: next })
  }

  return (
    <div className="space-y-3" data-testid={`${testidPrefix}-layers`}>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          data-testid={`${testidPrefix}-enable`}
          checked={enabled}
          disabled={locked}
          onChange={(e) => onChange({ enabled: e.target.checked, layers })}
        />
        {t('media:renderPrep.coverEnable')}
      </label>
      {enabled && (
        <>
          <p className="field-help m-0">{t('media:renderPrep.coverHint')}</p>
          <div className="space-y-3">
            {layers.map((layer, index) => (
              <CoverLayerCard
                key={layer.id}
                layer={layer}
                index={index}
                count={layers.length}
                locked={locked}
                prefix={testidPrefix}
                onPatch={(patch) => updateLayer(index, patch)}
                onGeometry={(key, value) => updateGeometry(index, key, value)}
                onRemove={() => removeLayer(index)}
                onMove={(delta) => moveLayer(index, delta)}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-media-secondary btn-sm"
              data-testid={`${testidPrefix}-layer-add`}
              disabled={locked || atCap}
              onClick={addLayer}
            >
              <IconPlus size={14} />
              {t('media:renderPrep.coverAdd')}
            </button>
            <span className="text-[11px] text-[var(--color-text-tertiary)]">
              {t('media:renderPrep.coverCount', { used: layers.length, max: MAX_COVER_LAYERS })}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function CoverLayerCard({
  layer,
  index,
  count,
  locked,
  prefix,
  onPatch,
  onGeometry,
  onRemove,
  onMove,
}: {
  layer: PresentationLayer
  index: number
  count: number
  locked: boolean
  prefix: string
  onPatch: (patch: Partial<PresentationLayer>) => void
  onGeometry: (key: 'widthPercent' | 'heightPercent', value: number) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const { t } = useTranslation(['media'])
  const isBlur = layer.type === 'BLUR'

  return (
    <div
      className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] p-3"
      data-testid={`${prefix}-layer-${index}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
          {t('media:renderPrep.coverLayerLabel', { index: index + 1 })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn-media-secondary btn-sm px-1.5"
            aria-label={t('media:renderPrep.coverMoveUp')}
            data-testid={`${prefix}-layer-${index}-up`}
            disabled={locked || index === 0}
            onClick={() => onMove(-1)}
          >
            <IconArrowUp size={13} />
          </button>
          <button
            type="button"
            className="btn-media-secondary btn-sm px-1.5"
            aria-label={t('media:renderPrep.coverMoveDown')}
            data-testid={`${prefix}-layer-${index}-down`}
            disabled={locked || index === count - 1}
            onClick={() => onMove(1)}
          >
            <IconArrowDown size={13} />
          </button>
          <button
            type="button"
            className="btn-media-secondary btn-sm px-1.5 text-[var(--color-danger)]"
            aria-label={t('media:renderPrep.coverRemove')}
            data-testid={`${prefix}-layer-${index}-remove`}
            disabled={locked}
            onClick={onRemove}
          >
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="field-label">
          <span>{t('media:renderPrep.coverPositionLabel')}</span>
          <select
            className="field-input"
            data-testid={`${prefix}-layer-${index}-anchor`}
            value={layer.anchor}
            disabled={locked}
            onChange={(e) => onPatch({ anchor: e.target.value as PresentationLayerAnchor })}
          >
            {COVER_ANCHORS.map((anchor) => (
              <option key={anchor} value={anchor}>
                {t(`media:renderPrep.layerAnchor${anchor.charAt(0)}${anchor.slice(1).toLowerCase()}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.maskStyle')}</span>
          <select
            className="field-input"
            data-testid={`${prefix}-layer-${index}-style`}
            value={layer.type}
            disabled={locked}
            onChange={(e) => {
              const type = e.target.value as 'SOLID' | 'BLUR'
              onPatch({
                type,
                style:
                  type === 'BLUR'
                    ? { blurRadius: 10 }
                    : { color: '#000000', opacityPercent: 60 },
              })
            }}
          >
            <option value="SOLID">{t('media:renderPrep.maskStyleSolid')}</option>
            <option value="BLUR">{t('media:renderPrep.maskStyleBlur')}</option>
          </select>
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.maskWidth')}</span>
          <input
            type="number"
            className="field-input"
            min={COVER_WIDTH_MIN}
            max={COVER_WIDTH_MAX}
            data-testid={`${prefix}-layer-${index}-width`}
            value={layer.geometry.widthPercent}
            disabled={locked}
            onChange={(e) => onGeometry('widthPercent', Number(e.target.value))}
          />
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.maskHeight')}</span>
          <input
            type="number"
            className="field-input"
            min={COVER_HEIGHT_MIN}
            max={COVER_HEIGHT_MAX}
            data-testid={`${prefix}-layer-${index}-height`}
            value={layer.geometry.heightPercent}
            disabled={locked}
            onChange={(e) => onGeometry('heightPercent', Number(e.target.value))}
          />
        </label>
        {isBlur ? (
          <label className="field-label">
            <span>{t('media:renderPrep.maskBlurRadius')}</span>
            <input
              type="number"
              className="field-input"
              min={COVER_BLUR_MIN}
              max={COVER_BLUR_MAX}
              data-testid={`${prefix}-layer-${index}-blur-radius`}
              value={('blurRadius' in layer.style ? layer.style.blurRadius : 10) as number}
              disabled={locked}
              onChange={(e) =>
                onPatch({
                  style: {
                    blurRadius: Math.max(COVER_BLUR_MIN, Math.min(COVER_BLUR_MAX, Number(e.target.value))),
                  },
                })
              }
            />
          </label>
        ) : (
          <>
            <label className="field-label">
              <span>{t('media:renderPrep.maskColorLabel')}</span>
              <input
                type="color"
                className="field-input h-9 w-full p-1"
                data-testid={`${prefix}-layer-${index}-color`}
                value={('color' in layer.style ? layer.style.color : '#000000') as string}
                disabled={locked}
                onChange={(e) =>
                  onPatch({
                    style: {
                      color: e.target.value.toUpperCase(),
                      opacityPercent:
                        'opacityPercent' in layer.style ? layer.style.opacityPercent : 60,
                    },
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>{t('media:renderPrep.maskOpacity')}</span>
              <input
                type="number"
                className="field-input"
                min={COVER_OPACITY_MIN}
                max={COVER_OPACITY_MAX}
                data-testid={`${prefix}-layer-${index}-opacity`}
                value={('opacityPercent' in layer.style ? layer.style.opacityPercent : 60) as number}
                disabled={locked}
                onChange={(e) =>
                  onPatch({
                    style: {
                      color: 'color' in layer.style ? layer.style.color : '#000000',
                      opacityPercent: Math.max(
                        COVER_OPACITY_MIN,
                        Math.min(COVER_OPACITY_MAX, Number(e.target.value)),
                      ),
                    },
                  })
                }
              />
            </label>
          </>
        )}
      </div>
    </div>
  )
}
