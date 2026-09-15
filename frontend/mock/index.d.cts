import type { IncomingMessage, ServerResponse } from 'node:http'

export declare function createMockMiddleware(): (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void
