import { useState, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  IconArrowRight,
  IconBook2,
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconMenu2,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import { Logo } from '@/components/shared/Logo'
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { useGuideArticles, useGuideCategories } from '@/hooks/useGuide'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'
import type { GuideArticle } from '@/types/guide'

export function GuidePage() {
  const { t, i18n } = useTranslation('guide')
  const { slug } = useParams<{ slug?: string }>()
  const navigate = useNavigate()

  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)
  const lastWsId = getLastWorkspaceId()
  const studioTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : lastWsId
        ? `/w/${lastWsId}/media`
        : '/dashboard'
    : '/login'

  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const { data: categories = [], isLoading: catsLoading } = useGuideCategories(lang)
  const { data: articles = [], isLoading: articlesLoading } = useGuideArticles({ lang })

  const [searchQuery, setSearchQuery] = useState('')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})

  // Determine active article
  const activeArticle: GuideArticle | undefined = useMemo(() => {
    if (articles.length === 0) return undefined
    if (slug) {
      return articles.find((a) => a.slug === slug)
    }
    return articles[0]
  }, [articles, slug])

  // Filter articles based on search query
  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim()) return articles
    const q = searchQuery.toLowerCase().trim()
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.excerpt && a.excerpt.toLowerCase().includes(q)) ||
        a.slug.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q),
    )
  }, [articles, searchQuery])

  // Group filtered articles by category
  const categorizedArticles = useMemo(() => {
    const map = new Map<string, { categoryTitle: string; items: GuideArticle[] }>()
    for (const cat of categories) {
      map.set(cat.id, { categoryTitle: cat.title, items: [] })
    }
    for (const art of filteredArticles) {
      if (map.has(art.categoryId)) {
        map.get(art.categoryId)!.items.push(art)
      } else {
        const fallbackTitle = art.categoryTitle || t('category')
        if (!map.has(art.categoryId)) {
          map.set(art.categoryId, { categoryTitle: fallbackTitle, items: [] })
        }
        map.get(art.categoryId)!.items.push(art)
      }
    }
    return Array.from(map.entries())
      .filter(([_, group]) => group.items.length > 0 || !searchQuery.trim())
      .map(([catId, group]) => ({
        categoryId: catId,
        categoryTitle: group.categoryTitle,
        articles: group.items,
      }))
  }, [categories, filteredArticles, searchQuery, t])

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }))
  }

  const handleSelectArticle = (artSlug: string) => {
    setMobileSidebarOpen(false)
    navigate(`/guide/${artSlug}`)
  }

  const isLoading = catsLoading || articlesLoading

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-[#0a0a0c] text-neutral-900 dark:text-neutral-100">
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 h-16 border-b border-neutral-200/80 dark:border-neutral-800/80 bg-white/90 dark:bg-[#09090a]/90 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="md:hidden p-2 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
            aria-label="Toggle navigation"
          >
            {mobileSidebarOpen ? <IconX size={20} /> : <IconMenu2 size={20} />}
          </button>
          <Logo to="/" />
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
            <IconBook2 size={14} className="text-primary" />
            <span>{t('title')}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageSwitcher className="h-9 px-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100/80 dark:bg-neutral-900/80 text-xs font-semibold" />
          <ThemeToggle className="h-9 w-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-100/80 dark:bg-neutral-900/80" />

          {accessToken ? (
            <Link
              to={studioTarget}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-xs"
            >
              <span>Studio</span>
              <IconArrowRight size={14} />
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="hidden sm:inline-block text-xs sm:text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:text-black dark:hover:text-white px-2.5 py-1.5 transition-colors"
              >
                {t('loginBtn')}
              </Link>
              <Link
                to="/register"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-xs"
              >
                <span>{t('ctaBtn')}</span>
                <IconArrowRight size={14} />
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto flex">
        {/* Desktop Sidebar (Sticky) */}
        <aside className="hidden md:block w-72 shrink-0 border-r border-neutral-200/80 dark:border-neutral-800/80 bg-white/50 dark:bg-[#09090a]/50 p-4 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
          {/* Search bar */}
          <div className="relative mb-4">
            <IconSearch
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('search')}
              className="w-full pl-9 pr-8 py-2 rounded-xl text-xs bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <IconX size={14} />
              </button>
            )}
          </div>

          {/* Navigation Tree */}
          {isLoading ? (
            <div className="space-y-3 py-2 animate-pulse">
              <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-3/4" />
              <div className="h-8 bg-neutral-200 dark:bg-neutral-800 rounded-lg w-full" />
              <div className="h-8 bg-neutral-200 dark:bg-neutral-800 rounded-lg w-full" />
            </div>
          ) : categorizedArticles.length === 0 ? (
            <div className="text-center py-8 text-neutral-400 text-xs">{t('empty')}</div>
          ) : (
            <nav className="space-y-4">
              {categorizedArticles.map((group) => {
                const isCollapsed = Boolean(collapsedCategories[group.categoryId])
                return (
                  <div key={group.categoryId} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleCategory(group.categoryId)}
                      className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 px-2 py-1.5 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                    >
                      <span>{group.categoryTitle}</span>
                      {isCollapsed ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
                    </button>

                    {!isCollapsed && (
                      <div className="pl-1 space-y-0.5">
                        {group.articles.map((art) => {
                          const isActive = activeArticle?.slug === art.slug
                          return (
                            <button
                              key={art.id}
                              type="button"
                              onClick={() => handleSelectArticle(art.slug)}
                              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-all text-left ${
                                isActive
                                  ? 'bg-neutral-200/80 dark:bg-white/10 text-neutral-950 dark:text-white font-semibold shadow-xs'
                                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-neutral-200'
                              }`}
                            >
                              <IconFileText size={15} className="shrink-0 opacity-70" />
                              <span className="truncate">{art.title}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>
          )}
        </aside>

        {/* Mobile Sidebar Drawer */}
        {mobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex">
            <div className="w-80 max-w-[85vw] bg-white dark:bg-[#0a0a0c] h-full p-4 flex flex-col shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <span className="font-semibold text-sm">{t('title')}</span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-1 rounded-md text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                >
                  <IconX size={18} />
                </button>
              </div>

              <div className="mt-3 relative">
                <IconSearch
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search')}
                  className="w-full pl-9 pr-8 py-2 rounded-xl text-xs bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800"
                />
              </div>

              <div className="flex-1 overflow-y-auto mt-4 space-y-4">
                {categorizedArticles.map((group) => (
                  <div key={group.categoryId} className="space-y-1">
                    <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 px-2 py-1">
                      {group.categoryTitle}
                    </div>
                    <div className="space-y-0.5">
                      {group.articles.map((art) => (
                        <button
                          key={art.id}
                          type="button"
                          onClick={() => handleSelectArticle(art.slug)}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left ${
                            activeArticle?.slug === art.slug
                              ? 'bg-neutral-200 dark:bg-white/10 text-neutral-900 dark:text-white font-semibold'
                              : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                          }`}
                        >
                          <IconFileText size={15} className="shrink-0 opacity-70" />
                          <span className="truncate">{art.title}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1" onClick={() => setMobileSidebarOpen(false)} />
          </div>
        )}

        {/* Article Reader Area */}
        <main className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-8 max-w-4xl">
          {isLoading ? (
            <div className="space-y-6 animate-pulse">
              <div className="h-6 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-1/4" />
              <div className="h-10 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-3/4" />
              <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-1/2" />
              <div className="space-y-3 pt-6">
                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-full" />
                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-5/6" />
                <div className="h-4 bg-neutral-200 dark:bg-neutral-800 rounded-sm w-4/5" />
              </div>
            </div>
          ) : !activeArticle ? (
            <div className="py-16 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
                <IconFileText size={28} />
              </div>
              <h2 className="text-xl font-bold mb-2">{t('notFound')}</h2>
              <p className="text-sm text-neutral-500 mb-6">{t('empty')}</p>
              {articles.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleSelectArticle(articles[0].slug)}
                  className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  {t('backToGuide')}
                </button>
              )}
            </div>
          ) : (
            <article className="space-y-8">
              {/* Breadcrumb & Metadata */}
              <div className="space-y-2 border-b border-neutral-200 dark:border-neutral-800 pb-6">
                <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  <Link to="/" className="hover:text-neutral-900 dark:hover:text-white">
                    Home
                  </Link>
                  <span>/</span>
                  <Link to="/guide" className="hover:text-neutral-900 dark:hover:text-white">
                    {t('title')}
                  </Link>
                  {activeArticle.categoryTitle && (
                    <>
                      <span>/</span>
                      <span>{activeArticle.categoryTitle}</span>
                    </>
                  )}
                </div>

                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-neutral-950 dark:text-white pt-2">
                  {activeArticle.title}
                </h1>

                {activeArticle.excerpt && (
                  <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed pt-1">
                    {activeArticle.excerpt}
                  </p>
                )}

                {activeArticle.updatedAt && (
                  <div className="text-xs text-neutral-400 pt-2">
                    {t('updatedAt')}: {new Date(activeArticle.updatedAt).toLocaleDateString()}
                  </div>
                )}
              </div>

              {/* Markdown Content */}
              <div className="prose prose-neutral dark:prose-invert max-w-none text-neutral-800 dark:text-neutral-200 text-sm sm:text-base leading-relaxed space-y-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-2xl sm:text-3xl font-bold mt-8 mb-4 border-b border-neutral-200 dark:border-neutral-800 pb-2">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-xl sm:text-2xl font-bold mt-6 mb-3 text-neutral-900 dark:text-white">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-lg font-semibold mt-4 mb-2 text-neutral-900 dark:text-white">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => <p className="mb-4 leading-7">{children}</p>,
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside mb-4 space-y-1.5 pl-2">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside mb-4 space-y-1.5 pl-2">{children}</ol>
                    ),
                    li: ({ children }) => <li className="leading-7">{children}</li>,
                    code: ({ children, className }) => {
                      const isInline = !className
                      return isInline ? (
                        <code className="px-1.5 py-0.5 rounded-md bg-neutral-200/70 dark:bg-neutral-800 font-mono text-xs text-primary font-medium">
                          {children}
                        </code>
                      ) : (
                        <code className="block p-4 rounded-xl bg-neutral-900 text-neutral-100 dark:bg-neutral-950 font-mono text-xs overflow-x-auto border border-neutral-800 my-4">
                          {children}
                        </code>
                      )
                    },
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-primary pl-4 py-1 italic my-4 text-neutral-600 dark:text-neutral-300 bg-neutral-100/50 dark:bg-neutral-900/50 rounded-r-lg">
                        {children}
                      </blockquote>
                    ),
                    img: ({ src, alt }) => (
                      <img
                        src={src}
                        alt={alt ?? ''}
                        loading="lazy"
                        className="rounded-xl border border-neutral-200 dark:border-neutral-800 max-w-full my-6 shadow-md"
                      />
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-6 rounded-xl border border-neutral-200 dark:border-neutral-800">
                        <table className="w-full text-left text-xs border-collapse">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 p-3 font-semibold">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border-b border-neutral-200/60 dark:border-neutral-800/60 p-3">
                        {children}
                      </td>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary hover:underline font-medium"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {activeArticle.content}
                </ReactMarkdown>
              </div>

              {/* Bottom CTA Card */}
              {!accessToken && (
                <div className="mt-16 p-6 sm:p-8 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-neutral-100 to-white dark:from-neutral-900 dark:to-neutral-950 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-neutral-900 dark:text-white">
                      {t('ctaTitle')}
                    </h3>
                    <p className="text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
                      {t('ctaDesc')}
                    </p>
                  </div>
                  <Link
                    to="/register"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs sm:text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shrink-0 shadow-sm"
                  >
                    <span>{t('ctaBtn')}</span>
                    <IconArrowRight size={16} />
                  </Link>
                </div>
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  )
}
