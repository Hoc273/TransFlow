import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { GuestGuard } from '@/components/auth/GuestGuard'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { RouteErrorBoundary } from '@/components/error/RouteErrorBoundary'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'

const LandingPage = lazy(() => import('@/pages/landing/LandingPage').then(m => ({ default: m.LandingPage })))
const LegacyLandingPage = lazy(() => import('@/pages/landing/LegacyLandingPage').then(m => ({ default: m.LegacyLandingPage })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const GoogleAuthDonePage = lazy(() => import('@/pages/auth/GoogleAuthDonePage').then(m => ({ default: m.GoogleAuthDonePage })))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const UsagePage = lazy(() => import('@/pages/dashboard/UsagePage').then(m => ({ default: m.UsagePage })))
const MediaListPage = lazy(() => import('@/pages/media/MediaListPage').then(m => ({ default: m.MediaListPage })))
const MediaJobPage = lazy(() => import('@/pages/media/MediaJobPage').then(m => ({ default: m.MediaJobPage })))
const NoWorkspacePage = lazy(() => import('@/pages/workspace/NoWorkspacePage').then(m => ({ default: m.NoWorkspacePage })))
const MembersPage = lazy(() => import('@/pages/settings/MembersPage').then(m => ({ default: m.MembersPage })))
const PresetSettingsPage = lazy(() => import('@/pages/settings/PresetSettingsPage').then(m => ({ default: m.PresetSettingsPage })))
const AccountSettingsPage = lazy(() => import('@/pages/account/AccountSettingsPage').then(m => ({ default: m.AccountSettingsPage })))
const BatchListPage = lazy(() => import('@/pages/batch/BatchListPage').then(m => ({ default: m.BatchListPage })))
const BatchDetailPage = lazy(() => import('@/pages/batch/BatchDetailPage').then(m => ({ default: m.BatchDetailPage })))
const ProjectListPage = lazy(() => import('@/pages/project/ProjectListPage').then(m => ({ default: m.ProjectListPage })))
const NotificationCenterPage = lazy(() => import('@/pages/notification/NotificationCenterPage').then(m => ({ default: m.NotificationCenterPage })))
const GlossaryPage = lazy(() => import('@/pages/glossary/GlossaryPage').then(m => ({ default: m.GlossaryPage })))
const PlatformShell = lazy(() => import('@/components/platform/PlatformShell').then(m => ({ default: m.PlatformShell })))
const PlatformAdminGuard = lazy(() => import('@/components/platform/PlatformAdminGuard').then(m => ({ default: m.PlatformAdminGuard })))
const PlatformOverviewPage = lazy(() => import('@/pages/platform/PlatformOverviewPage').then(m => ({ default: m.PlatformOverviewPage })))
const PlatformStatusPage = lazy(() => import('@/pages/platform/PlatformStatusPage').then(m => ({ default: m.PlatformStatusPage })))
const PlatformUsersPage = lazy(() => import('@/pages/platform/PlatformUsersPage').then(m => ({ default: m.PlatformUsersPage })))
const PlatformWorkspacesPage = lazy(() => import('@/pages/platform/PlatformWorkspacesPage').then(m => ({ default: m.PlatformWorkspacesPage })))
const PlatformAuditPage = lazy(() => import('@/pages/platform/PlatformAuditPage').then(m => ({ default: m.PlatformAuditPage })))

function WorkspaceRouteBoundary({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams()
  return <RouteErrorBoundary workspaceId={workspaceId}>{children}</RouteErrorBoundary>
}

function DashboardRedirect() {
  const current = useAuthStore((s) => s.currentWorkspace?.id)
  const last = getLastWorkspaceId()
  const token = useAuthStore((s) => s.accessToken)
  if (!token) return <Navigate to="/login" replace />
  const id = current ?? last
  if (id) return <Navigate to={`/w/${id}`} replace />
  return <Navigate to="/no-workspace" replace />
}

function PageLoader() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/qwencloud" element={<Navigate to="/" replace />} />
        <Route path="/legacy-landing" element={<LegacyLandingPage />} />

        <Route element={<GuestGuard />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        </Route>

        {/* Google OAuth return — public; exchange only when flag + BE ready (09b B.1b) */}
        <Route path="/auth/google/done" element={<GoogleAuthDonePage />} />

        <Route
          path="/no-workspace"
          element={
            <AuthOnly>
              <NoWorkspacePage />
            </AuthOnly>
          }
        />

        <Route element={<AuthGuard />}>
          <Route path="/w/:workspaceId" element={<AppShell />}>
            <Route
              index
              element={
                <WorkspaceRouteBoundary>
                  <DashboardPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="notifications"
              element={
                <WorkspaceRouteBoundary>
                  <NotificationCenterPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="projects"
              element={
                <WorkspaceRouteBoundary>
                  <ProjectListPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="projects/:projectId/documents"
              element={<Navigate to="../media" replace />}
            />
            <Route
              path="documents/:documentId/jobs"
              element={<Navigate to="../media" replace />}
            />
            <Route
              path="jobs/:jobId/editor"
              element={<Navigate to="../media" replace />}
            />
            <Route
              path="batches"
              element={
                <WorkspaceRouteBoundary>
                  <BatchListPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="batches/:batchId"
              element={
                <WorkspaceRouteBoundary>
                  <BatchDetailPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="glossaries"
              element={
                <WorkspaceRouteBoundary>
                  <GlossaryPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="tm"
              element={<Navigate to="../glossaries" replace />}
            />
            <Route
              path="media"
              element={
                <WorkspaceRouteBoundary>
                  <MediaListPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="media/presets"
              element={
                <WorkspaceRouteBoundary>
                  <PresetSettingsPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="media/jobs/:jobId"
              element={
                <WorkspaceRouteBoundary>
                  <MediaJobPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="creative/*"
              element={<Navigate to="../media" replace />}
            />
            <Route
              path="dashboard/usage"
              element={
                <WorkspaceRouteBoundary>
                  <RoleGuard action="dashboard.usage">
                    <UsagePage />
                  </RoleGuard>
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="settings/members"
              element={
                <WorkspaceRouteBoundary>
                  <MembersPage />
                </WorkspaceRouteBoundary>
              }
            />
            <Route
              path="settings/provider"
              element={<Navigate to="../account/security" replace />}
            />
            <Route
              path="settings/media-presets"
              element={<Navigate to="../media/presets" replace />}
            />
            {/* User-level Account Settings (Profile and Setting template) */}
            <Route path="account" element={<AccountIndexRedirect />} />
            <Route
              path="account/:section"
              element={
                <WorkspaceRouteBoundary>
                  <AccountSettingsPage />
                </WorkspaceRouteBoundary>
              }
            />
          </Route>
        </Route>

        <Route path="/dashboard" element={<DashboardRedirect />} />

        {/* Platform Super Admin */}
        <Route element={<PlatformAdminGuard />}>
          <Route path="/platform" element={<PlatformShell />}>
            <Route index element={<PlatformOverviewPage />} />
            <Route path="status" element={<PlatformStatusPage />} />
            <Route path="users" element={<PlatformUsersPage />} />
            <Route path="workspaces" element={<PlatformWorkspacesPage />} />
            <Route path="audit" element={<PlatformAuditPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

/** Minimal token gate for routes outside AuthGuard workspace tree. */
function AuthOnly({ children }: { children: ReactNode }) {
  const token = useAuthStore((s) => s.accessToken)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AccountIndexRedirect() {
  const { workspaceId } = useParams()
  return <Navigate to={`/w/${workspaceId}/account/profile`} replace />
}
