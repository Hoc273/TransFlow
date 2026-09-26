import { QueryClient } from '@tanstack/react-query'
import type { CreditTransactionQuery } from '@/types/credit'

/** Default staleTime: 30s (realtime/dashboard). Override per query (09b A.5.1). */
export const STALE = {
  static: 5 * 60 * 1000,
  realtime: 30 * 1000,
  semiLive: 0,
} as const

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE.realtime,
        retry: (failureCount, error) => {
          const status = (error as { status?: number })?.status
          if (status === 401 || status === 403 || status === 404) return false
          return failureCount < 2
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

export const queryKeys = {
  userCredit: ['credit', 'balance'] as const,
  creditPackages: ['credit', 'packages'] as const,
  creditTransactionsRoot: ['credit', 'transactions'] as const,
  creditTransactions: (params: CreditTransactionQuery = {}) =>
    ['credit', 'transactions', params] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  members: (wsId: string) => ['members', wsId] as const,
  providers: (wsId: string) => ['providers', wsId] as const,
  providerPresets: (wsId: string, category?: string) =>
    ['providerPresets', wsId, category ?? 'all'] as const,
  ttsVoices: (wsId: string, providerId: string) =>
    ['ttsVoices', wsId, providerId] as const,
  ttsVoiceLanguages: (wsId: string, providerId: string) =>
    ['ttsVoiceLanguages', wsId, providerId] as const,
  ttsProviders: (wsId: string) => ['ttsProviders', wsId] as const,
  batches: (wsId: string) => ['batches', wsId] as const,
  batchDetail: (wsId: string, batchId: string) => ['batchDetail', wsId, batchId] as const,
  notifications: (wsId: string, params?: { limit?: number; offset?: number }) =>
    ['notifications', wsId, params ?? {}] as const,
  notificationsInfinite: (wsId: string) => ['notifications', wsId, 'infinite'] as const,
  notificationsUnreadCount: (wsId: string) => ['notifications', wsId, 'unread-count'] as const,
  projects: (wsId: string) => ['projects', wsId] as const,
  projectMembers: (wsId: string, projectId: string) =>
    ['projectMembers', wsId, projectId] as const,
  jobs: (wsId: string, documentId: string) => ['jobs', wsId, documentId] as const,
  job: (wsId: string, jobId: string) => ['job', wsId, jobId] as const,
  mediaJobs: (wsId: string, projectId: string) => ['mediaJobs', wsId, projectId] as const,
  mediaJob: (wsId: string, jobId: string) => ['mediaJob', wsId, jobId] as const,
  mediaAssets: (wsId: string, projectId: string) => ['mediaAssets', wsId, projectId] as const,
  mediaAsset: (wsId: string, assetId: string) => ['mediaAsset', wsId, assetId] as const,
  renderConfig: (wsId: string, jobId: string) =>
    ['mediaJob', wsId, jobId, 'render-config'] as const,
  /** CT3 output package — presigned render output for the Export preview. */
  outputPackage: (wsId: string, jobId: string) => ['outputPackage', wsId, jobId] as const,
  workflowPresets: (wsId: string, projectId: string) =>
    ['workflowPresets', wsId, projectId] as const,
  mediaTermsVersion: (wsId: string) => ['mediaTermsVersion', wsId] as const,
  mediaProposals: (wsId: string, jobId: string) => ['mediaProposals', wsId, jobId] as const,
  mediaSubtitles: (wsId: string, jobId: string) => ['mediaSubtitles', wsId, jobId] as const,
  mediaQaIssues: (wsId: string, jobId: string, resolved?: boolean) =>
    ['mediaQaIssues', wsId, jobId, resolved] as const,
  /** B1.2 SYSTEM subtitle style presets — deployment-wide, never workspace-scoped. */
  subtitleStylePresets: ['subtitleStyles', 'presets'] as const,
  jobSubtitleStyle: (jobId: string) => ['subtitleStyles', 'job', jobId] as const,
  /** CT10.3B availability projection — deployment-wide, never workspace-scoped. */
  transformationCapabilities: ['transformation', 'capabilities'] as const,
  segmentHistory: (wsId: string, segmentId: string) =>
    ['segmentHistory', wsId, segmentId] as const,
  projectGlossary: (wsId: string, projectId: string) =>
    ['projectGlossary', wsId, projectId] as const,
  glossaryTerms: (wsId: string, projectId: string) =>
    ['glossaryTerms', wsId, projectId] as const,
  usage: (wsId: string, params?: Record<string, string | undefined>) =>
    ['usage', wsId, params ?? {}] as const,
  // Platform Super Admin (docs/34 / 09b Phase P) — no workspace scope
  me: ['auth', 'me'] as const,
  platformOverview: (params: Record<string, string | number | undefined>) =>
    ['platform', 'overview', params] as const,
  platformStatus: ['platform', 'status'] as const,
  platformUsers: (params: Record<string, string | number | boolean | undefined>) =>
    ['platform', 'users', params] as const,
  platformWorkspaces: (params: Record<string, string | number | undefined>) =>
    ['platform', 'workspaces', params] as const,
  platformAudit: (params: Record<string, string | number | undefined>) =>
    ['platform', 'audit', params] as const,
  platformRealtime: ['platform', 'realtime'] as const,
  platformProviders: ['platform', 'providers'] as const,
  platformPricing: ['platform', 'pricing'] as const,
  platformPricingHistory: (params: Record<string, string | undefined>) =>
    ['platform', 'pricing', 'history', params] as const,
  platformPricingCoverage: ['platform', 'pricing', 'coverage'] as const,
  // Guide (Public + Platform Admin)
  guideCategories: (lang?: string) => ['guide', 'categories', lang ?? 'vi'] as const,
  guideArticles: (params?: Record<string, string | number | undefined>) =>
    ['guide', 'articles', params ?? {}] as const,
  guideArticle: (slug?: string, lang?: string) => ['guide', 'article', slug ?? '', lang ?? 'vi'] as const,
  adminGuideCategories: ['admin', 'guide', 'categories'] as const,
  adminGuideCategory: (id?: string) => ['admin', 'guide', 'category', id ?? ''] as const,
  adminGuideArticles: (params?: Record<string, string | number | undefined>) =>
    ['admin', 'guide', 'articles', params ?? {}] as const,
  adminGuideArticle: (id?: string) => ['admin', 'guide', 'article', id ?? ''] as const,
}
