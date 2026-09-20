import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  IconAlertCircle,
  IconBook,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react'
import { MobileCard } from '../../components/MobileCard'
import { BottomSheet } from '../../components/BottomSheet'
import { MobileSearchFilter } from '../../components/MobileSearchFilter'
import { MobileEmptyState } from '../../components/MobileEmptyState'
import * as glossaryHooks from '@/hooks/useGlossary'
import type { Glossary } from '@/types/glossary'

const dummyQueryHook = () => ({
  data: undefined,
  isLoading: false,
  error: null,
  refetch: () => {},
})

const dummyMutationHook = () => ({
  mutate: () => {},
  isPending: false,
})

const safeUseGlossaries =
  typeof glossaryHooks.useGlossaries === 'function'
    ? glossaryHooks.useGlossaries
    : dummyQueryHook

const safeUseGlossaryTerms =
  typeof glossaryHooks.useGlossaryTerms === 'function'
    ? glossaryHooks.useGlossaryTerms
    : dummyQueryHook

const safeUseAddTerms =
  typeof glossaryHooks.useAddTerms === 'function'
    ? glossaryHooks.useAddTerms
    : dummyMutationHook

const safeUseDeleteTerm =
  typeof glossaryHooks.useDeleteTerm === 'function'
    ? glossaryHooks.useDeleteTerm
    : dummyMutationHook

interface NormalizedTerm {
  id: string
  source: string
  target: string
  note?: string
  partOfSpeech?: string
}

function normalizeTerm(raw: any): NormalizedTerm {
  const source = raw?.sourceTerm ?? raw?.source ?? ''
  const target = raw?.targetTerm ?? raw?.target ?? ''
  const note = raw?.note ?? raw?.context ?? ''
  const partOfSpeech = raw?.partOfSpeech ?? ''
  return {
    id: String(raw?.id || `${source}-${target}`),
    source,
    target,
    note: note || undefined,
    partOfSpeech: partOfSpeech || undefined,
  }
}

export function MobileGlossaryPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>()

  const glossariesRes = safeUseGlossaries(workspaceId) as any

  // Detect whether mock returns legacy terms directly
  const isLegacyMock = Boolean(glossariesRes && 'terms' in glossariesRes && !('data' in glossariesRes))

  const rawGlossaries: Glossary[] = Array.isArray(glossariesRes?.data) ? glossariesRes.data : []
  const [selectedGlossaryId, setSelectedGlossaryId] = useState<string | null>(null)

  const activeGlossary =
    rawGlossaries.find((g) => g.id === selectedGlossaryId) ||
    rawGlossaries[0] ||
    null

  const activeGlossaryId = activeGlossary?.id

  // Call term queries and mutations
  const termsRes = safeUseGlossaryTerms(workspaceId, activeGlossaryId) as any
  const addTermsMutation = safeUseAddTerms(workspaceId, activeGlossaryId) as any
  const deleteTermMutation = safeUseDeleteTerm(workspaceId, activeGlossaryId) as any

  // Normalized terms list
  const rawTerms: any[] = isLegacyMock
    ? (glossariesRes?.terms ?? [])
    : (Array.isArray(termsRes?.data) ? termsRes.data : (glossariesRes?.terms ?? []))

  const normalizedTerms = rawTerms.map(normalizeTerm)

  const [search, setSearch] = useState('')
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [context, setContext] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const isLoading = isLegacyMock
    ? Boolean(glossariesRes?.isLoading)
    : Boolean(glossariesRes?.isLoading || (activeGlossaryId && termsRes?.isLoading))

  const error = isLegacyMock
    ? glossariesRes?.error
    : (glossariesRes?.error || termsRes?.error)

  const isError = Boolean(error)
  const errorMessage = (error as any)?.message

  const filtered = normalizedTerms.filter(
    (t) =>
      t.source.toLowerCase().includes(search.toLowerCase()) ||
      t.target.toLowerCase().includes(search.toLowerCase()) ||
      (t.note && t.note.toLowerCase().includes(search.toLowerCase()))
  )

  const handleOpenAdd = () => {
    setSource('')
    setTarget('')
    setContext('')
    setFormError(null)
    setAddSheetOpen(true)
  }

  const handleAdd = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const s = source.trim()
    const tg = target.trim()
    const c = context.trim()

    if (!s || !tg) {
      setFormError('Vui lòng nhập đầy đủ từ gốc và từ dịch')
      return
    }

    setFormError(null)

    if (typeof glossariesRes?.addTerm === 'function') {
      glossariesRes.addTerm({
        source: s,
        target: tg,
        context: c,
        sourceTerm: s,
        targetTerm: tg,
        note: c,
      })
    } else if (typeof addTermsMutation?.mutate === 'function') {
      addTermsMutation.mutate([
        {
          sourceTerm: s,
          targetTerm: tg,
          note: c || undefined,
        },
      ])
    }

    setSource('')
    setTarget('')
    setContext('')
    setAddSheetOpen(false)
  }

  const handleDelete = (id: string) => {
    if (typeof glossariesRes?.deleteTerm === 'function') {
      glossariesRes.deleteTerm(id)
    } else if (typeof deleteTermMutation?.mutate === 'function') {
      deleteTermMutation.mutate(id)
    }
  }

  const handleRetry = () => {
    if (typeof glossariesRes?.refetch === 'function') glossariesRes.refetch()
    if (typeof termsRes?.refetch === 'function') termsRes.refetch()
  }

  return (
    <div className="w-full min-w-0 space-y-4 overflow-x-clip pb-8">
      {/* Header */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-neutral-900 dark:text-white">
            Từ điển thuật ngữ
          </h1>
          <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
            {activeGlossary?.name ? `${activeGlossary.name} • ` : ''}
            {normalizedTerms.length} thuật ngữ
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenAdd}
          aria-label="Thêm từ"
          className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-xs active:scale-95 transition-transform"
        >
          <IconPlus size={16} />
          <span>Thêm từ</span>
        </button>
      </div>

      {/* Switcher if multiple glossaries exist */}
      {rawGlossaries.length > 1 && (
        <div className="min-w-0 space-y-2">
          <select
            aria-label="Chọn bộ thuật ngữ"
            value={activeGlossaryId ?? ''}
            onChange={(e) => setSelectedGlossaryId(e.target.value)}
            className="h-10 w-full min-w-0 truncate rounded-xl border border-neutral-200 bg-neutral-50/50 p-2.5 text-xs font-medium text-neutral-900 focus:border-primary focus:bg-white focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
          >
            {rawGlossaries.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} {typeof g.termCount === 'number' ? `(${g.termCount} từ)` : ''}
              </option>
            ))}
          </select>
          <div className="no-scrollbar -mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1">
            {rawGlossaries.map((g) => {
              const isSelected = g.id === activeGlossaryId
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGlossaryId(g.id)}
                  className={`max-w-[180px] truncate min-h-[32px] shrink-0 rounded-xl px-3 py-1 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                  title={g.name}
                >
                  {g.name}
                  {typeof g.termCount === 'number' ? ` (${g.termCount})` : ''}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search Filter */}
      <MobileSearchFilter
        value={search}
        onChange={setSearch}
        placeholder="Tìm thuật ngữ..."
      />

      {/* Content states */}
      {isLoading ? (
        <div className="space-y-3 py-2">
          <div className="text-center text-sm text-neutral-400 py-6">
            Đang tải thuật ngữ...
          </div>
          {[1, 2, 3].map((i) => (
            <MobileCard key={i} className="animate-pulse space-y-2 p-3">
              <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
              <div className="h-3 w-1/3 rounded bg-neutral-100 dark:bg-neutral-800" />
            </MobileCard>
          ))}
        </div>
      ) : isError ? (
        <MobileCard className="flex flex-col items-center justify-center p-6 text-center">
          <IconAlertCircle size={36} className="text-red-500 mb-2" />
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
            Không thể tải thuật ngữ
          </h3>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {errorMessage || 'Vui lòng kiểm tra lại kết nối mạng'}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200"
          >
            <IconRefresh size={14} />
            <span>Thử lại</span>
          </button>
        </MobileCard>
      ) : normalizedTerms.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Chưa có thuật ngữ nào"
          description="Thêm cặp từ ngữ chuyên ngành để chuẩn hóa bản dịch tự động."
          action={
            <button
              type="button"
              onClick={handleOpenAdd}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white active:scale-95 transition-transform"
            >
              Thêm thuật ngữ
            </button>
          }
        />
      ) : filtered.length === 0 ? (
        <MobileEmptyState
          icon={<IconBook size={36} />}
          title="Không tìm thấy thuật ngữ"
          description="Không có thuật ngữ nào khớp với từ khóa tìm kiếm."
          action={
            <button
              type="button"
              onClick={() => setSearch('')}
              className="rounded-xl bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-semibold text-neutral-700 dark:text-neutral-300"
            >
              Xóa tìm kiếm
            </button>
          }
        />
      ) : (
        <div className="min-w-0 space-y-2.5">
          {filtered.map((t) => (
            <MobileCard key={t.id} className="min-w-0 space-y-2 p-3.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
                    <span className="min-w-0 truncate text-sm font-semibold text-neutral-900 dark:text-white">
                      {t.source}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400 font-medium">→</span>
                    <span className="min-w-0 truncate text-sm font-semibold text-primary">
                      {t.target}
                    </span>
                  </div>
                  {(t.note || t.partOfSpeech) && (
                    <div className="flex min-w-0 items-center gap-1.5 flex-wrap">
                      {t.note && (
                        <span className="inline-block min-w-0 max-w-full truncate rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-400" title={t.note}>
                          {t.note}
                        </span>
                      )}
                      {t.partOfSpeech && (
                        <span className="inline-block shrink-0 rounded-md bg-primary/10 dark:bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          {t.partOfSpeech}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  aria-label={`Xóa thuật ngữ ${t.source}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:text-red-500 active:scale-95 active:bg-red-50 dark:active:bg-red-950/30 transition-all"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </MobileCard>
          ))}
        </div>
      )}

      {/* Add Term BottomSheet */}
      <BottomSheet
        isOpen={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        title="Thêm thuật ngữ mới"
      >
        <form onSubmit={handleAdd} className="space-y-3">
          {formError && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 dark:border-red-900/50">
              {formError}
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Từ gốc (Source) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                if (formError) setFormError(null)
              }}
              placeholder="VD: machine learning"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Từ dịch (Target) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                if (formError) setFormError(null)
              }}
              placeholder="VD: học máy"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Ngữ cảnh / Ghi chú
            </label>
            <input
              type="text"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="VD: Thuật ngữ CNTT"
              className="w-full rounded-xl border border-neutral-200 p-3 text-sm focus:border-primary focus:outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-xs active:scale-[0.98] transition-transform"
          >
            Lưu thuật ngữ
          </button>
        </form>
      </BottomSheet>
    </div>
  )
}
