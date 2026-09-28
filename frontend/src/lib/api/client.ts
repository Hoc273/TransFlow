import { apiBaseUrl } from '@/config/featureFlags'
import { clearAuthAndRedirect, useAuthStore } from '@/store/authStore'
import { ApiError, type SpringApiErrorBody } from '@/types/api'

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
  /**
   * Bytes of the request body sent so far. fetch() cannot report upload progress, so a request
   * with this callback goes through XMLHttpRequest; auth/refresh handling stays the same.
   */
  onUploadProgress?: (loadedBytes: number) => void
}

/** fetch()-compatible transport over XHR, only to observe upload progress. */
function xhrFetch(url: string, init: RequestInit, onUploadProgress: (loaded: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init.signal
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const xhr = new XMLHttpRequest()
    xhr.open(init.method ?? 'GET', url)
    xhr.withCredentials = init.credentials === 'include'
    xhr.responseType = 'blob'
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.onprogress = (e) => onUploadProgress(e.loaded)
    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => signal?.removeEventListener('abort', onAbort)
    xhr.onload = () => {
      done()
      const headers = new Headers()
      for (const row of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const at = row.indexOf(':')
        if (at > 0) headers.append(row.slice(0, at).trim(), row.slice(at + 1).trim())
      }
      // Null-body statuses (204/205/304) reject a body in the Response constructor.
      const body = [204, 205, 304].includes(xhr.status) ? null : (xhr.response as Blob)
      resolve(new Response(body, { status: xhr.status, statusText: xhr.statusText, headers }))
    }
    // Same failure shapes as fetch: TypeError on network loss, AbortError on abort.
    xhr.onerror = () => { done(); reject(new TypeError('Network request failed')) }
    xhr.ontimeout = xhr.onerror
    xhr.onabort = () => { done(); reject(new DOMException('Aborted', 'AbortError')) }
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null)
  })
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

/**
 * - refreshed: a new access token is stored
 * - rejected: the server refused the refresh token (expired/revoked/disabled) → session is over
 * - unavailable: network error, 5xx or 429 → the session may still be valid, do NOT log out
 */
type RefreshOutcome = 'refreshed' | 'rejected' | 'unavailable'

let refreshInFlight: Promise<RefreshOutcome> | null = null

/** Shared single-flight refresh (HttpOnly cookie). */
async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async (): Promise<RefreshOutcome> => {
    try {
      // The refresh token rides in the HttpOnly cookie; the backend rotates it on success.
      const res = await fetch(`${apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      })
      if (res.status === 401 || res.status === 403) return 'rejected'
      if (!res.ok) return 'unavailable'
      const raw = await res.json()
      const data =
        raw && typeof raw === 'object' && typeof raw.code === 'number' && 'data' in raw
          ? (raw.data as { accessToken?: string })
          : (raw as { accessToken?: string })

      if (data?.accessToken) {
        useAuthStore.getState().setAccessToken(data.accessToken)
        return 'refreshed'
      }
      return 'rejected'
    } catch {
      return 'unavailable'
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

/**
 * Decide what to do after a request sent with `tokenUsed` got 401:
 * - retry: another request already rotated the token, or the refresh succeeded
 * - expired: the refresh token was rejected → caller logs out
 * - unavailable: the refresh endpoint could not be reached → keep the session, surface an error
 */
async function recoverFromUnauthorized(
  tokenUsed: string | null,
): Promise<'retry' | 'expired' | 'unavailable'> {
  const current = useAuthStore.getState().accessToken
  if (current && current !== tokenUsed) return 'retry'
  const outcome = await refreshAccessToken()
  if (outcome === 'refreshed') return 'retry'
  return outcome === 'rejected' ? 'expired' : 'unavailable'
}

/** Thrown when a 401 could not be recovered because the refresh endpoint was unreachable. */
function sessionRefreshUnavailableError(path: string): ApiError {
  return new ApiError({
    status: 503,
    errorCode: 'SESSION_REFRESH_UNAVAILABLE',
    code: 'SESSION_REFRESH_UNAVAILABLE',
    message: 'Could not renew the session. Check your connection and try again.',
    retryable: true,
    path,
  })
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
    onUploadProgress,
  } = options

  const url = path.startsWith('http') ? path : `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`

  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  }

  const tokenUsed = skipAuth ? null : useAuthStore.getState().accessToken
  if (tokenUsed) reqHeaders.Authorization = `Bearer ${tokenUsed}`

  let payload: BodyInit | undefined
  if (body !== undefined && body !== null) {
    if (rawBody) {
      payload = body as BodyInit
    } else {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] ?? 'application/json'
      payload = JSON.stringify(body)
    }
  }

  // credentials: login/register/google-exchange responses set the refresh cookie.
  const init: RequestInit = { method, headers: reqHeaders, body: payload, signal, credentials: 'include' }
  const res = onUploadProgress ? await xhrFetch(url, init, onUploadProgress) : await fetch(url, init)

  if (res.status === 401 && !skipAuth && !skipRefresh) {
    const next = await recoverFromUnauthorized(tokenUsed)
    if (next === 'retry') {
      return apiResponse(path, { ...options, skipRefresh: true })
    }
    if (next === 'unavailable') {
      throw sessionRefreshUnavailableError(url)
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
