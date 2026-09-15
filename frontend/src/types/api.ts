/** Normalized client error shape (09b A.5.0 + provider error extension). */
export type ApiErrorShape = {
  status: number
  /** Machine-readable error code from the ProviderErrorCode catalog. */
  errorCode?: string
  /** Legacy code field — still populated for non-provider errors. */
  code: string
  /** Short human-readable title (e.g. "Rate Limited"). */
  title?: string
  message: string
  /** Structured key-value details about the failure. */
  details?: Record<string, string> | null
  /** Provider base URL involved. */
  provider?: string | null
  /** Protocol involved (openai_compatible, anthropic, etc.). */
  protocol?: string | null
  /** Capability involved (TRANSLATE, STT, TTS, EMBED, SUMMARIZE). */
  capability?: string | null
  /** Whether the error is retryable in principle. */
  retryable?: boolean
  /** Actionable suggestion for the user. */
  recommendedAction?: string | null
  /** Link to relevant documentation. */
  documentation?: string | null
  fieldErrors?: Record<string, string>
  path?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly errorCode: string
  readonly code: string
  readonly title?: string
  readonly details?: Record<string, string> | null
  readonly provider?: string | null
  readonly protocol?: string | null
  readonly capability?: string | null
  readonly retryable: boolean
  readonly recommendedAction?: string | null
  readonly documentation?: string | null
  readonly fieldErrors?: Record<string, string>
  readonly path?: string

  constructor(shape: ApiErrorShape) {
    super(shape.message)
    this.name = 'ApiError'
    this.status = shape.status
    this.errorCode = shape.errorCode ?? shape.code
    this.code = shape.code
    this.title = shape.title
    this.details = shape.details
    this.provider = shape.provider
    this.protocol = shape.protocol
    this.capability = shape.capability
    this.retryable = shape.retryable ?? false
    this.recommendedAction = shape.recommendedAction
    this.documentation = shape.documentation
    this.fieldErrors = shape.fieldErrors
    this.path = shape.path
  }

  toShape(): ApiErrorShape {
    return {
      status: this.status,
      errorCode: this.errorCode,
      code: this.code,
      title: this.title,
      message: this.message,
      details: this.details,
      provider: this.provider,
      protocol: this.protocol,
      capability: this.capability,
      retryable: this.retryable,
      recommendedAction: this.recommendedAction,
      documentation: this.documentation,
      fieldErrors: this.fieldErrors,
      path: this.path,
    }
  }
}

/** Spring Boot ApiError body (legacy) or ProviderErrorResponse body (new). */
export type SpringApiErrorBody = {
  timestamp?: string
  status?: number
  error?: string
  message?: string
  path?: string
  fieldErrors?: Record<string, string> | null
  /** Machine-readable code on the Spring `ApiError` shape (e.g. STYLE_NOT_FOUND). */
  code?: string
  // ProviderErrorResponse fields
  errorCode?: string
  title?: string
  details?: Record<string, string> | null
  provider?: string | null
  protocol?: string | null
  capability?: string | null
  retryable?: boolean
  recommendedAction?: string | null
  documentation?: string | null
}
