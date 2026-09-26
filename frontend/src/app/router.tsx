import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGuard } from '@/components/auth/AuthGuard'
import { GuestGuard } from '@/components/auth/GuestGuard'
import { getLastWorkspaceId, useAuthStore } from '@/store/authStore'
import { MobileWorkspaceAdapter } from '@/mobile/routes/MobileWorkspaceAdapter'

const LandingPage = lazy(() => import('@/pages/landing/LandingPage').then(m => ({ default: m.LandingPage })))
const LegacyLandingPage = lazy(() => import('@/pages/landing/LegacyLandingPage').then(m => ({ default: m.LegacyLandingPage })))
const GuidePage = lazy(() => import('@/pages/guide/GuidePage').then(m => ({ default: m.GuidePage })))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const GoogleAuthDonePage = lazy(() => import('@/pages/auth/GoogleAuthDonePage').then(m => ({ default: m.GoogleAuthDonePage })))
const NoWorkspacePage = lazy(() => import('@/pages/workspace/NoWorkspacePage').then(m => ({ default: m.NoWorkspacePage })))
const PlatformShell = lazy(() => import('@/components/platform/PlatformShell').then(m => ({ default: m.PlatformShell })))
const PlatformAdminGuard = lazy(() => import('@/components/platform/PlatformAdminGuard').then(m => ({ default: m.PlatformAdminGuard })))
const PlatformOverviewPage = lazy(() => import('@/pages/platform/PlatformOverviewPage').then(m => ({ default: m.PlatformOverviewPage })))
const PlatformStatusPage = lazy(() => import('@/pages/platform/PlatformStatusPage').then(m => ({ default: m.PlatformStatusPage })))
const PlatformUsersPage = lazy(() => import('@/pages/platform/PlatformUsersPage').then(m => ({ default: m.PlatformUsersPage })))
const PlatformWorkspacesPage = lazy(() => import('@/pages/platform/PlatformWorkspacesPage').then(m => ({ default: m.PlatformWorkspacesPage })))
const PlatformAuditPage = lazy(() => import('@/pages/platform/PlatformAuditPage').then(m => ({ default: m.PlatformAuditPage })))
const PlatformProvidersPage = lazy(() => import('@/pages/platform/PlatformProvidersPage').then(m => ({ default: m.PlatformProvidersPage })))
const PlatformPricingPage = lazy(() => import('@/pages/platform/PlatformPricingPage').then(m => ({ default: m.PlatformPricingPage })))
const GuideAdminPage = lazy(() => import('@/pages/platform/GuideAdminPage').then(m => ({ default: m.GuideAdminPage })))

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
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/:slug" element={<GuidePage />} />

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

        {/* Platform Super Admin */}
        <Route element={<PlatformAdminGuard />}>
          <Route path="/platform" element={<PlatformShell />}>
            <Route index element={<PlatformOverviewPage />} />
            <Route path="status" element={<PlatformStatusPage />} />
            <Route path="users" element={<PlatformUsersPage />} />
            <Route path="workspaces" element={<PlatformWorkspacesPage />} />
            <Route path="providers" element={<PlatformProvidersPage />} />
            <Route path="pricing" element={<PlatformPricingPage />} />
            <Route path="audit" element={<PlatformAuditPage />} />
            <Route path="guides" element={<GuideAdminPage />} />
          </Route>
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
