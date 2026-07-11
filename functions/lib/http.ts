import { SESSION_COOKIE, SESSION_SECONDS } from "./auth"

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } })
}

export function cookieValue(request: Request, name = SESSION_COOKIE): string | null {
  const match = request.headers
    .get("Cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${SESSION_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
}

export function isSameOriginJson(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin && request.headers.get("Content-Type")?.split(";", 1)[0] === "application/json"
}
