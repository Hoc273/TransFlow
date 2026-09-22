import { apiBaseUrl } from '@/config/featureFlags'
import { clearAuthAndRedirect, useAuthStore } from '@/store/authStore'
import { ApiError, type SpringApiErrorBody } from '@/types/api'
import type { AuthResponse } from '@/types/auth'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  /** Extra headers (Content-Type set automatically for JSON bodies). */
  headers?: Record<string, string>
  /** Skip Authorization header (login/register/refresh). */
  skipAuth?: boolean
  /** Skip 401 → refresh → retry (used by refresh itself). */
  skipRefresh?: boolean
  /** AbortSignal */
  signal?: AbortSignal
  /** When true, do not JSON-stringify body (FormData / Blob). */
  rawBody?: boolean
}

function codeFromStatus(status: number): string {
  if (status === 429) return 'RATE_LIMITED'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status >= 500) return 'SERVER_ERROR'
  return `HTTP_${status}`
}

async function parseError(res: Response, requestPath: string): Promise<ApiError> {
  let body: SpringApiErrorBody | undefined
  try {
    body = (await res.json()) as SpringApiErrorBody
  } catch {
    body = undefined
  }

  // Prefer structured codes from the server body over HTTP-status heuristics.
  // `errorCode` is the ProviderErrorResponse shape; `code` is the ApiError shape
  // used by coded endpoints (e.g. STYLE_NOT_FOUND) — without it those collapse
  // into a generic NOT_FOUND and callers cannot branch on them.
  const rawCode = body?.errorCode || body?.code
  const errorCode = rawCode !== undefined ? String(rawCode) : codeFromStatus(res.status)

  const isBatchCreate =
    res.status === 429 && /\/batches(?:\?|$)/.test(requestPath) && !requestPath.includes('/documents/')

  const fieldErrors =
    body?.fieldErrors ??
    (body && 'data' in body && typeof (body as any).data === 'object' && !Array.isArray((body as any).data)
      ? ((body as any).data as Record<string, string>)
      : undefined)

  return new ApiError({
    status: res.status,
    errorCode: isBatchCreate ? 'RATE_LIMITED' : errorCode,
    code: isBatchCreate ? 'RATE_LIMITED' : errorCode,
    title: body?.title,
    message: body?.message || res.statusText || 'Request failed',
    details: body?.details ?? undefined,
    provider: body?.provider ?? undefined,
    protocol: body?.protocol ?? undefined,
    capability: body?.capability ?? undefined,
    retryable: body?.retryable ?? undefined,
    recommendedAction: body?.recommendedAction ?? undefined,
    documentation: body?.documentation ?? undefined,
    fieldErrors,
    path: body?.path || requestPath,
  })
}

let refreshInFlight: Promise<boolean> | null = null

async function tryRefreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (!refreshToken) return false

    try {
      const res = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) return false
      const data = (await res.json()) as AuthResponse
      useAuthStore.getState().setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      })
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * Single API client for the SPA (09b A.5.0).
 * Screens must not call this directly — use React Query hooks.
 */
export async function apiResponse(path: string, options: RequestOptions = {}): Promise<Response> {
  const {
    method = 'GET',
    body,
    headers = {},
    skipAuth = false,
    skipRefresh = false,
    signal,
    rawBody = false,
  } = options

  const url = path.startsWith('http') ? path : `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`

  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  }

  if (!skipAuth) {
    const token = useAuthStore.getState().accessToken
    if (token) reqHeaders.Authorization = `Bearer ${token}`
  }

  let payload: BodyInit | undefined
  if (body !== undefined && body !== null) {
    if (rawBody) {
      payload = body as BodyInit
    } else {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] ?? 'application/json'
      payload = JSON.stringify(body)
    }
  }

  const res = await fetch(url, { method, headers: reqHeaders, body: payload, signal })

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    const refreshed = await tryRefreshAccessToken()
    if (refreshed) {
      return apiResponse(path, { ...options, skipRefresh: true })
    }
    clearAuthAndRedirect()
    throw new ApiError({
      status: 401,
      errorCode: 'UNAUTHORIZED',
      code: 'UNAUTHORIZED',
      message: 'Session expired',
      path: url,
    })
  }

  if (!res.ok) {
    throw await parseError(res, path)
  }

  return res
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await apiResponse(path, options)

  if (res.status === 204) {
    return undefined as T
  }

  const text = await res.text()
  if (!text) return undefined as T

  try {
    const json = JSON.parse(text)
    // Automatically unwrap Spring Boot ApiResponse envelope: { code: 1000, data: T }
    if (
      json !== null &&
      typeof json === 'object' &&
      typeof json.code === 'number' &&
      'data' in json
    ) {
      return json.data as T
    }
    return json as T
  } catch {
    return text as unknown as T
  }
}

export function buildWorkspacePath(workspaceId: string, suffix = ''): string {
  const clean = suffix.startsWith('/') ? suffix : suffix ? `/${suffix}` : ''
  return `/workspaces/${workspaceId}${clean}`
}
