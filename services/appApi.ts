import * as Crypto from 'expo-crypto'
import { AUTH_BASE_URL } from './appConfig'
import {
  loadAuthSession,
  saveAuthSession,
  refreshAuthSession,
  clearAuthSession,
  type AuthSession,
} from './authService'

type QueryValue = string | number | boolean | null | undefined

interface AppRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  json?: Record<string, unknown>
  formData?: FormData
  headers?: Record<string, string>
  timeoutMs?: number | null
  /**
   * Explicit workspace scope for this request. When omitted, the module-level
   * active workspace (set by WorkspaceContext via `setRequestWorkspaceId`) is
   * sent as `x-overlay-workspace-id`; the server falls back to the user's
   * stored active workspace when no header is present.
   */
  workspaceId?: string | null
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export const ACTIVE_WORKSPACE_HEADER = 'x-overlay-workspace-id'

let requestWorkspaceId: string | null = null

/**
 * Sets the workspace id attached to every appRequest/appFetch call.
 * WorkspaceContext calls this whenever the active workspace changes (or is
 * cleared on sign-out). Pass `null` to clear — the server then resolves the
 * user's stored active workspace.
 */
export function setRequestWorkspaceId(workspaceId: string | null): void {
  requestWorkspaceId = workspaceId && workspaceId.trim().length > 0 ? workspaceId.trim() : null
}

export function getRequestWorkspaceId(): string | null {
  return requestWorkspaceId
}

/** Typed API error so screens can branch on status/code instead of message text. */
export class OverlayApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'OverlayApiError'
    this.status = status
    this.code = code
  }

  get isAuthError(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isBudgetExceeded(): boolean {
    return this.status === 402
  }

  get isRateLimited(): boolean {
    return this.status === 429
  }
}

function createUrl(
  path: string,
  session: AuthSession | null,
  query?: Record<string, QueryValue>,
): string {
  const url = new URL(path.startsWith('http') ? path : `${AUTH_BASE_URL}${path}`)
  if (session?.user.id) {
    url.searchParams.set('userId', session.user.id)
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

// How many ms before the actual expiry we consider a token "about to expire"
// and proactively refresh it. Must stay well below the token's real lifetime
// (~5 min observed): at 5 min the check is true at every point in the token's
// life, so every request triggers a refresh and the rate-limited refresh
// endpoint (12/10min) returns 429s.
const TOKEN_REFRESH_BUFFER_MS = 45 * 1000

// After a refresh failure, don't hit the endpoint again for this long — the
// server rate-limits refreshes, so a tight retry loop makes things worse.
const REFRESH_FAILURE_COOLDOWN_MS = 60 * 1000

// Server endpoints that mutate user-owned, owner-funded state require an
// Idempotency-Key header (HTTP 428 without one). The key must stay stable
// across retries of the same logical operation; callers may pass their own
// via options.headers, otherwise we generate one per request.
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key'
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING_METHODS.has((method ?? 'GET').toUpperCase())
}

function withIdempotencyKey(headers: Headers, method: string | undefined): void {
  if (!isMutatingMethod(method)) return
  if (headers.has(IDEMPOTENCY_KEY_HEADER)) return
  headers.set(IDEMPOTENCY_KEY_HEADER, Crypto.randomUUID())
}

function withIdempotencyKeyRecord(
  headers: Record<string, string>,
  method: string | undefined,
): void {
  if (!isMutatingMethod(method)) return
  const existing = Object.keys(headers).find(
    (k) => k.toLowerCase() === IDEMPOTENCY_KEY_HEADER.toLowerCase(),
  )
  if (existing) return
  headers[IDEMPOTENCY_KEY_HEADER] = Crypto.randomUUID()
}

function decodeJwtExpMs(token: string | undefined): number {
  if (!token) return 0
  try {
    const payload = token.split('.')[1]
    if (!payload) return 0
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64)) as { exp?: unknown }
    return typeof json.exp === 'number' ? json.exp * 1000 : 0
  } catch {
    return 0
  }
}

/**
 * When the token actually stops working. The server sets `expiresAt` to the
 * long-lived session-cookie horizon (~30 days) on some auth paths, while the
 * underlying WorkOS access token is a JWT that dies after ~15 minutes —
 * trusting `expiresAt` alone leaves dead tokens in place until every call
 * starts 401ing. The JWT `exp` claim is the source of truth when present.
 */
function getSessionExpiryMs(session: AuthSession): number {
  const jwtExp = decodeJwtExpMs(session.accessToken)
  const stored = session.expiresAt ?? 0
  if (jwtExp && stored) return Math.min(jwtExp, stored)
  return jwtExp || stored
}

let refreshInFlight: Promise<AuthSession | null> | null = null
let refreshCooldownUntil = 0
// Whether the last refresh failed because the server rejected the refresh
// token itself (401/403) — the only failure that justifies signing the user
// out. Rate limits, 5xx and network errors are transient.
let lastRefreshAuthRejected = false

async function refreshStoredSession(session: AuthSession): Promise<AuthSession | null> {
  if (Date.now() < refreshCooldownUntil) {
    console.log('[appApi] refresh skipped: cooling down after recent failure')
    return null
  }
  if (!refreshInFlight) {
    lastRefreshAuthRejected = false
    refreshInFlight = (async () => {
      try {
        const refreshed = await refreshAuthSession(session)
        await saveAuthSession(refreshed)
        return refreshed
      } catch (error) {
        const status = (error as { status?: number }).status
        lastRefreshAuthRejected = status === 401 || status === 403
        refreshCooldownUntil = Date.now() + REFRESH_FAILURE_COOLDOWN_MS
        console.error('[appApi] token refresh failed', error)
        return null
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

/**
 * Return a session with a still-valid access token, refreshing it proactively
 * if it has expired (or is about to expire). Only a definitive rejection of
 * the refresh token (401/403) clears the stored session — transient failures
 * (rate limit, 5xx, offline) return the stale session so the request can try
 * anyway and the 401-retry path decides the outcome.
 */
async function getValidSession(): Promise<AuthSession | null> {
  const session = await loadAuthSession()
  if (!session) return null

  const now = Date.now()
  const expiresAt = getSessionExpiryMs(session)

  // If we don't know when the token expires (legacy session from before the
  // expiresAt field was added, or a non-JWT token), still try to refresh it
  // once so we get a session that DOES carry an expiry.
  if (!expiresAt) {
    console.log('[appApi] getValidSession: no expiry known, forcing refresh')
    const refreshed = await refreshStoredSession(session)
    if (refreshed) return refreshed
    if (lastRefreshAuthRejected) {
      await clearAuthSession()
      throw new Error('Session expired. Please sign in again.')
    }
    return session
  }

  // Token is still valid (with buffer) — use it as-is.
  if (expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
    return session
  }

  // Token has expired or is about to expire — refresh it.
  console.log(
    '[appApi] getValidSession: token expiring (expiresAt=%d now=%d), refreshing',
    expiresAt,
    now,
  )
  const refreshed = await refreshStoredSession(session)
  if (refreshed) {
    console.log('[appApi] getValidSession: refresh succeeded')
    return refreshed
  }
  if (lastRefreshAuthRejected) {
    await clearAuthSession()
    throw new Error('Session expired. Please sign in again.')
  }
  // Transient failure (429, 5xx, offline): keep the stored session — the
  // request goes out with the stale token, and the 401-retry path decides
  // the outcome without signing the user out over a hiccup.
  return session
}

/**
 * A 401 can still slip through (token revoked server-side, skew between the
 * JWT exp and the server's validation, or a request in flight across the
 * refresh boundary). Give it one refresh+retry before surfacing the error.
 */
async function tryRefreshAfter401(): Promise<AuthSession | null> {
  const session = await loadAuthSession()
  if (!session) return null
  const refreshed = await refreshStoredSession(session)
  if (!refreshed && lastRefreshAuthRejected) {
    await clearAuthSession()
  }
  return refreshed
}

function resolveWorkspaceId(options: AppRequestOptions): string | null {
  const workspaceId =
    options.workspaceId === undefined ? requestWorkspaceId : options.workspaceId
  return workspaceId && workspaceId.trim().length > 0 ? workspaceId.trim() : null
}

export async function appRequest(
  path: string,
  options: AppRequestOptions = {},
): Promise<Response> {
  const method = options.method ?? 'GET'
  const workspaceId = resolveWorkspaceId(options)
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const doFetch = async (session: AuthSession | null): Promise<Response> => {
    const headers = new Headers(options.headers)
    if (session?.accessToken) {
      headers.set('Authorization', `Bearer ${session.accessToken}`)
    }
    if (workspaceId) {
      headers.set(ACTIVE_WORKSPACE_HEADER, workspaceId)
    }
    withIdempotencyKey(headers, method)

    let body: BodyInit | undefined
    if (options.formData) {
      body = options.formData
    } else if (options.json) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify({
        ...options.json,
        accessToken: session?.accessToken,
        userId: session?.user.id,
      })
    }

    const requestUrl = createUrl(path, session, options.query)
    const controller = timeoutMs > 0 ? new AbortController() : null
    const timer = controller
      ? setTimeout(() => {
          console.warn(
            '[appApi] request timed out after %d ms: %s',
            timeoutMs,
            requestUrl,
          )
          controller.abort()
        }, timeoutMs)
      : null

    try {
      return await fetch(requestUrl, {
        method,
        headers,
        body,
        signal: controller?.signal,
      })
    } finally {
      if (timer) {
        clearTimeout(timer)
      }
    }
  }

  let session = await getValidSession()
  let response = await doFetch(session)
  if (response.status === 401 && session) {
    const refreshed = await tryRefreshAfter401()
    if (refreshed) {
      response = await doFetch(refreshed)
    }
  }
  return response
}

export async function appFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const path =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  const doFetch = (session: AuthSession | null): Promise<Response> => {
    const headers = new Headers(init.headers)
    if (session?.accessToken) {
      headers.set('Authorization', `Bearer ${session.accessToken}`)
    }
    // RequestInit has no workspaceId option — callers scoping to a different
    // workspace set the header themselves; otherwise the module default applies.
    if (requestWorkspaceId && !headers.has(ACTIVE_WORKSPACE_HEADER)) {
      headers.set(ACTIVE_WORKSPACE_HEADER, requestWorkspaceId)
    }
    withIdempotencyKey(headers, init.method)
    return fetch(createUrl(path, session), { ...init, headers })
  }

  const session = await getValidSession()
  let response = await doFetch(session)
  if (response.status === 401 && session) {
    const refreshed = await tryRefreshAfter401()
    if (refreshed) {
      response = await doFetch(refreshed)
    }
  }
  return response
}

export async function appJson<T>(
  path: string,
  options: AppRequestOptions = {},
): Promise<T> {
  const response = await appRequest(path, options)
  if (!response.ok) {
    throw await toOverlayApiError(response)
  }
  return response.json() as Promise<T>
}

// Keys servers have used to wrap list payloads. The BFF contract differs by
// route version and query params (?view= paginates into {data, nextCursor},
// some lists nest under their resource name) — normalizing here keeps one
// badly-shaped list from crashing an entire screen.
const LIST_WRAPPER_KEYS = [
  'data',
  'items',
  'results',
  'records',
  'conversations',
  'notes',
  'files',
  'memories',
  'outputs',
  'automations',
  'runs',
  'skills',
  'mcps',
  'servers',
  'projects',
  'agents',
  'channels',
  'members',
] as const

/**
 * Coerce a list endpoint's response into an array: bare arrays pass through,
 * common envelope shapes get unwrapped, and anything else becomes an empty
 * list (screens render their empty state instead of throwing on iteration).
 */
export function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    for (const key of LIST_WRAPPER_KEYS) {
      const value = record[key]
      if (Array.isArray(value)) return value as T[]
    }
  }
  return []
}

async function toOverlayApiError(response: Response): Promise<OverlayApiError> {
  const text = await response.text().catch(() => '')
  let payload: { error?: unknown; message?: unknown; code?: unknown } | null = null
  try {
    payload = text ? JSON.parse(text) as { error?: unknown; message?: unknown; code?: unknown } : null
  } catch {
    payload = null
  }

  const code = typeof payload?.code === 'string' ? payload.code : undefined
  let raw = String(payload?.message || payload?.error || text || '').trim()
  // A proxy/framework error page (404 text/html, Cloudflare block, ...) is not
  // a user-facing message — don't dump markup into alert dialogs.
  if (raw.startsWith('<')) {
    raw = ''
  }
  const lower = raw.toLowerCase()
  let message: string
  if (response.status === 401) {
    message = 'Session expired. Please sign in again.'
  } else if (response.status === 403 && (lower.includes('storage') || lower.includes('quota'))) {
    message = 'Not enough Overlay storage remaining.'
  } else if (response.status === 403 && (lower.includes('paid plan') || lower.includes('upgrade'))) {
    message = 'This feature requires a paid Overlay plan.'
  } else if (response.status === 402 || lower.includes('budget') || lower.includes('credits')) {
    message = 'Your Overlay budget is exhausted. Review billing on the web app.'
  } else if (response.status >= 500) {
    message = raw || 'Overlay backend is temporarily unavailable.'
  } else {
    message = raw || `Request failed with status ${response.status}`
  }
  return new OverlayApiError(message, response.status, code)
}

export async function readJsonSseStream<T>(
  response: Response,
  onChunk: (chunk: T) => void,
): Promise<void> {
  for await (const chunk of streamJsonSse<T>(response)) {
    onChunk(chunk)
  }
}

export async function* streamJsonSse<T>(response: Response): AsyncGenerator<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Stream failed with status ${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    for (const chunk of parseSseText<T>(text)) {
      yield chunk
    }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  function* parseBuffer(flush = false): Generator<T> {
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex >= 0) {
      const rawEvent = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)

      const chunk = parseSseEvent<T>(rawEvent)
      if (chunk.done) {
        return
      }
      if (chunk.value !== undefined) {
        yield chunk.value
      }

      delimiterIndex = buffer.indexOf('\n\n')
    }

    if (flush && buffer.trim().length > 0) {
      const chunk = parseSseEvent<T>(buffer)
      buffer = ''
      if (chunk.done) {
        return
      }
      if (chunk.value !== undefined) {
        yield chunk.value
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

    for (const chunk of parseBuffer(done)) {
      yield chunk
    }

    if (done) {
      return
    }
  }
}

function xhrRawStream(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): AsyncGenerator<string> {
  const queue: Array<{ text: string } | { error: Error } | null> = []
  let notify: (() => void) | null = null
  let finished = false

  const xhr = new XMLHttpRequest()
  xhr.open(method, url)
  for (const [key, value] of Object.entries(headers)) {
    xhr.setRequestHeader(key, value)
  }

  let position = 0

  function push(item: { text: string } | { error: Error } | null) {
    queue.push(item)
    const fn = notify
    notify = null
    fn?.()
  }

  xhr.onprogress = () => {
    const newText = xhr.responseText.slice(position)
    if (newText.length > 0) {
      position = xhr.responseText.length
      push({ text: newText })
    }
  }

  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      finished = true
      push({ error: new Error(`HTTP ${xhr.status}: ${xhr.statusText || 'Request failed'} — ${xhr.responseText.slice(0, 200)}`) })
      push(null)
      return
    }
    const newText = xhr.responseText.slice(position)
    if (newText.length > 0) {
      position = xhr.responseText.length
      push({ text: newText })
    }
    finished = true
    push(null)
  }

  xhr.onerror = () => {
    finished = true
    push({ error: new Error(`XHR request failed (status ${xhr.status})`) })
  }

  xhr.ontimeout = () => {
    finished = true
    push({ error: new Error('XHR request timed out') })
  }

  xhr.send(body)

  async function* gen(): AsyncGenerator<string> {
    while (true) {
      if (queue.length > 0) {
        const item = queue.shift()!
        if (item === null) return
        if ('error' in item) throw item.error
        yield item.text
      } else if (finished) {
        return
      } else {
        await new Promise<void>((resolve) => {
          notify = resolve
        })
      }
    }
  }

  return gen()
}

async function* xhrStreamSse<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): AsyncGenerator<T> {
  let buffer = ''

  for await (const chunk of xhrRawStream(url, method, headers, body)) {
    buffer += chunk
    let delimiterIndex = buffer.indexOf('\n\n')
    while (delimiterIndex >= 0) {
      const rawEvent = buffer.slice(0, delimiterIndex)
      buffer = buffer.slice(delimiterIndex + 2)
      const result = parseSseEvent<T>(rawEvent)
      if (result.done) return
      if (result.value !== undefined) yield result.value
      delimiterIndex = buffer.indexOf('\n\n')
    }
  }

  if (buffer.trim()) {
    const result = parseSseEvent<T>(buffer)
    if (!result.done && result.value !== undefined) yield result.value
  }
}

export async function* appXhrStreamSse<T>(
  path: string,
  options: AppRequestOptions = {},
): AsyncGenerator<T> {
  const session = await getValidSession()
  const headers: Record<string, string> = { ...options.headers }
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`
  }
  const streamWorkspaceId = resolveWorkspaceId(options)
  if (streamWorkspaceId && !headers[ACTIVE_WORKSPACE_HEADER]) {
    headers[ACTIVE_WORKSPACE_HEADER] = streamWorkspaceId
  }
  withIdempotencyKeyRecord(headers, options.method ?? 'POST')
  let body: string | undefined
  if (options.json) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify({
      ...options.json,
      accessToken: session?.accessToken,
      userId: session?.user.id,
    })
  }
  const url = createUrl(path, session, options.query)
  yield* xhrStreamSse<T>(url, options.method ?? 'POST', headers, body)
}

function* parseSseText<T>(text: string): Generator<T> {
  const normalized = text.replace(/\r\n/g, '\n')
  const events = normalized.split('\n\n')

  for (const rawEvent of events) {
    const chunk = parseSseEvent<T>(rawEvent)
    if (chunk.done) {
      return
    }
    if (chunk.value !== undefined) {
      yield chunk.value
    }
  }
}

function parseSseEvent<T>(
  rawEvent: string,
): { done: true; value?: never } | { done: false; value?: T } {
  const payload = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
    .trim()

  if (!payload) {
    return { done: false }
  }

  if (payload === '[DONE]') {
    return { done: true }
  }

  return { done: false, value: JSON.parse(payload) as T }
}
