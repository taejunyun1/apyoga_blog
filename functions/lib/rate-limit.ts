import type { AuthEnv } from "./env"

const WINDOW_SECONDS = 600
const encoder = new TextEncoder()

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

export async function readFailures(env: AuthEnv, key: string): Promise<number> {
  return Number(await env.AUTH_RATE_LIMIT.get(key) ?? "0") || 0
}

export async function recordFailure(env: AuthEnv, key: string, failures: number): Promise<void> {
  await env.AUTH_RATE_LIMIT.put(key, String(failures + 1), { expirationTtl: WINDOW_SECONDS })
}

export async function clearFailures(env: AuthEnv, key: string): Promise<void> {
  await env.AUTH_RATE_LIMIT.delete(key)
}
