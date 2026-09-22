import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'

export function LandingProductivity() {
  const { t } = useTranslation('landing')
  const accessToken = useAuthStore((s) => s.accessToken)
  const currentWorkspace = useAuthStore((s) => s.currentWorkspace)

  const batchTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/batches`
      : '/dashboard'
    : '/login'

  const qaTarget = accessToken
    ? currentWorkspace?.id
      ? `/w/${currentWorkspace.id}/glossaries`
      : '/dashboard'
    : '/login'

  return (
    <section id="productivity" className="py-20 max-w-7xl mx-auto px-4 sm:px-6">
      {/* Section Header */}
      <div className="text-center max-w-3xl mx-auto mb-14">
        <h2 className="text-3xl sm:text-5xl font-black tracking-tight text-neutral-900 dark:text-white leading-tight">
          {t('productivity.titlePrefix')}
          <span className="bg-gradient-to-r from-[#8054ff] via-[#5b8cff] to-[#ff7043] bg-clip-text text-transparent">
            {t('productivity.titleHighlight')}
          </span>
        </h2>
        <p className="text-neutral-500 dark:text-neutral-400 text-sm sm:text-base mt-4 max-w-2xl mx-auto leading-relaxed">
          {t('productivity.subtitle')}
        </p>
      </div>

      {/* 2-Column Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Card 1: Batch Localization & Đa ngôn ngữ hàng loạt */}
        <div className="relative overflow-hidden group rounded-[32px] border border-neutral-200/80 dark:border-white/10 hover:border-[#714ffc]/50 dark:hover:border-[#714ffc]/60 bg-[#fbfbfe] dark:bg-[#13151b] p-7 sm:p-8 flex flex-col justify-between shadow-sm dark:shadow-[0_10px_35px_rgba(0,0,0,0.55)] hover:shadow-[0_20px_50px_rgba(113,79,252,0.18)] hover:-translate-y-1.5 transition-all duration-500">
          {/* Ambient Glow Background Effect */}
          <div className="absolute -top-24 -right-24 w-60 h-60 bg-[#714ffc]/10 dark:bg-[#714ffc]/15 rounded-full blur-3xl pointer-events-none group-hover:scale-125 group-hover:bg-[#714ffc]/25 transition-all duration-700" />

          <div>
            {/* Pulsing Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100/80 dark:bg-purple-950/60 text-[#714ffc] dark:text-[#a78bff] text-[11px] font-semibold mb-3.5 border border-purple-200/50 dark:border-purple-800/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#714ffc] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#714ffc]" />
              </span>
              {t('productivity.batchBadge')}
            </div>

            <h3 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight mb-2.5">
              {t('productivity.batchTitle')}
            </h3>

            <p className="text-neutral-500 dark:text-neutral-400 text-sm leading-relaxed mb-6">
              {t('productivity.batchDesc')}
            </p>
          </div>

          {/* Media View (Video dải sóng đỏ tím nguyên bản + Hover Zoom & Live Badge) */}
          <div className="relative rounded-2xl overflow-hidden aspect-[16/9] border border-neutral-200/70 dark:border-white/10 bg-[#09090a] dark:bg-[#09090a] shadow-inner group/video">
            <video
              src="/landing/videos/agent_try_ai.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
            {/* Glassmorphic Status Pill */}
            <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono font-medium text-white/90 flex items-center gap-1.5 shadow-sm pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>BATCH ENGINE</span>
            </div>
            {/* Bottom Glow Beam on Hover */}
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-[#714ffc] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>

          {/* Link Action */}
          <div className="pt-5 mt-6 border-t border-neutral-200/70 dark:border-white/10 flex items-center justify-between">
            <Link
              to={batchTarget}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#714ffc] dark:text-[#a78bff] hover:text-[#5832e8] dark:hover:text-[#c4b3ff] transition-colors group/link"
            >
              <span>{t('productivity.batchCta')}</span>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-950/70 group-hover/link:bg-[#714ffc] group-hover/link:text-white transition-all duration-300 transform group-hover/link:translate-x-1 text-xs">
                →
              </span>
            </Link>
            <span className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
              RabbitMQ Queue
            </span>
          </div>
        </div>

        {/* Card 2: Translation Memory & Kiểm duyệt QA 3 chiều */}
        <div className="relative overflow-hidden group rounded-[32px] border border-neutral-200/80 dark:border-white/10 hover:border-blue-500/50 dark:hover:border-blue-500/60 bg-[#fbfbfe] dark:bg-[#13151b] p-7 sm:p-8 flex flex-col justify-between shadow-sm dark:shadow-[0_10px_35px_rgba(0,0,0,0.55)] hover:shadow-[0_20px_50px_rgba(59,130,246,0.18)] hover:-translate-y-1.5 transition-all duration-500">
          {/* Ambient Glow Background Effect */}
          <div className="absolute -top-24 -right-24 w-60 h-60 bg-blue-500/10 dark:bg-blue-500/15 rounded-full blur-3xl pointer-events-none group-hover:scale-125 group-hover:bg-blue-500/25 transition-all duration-700" />

          <div>
            {/* Pulsing Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100/80 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 text-[11px] font-semibold mb-3.5 border border-blue-200/50 dark:border-blue-800/40">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              {t('productivity.qaBadge')}
            </div>

            <h3 className="text-2xl font-bold text-neutral-900 dark:text-white tracking-tight mb-2.5">
              {t('productivity.qaTitle')}
            </h3>

            <p className="text-neutral-500 dark:text-neutral-400 text-sm leading-relaxed mb-6">
              {t('productivity.qaDesc')}
            </p>
          </div>

          {/* Media View (Video dải sóng xanh dương nguyên bản + Hover Zoom & Live Badge) */}
          <div className="relative rounded-2xl overflow-hidden aspect-[16/9] border border-neutral-200/70 dark:border-white/10 bg-[#09090a] dark:bg-[#09090a] shadow-inner group/video">
            <video
              src="/landing/videos/agent_docs.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
            />
            {/* Glassmorphic Status Pill */}
            <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[10px] font-mono font-medium text-white/90 flex items-center gap-1.5 shadow-sm pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span>QA SHIELD</span>
            </div>
            {/* Bottom Glow Beam on Hover */}
            <div className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>

          {/* Link Action */}
          <div className="pt-5 mt-6 border-t border-neutral-200/70 dark:border-white/10 flex items-center justify-between">
            <Link
              to={qaTarget}
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors group/link"
            >
              <span>{t('productivity.qaCta')}</span>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-950/70 group-hover/link:bg-blue-600 group-hover/link:text-white transition-all duration-300 transform group-hover/link:translate-x-1 text-xs">
                →
              </span>
            </Link>
            <span className="text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
              3-Way Audit Rule
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
