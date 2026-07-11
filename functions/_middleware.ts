import { verifySession } from "./lib/auth"
import type { AuthEnv, PagesHandler } from "./lib/env"
import { cookieValue, json } from "./lib/http"

const PUBLIC = new Set(["/login", "/api/auth/login", "/api/auth/session", "/api/auth/logout"])

export async function protectRequest(
  request: Request,
  env: AuthEnv,
  next: () => Promise<Response>,
): Promise<Response> {
  const url = new URL(request.url)
  if (PUBLIC.has(url.pathname)) return next()

  const token = cookieValue(request)
  if (
    token
    && env.AUTH_USERNAME
    && env.SESSION_SECRET
    && await verifySession(token, env.AUTH_USERNAME, env.SESSION_SECRET)
  ) {
    return next()
  }

  if (url.pathname.startsWith("/api/")) return json({ message: "로그인이 필요해요." }, 401)

  const login = new URL("/login", url)
  login.searchParams.set("next", `${url.pathname}${url.search}`)
  return Response.redirect(login, 302)
}

export const onRequest: PagesHandler<AuthEnv> = ({ request, env, next }) => protectRequest(request, env, next)
