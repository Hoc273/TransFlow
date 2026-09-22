import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { GuestGuard } from '@/components/auth/GuestGuard'
import { PlatformGuard } from '@/components/platform/PlatformGuard'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'
import { MobileWorkspaceAdapter } from '@/mobile/routes/MobileWorkspaceAdapter'

const LandingPage = lazy(() => import('@/pages/landing/LandingPage').then(m => ({ default: m.LandingPage })))
const LegacyLandingPage = lazy(() => import('@/pages/landing/LegacyLandingPage').then(m => ({ default: m.LegacyLandingPage })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const GoogleAuthDonePage = lazy(() => import('@/pages/auth/GoogleAuthDonePage').then(m => ({ default: m.GoogleAuthDonePage })))
const NoWorkspacePage = lazy(() => import('@/pages/workspace/NoWorkspacePage').then(m => ({ default: m.NoWorkspacePage })))
const PlatformLayout = lazy(() => import('@/pages/platform/PlatformLayout').then(m => ({ default: m.PlatformLayout })))
const PlatformOverviewPage = lazy(() => import('@/pages/platform/OverviewPage').then(m => ({ default: m.OverviewPage })))
const PlatformStatusPage = lazy(() => import('@/pages/platform/StatusPage').then(m => ({ default: m.StatusPage })))
const PlatformUsersPage = lazy(() => import('@/pages/platform/UsersPage').then(m => ({ default: m.UsersPage })))
const PlatformWorkspacesPage = lazy(() => import('@/pages/platform/WorkspacesPage').then(m => ({ default: m.WorkspacesPage })))
const PlatformAuditPage = lazy(() => import('@/pages/platform/AuditPage').then(m => ({ default: m.AuditPage })))

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
          <Route path="/auth/login" element={<Navigate to="/login" replace />} />
          <Route path="/auth/register" element={<Navigate to="/register" replace />} />
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
          <Route path="/w/:workspaceId/*" element={<MobileWorkspaceAdapter />} />
        </Route>

        <Route path="/dashboard" element={<DashboardRedirect />} />

        {/* Platform Super Admin — top-level, no workspace scope (API_Contract §13.1) */}
        <Route path="/platform" element={<PlatformGuard><PlatformLayout /></PlatformGuard>}>
          <Route index element={<PlatformOverviewPage />} />
          <Route path="status" element={<PlatformStatusPage />} />
          <Route path="users" element={<PlatformUsersPage />} />
          <Route path="workspaces" element={<PlatformWorkspacesPage />} />
          <Route path="audit" element={<PlatformAuditPage />} />
        </Route>

        {/* Legacy top-level redirects */}
        <Route path="/tm/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/documents/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/creative/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/jobs/*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/editor/*" element={<Navigate to="/dashboard" replace />} />

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
