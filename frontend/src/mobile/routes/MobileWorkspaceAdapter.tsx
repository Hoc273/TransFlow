import { lazy } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { useIsMobile } from '../hooks/useIsMobile'
import { AppShell } from '@/components/layout/AppShell'
import { MobileAppShell } from '../layout/MobileAppShell'
import { MobileMediaJobWrapper } from '../components/MobileMediaJobWrapper'
import { RouteErrorBoundary } from '@/components/error/RouteErrorBoundary'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Desktop pages (lazy loaded)
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const UsagePage = lazy(() => import('@/pages/dashboard/UsagePage').then(m => ({ default: m.UsagePage })))
const MediaListPage = lazy(() => import('@/pages/media/MediaListPage').then(m => ({ default: m.MediaListPage })))
const MediaJobPage = lazy(() => import('@/pages/media/MediaJobPage').then(m => ({ default: m.MediaJobPage })))
const MembersPage = lazy(() => import('@/pages/settings/MembersPage').then(m => ({ default: m.MembersPage })))
const PresetSettingsPage = lazy(() => import('@/pages/settings/PresetSettingsPage').then(m => ({ default: m.PresetSettingsPage })))
const AccountSettingsPage = lazy(() => import('@/pages/account/AccountSettingsPage').then(m => ({ default: m.AccountSettingsPage })))
const BatchListPage = lazy(() => import('@/pages/batch/BatchListPage').then(m => ({ default: m.BatchListPage })))
const BatchDetailPage = lazy(() => import('@/pages/batch/BatchDetailPage').then(m => ({ default: m.BatchDetailPage })))
const ProjectListPage = lazy(() => import('@/pages/project/ProjectListPage').then(m => ({ default: m.ProjectListPage })))
const NotificationCenterPage = lazy(() => import('@/pages/notification/NotificationCenterPage').then(m => ({ default: m.NotificationCenterPage })))
const GlossaryPage = lazy(() => import('@/pages/glossary/GlossaryPage').then(m => ({ default: m.GlossaryPage })))

// Mobile pages (lazy loaded)
const MobileDashboardPage = lazy(() => import('../pages/dashboard/MobileDashboardPage').then(m => ({ default: m.MobileDashboardPage })))
const MobileUsagePage = lazy(() => import('../pages/dashboard/MobileUsagePage').then(m => ({ default: m.MobileUsagePage })))
const MobileProjectListPage = lazy(() => import('../pages/projects/MobileProjectListPage').then(m => ({ default: m.MobileProjectListPage })))
const MobileBatchListPage = lazy(() => import('../pages/batches/MobileBatchListPage').then(m => ({ default: m.MobileBatchListPage })))
const MobileBatchDetailPage = lazy(() => import('../pages/batches/MobileBatchDetailPage').then(m => ({ default: m.MobileBatchDetailPage })))
const MobileGlossaryPage = lazy(() => import('../pages/glossary/MobileGlossaryPage').then(m => ({ default: m.MobileGlossaryPage })))
const MobileMediaListPage = lazy(() => import('../pages/media/MobileMediaListPage').then(m => ({ default: m.MobileMediaListPage })))
const MobileMembersPage = lazy(() => import('../pages/settings/MobileMembersPage').then(m => ({ default: m.MobileMembersPage })))
const MobilePresetSettingsPage = lazy(() => import('../pages/settings/MobilePresetSettingsPage').then(m => ({ default: m.MobilePresetSettingsPage })))
const MobileAccountPage = lazy(() => import('../pages/account/MobileAccountPage').then(m => ({ default: m.MobileAccountPage })))
const MobileCreditPage = lazy(() => import('../pages/account/MobileCreditPage').then(m => ({ default: m.MobileCreditPage })))
const MobileNotificationPage = lazy(() => import('../pages/notification/MobileNotificationPage').then(m => ({ default: m.MobileNotificationPage })))

export function MobileWorkspaceAdapter() {
  const { workspaceId } = useParams()
  const isMobile = useIsMobile()
  const location = useLocation()

  // SPECIAL EXEMPTION: Media Studio Job detail stays as desktop MediaJobPage,
  // but on mobile it is wrapped in a safe viewport container (desktop untouched).
  const isMediaStudioJobDetail = /\/media\/jobs\/[^/]+/.test(location.pathname)

  if (isMediaStudioJobDetail && isMobile) {
    return (
      <RouteErrorBoundary workspaceId={workspaceId}>
        <Routes>
          <Route element={<MobileAppShell />}>
            <Route
              path="media/jobs/:jobId"
              element={
                <MobileMediaJobWrapper>
                  <MediaJobPage />
                </MobileMediaJobWrapper>
              }
            />
          </Route>
        </Routes>
      </RouteErrorBoundary>
    )
  }

  if (isMediaStudioJobDetail) {
    return (
      <RouteErrorBoundary workspaceId={workspaceId}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="media/jobs/:jobId" element={<MediaJobPage />} />
          </Route>
        </Routes>
      </RouteErrorBoundary>
    )
  }

  if (isMobile) {
    return (
      <RouteErrorBoundary workspaceId={workspaceId}>
        <Routes>
          <Route element={<MobileAppShell />}>
            <Route index element={<MobileDashboardPage />} />
            <Route path="notifications" element={<MobileNotificationPage />} />
            <Route path="projects" element={<MobileProjectListPage />} />
            <Route path="batches" element={<MobileBatchListPage />} />
            <Route path="batches/:batchId" element={<MobileBatchDetailPage />} />
            <Route path="glossaries" element={<MobileGlossaryPage />} />
            <Route path="media" element={<MobileMediaListPage />} />
            <Route path="media/presets" element={<MobilePresetSettingsPage />} />
            <Route
              path="dashboard/usage"
              element={
                <RoleGuard action="dashboard.usage">
                  <MobileUsagePage />
                </RoleGuard>
              }
            />
            <Route path="settings/members" element={<MobileMembersPage />} />
            <Route path="settings/provider" element={<Navigate to="../account/security" replace />} />
            <Route path="settings/media-presets" element={<Navigate to="../media/presets" replace />} />
            <Route path="account/credit" element={<MobileCreditPage />} />
            <Route path="account/*" element={<MobileAccountPage />} />
            {/* Legacy route redirects */}
            <Route path="tm/*" element={<Navigate to="../glossaries" replace />} />
            <Route path="documents/*" element={<Navigate to="../media" replace />} />
            <Route path="creative/*" element={<Navigate to="../media" replace />} />
            <Route path="jobs/*" element={<Navigate to="../media" replace />} />
            <Route path="*" element={<Navigate to="" replace />} />
          </Route>
        </Routes>
      </RouteErrorBoundary>
    )
  }

  // Desktop View: Original AppShell & Desktop pages untouched
  return (
    <RouteErrorBoundary workspaceId={workspaceId}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="notifications" element={<NotificationCenterPage />} />
          <Route path="projects" element={<ProjectListPage />} />
          <Route path="batches" element={<BatchListPage />} />
          <Route path="batches/:batchId" element={<BatchDetailPage />} />
          <Route path="glossaries" element={<GlossaryPage />} />
          <Route path="media" element={<MediaListPage />} />
          <Route path="media/presets" element={<PresetSettingsPage />} />
          <Route path="media/jobs/:jobId" element={<MediaJobPage />} />
          <Route
            path="dashboard/usage"
            element={
              <RoleGuard action="dashboard.usage">
                <UsagePage />
              </RoleGuard>
            }
          />
          <Route path="settings/members" element={<MembersPage />} />
          <Route path="settings/provider" element={<Navigate to="../account/security" replace />} />
          <Route path="settings/media-presets" element={<Navigate to="../media/presets" replace />} />
          <Route path="account/:section" element={<AccountSettingsPage />} />
          <Route path="account" element={<Navigate to="profile" replace />} />
          {/* Legacy route redirects */}
          <Route path="tm/*" element={<Navigate to="../glossaries" replace />} />
          <Route path="documents/*" element={<Navigate to="../media" replace />} />
          <Route path="creative/*" element={<Navigate to="../media" replace />} />
          <Route path="jobs/*" element={<Navigate to="../media" replace />} />
          <Route path="*" element={<Navigate to="" replace />} />
        </Route>
      </Routes>
    </RouteErrorBoundary>
  )
}
