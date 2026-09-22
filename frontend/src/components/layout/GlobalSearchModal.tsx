import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconArrowRight,
  IconBook2,
  IconChartBar,
  IconCornerDownLeft,
  IconFolder,
  IconLayoutGrid,
  IconSearch,
  IconSparkles,
  IconStack2,
  IconUsers,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { useBatches } from '@/hooks/useBatches'
import { useProjects } from '@/hooks/useProjects'
import { asJobStatus } from '@/lib/status'
import { cn } from '@/lib/cn'

interface GlobalSearchModalProps {
  open: boolean
  onClose: () => void
  workspaceId: string
}

interface SearchItem {
  id: string
  category: 'pages' | 'projects' | 'batches'
  categoryLabel: string
  title: string
  subtitle?: string
  badge?: string
  badgeColor?: string
  icon: typeof IconFolder
  iconColor: string
  path: string
}

export function GlobalSearchModal({ open, onClose, workspaceId }: GlobalSearchModalProps) {
  const { t } = useTranslation(['common', 'project', 'batch', 'glossary'])
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Fetch data across modules
  const { data: projects = [] } = useProjects(workspaceId)
  const { data: batches = [] } = useBatches(workspaceId)

  // Focus input when modal opens & reset state
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveCategory('all')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // System navigation items for quick access and searching
  const systemPages: SearchItem[] = useMemo(() => {
    const base = `/w/${workspaceId}`
    return [
      {
        id: 'page-dashboard',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.dashboard', { defaultValue: 'Bảng điều khiển' }),
        subtitle: 'Tổng quan hoạt động và thống kê workspace',
        icon: IconLayoutGrid,
        iconColor: 'bg-indigo-500/10 text-indigo-500 dark:bg-indigo-500/20 dark:text-indigo-400',
        path: base,
      },
      {
        id: 'page-projects',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.projects', { defaultValue: 'Dự án' }),
        subtitle: 'Quản lý tài liệu dịch thuật và bản địa hóa',
        icon: IconFolder,
        iconColor: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400',
        path: `${base}/projects`,
      },
      {
        id: 'page-glossaries',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.glossaries', { defaultValue: 'Bảng thuật ngữ' }),
        subtitle: 'Chuẩn hóa danh mục thuật ngữ theo domain',
        icon: IconBook2,
        iconColor: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400',
        path: `${base}/glossaries`,
      },
      {
        id: 'page-media',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.media', { defaultValue: 'Video' }),
        subtitle: 'Dịch video, lồng tiếng AI giọng đọc & phụ đề',
        badge: 'Media',
        badgeColor: 'bg-[#714ffc]/15 text-[#8c67ff]',
        icon: IconVideo,
        iconColor: 'bg-purple-500/10 text-purple-500 dark:bg-purple-500/20 dark:text-purple-400',
        path: `${base}/media`,
      },
      {
        id: 'page-usage',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.usage', { defaultValue: 'Tài nguyên AI' }),
        subtitle: 'Thống kê lượng dùng token, chi phí và hạn ngạch',
        icon: IconChartBar,
        iconColor: 'bg-amber-500/10 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400',
        path: `${base}/dashboard/usage`,
      },
      {
        id: 'page-members',
        category: 'pages',
        categoryLabel: t('common:commandPalette.pages', { defaultValue: 'Trang & Công cụ' }),
        title: t('common:nav.members', { defaultValue: 'Thành viên' }),
        subtitle: 'Quản lý thành viên workspace và phân quyền',
        icon: IconUsers,
        iconColor: 'bg-pink-500/10 text-pink-500 dark:bg-pink-500/20 dark:text-pink-400',
        path: `${base}/settings/members`,
      },
    ]
  }, [workspaceId, t])

  const q = query.trim().toLowerCase()

  // Filter items based on search query
  const filteredPages = useMemo(() => {
    if (!q) return systemPages.slice(0, 4) // Show top 4 in quick nav
    return systemPages.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.subtitle && p.subtitle.toLowerCase().includes(q)),
    )
  }, [systemPages, q])

  const filteredProjects: SearchItem[] = useMemo(() => {
    if (!q) return []
    return projects
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.domain && p.domain.toLowerCase().includes(q)) ||
          p.sourceLang.toLowerCase().includes(q),
      )
      .map((p) => ({
        id: `proj-${p.id}`,
        category: 'projects' as const,
        categoryLabel: t('common:commandPalette.projects', { defaultValue: 'Dự án' }),
        title: p.name,
        subtitle: p.domain ? `${p.domain}` : undefined,
        badge: p.sourceLang.toUpperCase(),
        badgeColor: 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-mono',
        icon: IconFolder,
        iconColor: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400',
        path: `/w/${workspaceId}/projects`,
      }))
  }, [projects, q, workspaceId, t])

  const filteredBatches: SearchItem[] = useMemo(() => {
    if (!q) return []
    return batches
      .filter(
        (b) =>
          (b.name || '').toLowerCase().includes(q) ||
          String(b.status).toLowerCase().includes(q),
      )
      .map((b) => ({
        id: `batch-${b.id}`,
        category: 'batches' as const,
        categoryLabel: t('common:commandPalette.batches', { defaultValue: 'Xử lý hàng loạt' }),
        title: b.name || b.id.slice(0, 8),
        badge: asJobStatus(String(b.status)),
        badgeColor: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono text-[10px]',
        icon: IconStack2,
        iconColor: 'bg-cyan-500/10 text-cyan-500 dark:bg-cyan-500/20 dark:text-cyan-400',
        path: `/w/${workspaceId}/batches/${b.id}`,
      }))
  }, [batches, q, workspaceId, t])

  // Aggregate results based on active tab filter
  const visibleItems: SearchItem[] = useMemo(() => {
    if (!q) {
      return filteredPages
    }

    const all = [...filteredPages, ...filteredProjects, ...filteredBatches]

    if (activeCategory === 'all') return all
    return all.filter((item) => item.category === activeCategory)
  }, [
    q,
    activeCategory,
    filteredPages,
    filteredProjects,
    filteredBatches,
  ])

  // Ensure selected index is in bounds
  useEffect(() => {
    setSelectedIndex(0)
  }, [query, activeCategory])

  const handleNavigate = (path: string) => {
    onClose()
    navigate(path)
  }

  // Handle keyboard events: ArrowDown, ArrowUp, Enter, Escape
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }

    if (visibleItems.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % visibleItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + visibleItems.length) % visibleItems.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = visibleItems[selectedIndex]
      if (target) {
        handleNavigate(target.path)
      }
    }
  }

  // Auto-scroll the selected element into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const activeEl = list.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!open) return null

  const totalMatches =
    filteredPages.length +
    filteredProjects.length +
    filteredBatches.length

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-x-clip bg-black/60 p-3 pt-[4vh] backdrop-blur-md animate-in fade-in duration-150 sm:p-6 sm:pt-[12vh] dark:bg-black/75"
      onClick={onClose}
    >
      {/* Modal Dialog Card */}
      <div
        className={cn(
          'flex max-h-[90dvh] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-2xl select-none sm:max-h-[82vh]',
          'bg-white/95 dark:bg-[#12141c]/95 backdrop-blur-2xl',
          'border border-neutral-200/90 dark:border-white/10',
          'shadow-[0_25px_70px_rgba(0,0,0,0.22),0_0_1px_1px_rgba(0,0,0,0.06)] dark:shadow-[0_30px_80px_rgba(0,0,0,0.85),0_0_1px_1px_rgba(255,255,255,0.1)]',
          'animate-in fade-in-0 zoom-in-95 duration-150',
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('common:commandPalette.placeholder')}
      >
        {/* Top Search Bar */}
        <div className="flex items-center gap-3 px-4 sm:px-5 h-14 sm:h-16 border-b border-neutral-200/80 dark:border-white/[0.08] bg-transparent">
          <div className="w-8 h-8 rounded-xl bg-[#714ffc]/10 dark:bg-[#714ffc]/20 text-[#714ffc] dark:text-[#a78bff] flex items-center justify-center shrink-0">
            <IconSearch size={18} stroke={2.4} />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('common:commandPalette.placeholder')}
            className="flex-1 bg-transparent text-[14px] sm:text-[15px] font-medium text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none"
          />

          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/10 transition cursor-pointer"
              title="Clear"
            >
              <IconX size={16} />
            </button>
          ) : (
            <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-neutral-100 dark:bg-white/[0.08] text-neutral-400 dark:text-neutral-500 border border-neutral-200/80 dark:border-white/10">
              ESC
            </kbd>
          )}
        </div>

        {/* Category Tabs (shown when searching with results) */}
        {q && totalMatches > 0 && (
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-neutral-100 px-4 py-2 text-xs dark:border-white/[0.06]">
            <button
              type="button"
              onClick={() => setActiveCategory('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0',
                activeCategory === 'all'
                  ? 'bg-[#714ffc] text-white shadow-2xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06]',
              )}
            >
              {t('common:commandPalette.all')} ({totalMatches})
            </button>

            {filteredPages.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCategory('pages')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0',
                  activeCategory === 'pages'
                    ? 'bg-[#714ffc] text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06]',
                )}
              >
                {t('common:commandPalette.pages')} ({filteredPages.length})
              </button>
            )}

            {filteredProjects.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCategory('projects')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0',
                  activeCategory === 'projects'
                    ? 'bg-[#714ffc] text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06]',
                )}
              >
                {t('common:commandPalette.projects')} ({filteredProjects.length})
              </button>
            )}

            {filteredBatches.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveCategory('batches')}
                className={cn(
                  'px-2.5 py-1 rounded-lg font-medium transition cursor-pointer shrink-0',
                  activeCategory === 'batches'
                    ? 'bg-[#714ffc] text-white shadow-2xs'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-white/[0.06]',
                )}
              >
                {t('common:commandPalette.batches')} ({filteredBatches.length})
              </button>
            )}

          </div>
        )}

        {/* Scrollable Results List */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-2 sm:p-2.5 space-y-1">
          {/* Quick Navigation mode (empty query) */}
          {!q && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10.5px] font-bold tracking-wider text-neutral-400 dark:text-neutral-500 uppercase">
                <IconSparkles size={13} className="text-[#714ffc]" />
                <span>{t('common:commandPalette.quickNav')}</span>
              </div>

              {filteredPages.map((item, index) => {
                const Icon = item.icon
                const isSelected = selectedIndex === index

                return (
                  <button
                    key={item.id}
                    data-index={index}
                    type="button"
                    onClick={() => handleNavigate(item.path)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-left transition-all duration-150',
                      isSelected
                        ? 'bg-[#714ffc]/[0.08] dark:bg-[#714ffc]/20 text-neutral-900 dark:text-white shadow-2xs'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-white/[0.06]',
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-150',
                          item.iconColor,
                          isSelected && 'scale-105',
                        )}
                      >
                        <Icon size={17} stroke={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100">
                            {item.title}
                          </span>
                          {item.badge && (
                            <span
                              className={cn(
                                'text-[10px] font-bold px-1.5 py-0.2 rounded-md',
                                item.badgeColor,
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[#714ffc] text-white shadow-2xs animate-in fade-in-0 duration-100">
                          <span>{t('common:commandPalette.openHint', { defaultValue: 'Mở' })}</span>
                          <IconCornerDownLeft size={11} stroke={2.4} />
                        </span>
                      ) : (
                        <IconArrowRight
                          size={14}
                          className="text-neutral-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
                        />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Empty search results */}
          {q && visibleItems.length === 0 && (
            <div className="py-12 px-4 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-white/[0.05] text-neutral-400 flex items-center justify-center mx-auto mb-3">
                <IconSearch size={22} stroke={1.8} />
              </div>
              <div className="text-[14px] font-semibold text-neutral-800 dark:text-neutral-200">
                {t('common:commandPalette.noResults')}
              </div>
              <p className="text-[12px] text-neutral-400 dark:text-neutral-500 max-w-sm mx-auto">
                {t('common:commandPalette.noResultsSub')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#714ffc] hover:bg-[#714ffc]/10 transition cursor-pointer"
              >
                {t('common:commandPalette.clearSearch', { defaultValue: 'Xóa tìm kiếm' })}
              </button>
            </div>
          )}

          {/* Search results list */}
          {q && visibleItems.length > 0 && (
            <div className="space-y-0.5">
              {visibleItems.map((item, index) => {
                const Icon = item.icon
                const isSelected = selectedIndex === index

                return (
                  <button
                    key={item.id}
                    data-index={index}
                    type="button"
                    onClick={() => handleNavigate(item.path)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      'group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer text-left transition-all duration-150',
                      isSelected
                        ? 'bg-[#714ffc]/[0.08] dark:bg-[#714ffc]/20 text-neutral-900 dark:text-white shadow-2xs'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100/80 dark:hover:bg-white/[0.06]',
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-150',
                          item.iconColor,
                          isSelected && 'scale-105',
                        )}
                      >
                        <Icon size={17} stroke={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13.5px] font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                            {item.title}
                          </span>
                          <span className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 shrink-0">
                            · {item.categoryLabel}
                          </span>
                        </div>
                        {item.subtitle && (
                          <div className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.badge && (
                        <span
                          className={cn(
                            'text-[10px] font-bold px-1.5 py-0.2 rounded-md',
                            item.badgeColor,
                          )}
                        >
                          {item.badge}
                        </span>
                      )}

                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-[#714ffc] text-white shadow-2xs animate-in fade-in-0 duration-100">
                          <span>{t('common:commandPalette.openHint', { defaultValue: 'Mở' })}</span>
                          <IconCornerDownLeft size={11} stroke={2.4} />
                        </span>
                      ) : (
                        <IconArrowRight
                          size={14}
                          className="text-neutral-400 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
                        />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer info & Keyboard hints */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 dark:border-white/[0.08] bg-neutral-50/70 dark:bg-white/[0.02] text-[11px] text-neutral-400 dark:text-neutral-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.2 rounded bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[10px] font-mono">
                ↑
              </kbd>
              <kbd className="px-1 py-0.2 rounded bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[10px] font-mono">
                ↓
              </kbd>
              <span>{t('common:commandPalette.navigateHint', { defaultValue: 'Điều hướng' })}</span>
            </span>

            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.2 rounded bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[10px] font-mono">
                ↵
              </kbd>
              <span>{t('common:commandPalette.openHint', { defaultValue: 'Mở' })}</span>
            </span>

            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.2 rounded bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[10px] font-mono">
                ESC
              </kbd>
              <span>{t('common:commandPalette.closeHint', { defaultValue: 'Đóng' })}</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 font-mono text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#714ffc]" />
            <span>TransFlow Command</span>
          </div>
        </div>
      </div>
    </div>
  )
}
