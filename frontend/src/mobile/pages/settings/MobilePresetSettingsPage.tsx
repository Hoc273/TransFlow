import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  IconAdjustments,
  IconCpu,
  IconSearch,
  IconSubtitles,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import * as presetHooks from '@/hooks/useWorkflowPresets'

interface NormalizedPreset {
  id: string
  name: string
  description: string
  scope: string
  isSystem: boolean
  isDefault: boolean
  active: boolean
  workflowMode?: string
  subtitleMode?: string
  raw: any
}

export function MobilePresetSettingsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()

  // Defensively invoke useWorkflowPresets with or without workspaceId
  const presetsResult =
    typeof presetHooks.useWorkflowPresets === 'function'
      ? (presetHooks.useWorkflowPresets as any)(workspaceId)
      : undefined

  const rawPresets: any[] = presetsResult?.presets ?? presetsResult?.data ?? []
  const isLoading = Boolean(presetsResult?.isLoading)

  const [search, setSearch] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<NormalizedPreset | null>(null)

  // Normalize presets defensively
  const presets: NormalizedPreset[] = useMemo(() => {
    return rawPresets.map((p, idx): NormalizedPreset => {
      const isSystem = Boolean(p?.isSystem ?? (p?.scope === 'SYSTEM'))
      const scope = p?.scope || (isSystem ? 'SYSTEM' : 'WORKSPACE')

      return {
        id: String(p?.id || `preset-${idx}`),
        name: p?.name || 'Preset không tên',
        description: p?.description || 'Không có mô tả chi tiết',
        scope,
        isSystem,
        isDefault: Boolean(p?.isDefault),
        active: p?.active !== false,
        workflowMode: p?.config?.workflowMode,
        subtitleMode: p?.config?.subtitleMode,
        raw: p,
      }
    })
  }, [rawPresets])

  // Filter presets by search term
  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      const term = search.trim().toLowerCase()
      if (!term) return true
      return (
        p.name.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term)
      )
    })
  }, [presets, search])

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">Workflow Presets</h1>
        <p className="text-xs text-neutral-500 line-clamp-2">Cấu hình mẫu cho pipeline dịch thuật và TTS video.</p>
      </div>

      {/* Search Input */}
      {presets.length > 0 && (
        <div className="relative min-w-0">
          <IconSearch
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm preset theo tên, mô tả..."
            className="h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-neutral-50/50 py-2.5 pl-9 pr-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white dark:focus:bg-neutral-900"
          />
        </div>
      )}

      {/* Preset List Content */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-neutral-400">Đang tải presets...</div>
      ) : presets.length === 0 ? (
        <MobileEmptyState
          icon={<IconAdjustments size={36} />}
          title="Chưa có preset nào"
          description="Hiện chưa có preset cấu hình workflow nào trong workspace này."
        />
      ) : filteredPresets.length === 0 ? (
        <MobileEmptyState
          icon={<IconSearch size={36} />}
          title="Không tìm thấy preset"
          description="Không có cấu hình workflow nào phù hợp với tìm kiếm của bạn."
        />
      ) : (
        <div className="min-w-0 space-y-3">
          {filteredPresets.map((preset) => (
            <MobileCard
              key={preset.id}
              interactive
              onClick={() => setSelectedPreset(preset)}
              className="min-w-0 space-y-2 p-3.5"
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-semibold text-sm text-neutral-900 dark:text-white" title={preset.name}>
                    {preset.name}
                  </span>
                  {preset.isDefault && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[9px] font-bold">
                      Mặc định
                    </span>
                  )}
                </div>
                <span
                  className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    preset.isSystem
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                  }`}
                >
                  {preset.isSystem ? 'Hệ thống' : 'Tùy chỉnh'}
                </span>
              </div>

              <p className="text-xs break-words text-neutral-500 line-clamp-2">{preset.description}</p>

              {(preset.workflowMode || preset.subtitleMode) && (
                <div className="flex min-w-0 items-center gap-2 flex-wrap pt-1">
                  {preset.workflowMode && (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-[11px] text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md font-medium">
                      <IconCpu size={12} className="shrink-0" />
                      <span className="truncate">{preset.workflowMode}</span>
                    </span>
                  )}
                  {preset.subtitleMode && (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-[11px] text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md font-medium">
                      <IconSubtitles size={12} className="shrink-0" />
                      <span className="truncate">{preset.subtitleMode}</span>
                    </span>
                  )}
                </div>
              )}
            </MobileCard>
          ))}
        </div>
      )}

      {/* Preset Details BottomSheet */}
      <BottomSheet
        isOpen={Boolean(selectedPreset)}
        onClose={() => setSelectedPreset(null)}
        title="Chi tiết Preset"
      >
        {selectedPreset && (
          <div className="space-y-4">
            <h3 className="text-base font-bold text-neutral-900 dark:text-white">
              {selectedPreset.name}
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  selectedPreset.isSystem
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                {selectedPreset.isSystem ? 'Hệ thống' : 'Tùy chỉnh'}
              </span>
              {selectedPreset.isDefault && (
                <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-semibold">
                  Mặc định cho workspace
                </span>
              )}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Mô tả</h4>
              <p className="text-sm text-neutral-700 dark:text-neutral-300 mt-1">
                {selectedPreset.description}
              </p>
            </div>

            {selectedPreset.raw?.config && (
              <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-3">
                <h4 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                  Cấu hình chi tiết
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/50 p-2.5">
                    <span className="text-neutral-400 block text-[10px]">Chế độ xử lý</span>
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                      {selectedPreset.raw.config.workflowMode || 'AUTO'}
                    </span>
                  </div>
                  <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/50 p-2.5">
                    <span className="text-neutral-400 block text-[10px]">Phụ đề</span>
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                      {selectedPreset.raw.config.subtitleMode || 'Mặc định'}
                    </span>
                  </div>
                  {selectedPreset.raw.config.subtitlePosition && (
                    <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/50 p-2.5">
                      <span className="text-neutral-400 block text-[10px]">Vị trí phụ đề</span>
                      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {selectedPreset.raw.config.subtitlePosition}
                      </span>
                    </div>
                  )}
                  {selectedPreset.raw.config.outputAspectRatio && (
                    <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/50 p-2.5">
                      <span className="text-neutral-400 block text-[10px]">Tỷ lệ khung hình</span>
                      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {selectedPreset.raw.config.outputAspectRatio}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedPreset(null)}
              className="w-full rounded-xl bg-neutral-100 dark:bg-neutral-800 py-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300 active:scale-[0.98] transition-transform"
            >
              Đóng
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
