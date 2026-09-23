import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  IconAlertCircle,
  IconCheck,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFileText,
  IconFolder,
  IconFolderPlus,
  IconGripVertical,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react'
import {
  useAdminGuideArticles,
  useAdminGuideCategories,
  useCreateGuideArticle,
  useCreateGuideCategory,
  useDeleteGuideArticle,
  useDeleteGuideCategory,
  useMoveGuideCategory,
  useSetGuideArticlePublish,
  useUpdateGuideArticle,
  useUpdateGuideCategory,
} from '@/hooks/useGuide'
import type {
  GuideArticle,
  GuideArticleRequest,
  GuideArticleStatus,
  GuideCategory,
  GuideCategoryRequest,
} from '@/types/guide'

export function GuideAdminPage() {
  const { t } = useTranslation('guide')

  // Data fetching
  const { data: categories = [], isLoading: catsLoading } = useAdminGuideCategories()
  const [selectedCatFilter, setSelectedCatFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<GuideArticleStatus | ''>('')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: articles = [], isLoading: articlesLoading } = useAdminGuideArticles({
    categoryId: selectedCatFilter || undefined,
    status: (statusFilter as GuideArticleStatus) || undefined,
    q: searchQuery || undefined,
  })

  // Mutations
  const createCategoryMut = useCreateGuideCategory()
  const updateCategoryMut = useUpdateGuideCategory()
  const deleteCategoryMut = useDeleteGuideCategory()
  const moveCategoryMut = useMoveGuideCategory()

  const createArticleMut = useCreateGuideArticle()
  const updateArticleMut = useUpdateGuideArticle()
  const deleteArticleMut = useDeleteGuideArticle()
  const setPublishMut = useSetGuideArticlePublish()

  // Category Modal State
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<GuideCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<GuideCategoryRequest>({
    titleVi: '',
    titleEn: '',
    slug: '',
    orderIndex: 0,
    published: true,
  })
  const [categoryError, setCategoryError] = useState<string | null>(null)

  // Article Modal State
  const [articleModalOpen, setArticleModalOpen] = useState(false)
  const [editingArticle, setEditingArticle] = useState<GuideArticle | null>(null)
  const [articleForm, setArticleForm] = useState<GuideArticleRequest>({
    categoryId: '',
    titleVi: '',
    titleEn: '',
    slug: '',
    excerptVi: '',
    excerptEn: '',
    contentVi: '',
    contentEn: '',
    orderIndex: 0,
    coverImageUrl: '',
    status: 'DRAFT',
  })
  const [articleEditorTab, setArticleEditorTab] = useState<'write' | 'preview'>('write')
  const [articleContentLang, setArticleContentLang] = useState<'vi' | 'en'>('vi')
  const [articleError, setArticleError] = useState<string | null>(null)

  // Standalone Preview Modal
  const [previewArticleItem, setPreviewArticleItem] = useState<GuideArticle | null>(null)
  const [previewLang, setPreviewLang] = useState<'vi' | 'en'>('vi')

  // Notification / Alert message
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const showToast = (msg: string) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  // --- Category Actions ---
  const handleOpenCategoryModal = (cat?: GuideCategory) => {
    setCategoryError(null)
    if (cat) {
      setEditingCategory(cat)
      setCategoryForm({
        titleVi: cat.titleVi,
        titleEn: cat.titleEn,
        slug: cat.slug,
        orderIndex: cat.orderIndex,
        published: cat.published,
      })
    } else {
      setEditingCategory(null)
      setCategoryForm({
        titleVi: '',
        titleEn: '',
        slug: '',
        orderIndex: categories.length,
        published: true,
      })
    }
    setCategoryModalOpen(true)
  }

  const handleSaveCategory = async () => {
    setCategoryError(null)
    if (!categoryForm.titleVi.trim() || !categoryForm.titleEn.trim()) {
      setCategoryError('Tiêu đề Tiếng Việt và Tiếng Anh là bắt buộc.')
      return
    }

    try {
      if (editingCategory) {
        await updateCategoryMut.mutateAsync({
          id: editingCategory.id,
          data: categoryForm,
        })
        showToast(t('admin.saveSuccess'))
      } else {
        await createCategoryMut.mutateAsync(categoryForm)
        showToast(t('admin.saveSuccess'))
      }
      setCategoryModalOpen(false)
    } catch (err: any) {
      setCategoryError(err?.message || 'Có lỗi xảy ra khi lưu danh mục.')
    }
  }

  const handleDeleteCategory = async (cat: GuideCategory) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return
    try {
      await deleteCategoryMut.mutateAsync(cat.id)
      showToast('Đã xóa danh mục thành công.')
    } catch (err: any) {
      alert(err?.message || t('admin.deleteHasArticles'))
    }
  }

  // --- Drag & drop reorder (same pattern as WorkspacesSection) ---
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [isReordering, setIsReordering] = useState(false)

  const handleDropReorder = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || isReordering) return
    const next = [...categories]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setIsReordering(true)
    try {
      for (let i = 0; i < next.length; i++) {
        if (next[i].orderIndex !== i) {
          await moveCategoryMut.mutateAsync({ id: next[i].id, data: { orderIndex: i } })
        }
      }
      showToast(t('admin.reorderSuccess'))
    } catch (err: any) {
      alert(err?.message || t('admin.reorderError'))
    } finally {
      setIsReordering(false)
      setDraggedIdx(null)
      setDragOverIdx(null)
    }
  }

  // --- Article Actions ---
  const handleOpenArticleModal = (art?: GuideArticle) => {
    setArticleError(null)
    setArticleEditorTab('write')
    setArticleContentLang('vi')
    if (art) {
      setEditingArticle(art)
      setArticleForm({
        categoryId: art.categoryId,
        titleVi: art.titleVi,
        titleEn: art.titleEn,
        slug: art.slug,
        excerptVi: art.excerptVi ?? '',
        excerptEn: art.excerptEn ?? '',
        contentVi: art.contentVi ?? '',
        contentEn: art.contentEn ?? '',
        orderIndex: art.orderIndex,
        coverImageUrl: art.coverImageUrl ?? '',
        status: art.status,
      })
    } else {
      setEditingArticle(null)
      const defaultCatId = selectedCatFilter || (categories[0]?.id ?? '')
      setArticleForm({
        categoryId: defaultCatId,
        titleVi: '',
        titleEn: '',
        slug: '',
        excerptVi: '',
        excerptEn: '',
        contentVi: '',
        contentEn: '',
        orderIndex: 0,
        coverImageUrl: '',
        status: 'DRAFT',
      })
    }
    setArticleModalOpen(true)
  }

  const handleSaveArticle = async () => {
    setArticleError(null)
    if (!articleForm.titleVi.trim() || !articleForm.titleEn.trim()) {
      setArticleError('Tiêu đề Tiếng Việt và Tiếng Anh là bắt buộc.')
      return
    }
    if (!articleForm.categoryId) {
      setArticleError('Vui lòng chọn danh mục cho bài viết.')
      return
    }
    if (!articleForm.contentVi.trim() || !articleForm.contentEn.trim()) {
      setArticleError('Nội dung Tiếng Việt và Tiếng Anh là bắt buộc.')
      return
    }

    try {
      if (editingArticle) {
        await updateArticleMut.mutateAsync({
          id: editingArticle.id,
          data: articleForm,
        })
        showToast(t('admin.saveSuccess'))
      } else {
        await createArticleMut.mutateAsync(articleForm)
        showToast(t('admin.saveSuccess'))
      }
      setArticleModalOpen(false)
    } catch (err: any) {
      setArticleError(err?.message || 'Có lỗi xảy ra khi lưu bài viết.')
    }
  }

  const handleDeleteArticle = async (art: GuideArticle) => {
    if (!window.confirm(t('admin.deleteConfirm'))) return
    try {
      await deleteArticleMut.mutateAsync(art.id)
      showToast('Đã xóa bài viết.')
    } catch (err: any) {
      alert(err?.message || 'Không thể xóa bài viết.')
    }
  }

  const handleTogglePublish = async (art: GuideArticle) => {
    const newStatus: GuideArticleStatus = art.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    try {
      await setPublishMut.mutateAsync({
        id: art.id,
        status: newStatus,
      })
      showToast(newStatus === 'PUBLISHED' ? t('admin.publish') : t('admin.unpublish'))
    } catch (err: any) {
      alert(err?.message || 'Không thể đổi trạng thái.')
    }
  }

  return (
    <div className="platform-content">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold shadow-xl border border-neutral-700 animate-in fade-in slide-in-from-bottom-2">
          <IconCheck size={16} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)]">
            {t('admin.title')}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleOpenArticleModal()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-all shadow-xs"
          >
            <IconPlus size={16} />
            <span>{t('admin.newArticle')}</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Categories, Right Articles */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Categories Panel */}
        <div className="lg:col-span-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <IconFolder size={18} className="text-primary" />
              <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
                {t('admin.categories')} ({categories.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => handleOpenCategoryModal()}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              <IconFolderPlus size={14} />
              <span>{t('admin.newCategory')}</span>
            </button>
          </div>

          {catsLoading ? (
            <div className="space-y-2 py-4 animate-pulse">
              <div className="h-10 bg-[var(--color-border)] rounded-xl" />
              <div className="h-10 bg-[var(--color-border)] rounded-xl" />
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--color-text-tertiary)]">
              Chưa có danh mục nào.
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map((cat, idx) => {
                const isSelected = selectedCatFilter === cat.id
                return (
                  <div
                    key={cat.id}
                    draggable
                    onDragStart={(e) => {
                      setDraggedIdx(idx)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnter={() => {
                      if (draggedIdx !== null && draggedIdx !== idx) {
                        setDragOverIdx(idx)
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (draggedIdx !== null && draggedIdx !== idx) {
                        void handleDropReorder(draggedIdx, idx)
                      }
                      setDraggedIdx(null)
                      setDragOverIdx(null)
                    }}
                    onDragEnd={() => {
                      setDraggedIdx(null)
                      setDragOverIdx(null)
                    }}
                    className={`p-3 rounded-xl border transition-all duration-150 select-none ${
                      isSelected
                        ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                        : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)] bg-[var(--color-bg-surface)]'
                    } ${dragOverIdx === idx ? 'border-dashed border-[var(--color-accent)] bg-[var(--color-accent-soft)]/30' : ''} ${draggedIdx === idx ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="pt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] p-1 -ml-1 rounded transition-colors"
                        title={t('admin.dragToReorder')}
                      >
                        <IconGripVertical size={16} />
                      </div>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => {
                          if (draggedIdx !== null) return
                          setSelectedCatFilter(isSelected ? '' : cat.id)
                        }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                            {cat.titleVi}
                          </span>
                          {!cat.published && (
                            <span className="px-1.5 py-0.2 rounded-xs text-[10px] bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                              {t('admin.draft')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--color-text-tertiary)] truncate">
                          {cat.titleEn} · slug: <code className="font-mono">{cat.slug}</code>
                        </div>
                        <div className="text-[10px] text-primary font-medium mt-1">
                          {cat.articleCount} bài viết
                        </div>
                      </div>

                      {/* Category Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenCategoryModal(cat)}
                          className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-primary"
                          title={t('admin.editCategory')}
                        >
                          <IconEdit size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCategory(cat)}
                          className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-red-500"
                          title={t('admin.deleteCategory')}
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right Column: Articles Table & Filters */}
        <div className="lg:col-span-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-4 space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              {/* Category Filter */}
              <select
                value={selectedCatFilter}
                onChange={(e) => setSelectedCatFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
              >
                <option value="">{t('allCategories')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.titleVi}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as GuideArticleStatus | '')}
                className="px-2.5 py-1.5 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
              >
                <option value="">{t('admin.filterStatus')} (Tất cả)</option>
                <option value="DRAFT">{t('admin.draft')}</option>
                <option value="PUBLISHED">{t('admin.published')}</option>
              </select>
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-56 shrink-0">
              <IconSearch
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('admin.searchPlaceholder')}
                className="w-full pl-8 pr-7 py-1.5 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-hidden"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  <IconX size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Articles Table */}
          {articlesLoading ? (
            <div className="py-12 text-center text-xs text-[var(--color-text-tertiary)] animate-pulse">
              Đang tải danh sách bài viết…
            </div>
          ) : articles.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--color-text-tertiary)]">
              {t('empty')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-tertiary)] font-semibold">
                    <th className="py-2.5 px-3">{t('admin.articles')}</th>
                    <th className="py-2.5 px-3">{t('admin.status')}</th>
                    <th className="py-2.5 px-3">{t('admin.order')}</th>
                    <th className="py-2.5 px-3">Cập nhật</th>
                    <th className="py-2.5 px-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {articles.map((art) => {
                    const isPublished = art.status === 'PUBLISHED'
                    return (
                      <tr
                        key={art.id}
                        className="hover:bg-[var(--color-bg-hover)] transition-colors"
                      >
                        <td className="py-3 px-3">
                          <div className="font-semibold text-[var(--color-text-primary)]">
                            {art.titleVi}
                          </div>
                          <div className="text-[11px] text-[var(--color-text-tertiary)]">
                            {art.titleEn} · slug: <code className="font-mono">{art.slug}</code>
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleTogglePublish(art)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap transition-all ${
                              isPublished
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                            }`}
                            title={isPublished ? t('admin.unpublish') : t('admin.publish')}
                          >
                            {isPublished ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                            <span>{isPublished ? t('admin.published') : t('admin.draft')}</span>
                          </button>
                        </td>
                        <td className="py-3 px-3 text-[var(--color-text-secondary)] font-mono whitespace-nowrap">
                          {art.orderIndex}
                        </td>
                        <td className="py-3 px-3 text-[var(--color-text-tertiary)] whitespace-nowrap">
                          {art.updatedAt ? new Date(art.updatedAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewArticleItem(art)
                                setPreviewLang('vi')
                              }}
                              className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-primary transition-colors"
                              title={t('admin.preview')}
                            >
                              <IconFileText size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenArticleModal(art)}
                              className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-primary transition-colors"
                              title={t('admin.editArticle')}
                            >
                              <IconEdit size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteArticle(art)}
                              className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-red-500 transition-colors"
                              title={t('admin.deleteArticle')}
                            >
                              <IconTrash size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Category Modal (Create / Edit) */}
      {categoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 gap-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] shrink-0">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                {editingCategory ? t('admin.editCategory') : t('admin.newCategory')}
              </h3>
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <IconX size={18} />
              </button>
            </div>

            {categoryError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 shrink-0">
                <IconAlertCircle size={16} className="shrink-0" />
                <span>{categoryError}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                  {t('admin.titleVi')} *
                </label>
                <input
                  type="text"
                  value={categoryForm.titleVi}
                  onChange={(e) => setCategoryForm({ ...categoryForm, titleVi: e.target.value })}
                  placeholder="Ví dụ: Bắt đầu"
                  className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                  {t('admin.titleEn')} *
                </label>
                <input
                  type="text"
                  value={categoryForm.titleEn}
                  onChange={(e) => setCategoryForm({ ...categoryForm, titleEn: e.target.value })}
                  placeholder="Example: Getting Started"
                  className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                  {t('admin.slug')}
                </label>
                <input
                  type="text"
                  value={categoryForm.slug ?? ''}
                  onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}
                  placeholder="Tự sinh từ tiêu đề nếu để trống"
                  className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={categoryForm.published ?? true}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, published: e.target.checked })
                    }
                    className="rounded-sm text-primary"
                  />
                  <span>{t('admin.published')}</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--color-border)] shrink-0">
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {t('admin.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveCategory}
                disabled={createCategoryMut.isPending || updateCategoryMut.isPending}
                className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {t('admin.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Article Editor Modal (Create / Edit) */}
      {articleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] shrink-0">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                {editingArticle ? t('admin.editArticle') : t('admin.newArticle')}
              </h3>
              <button
                type="button"
                onClick={() => setArticleModalOpen(false)}
                className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <IconX size={18} />
              </button>
            </div>

            {articleError && (
              <div className="my-3 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs flex items-center gap-2 shrink-0">
                <IconAlertCircle size={16} className="shrink-0" />
                <span>{articleError}</span>
              </div>
            )}

            {/* Modal Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              {/* Category & Status Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.filterCategory')} *
                  </label>
                  <select
                    value={articleForm.categoryId}
                    onChange={(e) =>
                      setArticleForm({ ...articleForm, categoryId: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  >
                    <option value="">-- Chọn danh mục --</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.titleVi} ({c.titleEn})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.status')}
                  </label>
                  <select
                    value={articleForm.status}
                    onChange={(e) =>
                      setArticleForm({
                        ...articleForm,
                        status: e.target.value as GuideArticleStatus,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  >
                    <option value="DRAFT">{t('admin.draft')}</option>
                    <option value="PUBLISHED">{t('admin.published')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.order')}
                  </label>
                  <input
                    type="number"
                    value={articleForm.orderIndex ?? 0}
                    onChange={(e) =>
                      setArticleForm({ ...articleForm, orderIndex: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Title Vi & En */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.titleVi')} *
                  </label>
                  <input
                    type="text"
                    value={articleForm.titleVi}
                    onChange={(e) => setArticleForm({ ...articleForm, titleVi: e.target.value })}
                    placeholder="Tiêu đề tiếng Việt"
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.titleEn')} *
                  </label>
                  <input
                    type="text"
                    value={articleForm.titleEn}
                    onChange={(e) => setArticleForm({ ...articleForm, titleEn: e.target.value })}
                    placeholder="English title"
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Slug & Cover Image */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.slug')}
                  </label>
                  <input
                    type="text"
                    value={articleForm.slug ?? ''}
                    onChange={(e) => setArticleForm({ ...articleForm, slug: e.target.value })}
                    placeholder="Tự sinh từ tiêu đề tiếng Việt nếu để trống"
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] font-mono focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.coverImage')}
                  </label>
                  <input
                    type="text"
                    value={articleForm.coverImageUrl ?? ''}
                    onChange={(e) =>
                      setArticleForm({ ...articleForm, coverImageUrl: e.target.value })
                    }
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Excerpts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.excerptVi')}
                  </label>
                  <textarea
                    rows={2}
                    value={articleForm.excerptVi ?? ''}
                    onChange={(e) =>
                      setArticleForm({ ...articleForm, excerptVi: e.target.value })
                    }
                    placeholder="Tóm tắt ngắn gọn bài viết..."
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                    {t('admin.excerptEn')}
                  </label>
                  <textarea
                    rows={2}
                    value={articleForm.excerptEn ?? ''}
                    onChange={(e) =>
                      setArticleForm({ ...articleForm, excerptEn: e.target.value })
                    }
                    placeholder="Brief summary of the article..."
                    className="w-full px-3 py-2 rounded-xl text-xs bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Markdown Content Section */}
              <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[var(--color-text-primary)]">
                      Nội dung Markdown
                    </span>
                    <span className="text-[11px] text-[var(--color-text-tertiary)]">
                      (Hỗ trợ GitHub Flavored Markdown)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Write / Preview Tab */}
                    <div className="flex items-center p-0.5 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border)]">
                      <button
                        type="button"
                        onClick={() => setArticleEditorTab('write')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                          articleEditorTab === 'write'
                            ? 'bg-white dark:bg-neutral-800 text-[var(--color-text-primary)] shadow-xs'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {t('admin.tabWrite')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setArticleEditorTab('preview')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                          articleEditorTab === 'preview'
                            ? 'bg-white dark:bg-neutral-800 text-[var(--color-text-primary)] shadow-xs'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {t('admin.tabPreview')}
                      </button>
                    </div>

                    {/* Language Switcher for Content */}
                    <div className="flex items-center p-0.5 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border)]">
                      <button
                        type="button"
                        onClick={() => setArticleContentLang('vi')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                          articleContentLang === 'vi'
                            ? 'bg-primary text-white shadow-xs'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        VI
                      </button>
                      <button
                        type="button"
                        onClick={() => setArticleContentLang('en')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                          articleContentLang === 'en'
                            ? 'bg-primary text-white shadow-xs'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        EN
                      </button>
                    </div>
                  </div>
                </div>

                {articleEditorTab === 'write' ? (
                  articleContentLang === 'vi' ? (
                    <textarea
                      rows={12}
                      value={articleForm.contentVi}
                      onChange={(e) =>
                        setArticleForm({ ...articleForm, contentVi: e.target.value })
                      }
                      placeholder="# Tiêu đề bài viết\n\nNội dung Markdown tiếng Việt..."
                      className="w-full p-3 rounded-xl text-xs font-mono bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden leading-relaxed"
                    />
                  ) : (
                    <textarea
                      rows={12}
                      value={articleForm.contentEn}
                      onChange={(e) =>
                        setArticleForm({ ...articleForm, contentEn: e.target.value })
                      }
                      placeholder="# Article Title\n\nEnglish markdown content..."
                      className="w-full p-3 rounded-xl text-xs font-mono bg-[var(--color-bg-surface-2)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-hidden leading-relaxed"
                    />
                  )
                ) : (
                  <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-hover)] min-h-[300px] overflow-y-auto prose prose-neutral dark:prose-invert max-w-none text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {articleContentLang === 'vi'
                        ? articleForm.contentVi || '*Chưa có nội dung Tiếng Việt*'
                        : articleForm.contentEn || '*No English content yet*'}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--color-border)] shrink-0">
              <button
                type="button"
                onClick={() => setArticleModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {t('admin.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveArticle}
                disabled={createArticleMut.isPending || updateArticleMut.isPending}
                className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {t('admin.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Preview Modal */}
      {previewArticleItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-base font-bold text-[var(--color-text-primary)]">
                  {t('admin.preview')}
                </span>
                <div className="flex items-center p-0.5 rounded-lg bg-[var(--color-bg-hover)] border border-[var(--color-border)]">
                  <button
                    type="button"
                    onClick={() => setPreviewLang('vi')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                      previewLang === 'vi'
                        ? 'bg-primary text-white'
                        : 'text-[var(--color-text-tertiary)]'
                    }`}
                  >
                    VI
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewLang('en')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                      previewLang === 'en'
                        ? 'bg-primary text-white'
                        : 'text-[var(--color-text-tertiary)]'
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewArticleItem(null)}
                className="p-1 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                <IconX size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-6 pr-2 space-y-4">
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
                {previewLang === 'vi' ? previewArticleItem.titleVi : previewArticleItem.titleEn}
              </h1>

              {(previewLang === 'vi'
                ? previewArticleItem.excerptVi
                : previewArticleItem.excerptEn) && (
                <p className="text-sm text-[var(--color-text-secondary)] italic">
                  {previewLang === 'vi'
                    ? previewArticleItem.excerptVi
                    : previewArticleItem.excerptEn}
                </p>
              )}

              <div className="prose prose-neutral dark:prose-invert max-w-none text-xs leading-relaxed border-t border-[var(--color-border)] pt-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {(previewLang === 'vi'
                    ? previewArticleItem.contentVi
                    : previewArticleItem.contentEn) || ''}
                </ReactMarkdown>
              </div>
            </div>

            <div className="flex items-center justify-end pt-3 border-t border-[var(--color-border)] shrink-0">
              <button
                type="button"
                onClick={() => setPreviewArticleItem(null)}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
              >
                {t('admin.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
