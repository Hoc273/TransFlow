import { useCallback, useEffect, useRef, useState } from 'react'
import { apiResponse, type RequestOptions } from '@/lib/api/client'
import { ApiError } from '@/types/api'

export type SseConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'done'
  | 'error'

export type SseMessage<T> = {
  /** SSE `id:` field when the server assigns Event-IDs (A.5.5 resume). */
  id?: string
  event: string
  data: T
}

type UseSseHandlers<T> = {
  onEvent: (message: SseMessage<T>) => void
  onError?: (error: unknown) => void
}

export type SseResumeRequest = {
  path: string
  options?: RequestOptions
}

type ResumeContext<T> = {
  lastEventId: string | null
  lastMessage: SseMessage<T> | null
  attempt: number
}

type StartSseOptions = RequestOptions & {
  maxReconnectAttempts?: number
  reconnectDelayMs?: number
  /**
   * When the live stream drops before `done`, build a **resume** request
   * (typically `GET .../jobs/{id}/stream` + `Last-Event-ID`). Return null to
   * fall back to same-path reconnect (disabled for POST create by default).
   */
  resumeFrom?: (ctx: ResumeContext<unknown>) => SseResumeRequest | null
}

const DEFAULT_RECONNECTS = 3
const DEFAULT_RECONNECT_DELAY_MS = 1000

class SseEventError extends Error {}

/**
 * Authenticated SSE-over-fetch lifecycle for job streams.
 * Native EventSource cannot send the JSON body or Authorization header required
 * by the translation job create endpoint, so we parse the SSE framing ourselves.
 *
 * Resume contract (09b A.5.5):
 * - Server emits monotonic `id:` on every event.
 * - Client tracks `lastEventId` and, on disconnect, calls `resumeFrom` to open
 *   a GET resume stream with `Last-Event-ID` — never re-POST create.
 * - Application state (e.g. `streamingTokens`) is owned by the caller and is
 *   not cleared on reconnect.
 */
export function useSSE<T>({ onEvent, onError }: UseSseHandlers<T>) {
  const [status, setStatus] = useState<SseConnectionStatus>('idle')
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const mountedRef = useRef(true)
  const onEventRef = useRef(onEvent)
  const onErrorRef = useRef(onError)
  const lastEventIdRef = useRef<string | null>(null)
  const lastMessageRef = useRef<SseMessage<T> | null>(null)

  onEventRef.current = onEvent
  onErrorRef.current = onError

  const cancel = useCallback(() => {
    runIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    lastEventIdRef.current = null
    lastMessageRef.current = null
    if (mountedRef.current) {
      setStatus('idle')
      setReconnectAttempt(0)
    }
  }, [])

  const start = useCallback(
    async (path: string, options: StartSseOptions = {}) => {
      const runId = runIdRef.current + 1
      runIdRef.current = runId
      controllerRef.current?.abort()
      lastEventIdRef.current = null
      lastMessageRef.current = null

      const {
        maxReconnectAttempts = options.method === 'POST' ? 0 : DEFAULT_RECONNECTS,
        reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
        resumeFrom,
        ...requestOptions
      } = options

      let attempt = 0
      let currentPath = path
      let currentOptions: RequestOptions = { ...requestOptions }

      if (mountedRef.current) {
        setStatus('connecting')
        setReconnectAttempt(0)
      }

      while (runIdRef.current === runId) {
        const controller = new AbortController()
        controllerRef.current = controller

        // Attach Last-Event-ID for resume / same-path reconnect.
        const headers: Record<string, string> = {
          Accept: 'text/event-stream',
          ...currentOptions.headers,
        }
        if (lastEventIdRef.current && !headers['Last-Event-ID']) {
          headers['Last-Event-ID'] = lastEventIdRef.current
        }

        try {
          const response = await apiResponse(currentPath, {
            ...currentOptions,
            headers,
            signal: controller.signal,
          })

          if (!response.body) {
            throw new Error('Streaming response body is unavailable')
          }

          if (mountedRef.current && runIdRef.current === runId) {
            setStatus('open')
          }

          const completed = await consumeSseStream(response.body, (message) => {
            if (message.id) {
              lastEventIdRef.current = message.id
            }
            lastMessageRef.current = message as SseMessage<T>
            onEventRef.current(message as SseMessage<T>)
          })

          if (!completed) {
            throw new Error('Streaming connection closed before completion')
          }

          if (mountedRef.current && runIdRef.current === runId) {
            setStatus('done')
          }
          return
        } catch (error) {
          if (controller.signal.aborted || runIdRef.current !== runId) return

          const retryable =
            !(error instanceof SseEventError) &&
            (!(error instanceof ApiError) || error.status >= 500 || error.status === 0)

          if (!retryable) {
            if (mountedRef.current) setStatus('error')
            onErrorRef.current?.(error)
            throw error
          }

          // Prefer Event-ID resume (GET) over replaying the original request.
          // POST create sets maxReconnectAttempts=0 so it never re-creates a job.
          const resume =
            resumeFrom?.({
              lastEventId: lastEventIdRef.current,
              lastMessage: lastMessageRef.current,
              attempt,
            }) ?? null

          const usingResume = resume != null
          const attemptCap = usingResume
            ? Math.max(maxReconnectAttempts, DEFAULT_RECONNECTS)
            : maxReconnectAttempts

          if (attempt >= attemptCap) {
            if (mountedRef.current) setStatus('error')
            onErrorRef.current?.(error)
            throw error
          }

          attempt += 1
          if (usingResume && resume) {
            currentPath = resume.path
            const resumeHeaders: Record<string, string> = {
              ...(resume.options?.headers ?? {}),
            }
            if (lastEventIdRef.current) {
              resumeHeaders['Last-Event-ID'] = lastEventIdRef.current
            }
            currentOptions = {
              method: 'GET',
              ...resume.options,
              headers: resumeHeaders,
            }
          }

          if (mountedRef.current) {
            setStatus('reconnecting')
            setReconnectAttempt(attempt)
          }
          await wait(reconnectDelayMs * 2 ** (attempt - 1))
        }
      }
    },
    [],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
      controllerRef.current?.abort()
    }
  }, [])

  return { start, cancel, status, reconnectAttempt }
}

async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage<unknown>) => void,
): Promise<boolean> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const message = parseSseBlock(block)
      if (message) {
        if (message.event === 'error') {
          const data = message.data as { message?: string }
          throw new SseEventError(data?.message || 'Streaming translation failed')
        }
        onMessage(message)
        if (message.event === 'done') return true
      }
      boundary = buffer.indexOf('\n\n')
    }

    if (done) return false
  }
}

function parseSseBlock(block: string): SseMessage<unknown> | null {
  let event = 'message'
  let id: string | undefined
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('id:')) {
      id = line.slice(3).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (!dataLines.length) return null
  const raw = dataLines.join('\n')
  try {
    return { id, event, data: JSON.parse(raw) as unknown }
  } catch {
    return { id, event, data: raw }
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
