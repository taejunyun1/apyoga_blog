import type { AuthEnv } from "./env"

const WINDOW_SECONDS = 600
const MINIMUM_TTL_SECONDS = 60
const LOCKED_FAILURES = 5
const encoder = new TextEncoder()

export interface FailureWindow {
  count: number
  expiresAt: number
}

export async function rateLimitKey(request: Request, secret: string): Promise<string> {
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown"
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(`login:${address}`)),
  )
  return `login:${Array.from(signature).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function freshWindow(nowSeconds: number): FailureWindow {
  return { count: 0, expiresAt: nowSeconds + WINDOW_SECONDS }
}

function lockedWindow(nowSeconds: number): FailureWindow {
  return { count: LOCKED_FAILURES, expiresAt: nowSeconds + WINDOW_SECONDS }
}

export async function readFailures(env: AuthEnv, key: string, nowSeconds: number): Promise<FailureWindow> {
  const stored = await env.AUTH_RATE_LIMIT.get(key)
  if (stored === null) return freshWindow(nowSeconds)

  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch {
    return lockedWindow(nowSeconds)
  }

  if (typeof value !== "object" || value === null) return lockedWindow(nowSeconds)

  const candidate = value as { count?: unknown; expiresAt?: unknown }
  if (
    typeof candidate.count !== "number"
    || !Number.isSafeInteger(candidate.count)
    || candidate.count < 0
    || typeof candidate.expiresAt !== "number"
    || !Number.isSafeInteger(candidate.expiresAt)
    || candidate.expiresAt <= 0
  ) {
    return lockedWindow(nowSeconds)
  }

  const failures = candidate as FailureWindow
  return failures.expiresAt <= nowSeconds ? freshWindow(nowSeconds) : failures
}

export async function recordFailure(env: AuthEnv, key: string, failures: FailureWindow, nowSeconds: number): Promise<void> {
  const value = JSON.stringify({ count: failures.count + 1, expiresAt: failures.expiresAt })
  const expirationTtl = Math.max(MINIMUM_TTL_SECONDS, Math.ceil(failures.expiresAt - nowSeconds))
  await env.AUTH_RATE_LIMIT.put(key, value, { expirationTtl })
}

export async function clearFailures(env: AuthEnv, key: string): Promise<void> {
  await env.AUTH_RATE_LIMIT.delete(key)
}
