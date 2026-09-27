import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'

interface TestimonialStory {
  id: string
  group: 'Freelancer' | 'Creator'
  category: string
  title: string
  content: string
  author: string
  role: string
  image: string
  highlightMetric: string
  highlightMetricLabel: string
}

function getCustomerStories(t: (key: string) => string): TestimonialStory[] {
  return [
    {
      id: 'freelancer-1',
      group: 'Freelancer',
      category: t('stories.items.freelancer1.category'),
      title: t('stories.items.freelancer1.title'),
      content: t('stories.items.freelancer1.content'),
      author: t('stories.items.freelancer1.author'),
      role: t('stories.items.freelancer1.role'),
      image: '/landing/images/asset_19.jpg',
      highlightMetric: t('stories.items.freelancer1.metric'),
      highlightMetricLabel: t('stories.items.freelancer1.metricLabel')
    },
    {
      id: 'freelancer-2',
      group: 'Freelancer',
      category: t('stories.items.freelancer2.category'),
      title: t('stories.items.freelancer2.title'),
      content: t('stories.items.freelancer2.content'),
      author: t('stories.items.freelancer2.author'),
      role: t('stories.items.freelancer2.role'),
      image: '/landing/images/asset_20.png',
      highlightMetric: t('stories.items.freelancer2.metric'),
      highlightMetricLabel: t('stories.items.freelancer2.metricLabel')
    },
    {
      id: 'freelancer-3',
      group: 'Freelancer',
      category: t('stories.items.freelancer3.category'),
      title: t('stories.items.freelancer3.title'),
      content: t('stories.items.freelancer3.content'),
      author: t('stories.items.freelancer3.author'),
      role: t('stories.items.freelancer3.role'),
      image: '/landing/images/asset_23.jpg',
      highlightMetric: t('stories.items.freelancer3.metric'),
      highlightMetricLabel: t('stories.items.freelancer3.metricLabel')
    },
    {
      id: 'freelancer-4',
      group: 'Freelancer',
      category: t('stories.items.freelancer4.category'),
      title: t('stories.items.freelancer4.title'),
      content: t('stories.items.freelancer4.content'),
      author: t('stories.items.freelancer4.author'),
      role: t('stories.items.freelancer4.role'),
      image: '/landing/images/asset_24.png',
      highlightMetric: t('stories.items.freelancer4.metric'),
      highlightMetricLabel: t('stories.items.freelancer4.metricLabel')
    },
    {
      id: 'creator-1',
      group: 'Creator',
      category: t('stories.items.creator1.category'),
      title: t('stories.items.creator1.title'),
      content: t('stories.items.creator1.content'),
      author: t('stories.items.creator1.author'),
      role: t('stories.items.creator1.role'),
      image: '/landing/images/asset_25.png',
      highlightMetric: t('stories.items.creator1.metric'),
      highlightMetricLabel: t('stories.items.creator1.metricLabel')
    },
    {
      id: 'creator-2',
      group: 'Creator',
      category: t('stories.items.creator2.category'),
      title: t('stories.items.creator2.title'),
      content: t('stories.items.creator2.content'),
      author: t('stories.items.creator2.author'),
      role: t('stories.items.creator2.role'),
      image: '/landing/images/asset_26.jpg',
      highlightMetric: t('stories.items.creator2.metric'),
      highlightMetricLabel: t('stories.items.creator2.metricLabel')
    },
    {
      id: 'creator-3',
      group: 'Creator',
      category: t('stories.items.creator3.category'),
      title: t('stories.items.creator3.title'),
      content: t('stories.items.creator3.content'),
      author: t('stories.items.creator3.author'),
      role: t('stories.items.creator3.role'),
      image: '/landing/images/asset_27.png',
      highlightMetric: t('stories.items.creator3.metric'),
      highlightMetricLabel: t('stories.items.creator3.metricLabel')
    }
  ]
}

export function LandingCustomerStories() {
  const { t } = useTranslation('landing')
  const stories = useMemo(() => getCustomerStories(t), [t])

  const [activeIndex, setActiveIndex] = useState(0)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [maxTranslate, setMaxTranslate] = useState(0)

  const sectionRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // Calculate the maximum horizontal distance to translate
  const updateMaxTranslate = useCallback(() => {
    if (trackRef.current) {
      const scrollW = trackRef.current.scrollWidth
      const clientW = window.innerWidth
      // Leave comfortable margin on the right when reaching 100% progress
      const max = Math.max(0, scrollW - clientW + 80)
      setMaxTranslate(max)
    }
  }, [])

  useEffect(() => {
    updateMaxTranslate()
    window.addEventListener('resize', updateMaxTranslate)
    return () => window.removeEventListener('resize', updateMaxTranslate)
  }, [updateMaxTranslate])

  // Track window scroll inside the sticky section
  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current
      if (!section) return

      const rect = section.getBoundingClientRect()
      const totalScrollable = section.offsetHeight - window.innerHeight
      if (totalScrollable <= 0) return

      // How far down the user has scrolled through this section (0 to 1)
      const currentScroll = -rect.top
      const progress = Math.max(0, Math.min(1, currentScroll / totalScrollable))
      setScrollProgress(progress)

      // Map progress to active card index (0 to 6)
      const index = Math.min(
        stories.length - 1,
        Math.round(progress * (stories.length - 1))
      )
      setActiveIndex(index)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [stories.length])

  // Smoothly scroll window vertically to position corresponding to card index
  const scrollToCard = useCallback(
    (index: number) => {
      const section = sectionRef.current
      if (!section) return

      const totalScrollable = section.offsetHeight - window.innerHeight
      if (totalScrollable <= 0) return

      const targetProgress = index / (stories.length - 1)
      const sectionTop = section.getBoundingClientRect().top + window.scrollY
      const targetScrollTop = sectionTop + targetProgress * totalScrollable

      window.scrollTo({
        top: targetScrollTop,
        behavior: 'smooth'
      })
    },
    [stories.length]
  )

  const nextSlide = () => {
    const next = Math.min(stories.length - 1, activeIndex + 1)
    scrollToCard(next)
  }

  const prevSlide = () => {
    const prev = Math.max(0, activeIndex - 1)
    scrollToCard(prev)
  }

  return (
    <section
      ref={sectionRef}
      id="customers"
      className="relative h-[340vh] sm:h-[380vh] w-full"
    >
      {/* Sticky Viewport Container that locks in place during vertical scroll */}
      <div className="sticky top-0 h-screen w-full flex flex-col justify-center overflow-hidden py-4 select-none">
        {/* Section Header */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full mb-6 sm:mb-8 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100/80 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-xs font-semibold mb-2.5 border border-blue-200/50 dark:border-blue-800/40">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse" />
                {t('stories.badge')}
              </div>
              <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-neutral-900 dark:text-white leading-tight">
                {t('stories.title')}
              </h2>
              <p className="text-neutral-500 dark:text-neutral-400 text-xs sm:text-sm mt-2 max-w-2xl leading-relaxed">
                {t('stories.subtitle')}
              </p>
            </div>

            {/* Prev / Next & Progress Counter */}
            <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
              <span className="text-xs font-mono font-bold text-neutral-500 dark:text-neutral-400">
                0{activeIndex + 1} <span className="text-neutral-300 dark:text-neutral-600">/</span> 0{stories.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={prevSlide}
                  disabled={activeIndex === 0}
                  className="w-9 h-9 rounded-full border border-neutral-200/80 dark:border-white/10 bg-white dark:bg-[#13151b] hover:bg-neutral-100 dark:hover:bg-[#1a1d26] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-neutral-700 dark:text-neutral-300 transition-all shadow-sm cursor-pointer active:scale-95"
                  aria-label={t('stories.prev')}
                >
                  <IconChevronLeft size={18} />
                </button>
                <button
                  onClick={nextSlide}
                  disabled={activeIndex === stories.length - 1}
                  className="w-9 h-9 rounded-full border border-neutral-200/80 dark:border-white/10 bg-white dark:bg-[#13151b] hover:bg-neutral-100 dark:hover:bg-[#1a1d26] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center text-neutral-700 dark:text-neutral-300 transition-all shadow-sm cursor-pointer active:scale-95"
                  aria-label={t('stories.next')}
                >
                  <IconChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Horizontal Carousel Track Driven by Vertical Scroll */}
        <div
          ref={trackRef}
          style={{
            transform: `translate3d(-${scrollProgress * maxTranslate}px, 0, 0)`,
            willChange: 'transform'
          }}
          className="flex gap-6 sm:gap-8 px-4 sm:px-12 lg:px-24 transition-transform duration-75 ease-out"
        >
          {stories.map((story, index) => {
            const isActive = index === activeIndex

            return (
              <div
                key={story.id}
                onClick={() => scrollToCard(index)}
                className={`shrink-0 w-[86vw] sm:w-[580px] md:w-[660px] lg:w-[720px] h-[340px] sm:h-[380px] rounded-[28px] sm:rounded-[32px] overflow-hidden relative cursor-pointer transition-all duration-500 ease-out ${
                  isActive
                    ? 'border-[2.5px] border-blue-600 dark:border-blue-500 shadow-[0_20px_50px_rgba(37,99,235,0.25)] scale-[1.01]'
                    : 'border border-neutral-200/80 dark:border-white/10 opacity-80 hover:opacity-100 scale-[0.99]'
                }`}
              >
                {/* Abstract Gradient Background Image */}
                <img
                  src={story.image}
                  alt={story.title}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/10 pointer-events-none" />

                {/* White Card Box Overlay on the Right Half */}
                <div className="relative z-10 ml-auto h-full w-full sm:w-[60%] md:w-[56%] bg-white dark:bg-[#13151b]/95 backdrop-blur-md rounded-2xl sm:rounded-[28px] p-6 sm:p-7 flex flex-col justify-between shadow-2xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.7)] border-l border-neutral-100/50 dark:border-white/10">
                  <div>
                    {/* Quotation Marks Icon & Category Tag */}
                    <div className="flex items-center justify-between mb-3">
                      <svg
                        width="24"
                        height="20"
                        viewBox="0 0 22 18"
                        fill="currentColor"
                        className="text-neutral-900 dark:text-white"
                      >
                        <path d="M0 10.2857C0 4.60714 3.42857 0 9.14286 0V3.71429C5.71429 3.71429 4.28571 6.28571 4.28571 8.85714H9.14286V18H0V10.2857ZM12.8571 10.2857C12.8571 4.60714 16.2857 0 22 0V3.71429C18.5714 3.71429 17.1429 6.28571 17.1429 8.85714H22V18H12.8571V10.2857Z" />
                      </svg>

                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          story.group === 'Freelancer'
                            ? 'bg-purple-100 dark:bg-purple-950/60 text-[#714ffc] dark:text-[#a78bff]'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {story.category}
                      </span>
                    </div>

                    {/* Story Title */}
                    <h3 className="text-base sm:text-[17px] font-bold text-neutral-900 dark:text-white tracking-tight leading-snug line-clamp-2 mb-2">
                      {story.title}
                    </h3>

                    {/* Story Content */}
                    <p className="text-xs sm:text-[12.5px] text-neutral-600 dark:text-neutral-300 leading-relaxed line-clamp-4">
                      "{story.content}"
                    </p>
                  </div>

                  {/* Author Info & Highlight Metric Bar */}
                  <div className="pt-3.5 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#714ffc] to-[#5b8cff] flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-sm">
                        {story.author.charAt(0)}
                      </div>
                      <div className="truncate">
                        <div className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                          {story.author}
                        </div>
                        <div className="text-[10px] text-neutral-500 dark:text-neutral-400 italic truncate">
                          {story.role}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="block text-xs font-black text-blue-600 dark:text-blue-400 font-mono">
                        {story.highlightMetric}
                      </span>
                      <span className="block text-[9px] text-neutral-400 dark:text-neutral-500">
                        {story.highlightMetricLabel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 7 Interactive Pagination Dots */}
        <div className="flex items-center justify-center gap-2 mt-6 sm:mt-8 shrink-0">
          {stories.map((_, i) => {
            const isDotActive = i === activeIndex

            return (
              <button
                key={i}
                onClick={() => scrollToCard(i)}
                aria-label={t('stories.goToStory', { index: i + 1 })}
                className={`transition-all duration-300 rounded-full cursor-pointer ${
                  isDotActive
                    ? 'w-7 h-2 bg-blue-600 dark:bg-blue-500'
                    : 'w-2 h-2 bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400 dark:hover:bg-neutral-600'
                }`}
              />
            )
          })}
        </div>
      </div>
    </section>
  )
}
