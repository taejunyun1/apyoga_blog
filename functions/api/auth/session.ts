import { verifySession } from "../../lib/auth"
import type { AuthEnv, PagesHandler } from "../../lib/env"
import { cookieValue, json } from "../../lib/http"

export async function handleSession(request: Request, env: AuthEnv): Promise<Response> {
  const token = cookieValue(request)
  const authenticated = Boolean(token && env.AUTH_USERNAME && env.SESSION_SECRET && await verifySession(token, env.AUTH_USERNAME, env.SESSION_SECRET))
  return authenticated ? json({ authenticated: true }) : json({ authenticated: false }, 401)
}

export const onRequestGet: PagesHandler<AuthEnv> = ({ request, env }) => handleSession(request, env)
