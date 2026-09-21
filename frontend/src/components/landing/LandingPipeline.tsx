import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  IconMicrophone,
  IconMusic,
  IconLanguage,
  IconCheck,
  IconDownload,
  IconShieldCheck,
  IconScissors,
  IconFileText,
  IconVolume,
  IconPlayerPlay,
  IconPlayerPause,
  IconWaveSine,
  IconArrowRight,
  IconDatabase,
  IconLayersLinked,
  IconActivity,
  IconClock,
  IconVolume2,
  IconHeadphones,
  IconLock,
  IconLockOpen,
  IconAlertTriangle,
  IconVideo,
  IconChevronDown,
  IconChevronUp
} from '@tabler/icons-react'
import { useAuthStore } from '@/store/authStore'

export type WorkflowType = 'localization' | 'summarization'

interface StepData {
  id: string
  stageNum: string
  tabLabel: string
  tags: string[]
  headline: string
  technicalDetails: string
  metricPrimary: string
  metricPrimaryLabel: string
  metricSecondary: string
  metricSecondaryLabel: string
}

function getLocalizationSteps(t: (key: string) => string): StepData[] {
  return [
    {
      id: 'extract',
      stageNum: '01',
      tabLabel: t('pipeline.stepExtract.tab'),
      tags: ['STAGE 01'],
      headline: t('pipeline.stepExtract.headline'),
      technicalDetails: t('pipeline.stepExtract.details'),
      metricPrimary: t('pipeline.stepExtract.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepExtract.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepExtract.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepExtract.metricSecondaryLabel')
    },
    {
      id: 'stt',
      stageNum: '02',
      tabLabel: t('pipeline.stepStt.tab'),
      tags: ['STAGE 02'],
      headline: t('pipeline.stepStt.headline'),
      technicalDetails: t('pipeline.stepStt.details'),
      metricPrimary: t('pipeline.stepStt.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepStt.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepStt.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepStt.metricSecondaryLabel')
    },
    {
      id: 'translate',
      stageNum: '03',
      tabLabel: t('pipeline.stepTranslate.tab'),
      tags: ['STAGE 03'],
      headline: t('pipeline.stepTranslate.headline'),
      technicalDetails: t('pipeline.stepTranslate.details'),
      metricPrimary: t('pipeline.stepTranslate.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepTranslate.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepTranslate.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepTranslate.metricSecondaryLabel')
    },
    {
      id: 'dubbing',
      stageNum: '04',
      tabLabel: t('pipeline.stepDubbing.tab'),
      tags: ['STAGE 04'],
      headline: t('pipeline.stepDubbing.headline'),
      technicalDetails: t('pipeline.stepDubbing.details'),
      metricPrimary: t('pipeline.stepDubbing.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepDubbing.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepDubbing.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepDubbing.metricSecondaryLabel')
    },
    {
      id: 'render',
      stageNum: '05',
      tabLabel: t('pipeline.stepRender.tab'),
      tags: ['STAGE 05'],
      headline: t('pipeline.stepRender.headline'),
      technicalDetails: t('pipeline.stepRender.details'),
      metricPrimary: t('pipeline.stepRender.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepRender.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepRender.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepRender.metricSecondaryLabel')
    }
  ]
}

function getSummarizationSteps(t: (key: string) => string): StepData[] {
  return [
    {
      id: 'sum_chunk',
      stageNum: '01',
      tabLabel: t('pipeline.stepSumChunk.tab'),
      tags: ['STAGE 01'],
      headline: t('pipeline.stepSumChunk.headline'),
      technicalDetails: t('pipeline.stepSumChunk.details'),
      metricPrimary: t('pipeline.stepSumChunk.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepSumChunk.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepSumChunk.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepSumChunk.metricSecondaryLabel')
    },
    {
      id: 'sum_cutplan',
      stageNum: '02',
      tabLabel: t('pipeline.stepSumCutplan.tab'),
      tags: ['STAGE 02'],
      headline: t('pipeline.stepSumCutplan.headline'),
      technicalDetails: t('pipeline.stepSumCutplan.details'),
      metricPrimary: t('pipeline.stepSumCutplan.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepSumCutplan.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepSumCutplan.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepSumCutplan.metricSecondaryLabel')
    },
    {
      id: 'sum_export',
      stageNum: '03',
      tabLabel: t('pipeline.stepSumExport.tab'),
      tags: ['STAGE 03'],
      headline: t('pipeline.stepSumExport.headline'),
      technicalDetails: t('pipeline.stepSumExport.details'),
      metricPrimary: t('pipeline.stepSumExport.metricPrimary'),
      metricPrimaryLabel: t('pipeline.stepSumExport.metricPrimaryLabel'),
      metricSecondary: t('pipeline.stepSumExport.metricSecondary'),
      metricSecondaryLabel: t('pipeline.stepSumExport.metricSecondaryLabel')
    }
  ]
}

export function LandingPipeline() {
  const { t } = useTranslation('landing')
  const [workflow, setWorkflow] = useState<WorkflowType>('localization')
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  // Interactive local states for animations
  const [activeAudioTrack, setActiveAudioTrack] = useState<'both' | 'vocal' | 'bgm'>('both')
  const [subtitleMode, setSubtitleMode] = useState<'hard' | 'soft'>('hard')
  const [activeVoice, setActiveVoice] = useState<'ban_mai' | 'minh_quang'>('ban_mai')
  const [isPlayingDemo, setIsPlayingDemo] = useState(true)
  const [showAllTechDetails, setShowAllTechDetails] = useState(false)

  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)
  const authTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/media`
      : '/dashboard'
    : '/login'

  const localizationSteps = useMemo(() => getLocalizationSteps(t), [t])
  const summarizationSteps = useMemo(() => getSummarizationSteps(t), [t])
  const steps = workflow === 'localization' ? localizationSteps : summarizationSteps
  const currentStep = steps[currentStepIndex] || steps[0]

  const tabsContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll active tab into view horizontally on mobile (never scroll window)
  useEffect(() => {
    const container = tabsContainerRef.current
    if (!container) return
    const activeTab = container.children[currentStepIndex] as HTMLElement
    if (!activeTab) return

    const containerWidth = container.clientWidth
    const tabLeft = activeTab.offsetLeft
    const tabWidth = activeTab.offsetWidth
    const targetScrollLeft = tabLeft - containerWidth / 2 + tabWidth / 2

    container.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: 'smooth'
    })
  }, [currentStepIndex])

  // Deterministic Sequential Auto-play Timeline (Strictly 1 -> 2 -> 3 -> 4 -> 5 -> 1)
  useEffect(() => {
    if (isHovered) return

    const STEP_DURATION_MS = 5000
    const intervalMs = 25
    const startTime = Date.now()

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const pct = Math.min(100, (elapsed / STEP_DURATION_MS) * 100)
      setProgress(pct)

      if (elapsed >= STEP_DURATION_MS) {
        clearInterval(timer)
        // Advance strictly by 1 in sequential order: 0 -> 1 -> 2 -> 3 -> 4 -> 0
        setCurrentStepIndex((curr) => (curr + 1) % steps.length)
        setProgress(0)
      }
    }, intervalMs)

    return () => clearInterval(timer)
  }, [currentStepIndex, isHovered, workflow, steps.length])

  // Handle manual step selection (Direct, no jumps)
  const handleStepClick = (index: number) => {
    setCurrentStepIndex(index)
    setProgress(0)
    setShowAllTechDetails(false)
  }

  // Handle workflow change (Localization vs Summarization)
  const handleWorkflowChange = (newWf: WorkflowType) => {
    setWorkflow(newWf)
    setCurrentStepIndex(0)
    setProgress(0)
    setShowAllTechDetails(false)
  }

  return (
    <section id="pipeline" className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
      {/* Section Heading */}
      <div className="text-center max-w-3xl mx-auto mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-950/60 text-[#714ffc] dark:text-[#a78bff] text-xs font-semibold mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[#714ffc] animate-pulse" />
          <span>{t('pipeline.badge')}</span>
        </div>
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-neutral-950 dark:text-white mb-3">
          {t('pipeline.title')}
        </h2>
        <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
          {t('pipeline.subtitle')}
        </p>
      </div>

      {/* Workflow Switcher (Localization 5 bước vs Summarization 3 bước) */}
      <div className="flex justify-center mb-6 sm:mb-8">
        <div className="inline-flex p-1.5 rounded-full bg-neutral-100/90 dark:bg-[#13151b] border border-neutral-200/80 dark:border-white/10 shadow-xs backdrop-blur-sm">
          <button
            type="button"
            onClick={() => handleWorkflowChange('localization')}
            className={`inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              workflow === 'localization'
                ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            <IconLanguage size={14} />
            <span>{t('pipeline.tabLocalization')}</span>
          </button>

          <button
            type="button"
            onClick={() => handleWorkflowChange('summarization')}
            className={`inline-flex items-center gap-2 px-4 sm:px-5 py-1.5 sm:py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              workflow === 'summarization'
                ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
            }`}
          >
            <IconScissors size={14} />
            <span>{t('pipeline.tabSummarization')}</span>
          </button>
        </div>
      </div>


      {/* 5 Sequential Category Tabs (1 -> 2 -> 3 -> 4 -> 5) */}
      <div
        ref={tabsContainerRef}
        className="flex items-center md:justify-center overflow-x-auto no-scrollbar scroll-smooth gap-2 sm:gap-2.5 mb-8 sm:mb-10 px-4 sm:px-0 py-1 -mx-4 sm:mx-0"
      >
        {steps.map((step, idx) => {
          const isActive = idx === currentStepIndex
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => handleStepClick(idx)}
              className={`relative shrink-0 inline-flex items-center gap-1.5 sm:gap-2 px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer overflow-hidden ${
                isActive
                  ? 'bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 shadow-md ring-1 ring-black/5 dark:ring-white/10 scale-[1.02] border border-transparent'
                  : 'bg-neutral-100/90 dark:bg-white/[0.06] border border-neutral-200/90 dark:border-white/10 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/90 dark:hover:bg-white/10 hover:text-neutral-950 dark:hover:text-white hover:border-neutral-300 dark:hover:border-white/20 shadow-xs backdrop-blur-xs'
              }`}
            >
              {/* Step Number Tag */}
              <span
                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md transition-colors ${
                  isActive
                    ? 'bg-violet-500/30 text-violet-200 dark:bg-violet-900/40 dark:text-violet-800 border border-violet-400/40'
                    : 'bg-white/90 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border border-neutral-200/70 dark:border-white/10 shadow-xs'
                }`}
              >
                {step.stageNum}
              </span>

              {/* Glowing Pulse Dot */}
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 dark:bg-violet-600 animate-pulse" />
              )}

              <span>{step.tabLabel}</span>

              {/* Smooth Progress Bar at bottom of the active pill */}
              {isActive && (
                <div className="absolute inset-x-0 bottom-0 h-[2.5px] bg-neutral-800 dark:bg-neutral-200 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 via-indigo-400 to-purple-400 transition-all duration-75 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* FLAGSHIP STAGE CARD (Ultra-Premium Liquid Glass & Interactive Simulation) */}
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="rounded-2xl sm:rounded-[32px] border border-neutral-200/90 dark:border-white/10 bg-[#f8f9fd] dark:bg-[#13151b] p-4 sm:p-8 lg:p-10 shadow-md dark:shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all mb-12"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
          {/* Left Column: Stage Explanation & Specs (Order 2 on mobile -> Visual First) */}
          <div className="order-2 lg:order-1 lg:col-span-5 space-y-4 sm:space-y-6">
            {/* Stage Tags */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {currentStep.tags.map((tag, i) => (
                <span
                  key={tag}
                  className={`px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold ${
                    i === 0
                      ? 'bg-violet-100 dark:bg-violet-950/60 text-[#714ffc] dark:text-[#a78bff]'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Stage Headline */}
            <h3 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight leading-snug">
              {currentStep.headline}
            </h3>

            {/* Technical Detail Paragraph */}
            <div className="space-y-1.5">
              <p
                className={`text-neutral-600 dark:text-neutral-300 text-xs sm:text-sm lg:text-base leading-relaxed ${
                  showAllTechDetails ? '' : 'line-clamp-2 sm:line-clamp-none'
                }`}
              >
                {currentStep.technicalDetails}
              </p>
              <button
                type="button"
                onClick={() => setShowAllTechDetails(!showAllTechDetails)}
                className="sm:hidden text-[11px] font-semibold text-[#714ffc] dark:text-[#a78bff] hover:underline cursor-pointer inline-flex items-center gap-1 pt-0.5"
              >
                <span>
                  {showAllTechDetails
                    ? (t('pipeline.collapseDetails', 'Thu gọn') || 'Thu gọn')
                    : (t('pipeline.expandDetails', 'Xem chi tiết thuật toán ▾') || 'Xem chi tiết thuật toán ▾')}
                </span>
                {showAllTechDetails ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
              </button>
            </div>

            {/* Specs Metric Cards */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-4 pt-2 border-t border-neutral-200/70 dark:border-white/10">
              <div className="p-3 sm:p-3.5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#1a1d26] border border-neutral-200/60 dark:border-white/[0.08] shadow-xs">
                <div className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 mb-0.5 sm:mb-1">
                  {currentStep.metricPrimaryLabel}
                </div>
                <div className="text-sm sm:text-base lg:text-lg font-bold text-neutral-900 dark:text-white tracking-tight">
                  {currentStep.metricPrimary}
                </div>
              </div>

              <div className="p-3 sm:p-3.5 rounded-xl sm:rounded-2xl bg-white dark:bg-[#1a1d26] border border-neutral-200/60 dark:border-white/[0.08] shadow-xs">
                <div className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400 mb-0.5 sm:mb-1">
                  {currentStep.metricSecondaryLabel}
                </div>
                <div className="text-sm sm:text-base lg:text-lg font-bold text-neutral-900 dark:text-white tracking-tight">
                  {currentStep.metricSecondary}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 pt-2">
              <Link
                to={authTarget}
                className="inline-flex items-center justify-center px-6 py-2.5 rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 font-semibold text-xs sm:text-sm hover:opacity-90 transition-opacity shadow-sm cursor-pointer w-full sm:w-auto text-center"
              >
                {t('pipeline.ctaStudio')}
              </Link>
              <a
                href="#pipeline"
                className="hidden sm:inline-flex items-center justify-center px-6 py-2.5 rounded-full border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 font-semibold text-xs sm:text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                {t('pipeline.ctaDocs')}
              </a>
            </div>

            {/* Navigation hint */}
            <div className="hidden sm:flex items-center gap-2 text-xs text-neutral-400 pt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>
                {t('pipeline.runningStatus', { current: currentStepIndex + 1, total: steps.length })}
              </span>
            </div>
          </div>

          {/* Right Column: Interactive Animated Stage Simulation (Order 1 on mobile -> Visual First) */}
          <div className="order-1 lg:order-2 lg:col-span-7 bg-[#09090a] dark:bg-[#0a0c12] rounded-2xl border border-white/10 ring-1 ring-white/5 p-4 sm:p-6 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.08)] text-white min-h-[340px] sm:min-h-[420px] flex flex-col justify-between relative overflow-hidden">
            {/* Ambient subtle glow inside simulation */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-72 h-72 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

            {/* Clean Simulation Header */}
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/[0.08] text-xs select-none">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold text-neutral-200">{currentStep.headline}</span>
              </div>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-neutral-400 font-mono">
                {t('pipeline.interactivePreview')}
              </span>
            </div>

            {/* RENDER DYNAMIC ANIMATION VIEW BASED ON ACTIVE STEP */}
            {workflow === 'localization' && currentStepIndex === 0 && (
              <AnimationStep1Separation
                activeTrack={activeAudioTrack}
                setActiveTrack={setActiveAudioTrack}
              />
            )}

            {workflow === 'localization' && currentStepIndex === 1 && (
              <AnimationStep2STT isPlaying={isPlayingDemo} setIsPlaying={setIsPlayingDemo} />
            )}

            {workflow === 'localization' && currentStepIndex === 2 && (
              <AnimationStep3Translation />
            )}

            {workflow === 'localization' && currentStepIndex === 3 && (
              <AnimationStep4Dubbing
                activeVoice={activeVoice}
                setActiveVoice={setActiveVoice}
              />
            )}

            {workflow === 'localization' && currentStepIndex === 4 && (
              <AnimationStep5QA
                subtitleMode={subtitleMode}
                setSubtitleMode={setSubtitleMode}
              />
            )}

            {/* SUMMARIZATION WORKFLOW VIEWS */}
            {workflow === 'summarization' && currentStepIndex === 0 && <AnimationSumStep1 />}
            {workflow === 'summarization' && currentStepIndex === 1 && <AnimationSumStep2 />}
            {workflow === 'summarization' && currentStepIndex === 2 && <AnimationSumStep3 />}
          </div>
        </div>
      </div>

      {/* 3 COMPACT TRANSFLOW PLATFORM PILLARS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-6 pt-2 sm:pt-4">
        {/* Card 1: Batch Processing Engine */}
        <div className="rounded-2xl border border-neutral-200/80 dark:border-white/10 bg-[#fbfbfe] dark:bg-[#13151b] p-4 sm:p-6 shadow-sm dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] hover:shadow-md dark:hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="space-y-2.5 sm:space-y-4">
            <div className="flex items-center gap-1.5">
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                Batch API
              </span>
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                100+ Streams
              </span>
            </div>

            <h4 className="text-base sm:text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
              <IconLayersLinked size={18} className="text-purple-500 shrink-0" />
              <span>{t('pipeline.pillarBatchTitle')}</span>
            </h4>

            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2 sm:line-clamp-none">
              {t('pipeline.pillarBatchDesc')}
            </p>
          </div>

          <div className="pt-3 sm:pt-6 border-t border-neutral-200/70 dark:border-white/10 space-y-1.5 sm:space-y-3 mt-3 sm:mt-4">
            <div className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400">
              {t('pipeline.pillarBatchCapacityLabel')}{' '}
              <strong className="text-neutral-900 dark:text-white">
                {t('pipeline.pillarBatchCapacityValue')}
              </strong>
            </div>
            <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-neutral-900 dark:text-white">
              <span>{t('pipeline.pillarBatchDuration')}</span>
              <span>{t('pipeline.pillarBatchRetry')}</span>
            </div>
          </div>
        </div>

        {/* Card 2: pgvector Translation Memory & Glossary */}
        <div className="rounded-2xl border border-neutral-200/80 dark:border-white/10 bg-[#fbfbfe] dark:bg-[#13151b] p-4 sm:p-6 shadow-sm dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] hover:shadow-md dark:hover:border-white/20 transition-all flex flex-col justify-between">
          <div className="space-y-2.5 sm:space-y-4">
            <div className="flex items-center gap-1.5">
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                pgvector TM
              </span>
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300">
                Glossary Shield
              </span>
            </div>

            <h4 className="text-base sm:text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
              <IconDatabase size={18} className="text-emerald-500 shrink-0" />
              <span>{t('pipeline.pillarTmTitle')}</span>
            </h4>

            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2 sm:line-clamp-none">
              {t('pipeline.pillarTmDesc')}
            </p>
          </div>

          <div className="pt-3 sm:pt-6 border-t border-neutral-200/70 dark:border-white/10 space-y-1.5 sm:space-y-3 mt-3 sm:mt-4">
            <div className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400">
              {t('pipeline.pillarTmSavingsLabel')}{' '}
              <strong className="text-neutral-900 dark:text-white">
                {t('pipeline.pillarTmSavingsValue')}
              </strong>
            </div>
            <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-neutral-900 dark:text-white">
              <span>{t('pipeline.pillarTmSimilarity')}</span>
              <span>{t('pipeline.pillarTmTermLock')}</span>
            </div>
          </div>
        </div>

        {/* Card 3: Enterprise Security & Data Privacy */}
        <div
          id="privacy"
          className="rounded-2xl border border-neutral-200/80 dark:border-white/10 bg-[#fbfbfe] dark:bg-[#13151b] p-4 sm:p-6 shadow-sm dark:shadow-[0_8px_30px_rgba(0,0,0,0.5)] hover:shadow-md dark:hover:border-white/20 transition-all flex flex-col justify-between scroll-mt-24"
        >
          <div className="space-y-2.5 sm:space-y-4">
            <div className="flex items-center gap-1.5">
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                Enterprise Security
              </span>
              <span className="px-2 sm:px-2.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                Zero Retention
              </span>
            </div>

            <h4 className="text-base sm:text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
              <IconShieldCheck size={18} className="text-blue-500 shrink-0" />
              <span>{t('pipeline.pillarSecurityTitle')}</span>
            </h4>

            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2 sm:line-clamp-none">
              {t('pipeline.pillarSecurityDesc')}
            </p>
          </div>

          <div className="pt-3 sm:pt-6 border-t border-neutral-200/70 dark:border-white/10 space-y-1.5 sm:space-y-3 mt-3 sm:mt-4">
            <div className="text-[10px] sm:text-[11px] text-neutral-500 dark:text-neutral-400">
              {t('pipeline.pillarSecurityEncryptionLabel')}{' '}
              <strong className="text-neutral-900 dark:text-white">
                {t('pipeline.pillarSecurityEncryptionValue')}
              </strong>
            </div>
            <div className="flex items-center justify-between text-[11px] sm:text-xs font-bold text-neutral-900 dark:text-white">
              <span>{t('pipeline.pillarSecurityRetention')}</span>
              <span>{t('pipeline.pillarSecurityTraining')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom CTA Button */}
      <div className="flex justify-center pt-10">
        <Link
          to={authTarget}
          className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-sm font-semibold hover:opacity-90 transition-all cursor-pointer shadow-md"
        >
          <span>{t('pipeline.bottomCta')}</span>
          <IconArrowRight size={16} />
        </Link>
      </div>
    </section>
  )
}

// --------------------------------------------------------------------------
// ANIMATION COMPONENTS FOR EACH LOCALIZATION STEP
// --------------------------------------------------------------------------

/** BƯỚC 1: TÁCH ÂM THANH (SOURCE SEPARATION) */
function AnimationStep1Separation({
  activeTrack,
  setActiveTrack
}: {
  activeTrack: 'both' | 'vocal' | 'bgm'
  setActiveTrack: (t: 'both' | 'vocal' | 'bgm') => void
}) {
  const { t } = useTranslation('landing')
  const isVocalActive = activeTrack === 'vocal' || activeTrack === 'both'
  const isBgmActive = activeTrack === 'bgm' || activeTrack === 'both'

  // Natural organic heights resembling speech formants and audio dynamics
  const vocalHeights = [
    25, 45, 70, 88, 62, 40, 75, 95, 100, 82, 60, 42, 68, 90, 85, 55,
    38, 72, 94, 98, 76, 50, 65, 88, 92, 70, 48, 78, 85, 60, 40, 22
  ]

  // Ambient smooth heights for background music and acoustics
  const bgmHeights = [
    30, 42, 50, 45, 60, 55, 40, 48, 65, 58, 46, 52, 60, 50, 42, 48,
    58, 62, 54, 44, 50, 64, 58, 46, 52, 60, 55, 42, 48, 56, 44, 32
  ]

  return (
    <div className="space-y-3.5">
      {/* Top Header with Model Info & Stream Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3 text-xs">
        <div className="flex items-center gap-2 text-neutral-200">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-violet-300">
            <IconWaveSine size={15} />
          </div>
          <span className="font-bold tracking-tight">{t('pipeline.sim.extract.title')}</span>
        </div>

        {/* Interactive Filter Pills */}
        <div className="inline-flex p-0.5 rounded-lg bg-white/5 border border-white/10 text-[11px] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTrack('both')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              activeTrack === 'both'
                ? 'bg-purple-600 text-white font-semibold shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t('pipeline.sim.extract.all')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTrack('vocal')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              activeTrack === 'vocal'
                ? 'bg-purple-600 text-white font-semibold shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t('pipeline.sim.extract.vocalOnly')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTrack('bgm')}
            className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
              activeTrack === 'bgm'
                ? 'bg-purple-600 text-white font-semibold shadow-md'
                : 'text-neutral-400 hover:text-white'
            }`}
          >
            {t('pipeline.sim.extract.bgmOnly')}
          </button>
        </div>
      </div>

      {/* Track 1: Vocal Stream (Giọng nói gốc) */}
      <div
        onClick={() => setActiveTrack(activeTrack === 'vocal' ? 'both' : 'vocal')}
        className={`p-3.5 rounded-xl border transition-all duration-300 cursor-pointer relative overflow-hidden ${
          isVocalActive
            ? 'bg-gradient-to-r from-purple-950/40 via-violet-950/20 to-black/50 border-purple-500/50 shadow-[0_0_20px_rgba(168,85,247,0.12)]'
            : 'bg-white/[0.02] border-white/10 opacity-40 hover:opacity-60'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-5 h-5 rounded-md flex items-center justify-center ${
                isVocalActive ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-neutral-400'
              }`}
            >
              <IconMicrophone size={13} />
            </div>
            <div>
              <span className="text-xs font-bold text-purple-200">{t('pipeline.sim.extract.vocalTrack')}</span>
              <span className="hidden sm:inline-block ml-2 text-[10px] text-neutral-400">
                {t('pipeline.sim.extract.vocalClean')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isVocalActive ? (
              <span className="text-[10px] text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                {t('pipeline.sim.extract.vocalClarity')}
              </span>
            ) : (
              <span className="text-[10px] text-neutral-400 bg-white/5 px-2 py-0.5 rounded font-mono">
                {t('pipeline.sim.extract.muted')}
              </span>
            )}
          </div>
        </div>

        {/* Natural Waveform Equalizer Canvas */}
        <div className="relative h-12 px-3 bg-black/50 rounded-lg border border-white/5 flex items-center gap-1 sm:gap-1.5 overflow-hidden">
          {isVocalActive ? (
            <>
              {/* Laser Sweep Playhead */}
              <div
                className="absolute inset-y-0 w-[2px] bg-gradient-to-b from-purple-400 via-pink-400 to-purple-400 shadow-[0_0_8px_#ec4899] z-10 pointer-events-none"
                style={{ animation: 'laserSweepScan 2.6s ease-in-out infinite' }}
              />
              {vocalHeights.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-violet-600 via-purple-500 to-pink-400 rounded-full transition-all origin-bottom"
                  style={{
                    height: `${h}%`,
                    animation: `eqBarPulse ${0.9 + (i % 5) * 0.2}s ease-in-out infinite alternate`,
                    animationDelay: `${(i % 8) * 0.08}s`
                  }}
                />
              ))}
            </>
          ) : (
            <div className="w-full flex items-center justify-center">
              <div className="w-full h-[2px] bg-white/10 rounded" />
            </div>
          )}
        </div>
      </div>

      {/* Track 2: Background Music & SFX (Nhạc nền & Hiệu ứng) */}
      <div
        onClick={() => setActiveTrack(activeTrack === 'bgm' ? 'both' : 'bgm')}
        className={`p-3.5 rounded-xl border transition-all duration-300 cursor-pointer relative overflow-hidden ${
          isBgmActive
            ? 'bg-gradient-to-r from-blue-950/40 via-cyan-950/20 to-black/50 border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.12)]'
            : 'bg-white/[0.02] border-white/10 opacity-40 hover:opacity-60'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div
              className={`w-5 h-5 rounded-md flex items-center justify-center ${
                isBgmActive ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-neutral-400'
              }`}
            >
              <IconMusic size={13} />
            </div>
            <div>
              <span className="text-xs font-bold text-blue-200">
                {t('pipeline.sim.extract.bgmTrack')}
              </span>
              <span className="hidden sm:inline-block ml-2 text-[10px] text-neutral-400">
                {t('pipeline.sim.extract.bgmClean')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isBgmActive ? (
              <span className="text-[10px] text-cyan-300 bg-cyan-500/20 border border-cyan-500/30 px-2 py-0.5 rounded font-mono">
                {t('pipeline.sim.extract.bgmClarity')}
              </span>
            ) : (
              <span className="text-[10px] text-neutral-400 bg-white/5 px-2 py-0.5 rounded font-mono">
                {t('pipeline.sim.extract.muted')}
              </span>
            )}
          </div>
        </div>

        {/* Natural Waveform Equalizer Canvas */}
        <div className="relative h-12 px-3 bg-black/50 rounded-lg border border-white/5 flex items-center gap-1 sm:gap-1.5 overflow-hidden">
          {isBgmActive ? (
            <>
              {/* Laser Sweep Playhead */}
              <div
                className="absolute inset-y-0 w-[2px] bg-gradient-to-b from-cyan-400 via-sky-300 to-teal-400 shadow-[0_0_8px_#38bdf8] z-10 pointer-events-none"
                style={{ animation: 'laserSweepScan 2.6s ease-in-out infinite' }}
              />
              {bgmHeights.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-blue-600 via-cyan-400 to-teal-300 rounded-full transition-all origin-bottom"
                  style={{
                    height: `${h}%`,
                    animation: `eqBarSmooth ${1.2 + (i % 4) * 0.25}s ease-in-out infinite alternate`,
                    animationDelay: `${(i % 7) * 0.1}s`
                  }}
                />
              ))}
            </>
          ) : (
            <div className="w-full flex items-center justify-center">
              <div className="w-full h-[2px] bg-white/10 rounded" />
            </div>
          )}
        </div>
      </div>

      {/* Timeline & Acoustics Preservation Footer (Desktop only) */}
      <div className="hidden sm:flex flex-wrap items-center justify-between text-[11px] text-neutral-400 pt-1 gap-2 border-t border-white/10">
        <div className="flex items-center gap-2">
          <IconClock size={13} className="text-violet-400" />
          <span className="font-mono">00:01.84 / 04:32.18</span>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
          <IconCheck size={13} />
          <span>{t('pipeline.sim.extract.timbrePreserved')}</span>
        </div>
      </div>
    </div>
  )
}

/** BƯỚC 2: NHẬN DIỆN GIỌNG NÓI (SPEECH TO TEXT) */
function AnimationStep2STT({
  isPlaying,
  setIsPlaying
}: {
  isPlaying: boolean
  setIsPlaying: (p: boolean) => void
}) {
  const { t } = useTranslation('landing')
  return (
    <div className="space-y-3.5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-semibold text-neutral-200">{t('pipeline.sim.stt.title')}</span>
        </div>
        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono">
          {t('pipeline.sim.stt.detectedLang')}
        </span>
      </div>

      {/* Dynamic Mini Waveform Scanner (Desktop only) */}
      <div className="hidden sm:flex relative h-7 px-2 bg-black/50 rounded-lg border border-white/10 items-center gap-1 overflow-hidden">
        <div
          className="absolute inset-y-0 w-1 bg-purple-400 shadow-[0_0_8px_#c084fc] pointer-events-none"
          style={{ animation: 'laserSweepScan 2s ease-in-out infinite' }}
        />
        {[30, 60, 85, 45, 75, 90, 40, 70, 95, 50, 80, 100, 65, 40, 75, 90, 60, 40, 80, 55, 90, 70, 45, 80, 60].map(
          (h, i) => (
            <div
              key={i}
              className="flex-1 bg-purple-500/60 rounded-full origin-bottom"
              style={{
                height: `${h}%`,
                animation: isPlaying ? `eqBarPulse 0.8s ease-in-out infinite alternate` : undefined,
                animationDelay: `${i * 0.05}s`
              }}
            />
          )
        )}
      </div>

      {/* Subtitle Teleprompter Timeline with Word-Level Karaoke Alignment */}
      <div className="space-y-2 py-0.5">
        {/* Previous Segment (Desktop only) */}
        <div className="hidden sm:flex p-2.5 rounded-lg bg-white/5 border border-white/5 text-xs text-neutral-400 items-center justify-between">
          <span className="font-mono text-[11px] text-neutral-500">[00:00.00]</span>
          <span className="text-neutral-300">"Welcome to TransFlow Media Studio."</span>
          <span className="text-[10px] text-emerald-400 font-mono">99.8%</span>
        </div>

        {/* Active Highlighted Segment with Word-by-Word Karaoke Chips */}
        <div className="p-3 sm:p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/50 shadow-md text-xs space-y-2 relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] text-purple-300">
            <span className="font-mono font-bold flex items-center gap-1.5">
              <IconActivity size={13} className="text-purple-400" />
              [00:01.20 - 00:04.50]
            </span>
            <span className="px-2 py-0.5 rounded bg-purple-500/30 text-purple-200 text-[10px] border border-purple-400/40">
              {t('pipeline.sim.stt.wordAlignment')}
            </span>
          </div>

          {/* Karaoke Word Sequence */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm font-sans pt-0.5">
            <span className="px-2 py-0.5 rounded bg-purple-500/30 text-purple-200 border border-purple-400/50 font-bold animate-karaoke-word">
              "Next-generation
            </span>
            <span
              className="px-2 py-0.5 rounded bg-pink-500/30 text-pink-200 border border-pink-400/50 font-bold animate-karaoke-word"
              style={{ animationDelay: '0.4s' }}
            >
              video
            </span>
            <span
              className="px-2 py-0.5 rounded bg-purple-500/30 text-purple-200 border border-purple-400/50 font-bold animate-karaoke-word"
              style={{ animationDelay: '0.8s' }}
            >
              translation
            </span>
            <span className="px-1 text-white/90">powered</span>
            <span className="px-1 text-white/90">by</span>
            <span className="px-1 text-white/90">AI."</span>
            <span className="inline-block w-1.5 h-4 bg-purple-400 ml-1 animate-pulse align-middle" />
          </div>
        </div>

        {/* Upcoming Segment (Desktop only) */}
        <div className="hidden sm:flex p-2.5 rounded-lg bg-white/5 border border-white/5 text-xs text-neutral-500 items-center justify-between">
          <span className="font-mono text-[11px] text-neutral-600">[00:04.60]</span>
          <span>"Preserving background acoustics with frame accuracy..."</span>
          <span className="text-[10px] text-neutral-400 font-mono">{t('pipeline.sim.stt.pending')}</span>
        </div>
      </div>

      {/* Control Bar */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/40 transition-colors text-white cursor-pointer shadow-sm"
        >
          {isPlaying ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
          <span>{isPlaying ? t('pipeline.sim.stt.pause') : t('pipeline.sim.stt.play')}</span>
        </button>
        <span className="text-neutral-400 font-mono text-[11px]">{t('pipeline.sim.stt.syncDelta')}</span>
      </div>
    </div>
  )
}

/** BƯỚC 3: DỊCH THUẬT NGỮ CẢNH & TRANSLATION MEMORY (TM) */
function AnimationStep3Translation() {
  const { t } = useTranslation('landing')
  const [isGlossaryLocked, setIsGlossaryLocked] = useState(true)

  return (
    <div className="space-y-3.5">
      {/* Header with Live TM Confidence Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-violet-300">
            <IconLanguage size={15} />
          </div>
          <span className="font-bold text-neutral-200">
            {t('pipeline.sim.trans.title')}
          </span>
        </div>

        {/* Live TM Match Pill with Pulsing Glow */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div
            className={`px-2.5 py-1 rounded-full border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all duration-300 ${
              isGlossaryLocked
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 animate-tm-glow'
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isGlossaryLocked ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span>
              {t('pipeline.sim.trans.tmMatch', { rate: isGlossaryLocked ? '94.8%' : '52.0%' })}
            </span>
          </div>

          {/* Interactive Toggle Pill */}
          <button
            type="button"
            onClick={() => setIsGlossaryLocked(!isGlossaryLocked)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-all cursor-pointer ${
              isGlossaryLocked
                ? 'bg-purple-600/30 border-purple-500/50 text-purple-200 hover:bg-purple-600/50 shadow-sm'
                : 'bg-white/5 border-white/15 text-neutral-400 hover:text-white'
            }`}
            title={t('pipeline.sim.trans.toggleTitle')}
          >
            {isGlossaryLocked ? (
              <>
                <IconLock size={12} className="text-purple-300" />
                <span>{t('pipeline.sim.trans.tmLocked')}</span>
              </>
            ) : (
              <>
                <IconLockOpen size={12} className="text-neutral-400" />
                <span>{t('pipeline.sim.trans.tmFree')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Thẻ khoá thuật ngữ chuyên ngành (Glossary Shield Vault - Desktop only) */}
      <div className="hidden sm:block p-3 sm:p-3.5 rounded-xl bg-gradient-to-r from-amber-950/40 via-purple-950/30 to-black/60 border border-amber-500/35 text-xs relative overflow-hidden shadow-lg animate-shield-aura">
        {/* Animated Laser Synapse Beam along top border */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-amber-400/90 to-transparent animate-synapse-beam" />

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-[10px] font-bold flex items-center gap-1.5 tracking-wider uppercase">
              <IconLock size={12} className="text-amber-400 animate-lock-pulse" />
              {t('pipeline.sim.trans.shieldTitle')}
            </span>
          </div>

          {isGlossaryLocked ? (
            <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-400 font-mono text-[10px] font-bold flex items-center gap-1">
              <IconCheck size={11} />
              {t('pipeline.sim.trans.accurate100')}
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-400 font-mono text-[10px] font-bold flex items-center gap-1">
              <IconAlertTriangle size={11} />
              {t('pipeline.sim.trans.unprotected')}
            </span>
          )}
        </div>

        {/* Dynamic Terminology Bridge: EN ➔ VI */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2 pt-1">
          {/* Source EN Term */}
          <div className="p-2.5 rounded-lg bg-black/40 border border-white/10 hover:border-amber-500/40 transition-colors">
            <div className="text-[9px] font-mono text-neutral-400 uppercase tracking-wider mb-0.5 flex items-center justify-between">
              <span>{t('pipeline.sim.trans.srcTermLabel', 'EN (Source Term)')}</span>
              <span className="text-neutral-500">{t('pipeline.sim.trans.srcTermSub')}</span>
            </div>
            <div className="text-amber-200 font-mono font-semibold text-[11px] sm:text-[12px] truncate">
              "high-concurrency batch processing"
            </div>
          </div>

          {/* Animated Connecting Node */}
          <div className="flex sm:flex-col items-center justify-center py-0.5 sm:py-0">
            <div className="w-6 h-6 rounded-full bg-purple-500/25 border border-purple-400/50 flex items-center justify-center text-purple-300 shadow-sm animate-pulse">
              <IconArrowRight size={13} className="rotate-90 sm:rotate-0" />
            </div>
          </div>

          {/* Target VI Term */}
          <div
            className={`p-2.5 rounded-lg border transition-all duration-300 ${
              isGlossaryLocked
                ? 'bg-purple-950/50 border-purple-500/40 shadow-inner'
                : 'bg-amber-950/30 border-amber-500/30'
            }`}
          >
            <div className="text-[9px] font-mono uppercase tracking-wider mb-0.5 flex items-center justify-between">
              <span className={isGlossaryLocked ? 'text-purple-300' : 'text-amber-300'}>
                {isGlossaryLocked ? t('pipeline.sim.trans.targetLockedLabel') : t('pipeline.sim.trans.targetRawLabel')}
              </span>
              <span className="text-[9px] font-mono text-neutral-500">
                {isGlossaryLocked ? t('pipeline.sim.trans.exactMatch') : t('pipeline.sim.trans.warnMt')}
              </span>
            </div>
            <div
              className={`font-mono font-semibold text-[11px] sm:text-[12px] truncate ${
                isGlossaryLocked ? 'text-white' : 'text-neutral-300 line-through opacity-75'
              }`}
            >
              {isGlossaryLocked
                ? t('pipeline.sim.trans.lockedVI')
                : t('pipeline.sim.trans.rawVI')}
            </div>
          </div>
        </div>
      </div>

      {/* Đối sánh Bản gốc vs Bản dịch (Bilingual Split Comparison) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
        {/* Câu gốc */}
        <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all space-y-2">
          <div className="text-[10px] text-neutral-400 font-bold uppercase tracking-wider flex items-center justify-between border-b border-white/5 pb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>{t('pipeline.sim.trans.srcSentenceLabel')}</span>
            </div>
            <span className="font-mono text-neutral-400 text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
              EN-US
            </span>
          </div>
          <div className="text-neutral-300 font-sans leading-relaxed text-[12px]">
            "We integrated{' '}
            <span className="text-amber-200 font-semibold bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-400/40 inline-flex items-center gap-1 animate-term-highlight">
              <IconLock size={10} className="text-amber-300 inline" />
              high-concurrency batch processing
            </span>{' '}
            directly into our cloud workflow."
          </div>
        </div>

        {/* Bản dịch */}
        <div className="p-3 rounded-xl bg-gradient-to-br from-purple-950/40 via-violet-950/30 to-black/50 border border-purple-500/40 space-y-2 shadow-[0_0_20px_rgba(168,85,247,0.12)] relative overflow-hidden transition-all">
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-purple-400/70 to-transparent animate-laser-scan" />
          <div className="text-[10px] text-purple-300 font-bold uppercase tracking-wider flex items-center justify-between border-b border-white/5 pb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span>{t('pipeline.sim.trans.tgtSentenceLabel')}</span>
            </div>
            <span className="font-mono text-purple-300 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-400/30">
              VI-VN
            </span>
          </div>
          <div className="text-white font-sans font-medium leading-relaxed text-[12px]">
            {isGlossaryLocked ? (
              <>
                "{t('pipeline.sim.trans.translatedLockedPrefix')}
                <span className="text-purple-200 font-bold bg-purple-500/30 px-1.5 py-0.5 rounded border border-purple-400/60 inline-flex items-center gap-1 animate-shimmer animate-term-highlight shadow-sm">
                  <IconCheck size={11} className="text-emerald-400 inline" />
                  {t('pipeline.sim.trans.translatedLockedHighlight')}
                </span>
                {t('pipeline.sim.trans.translatedLockedSuffix')}"
              </>
            ) : (
              <>
                "{t('pipeline.sim.trans.translatedLockedPrefix')}
                <span className="text-amber-300 font-medium bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-400/40 line-through">
                  {t('pipeline.sim.trans.translatedRawHighlight')}
                </span>
                {t('pipeline.sim.trans.translatedLockedSuffix')}"
              </>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}

/** BƯỚC 4: LỒNG TIẾNG AI (SMART TTS DUBBING) */
function AnimationStep4Dubbing({
  activeVoice,
  setActiveVoice
}: {
  activeVoice: 'ban_mai' | 'minh_quang'
  setActiveVoice: (v: 'ban_mai' | 'minh_quang') => void
}) {
  const { t } = useTranslation('landing')
  const [isPlayingSample, setIsPlayingSample] = useState(true)

  // Voice acoustic profiles: Ban Mai (Mezzo-Soprano/Bright) vs Minh Quang (Baritone/Deep)
  const banMaiFormants = [35, 60, 85, 95, 75, 45, 80, 92, 70, 52, 88, 76, 55, 40, 68, 30]
  const minhQuangFormants = [75, 95, 90, 72, 60, 50, 45, 55, 65, 82, 70, 50, 42, 35, 28, 20]

  return (
    <div className="space-y-3.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-violet-300">
            <IconVolume size={15} />
          </div>
          <span className="font-bold text-neutral-200">{t('pipeline.sim.dub.title')}</span>
        </div>
        <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono font-bold self-start sm:self-auto flex items-center gap-1.5 animate-tm-glow">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t('pipeline.sim.dub.pacingStatus')}
        </span>
      </div>

      {/* Voice Talent Selection */}
      <div className="space-y-2">
        <div className="text-[11px] text-neutral-400 font-medium">
          {t('pipeline.sim.dub.selectActor')}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {/* Voice 1: Ban Mai */}
          <button
            type="button"
            onClick={() => setActiveVoice('ban_mai')}
            className={`p-3 sm:p-3.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden ${
              activeVoice === 'ban_mai'
                ? 'bg-gradient-to-br from-purple-950/70 via-violet-950/40 to-black/60 border-purple-400/80 shadow-[0_0_20px_rgba(168,85,247,0.2)] text-white ring-1 ring-purple-400/40'
                : 'bg-white/[0.02] border-white/10 text-neutral-400 hover:bg-white/[0.06] hover:border-white/20'
            }`}
          >
            {activeVoice === 'ban_mai' && (
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-purple-400/80 to-transparent animate-laser-scan" />
            )}

            <div className="font-bold flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    activeVoice === 'ban_mai'
                      ? 'bg-gradient-to-tr from-purple-600 to-pink-500 text-white shadow-[0_0_12px_rgba(168,85,247,0.6)]'
                      : 'bg-white/10 text-neutral-400'
                  }`}
                >
                  <IconHeadphones size={15} />
                </div>
                <div>
                  <div className="text-sm font-bold text-white leading-none">{t('pipeline.sim.dub.banMaiName')}</div>
                  <div className="text-[10px] text-purple-300 font-mono mt-0.5">{t('pipeline.sim.dub.banMaiAccent')}</div>
                </div>
              </div>
              {activeVoice === 'ban_mai' && (
                <span className="w-5 h-5 rounded-full bg-purple-500 text-white shadow-sm flex items-center justify-center">
                  <IconCheck size={12} />
                </span>
              )}
            </div>

            <div className="text-[11px] text-neutral-300 leading-snug">
              {t('pipeline.sim.dub.banMaiDesc')}
            </div>

            {/* Live Audio Frequency Spectrogram */}
            {activeVoice === 'ban_mai' && (
              <div className="flex items-end gap-1 h-4 mt-2.5 px-2 py-0.5 bg-black/50 rounded-lg border border-purple-500/30">
                {banMaiFormants.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-purple-500 to-pink-400 rounded-full"
                    style={{
                      height: `${isPlayingSample ? h : 25}%`,
                      transformOrigin: 'bottom',
                      animation: isPlayingSample ? 'eqBarPulse 1.2s ease-in-out infinite alternate' : 'none',
                      animationDelay: `${(i % 6) * 0.12}s`
                    }}
                  />
                ))}
              </div>
            )}
          </button>

          {/* Voice 2: Minh Quang */}
          <button
            type="button"
            onClick={() => setActiveVoice('minh_quang')}
            className={`p-3 sm:p-3.5 rounded-xl border text-left transition-all cursor-pointer relative overflow-hidden ${
              activeVoice === 'minh_quang'
                ? 'bg-gradient-to-br from-purple-950/70 via-violet-950/40 to-black/60 border-purple-400/80 shadow-[0_0_20px_rgba(168,85,247,0.2)] text-white ring-1 ring-purple-400/40'
                : 'bg-white/[0.02] border-white/10 text-neutral-400 hover:bg-white/[0.06] hover:border-white/20'
            }`}
          >
            {activeVoice === 'minh_quang' && (
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-purple-400/80 to-transparent animate-laser-scan" />
            )}

            <div className="font-bold flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    activeVoice === 'minh_quang'
                      ? 'bg-gradient-to-tr from-purple-600 to-indigo-500 text-white shadow-[0_0_12px_rgba(168,85,247,0.6)]'
                      : 'bg-white/10 text-neutral-400'
                  }`}
                >
                  <IconHeadphones size={15} />
                </div>
                <div>
                  <div className="text-sm font-bold text-white leading-none">{t('pipeline.sim.dub.minhQuangName')}</div>
                  <div className="text-[10px] text-purple-300 font-mono mt-0.5">{t('pipeline.sim.dub.minhQuangAccent')}</div>
                </div>
              </div>
              {activeVoice === 'minh_quang' && (
                <span className="w-5 h-5 rounded-full bg-purple-500 text-white shadow-sm flex items-center justify-center">
                  <IconCheck size={12} />
                </span>
              )}
            </div>

            <div className="text-[11px] text-neutral-300 leading-snug">
              {t('pipeline.sim.dub.minhQuangDesc')}
            </div>

            {/* Live Audio Frequency Spectrogram */}
            {activeVoice === 'minh_quang' && (
              <div className="flex items-end gap-1 h-4 mt-2.5 px-2 py-0.5 bg-black/50 rounded-lg border border-purple-500/30">
                {minhQuangFormants.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-purple-500 to-indigo-400 rounded-full"
                    style={{
                      height: `${isPlayingSample ? h : 25}%`,
                      transformOrigin: 'bottom',
                      animation: isPlayingSample ? 'eqBarPulse 1.2s ease-in-out infinite alternate' : 'none',
                      animationDelay: `${(i % 6) * 0.12}s`
                    }}
                  />
                ))}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Rubberband Lip-Sync Stretch & Smart Auto-Ducking Deck (Desktop only) */}
      <div className="hidden sm:block p-3.5 rounded-xl bg-black/50 border border-white/10 space-y-3 text-xs shadow-inner">
        {/* Khớp khẩu hình video */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-300 font-semibold flex items-center gap-1.5">
              <IconClock size={13} className="text-purple-400" />
              {t('pipeline.sim.dub.videoPaceLabel')}
            </span>
            <span className="text-emerald-400 font-mono font-bold">{t('pipeline.sim.dub.videoPaceValue')}</span>
          </div>

          {/* Dual-Track Visual Timeline with playhead */}
          <div className="w-full bg-neutral-900 h-2.5 rounded-full overflow-hidden relative border border-white/5">
            <div className="bg-gradient-to-r from-emerald-500 via-purple-500 to-pink-500 h-full w-[53%]" />
            <div className="absolute top-0 bottom-0 left-[53%] w-1.5 bg-white rounded-full shadow-[0_0_8px_#fff]" />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-laser-scan" />
          </div>
        </div>

        {/* Tự động né nhạc nền */}
        <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[11px]">
          <div className="flex items-center gap-1.5 text-neutral-300">
            <IconVolume2 size={13} className="text-purple-400" />
            <span>{t('pipeline.sim.dub.duckingLabel')}</span>
          </div>
          <span className="text-purple-300 font-mono font-bold bg-purple-500/20 border border-purple-500/30 px-2.5 py-0.5 rounded-full text-[10px] animate-pulse">
            {t('pipeline.sim.dub.duckingValue')}
          </span>
        </div>
      </div>

      {/* Footer: Giọng đọc mẫu */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <button
          type="button"
          onClick={() => setIsPlayingSample(!isPlayingSample)}
          className="inline-flex items-center gap-2 text-purple-300 hover:text-white transition-colors cursor-pointer group"
        >
          <div className="w-5 h-5 rounded-full bg-purple-500/20 group-hover:bg-purple-500/40 border border-purple-400/40 flex items-center justify-center text-purple-300 transition-all shadow-sm">
            {isPlayingSample ? <IconPlayerPause size={12} /> : <IconPlayerPlay size={12} />}
          </div>
          <span className="font-medium">{t('pipeline.sim.dub.sampleReady')}</span>
        </button>

        {/* Live Acoustic Bars Indicator */}
        <div className="flex items-center gap-1">
          {[40, 75, 95, 60, 85].map((val, idx) => (
            <div
              key={idx}
              className="w-1 bg-purple-400 rounded-full"
              style={{
                height: `${isPlayingSample ? val / 6 : 3}px`,
                animation: isPlayingSample ? 'eqBarPulse 0.9s ease-in-out infinite alternate' : 'none',
                animationDelay: `${idx * 0.15}s`
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** BƯỚC 5: KIỂM ĐỊNH QA & XUẤT VIDEO (3-WAY QA & RENDER) */
function AnimationStep5QA({
  subtitleMode,
  setSubtitleMode
}: {
  subtitleMode: 'hard' | 'soft'
  setSubtitleMode: (m: 'hard' | 'soft') => void
}) {
  const { t } = useTranslation('landing')
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)

  const handleDownload = (format: string) => {
    setDownloadStatus(format)
    setTimeout(() => {
      setDownloadStatus(null)
    }, 2000)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <IconShieldCheck size={16} />
          </div>
          <span className="font-bold text-neutral-100 text-sm">{t('pipeline.sim.qa.title')}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(16,185,129,0.25)] self-start sm:self-auto">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>{t('pipeline.sim.qa.passedCriteria')}</span>
        </div>
      </div>

      {/* Interactive Video Preview Frame with Subtitle Mode */}
      <div className="p-3 sm:p-4 rounded-2xl bg-neutral-950/85 border border-white/10 space-y-3 text-xs relative overflow-hidden shadow-xl backdrop-blur-sm">
        {/* Toggle Ribbon */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-neutral-200 font-bold">
              <IconVideo size={14} className="text-purple-400" />
              <span>{t('pipeline.sim.qa.previewLabel')}</span>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              LIVE PREVIEW 4K
            </span>
          </div>

          <div className="inline-flex p-1 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setSubtitleMode('hard')}
              className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                subtitleMode === 'hard'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold shadow-md shadow-purple-900/40 scale-[1.02]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Hard-sub
            </button>
            <button
              type="button"
              onClick={() => setSubtitleMode('soft')}
              className={`px-3 py-1 rounded-lg text-xs transition-all cursor-pointer ${
                subtitleMode === 'soft'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-semibold shadow-md shadow-purple-900/40 scale-[1.02]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Soft-sub
            </button>
          </div>
        </div>

        {/* Video Canvas Simulation with Safe-Zone Reticle and Playhead */}
        <div className="h-44 sm:h-52 rounded-xl bg-gradient-to-b from-[#080a12] via-[#05060a] to-black border border-white/15 flex flex-col justify-between p-3 sm:p-3.5 relative overflow-hidden select-none shadow-inner">
          {/* Real Video Footage Playing in Background */}
          <video
            src="/landing/videos/hero_slide_2.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover opacity-55 filter brightness-90 contrast-110 pointer-events-none"
          />

          {/* Cinematic Studio Vignette Overlay for High Legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/60 pointer-events-none" />

          {/* Subtle Grid Background */}
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }}
          />

          {/* Sweeping Timeline Laser Playhead */}
          <div className="absolute top-0 bottom-0 w-[2px] bg-gradient-to-b from-purple-400 via-emerald-400 to-transparent pointer-events-none animate-playhead z-0 shadow-[0_0_8px_#34d399]" />

          {/* 4 Corner Safe-Zone Reticles (Desktop only) */}
          <div className="hidden sm:block absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-emerald-400/80 animate-reticle pointer-events-none" />
          <div className="hidden sm:block absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-emerald-400/80 animate-reticle pointer-events-none" />
          <div className="hidden sm:block absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-emerald-400/80 animate-reticle pointer-events-none" />
          <div className="hidden sm:block absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-emerald-400/80 animate-reticle pointer-events-none" />

          {/* Studio HUD Overhead Info */}
          <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 z-10">
            <span className="tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              TITLE SAFE 16:9
            </span>
            <span className="text-emerald-400/90 font-bold tracking-wider hidden sm:inline">
              TC 00:01:24:18 / 00:02:45:00
            </span>
          </div>

          {/* Subtle Audio Waveform in Center Background (Desktop only) */}
          <div className="hidden sm:flex absolute inset-x-0 top-1/2 -translate-y-1/2 items-center justify-center gap-1 pointer-events-none opacity-20">
            {[16, 24, 38, 52, 68, 84, 56, 42, 70, 92, 64, 48, 80, 58, 32, 18].map((h, i) => (
              <div
                key={i}
                style={{ height: `${h}%` }}
                className="w-1 rounded-full bg-purple-400 animate-eq-pulse"
              />
            ))}
          </div>

          {/* Dynamic Subtitle Render */}
          <div className="flex justify-center z-10">
            {subtitleMode === 'hard' ? (
              <span className="text-xs sm:text-[13px] px-3.5 py-1 rounded-md transition-all text-center bg-black/90 text-amber-300 font-bold border border-amber-400/50 shadow-[0_0_20px_rgba(245,158,11,0.35)] tracking-wide inline-flex items-center gap-2 animate-subtitle-glow">
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-400/25 text-amber-300 border border-amber-400/40">
                  HARD-SUB
                </span>
                "{t('pipeline.sim.qa.subtitleSample')}"
              </span>
            ) : (
              <span className="text-xs sm:text-[13px] px-3.5 py-1 rounded-md transition-all text-center text-white font-medium bg-neutral-900/85 backdrop-blur-xl border border-white/25 shadow-[0_4px_24px_rgba(0,0,0,0.8)] inline-flex items-center gap-2 animate-subtitle-glow">
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-white/20 text-neutral-200 border border-white/30">
                  CC • SRT
                </span>
                "{t('pipeline.sim.qa.subtitleSample')}"
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Export Action Hub */}
      <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={() => handleDownload('mp4')}
          className="relative overflow-hidden group inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-purple-900/30 hover:shadow-purple-600/40 transition-all cursor-pointer active:scale-[0.98]"
        >
          <div className="absolute inset-0 animate-shimmer pointer-events-none opacity-30" />
          {downloadStatus === 'mp4' ? (
            <>
              <IconCheck size={15} className="text-emerald-300 animate-bounce" />
              <span>{t('pipeline.sim.qa.downloadingMp4')}</span>
            </>
          ) : (
            <>
              <IconDownload size={15} className="group-hover:translate-y-0.5 transition-transform text-white" />
              <span>{t('pipeline.sim.qa.downloadMp4')}</span>
              <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-white/20">
                H.265
              </span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleDownload('srt')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-medium cursor-pointer transition-all border active:scale-95 shadow-xs ${
              downloadStatus === 'srt'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-white/10 hover:bg-violet-600/20 text-neutral-200 hover:text-white border-white/10 hover:border-violet-500/40'
            }`}
          >
            {downloadStatus === 'srt' ? <IconCheck size={13} /> : <IconFileText size={13} className="text-violet-400" />}
            <span>.SRT</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownload('vtt')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono font-medium cursor-pointer transition-all border active:scale-95 shadow-xs ${
              downloadStatus === 'vtt'
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                : 'bg-white/10 hover:bg-violet-600/20 text-neutral-200 hover:text-white border-white/10 hover:border-violet-500/40'
            }`}
          >
            {downloadStatus === 'vtt' ? <IconCheck size={13} /> : <IconFileText size={13} className="text-violet-400" />}
            <span>.VTT</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// ANIMATION COMPONENTS FOR SUMMARIZATION WORKFLOW
// --------------------------------------------------------------------------

function AnimationSumStep1() {
  const { t } = useTranslation('landing')
  const [selectedTopic, setSelectedTopic] = useState<number>(0)
  const [revealedCount, setRevealedCount] = useState<number>(1)
  const [isManual, setIsManual] = useState<boolean>(false)

  const topics = useMemo(() => [
    { id: 1, title: t('pipeline.sim.sum1.topic1Title'), time: '00:00 - 05:20', duration: '5m 20s' },
    { id: 2, title: t('pipeline.sim.sum1.topic2Title'), time: '05:21 - 12:40', duration: '7m 19s' },
    { id: 3, title: t('pipeline.sim.sum1.topic3Title'), time: '12:41 - 18:30', duration: '5m 49s' }
  ], [t])

  // Sequential topic reveal & cyclic inspection
  useEffect(() => {
    if (isManual) return

    let step = 0
    const interval = setInterval(() => {
      step = (step + 1) % 6
      if (step === 0) {
        setRevealedCount(1)
        setSelectedTopic(0)
      } else if (step === 1) {
        setRevealedCount(2)
        setSelectedTopic(1)
      } else if (step === 2) {
        setRevealedCount(3)
        setSelectedTopic(2)
      } else if (step === 3) {
        setSelectedTopic(0)
      } else if (step === 4) {
        setSelectedTopic(1)
      } else if (step === 5) {
        setSelectedTopic(2)
      }
    }, 1600)

    return () => clearInterval(interval)
  }, [isManual])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.3)]">
            <IconFileText size={16} />
          </div>
          <span className="font-bold text-neutral-100 text-sm">{t('pipeline.sim.sum1.title')}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/40 text-purple-300 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(168,85,247,0.25)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
          <span>
            {revealedCount < 3 ? t('pipeline.sim.sum1.detecting', { count: revealedCount }) : t('pipeline.sim.sum1.done')}
          </span>
        </div>
      </div>

      {/* Video Monitor with Topic Analysis */}
      <div className="h-36 sm:h-44 rounded-xl bg-gradient-to-b from-[#0a0814] via-[#07050f] to-black border border-white/15 flex flex-col justify-between p-3 relative overflow-hidden select-none shadow-inner">
        {/* Real Video Footage Playing in Background */}
        <video
          src="/landing/videos/agent_docs.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-50 filter brightness-90 contrast-110 pointer-events-none"
        />

        {/* Studio Vignette Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/60 pointer-events-none" />

        {/* Sweeping Timeline Laser */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-gradient-to-b from-purple-400 via-pink-400 to-transparent pointer-events-none animate-playhead z-0 shadow-[0_0_8px_#c084fc]" />

        {/* Video HUD Overhead */}
        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 z-10">
          <span className="tracking-wider flex items-center gap-1.5 text-purple-300 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
            AI TOPIC BOUNDARY ANALYSIS
          </span>
          <span className="text-purple-300 font-mono">
            {topics[selectedTopic].time}
          </span>
        </div>

        {/* Segmented Chapter Bar */}
        <div className="z-10 space-y-1">
          <div className="flex gap-1.5 h-1.5 w-full rounded-full overflow-hidden bg-white/10 p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                selectedTopic === 0
                  ? 'bg-purple-400 flex-[3] shadow-[0_0_8px_#c084fc]'
                  : 'bg-purple-500/40 flex-[3]'
              }`}
            />
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                revealedCount >= 2
                  ? selectedTopic === 1
                    ? 'bg-purple-400 flex-[4] shadow-[0_0_8px_#c084fc]'
                    : 'bg-purple-500/40 flex-[4]'
                  : 'bg-white/15 flex-[4]'
              }`}
            />
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                revealedCount >= 3
                  ? selectedTopic === 2
                    ? 'bg-purple-400 flex-[3] shadow-[0_0_8px_#c084fc]'
                    : 'bg-purple-500/40 flex-[3]'
                  : 'bg-white/15 flex-[3]'
              }`}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-neutral-400 px-0.5">
            <span>00:00</span>
            <span className={revealedCount >= 2 ? 'text-purple-300 font-medium' : 'text-neutral-500'}>05:20</span>
            <span className={revealedCount >= 3 ? 'text-purple-300 font-medium' : 'text-neutral-500'}>12:40</span>
            <span>18:30</span>
          </div>
        </div>

        {/* Active Floating Topic Tag */}
        <div className="z-10 flex justify-center">
          <span className="text-xs px-3 py-1 rounded-md transition-all duration-300 text-center bg-purple-950/85 text-purple-200 font-semibold border border-purple-400/40 shadow-lg backdrop-blur-md inline-flex items-center gap-2">
            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-purple-400/25 text-purple-300 border border-purple-400/40">
              TOPIC 0{topics[selectedTopic].id}
            </span>
            <span className="truncate max-w-[200px] sm:max-w-[280px]">{topics[selectedTopic].title}</span>
          </span>
        </div>
      </div>

      {/* Interactive Topics List (Sequentially Revealed) */}
      <div className="space-y-1.5 text-xs">
        {topics.map((tItem, idx) => {
          const isRevealed = idx < revealedCount
          const isSelected = selectedTopic === idx

          if (!isRevealed) {
            return (
              <div
                key={tItem.id}
                className="w-full p-2.5 rounded-xl border border-dashed border-purple-500/25 bg-purple-950/15 text-neutral-400 flex items-center justify-between transition-all duration-500 opacity-60 animate-pulse"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
                  <span className="font-mono text-[11px] text-purple-300/60">
                    {t('pipeline.sim.sum1.scanning', { id: tItem.id })}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-purple-400/50">Scanning...</span>
              </div>
            )
          }

          return (
            <button
              key={tItem.id}
              type="button"
              onClick={() => {
                setSelectedTopic(idx)
                setRevealedCount(3)
                setIsManual(true)
              }}
              className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'bg-purple-950/40 border-purple-500/50 text-white shadow-md shadow-purple-900/20 translate-x-0.5'
                  : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-purple-400 animate-ping' : 'bg-neutral-500'}`} />
                <span className="font-medium">Topic 0{tItem.id}: {tItem.title}</span>
              </div>
              <span className="font-mono text-[11px] text-purple-300/90">{tItem.time}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AnimationSumStep2() {
  const { t } = useTranslation('landing')
  const [activeHighlight, setActiveHighlight] = useState<number>(0)
  const [revealedCount, setRevealedCount] = useState<number>(1)
  const [isManual, setIsManual] = useState<boolean>(false)

  const highlights = useMemo(() => [
    {
      id: 1,
      title: t('pipeline.sim.sum2.highlight1Title'),
      time: '02:15 - 03:05',
      timestamp: '02:15',
      duration: '50s',
      score: '98/100',
      rank: 'Top #1',
      tag: 'INFERENCE SPEED'
    },
    {
      id: 2,
      title: t('pipeline.sim.sum2.highlight2Title'),
      time: '08:40 - 09:25',
      timestamp: '08:40',
      duration: '45s',
      score: '94/100',
      rank: 'Top #2',
      tag: 'COST REDUCTION'
    },
    {
      id: 3,
      title: t('pipeline.sim.sum2.highlight3Title'),
      time: '14:10 - 14:55',
      timestamp: '14:10',
      duration: '45s',
      score: '89/100',
      rank: 'Top #3',
      tag: 'LIVE WORKFLOW'
    }
  ], [t])

  // Auto-cycle: Highlights appear sequentially directly on the video monitor!
  useEffect(() => {
    if (isManual) return

    let step = 0
    const interval = setInterval(() => {
      step = (step + 1) % 6
      if (step === 0) {
        setRevealedCount(1)
        setActiveHighlight(0)
      } else if (step === 1) {
        setRevealedCount(2)
        setActiveHighlight(1)
      } else if (step === 2) {
        setRevealedCount(3)
        setActiveHighlight(2)
      } else if (step === 3) {
        setActiveHighlight(0)
      } else if (step === 4) {
        setActiveHighlight(1)
      } else if (step === 5) {
        setActiveHighlight(2)
      }
    }, 1800)

    return () => clearInterval(interval)
  }, [isManual])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
            <IconScissors size={16} />
          </div>
          <span className="font-bold text-neutral-100 text-sm">{t('pipeline.sim.sum2.title')}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(245,158,11,0.25)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span>
            {t('pipeline.sim.sum2.cutPlanStatus', {
              count: revealedCount,
              duration: revealedCount === 3 ? '120s' : `${revealedCount * 45}s`
            })}
          </span>
        </div>
      </div>

      {/* Video Monitor with Splicing Simulation and Sequentially Appearing Moments */}
      <div className="h-44 sm:h-52 rounded-xl bg-gradient-to-b from-[#140e08] via-[#0f0a06] to-black border border-white/15 flex flex-col justify-between p-3 relative overflow-hidden select-none shadow-inner">
        {/* Real Video Footage Playing in Background */}
        <video
          src="/landing/videos/agent_try_ai.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-55 filter brightness-90 contrast-110 pointer-events-none"
        />

        {/* Studio Vignette Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/60 pointer-events-none" />

        {/* Scissor Splicing Reticle */}
        <div className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-amber-400/80 animate-reticle pointer-events-none" />
        <div className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-amber-400/80 animate-reticle pointer-events-none" />
        <div className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-amber-400/80 animate-reticle pointer-events-none" />
        <div className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-amber-400/80 animate-reticle pointer-events-none" />

        {/* Video HUD Overhead */}
        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 z-10">
          <span className="tracking-wider flex items-center gap-1.5 text-amber-300 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
            AI SPLICING • MOMENT 0{activeHighlight + 1}/03
          </span>
          <span className="text-amber-300 font-mono font-bold">
            DENSITY: {highlights[activeHighlight].score}
          </span>
        </div>

        {/* 3 Detected Moment Badges Appearing Sequentially on the Video */}
        <div className="z-10 flex items-center justify-center gap-2">
          {highlights.map((h, idx) => {
            const isVisible = idx < revealedCount
            const isActive = activeHighlight === idx
            return (
              <div
                key={h.id}
                className={`transition-all duration-500 transform ${
                  isVisible
                    ? 'opacity-100 scale-100 translate-y-0'
                    : 'opacity-0 scale-75 -translate-y-2 pointer-events-none'
                }`}
              >
                <div
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all border flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-amber-500 text-black border-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.7)] scale-105'
                      : 'bg-black/75 text-amber-300/80 border-amber-500/30 backdrop-blur-md'
                  }`}
                >
                  {isActive && <IconScissors size={11} className="text-black animate-spin" />}
                  <span>{h.rank}</span>
                  <span className="text-[9px] opacity-85">[{h.timestamp}]</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Active Highlight Callout Card on Video Canvas */}
        <div className="z-10 flex flex-col items-center justify-center px-1">
          <div
            key={activeHighlight}
            className="max-w-md w-full p-2.5 rounded-xl bg-black/85 backdrop-blur-md border border-amber-400/60 shadow-[0_0_24px_rgba(245,158,11,0.35)] text-center transition-all duration-300"
          >
            <div className="flex items-center justify-between text-[10px] font-mono pb-1 border-b border-white/10 text-amber-300/90">
              <span className="font-bold flex items-center gap-1.5 text-amber-300">
                <IconScissors size={12} className="text-amber-400" />
                <span>CUT SEGMENT [{highlights[activeHighlight].time}]</span>
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                {highlights[activeHighlight].tag}
              </span>
            </div>
            <div className="text-xs sm:text-[13px] font-bold text-white tracking-wide mt-1 truncate">
              ★ {highlights[activeHighlight].title}
            </div>
            <div className="flex items-center justify-center gap-3 mt-1 text-[10px] font-mono text-neutral-300">
              <span>{t('pipeline.sim.sum2.durationLabel')} <strong className="text-amber-300">{highlights[activeHighlight].duration}</strong></span>
              <span>•</span>
              <span>AI Density: <strong className="text-amber-300">{highlights[activeHighlight].score}</strong></span>
            </div>
          </div>
        </div>

        {/* Segmented Splicing Timeline Bar */}
        <div className="z-10 space-y-1">
          <div className="flex gap-1.5 h-1.5 w-full rounded-full overflow-hidden bg-white/10 p-0.5">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                revealedCount >= 1
                  ? activeHighlight === 0
                    ? 'bg-amber-400 flex-[3] shadow-[0_0_10px_#fbbf24]'
                    : 'bg-amber-400/50 flex-[3]'
                  : 'bg-white/15 flex-[3]'
              }`}
            />
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                revealedCount >= 2
                  ? activeHighlight === 1
                    ? 'bg-amber-400 flex-[3] shadow-[0_0_10px_#fbbf24]'
                    : 'bg-amber-400/50 flex-[3]'
                  : 'bg-white/15 flex-[3]'
              }`}
            />
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                revealedCount >= 3
                  ? activeHighlight === 2
                    ? 'bg-amber-400 flex-[3] shadow-[0_0_10px_#fbbf24]'
                    : 'bg-amber-400/50 flex-[3]'
                  : 'bg-white/15 flex-[3]'
              }`}
            />
          </div>
        </div>
      </div>

      {/* 3 Clickable Highlight Moments Below Video */}
      <div className="space-y-1.5 text-xs">
        {highlights.map((h, idx) => {
          const isRevealed = idx < revealedCount
          const isSelected = activeHighlight === idx

          if (!isRevealed) {
            return (
              <div
                key={h.id}
                className="w-full p-2.5 rounded-xl border border-dashed border-amber-500/25 bg-amber-950/15 text-neutral-400 flex items-center justify-between transition-all duration-500 opacity-60 animate-pulse"
              >
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400/60" />
                  <span className="font-mono text-[11px] text-amber-300/60">
                    {t('pipeline.sim.sum2.extracting', { rank: h.rank })}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-amber-400/50">Analyzing...</span>
              </div>
            )
          }

          return (
            <button
              key={h.id}
              type="button"
              onClick={() => {
                setActiveHighlight(idx)
                setRevealedCount(3)
                setIsManual(true)
              }}
              className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'bg-amber-950/40 border-amber-500/50 text-amber-100 shadow-md shadow-amber-900/20 translate-x-0.5'
                  : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-400 font-bold">★</span>
                <span className="font-semibold">{h.title}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  {h.score}
                </span>
                <span className="font-mono text-[11px] text-neutral-300">[{h.time}]</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Footer Stats */}
      <div className="text-[11px] text-neutral-400 pt-2 border-t border-white/10 flex justify-between">
        <span>{t('pipeline.sim.sum2.compressionRatio')}</span>
        <span className="text-amber-400 font-bold">{t('pipeline.sim.sum2.densityStat')}</span>
      </div>
    </div>
  )
}

function AnimationSumStep3() {
  const { t } = useTranslation('landing')
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)

  const handleDownload = (format: string) => {
    setDownloadStatus(format)
    setTimeout(() => {
      setDownloadStatus(null)
    }, 2000)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <IconPlayerPlay size={16} />
          </div>
          <span className="font-bold text-neutral-100 text-sm">{t('pipeline.sim.sum3.title')}</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-mono text-[11px] font-bold shadow-[0_0_12px_rgba(16,185,129,0.25)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span>{t('pipeline.sim.sum3.renderComplete')}</span>
        </div>
      </div>

      {/* Video Monitor: Real 120s Recap Reel */}
      <div className="h-40 sm:h-48 rounded-xl bg-gradient-to-b from-[#08120e] via-[#050d09] to-black border border-white/15 flex flex-col justify-between p-3 relative overflow-hidden select-none shadow-inner">
        {/* Real Video Footage Playing in Background */}
        <video
          src="/landing/videos/footer_brand.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-60 filter brightness-95 contrast-110 pointer-events-none"
        />

        {/* Studio Vignette Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/60 pointer-events-none" />

        {/* Safe-Zone Reticle (Desktop only) */}
        <div className="hidden sm:block absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 border-emerald-400/80 animate-reticle pointer-events-none" />
        <div className="hidden sm:block absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 border-emerald-400/80 animate-reticle pointer-events-none" />
        <div className="hidden sm:block absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 border-emerald-400/80 animate-reticle pointer-events-none" />
        <div className="hidden sm:block absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 border-emerald-400/80 animate-reticle pointer-events-none" />

        {/* Timeline Playhead */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-gradient-to-b from-emerald-400 via-teal-400 to-transparent pointer-events-none animate-playhead z-0 shadow-[0_0_8px_#34d399]" />

        {/* Video HUD Overhead */}
        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 z-10">
          <span className="tracking-wider flex items-center gap-1.5 text-emerald-300 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            RECAP REEL • 120s 4K
          </span>
          <span className="text-emerald-400 font-mono font-bold hidden sm:inline">
            TC 00:01:45 / 00:02:00
          </span>
        </div>

        {/* Key Takeaway Caption on Video */}
        <div className="z-10 flex justify-center">
          <span className="text-xs sm:text-[13px] px-3.5 py-1 rounded-md transition-all text-center text-white font-medium bg-neutral-900/85 backdrop-blur-xl border border-white/25 shadow-[0_4px_24px_rgba(0,0,0,0.8)] inline-flex items-center gap-2 animate-subtitle-glow">
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-emerald-400/25 text-emerald-300 border border-emerald-400/40">
              KEY TAKEAWAY
            </span>
            "{t('pipeline.sim.sum3.takeawayCaption')}"
          </span>
        </div>
      </div>

      {/* Takeaway Chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2 text-neutral-300">
          <IconCheck size={14} className="text-emerald-400 shrink-0" />
          <span className="text-[11px]">{t('pipeline.sim.sum3.bullet1')}</span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2 text-neutral-300">
          <IconCheck size={14} className="text-emerald-400 shrink-0" />
          <span className="text-[11px]">{t('pipeline.sim.sum3.bullet2')}</span>
        </div>
      </div>

      {/* Export Action Hub */}
      <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2.5">
        <button
          type="button"
          onClick={() => handleDownload('recap')}
          className="relative overflow-hidden group inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-900/30 hover:shadow-emerald-600/40 transition-all cursor-pointer active:scale-[0.98]"
        >
          <div className="absolute inset-0 animate-shimmer pointer-events-none opacity-30" />
          {downloadStatus === 'recap' ? (
            <>
              <IconCheck size={15} className="text-white animate-bounce" />
              <span>{t('pipeline.sim.sum3.downloadingRecap')}</span>
            </>
          ) : (
            <>
              <IconDownload size={15} className="group-hover:translate-y-0.5 transition-transform text-white" />
              <span>{t('pipeline.sim.sum3.downloadRecapBtn')}</span>
              <span className="text-[10px] font-mono font-normal px-1.5 py-0.5 rounded bg-white/20">
                1080p
              </span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => handleDownload('report')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer transition-all border active:scale-95 shadow-xs ${
            downloadStatus === 'report'
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : 'bg-white/10 hover:bg-emerald-600/20 text-neutral-200 hover:text-white border-white/10 hover:border-emerald-500/40'
          }`}
        >
          {downloadStatus === 'report' ? <IconCheck size={13} /> : <IconFileText size={13} className="text-emerald-400" />}
          <span>{t('pipeline.sim.sum3.downloadReportBtn')}</span>
        </button>
      </div>
    </div>
  )
}
