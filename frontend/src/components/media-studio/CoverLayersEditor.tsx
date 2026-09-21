// @ts-nocheck
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
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
  selectedLayerId,
  onSelectedLayerChange,
  testidPrefix = 'cover',
}: {
  enabled: boolean
  layers: PresentationLayer[]
  locked: boolean
  onChange: (next: { enabled: boolean; layers: PresentationLayer[] }) => void
  selectedLayerId?: string | null
  onSelectedLayerChange?: (layerId: string | null) => void
  testidPrefix?: string
}) {
  const { t } = useTranslation(['media'])
  const atCap = layers.length >= MAX_COVER_LAYERS
  const [selectedId, setSelectedId] = useState<string | null>(layers[0]?.id ?? null)
  const effectiveSelectedId = selectedLayerId ?? selectedId
  const selectedIndex = Math.max(0, layers.findIndex((layer) => layer.id === effectiveSelectedId))
  const selectedLayer = layers[selectedIndex]
  const selectLayer = (layerId: string | null) => {
    setSelectedId(layerId)
    onSelectedLayerChange?.(layerId)
  }

  useEffect(() => {
    if (!layers.length) {
      setSelectedId(null)
      return
    }
    if (!layers.some((layer) => layer.id === effectiveSelectedId)) {
      setSelectedId(layers[0].id)
      onSelectedLayerChange?.(layers[0].id)
    }
  }, [layers, effectiveSelectedId, onSelectedLayerChange])

  const updateLayer = (index: number, patch: Partial<PresentationLayer>) => {
    onChange({
      enabled,
      layers: layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)),
    })
  }

  const updateGeometry = (
    index: number,
    key: 'widthPercent' | 'heightPercent' | 'xPercent' | 'yPercent',
    raw: number,
  ) => {
    const isPosition = key === 'xPercent' || key === 'yPercent'
    const min = isPosition ? 0 : key === 'widthPercent' ? COVER_WIDTH_MIN : COVER_HEIGHT_MIN
    const max = isPosition ? 100 : key === 'widthPercent' ? COVER_WIDTH_MAX : COVER_HEIGHT_MAX
    const layer = layers[index]
    updateLayer(index, {
      geometry: {
        ...layer.geometry,
        [key]: Math.max(min, Math.min(max, Math.round(raw))),
      },
    })
  }

  const addLayer = () => {
    if (atCap) return
    if (!enabled) {
      const nextLayers = layers.length ? layers : [defaultCoverLayer([])]
      selectLayer(nextLayers[0].id)
      onChange({ enabled: true, layers: nextLayers })
      return
    }
    const layer = defaultCoverLayer(layers)
    selectLayer(layer.id)
    onChange({ enabled: true, layers: [...layers, layer] })
  }

  const removeLayer = (index: number) => {
    const nextLayers = layers.filter((_, i) => i !== index)
    const nextSelected = nextLayers[Math.min(index, nextLayers.length - 1)]
    selectLayer(nextSelected?.id ?? null)
    onChange({ enabled: nextLayers.length > 0 && enabled, layers: nextLayers })
  }

  const moveLayer = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= layers.length) return
    const next = [...layers]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ enabled, layers: next })
  }

  return (
    <div className="cover-layer-workspace" data-testid={`${testidPrefix}-layers`}>
      <div className="cover-layer-toolbar">
        <div className="min-w-0">
          <p className="cover-layer-kicker">{t('media:renderPrep.maskLayerTitle')}</p>
          <p className="field-help m-0">{t('media:renderPrep.coverHint')}</p>
        </div>
        <label className="cover-layer-master-toggle">
          <input
            type="checkbox"
            data-testid={`${testidPrefix}-enable`}
            checked={enabled}
            disabled={locked}
            onChange={(e) => onChange({ enabled: e.target.checked, layers })}
          />
          <span>{t('media:renderPrep.coverEnable')}</span>
        </label>
      </div>

      {!enabled ? (
        <div className="cover-layer-empty">
          <div>
            <p className="m-0 text-sm font-semibold">{t('media:renderPrep.coverEmptyTitle')}</p>
            <p className="field-help mt-1 mb-0">{t('media:renderPrep.coverEmptyHint')}</p>
          </div>
          <button
            type="button"
            className="btn-media-secondary btn-sm shrink-0"
            data-testid={`${testidPrefix}-layer-add`}
            disabled={locked}
            onClick={addLayer}
          >
            <IconPlus size={14} />
            {t('media:renderPrep.coverAdd')}
          </button>
        </div>
      ) : (
        <div className="cover-layer-editor-grid">
          <div className="cover-layer-rail" aria-label={t('media:renderPrep.coverLayerList')}>
            <div className="cover-layer-rail-heading">
              <span>{t('media:renderPrep.coverLayerList')}</span>
              <span>{t('media:renderPrep.coverCount', { used: layers.length, max: MAX_COVER_LAYERS })}</span>
            </div>
            {layers.map((layer, index) => (
              <button
                key={layer.id}
                type="button"
                className={`cover-layer-rail-item ${selectedLayer?.id === layer.id ? 'active' : ''}`}
                data-testid={`${testidPrefix}-layer-${index}-select`}
                aria-pressed={selectedLayer?.id === layer.id}
                onClick={() => selectLayer(layer.id)}
              >
                <span className="cover-layer-order">{index + 1}</span>
                <span className="min-w-0 text-left">
                  <strong>{t('media:renderPrep.coverLayerLabel', { index: index + 1 })}</strong>
                  <small>
                    {t(`media:renderPrep.layerAnchor${layer.anchor.charAt(0)}${layer.anchor.slice(1).toLowerCase()}`)}
                    {' · '}
                    {t(`media:renderPrep.maskStyle${layer.type === 'BLUR' ? 'Blur' : 'Solid'}`)}
                  </small>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="cover-layer-add"
              data-testid={`${testidPrefix}-layer-add`}
              disabled={locked || atCap}
              onClick={addLayer}
            >
              <IconPlus size={14} />
              {t('media:renderPrep.coverAdd')}
            </button>
          </div>

          <div className="cover-layer-inspector">
            <p className="cover-layer-inspector-title">
              {t('media:renderPrep.coverInspector')}
            </p>
            {selectedLayer && (
              <CoverLayerCard
                key={selectedLayer.id}
                layer={selectedLayer}
                index={selectedIndex}
                count={layers.length}
                locked={locked}
                prefix={testidPrefix}
                onPatch={(patch) => updateLayer(selectedIndex, patch)}
                onGeometry={(key, value) => updateGeometry(selectedIndex, key, value)}
                onRemove={() => removeLayer(selectedIndex)}
                onMove={(delta) => moveLayer(selectedIndex, delta)}
              />
            )}
          </div>
        </div>
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
  onGeometry: (
    key: 'widthPercent' | 'heightPercent' | 'xPercent' | 'yPercent',
    value: number,
  ) => void
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
}) {
  const { t } = useTranslation(['media'])
  const isBlur = layer.type === 'BLUR'

  return (
    <div
      className="cover-layer-card"
      data-testid={`${prefix}-layer-${index}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
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
            onChange={(e) => onPatch({
              anchor: e.target.value as PresentationLayerAnchor,
              geometry: { ...layer.geometry, yPercent: undefined },
            })}
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
        <label className="field-label">
          <span>{t('media:renderPrep.maskHorizontalPosition')}</span>
          <input
            type="number"
            className="field-input"
            min={0}
            max={100}
            data-testid={`${prefix}-layer-${index}-x`}
            value={layer.geometry.xPercent ?? 50}
            disabled={locked}
            onChange={(e) => onGeometry('xPercent', Number(e.target.value))}
          />
        </label>
        <label className="field-label">
          <span>{t('media:renderPrep.maskVerticalPosition')}</span>
          <input
            type="number"
            className="field-input"
            min={0}
            max={100}
            placeholder={t('media:renderPrep.maskFollowsAnchor')}
            data-testid={`${prefix}-layer-${index}-y`}
            value={layer.geometry.yPercent ?? ''}
            disabled={locked}
            onChange={(e) => onGeometry('yPercent', Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="btn-media-secondary btn-sm sm:col-span-2"
          disabled={locked || (
            layer.geometry.xPercent == null && layer.geometry.yPercent == null
          )}
          onClick={() => onPatch({
            geometry: {
              widthPercent: layer.geometry.widthPercent,
              heightPercent: layer.geometry.heightPercent,
            },
          })}
        >
          {t('media:renderPrep.maskResetPosition')}
        </button>
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
